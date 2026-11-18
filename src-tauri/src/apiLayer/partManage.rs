// 部件文件级操作：新建、模板复制、副本克隆、删除、分辨率缩放与 F/B、`R_` 拆分。

use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use crate::accessories;
use crate::baseSizes;
use crate::dataPaths;
use crate::imageOps::{self, Layer, PartEditState};
use crate::layerSidecar;
use crate::skinLoader::{self, PartCategory};
use crate::zones;

use super::types::{
    ApiError, CopyPartParams, CreateOrientationPartParams, CreateOrientationPartResult,
    CreatePartFromTemplateParams, CreatePartParams, CreatePartResult, CreateSidePartParams,
    CreateSidePartResult, DeletePartParams, GetBaseSizeParams, GetBaseSizeResult, ResizePartParams,
    ResizePartResult,
};
use super::{categoryDir, lockSessions, notLoaded, partIdKey, validateSegment, PartSession};

pub(super) fn resizePart(
    sessionsMutex: &Mutex<HashMap<String, PartSession>>,
    params: ResizePartParams,
) -> Result<ResizePartResult, ApiError> {
    if params.width == 0 || params.height == 0 {
        return Err(ApiError {
            code: "invalid_size".into(),
            message: format!("size must be positive: {}x{}", params.width, params.height),
        });
    }
    if params.width > imageOps::MAX_PART_DIM || params.height > imageOps::MAX_PART_DIM {
        return Err(ApiError {
            code: "size_too_large".into(),
            message: format!(
                "size exceeds {}: {}x{}",
                imageOps::MAX_PART_DIM,
                params.width,
                params.height
            ),
        });
    }
    let mut sessions = lockSessions(sessionsMutex)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    let (oldW, oldH) = (session.state.width, session.state.height);
    if oldW == params.width && oldH == params.height {
        return Ok(ResizePartResult {
            partId: params.partId,
            width: oldW,
            height: oldH,
        });
    }

    // 先在临时状态完成缩放并落盘，写盘成功后再替换内存会话，防止 IO 失败导致内存无法回滚。
    let newLayers: Vec<Layer> = session
        .state
        .layers
        .iter()
        .map(|l| Layer {
            id: l.id.clone(),
            name: l.name.clone(),
            visible: l.visible,
            opacity: l.opacity,
            pixels: imageOps::scaleNearest(&l.pixels, oldW, oldH, params.width, params.height),
            transform: None,
        })
        .collect();
    let newState = PartEditState {
        partName: session.state.partName.clone(),
        width: params.width,
        height: params.height,
        layers: newLayers,
    };
    let flat = imageOps::flattenPersisted(&newState);
    let target = dataPaths::resolvePath(&params.targetPath);
    imageOps::savePng(&target, params.width, params.height, &flat)?;

    session.state = newState;
    session.history.clear();
    session.activeStroke = None;

    if target == session.canonicalPngPath() {
        if let Err(e) = layerSidecar::save(
            &session.skinDir,
            session.categoryDir,
            &session.partName,
            &session.state,
            session.activeLayerIndex,
        ) {
            eprintln!("[resizePart] sidecar 写盘失败：{}", e.message);
        }
        let maskFile = session
            .skinDir
            .join(session.categoryDir)
            .join(format!("{}.zones.png", session.partName));
        if maskFile.is_file() {
            if let Some((mw, mh, ids)) = zones::loadMask(&maskFile) {
                let scaledIds =
                    zones::scaleMaskNearest(&ids, mw, mh, params.width, params.height);
                let _ = zones::saveMask(&maskFile, params.width, params.height, &scaledIds);
            }
        }
    }
    Ok(ResizePartResult {
        partId: params.partId,
        width: params.width,
        height: params.height,
    })
}

pub(super) fn getBaseSize(params: GetBaseSizeParams) -> Result<GetBaseSizeResult, ApiError> {
    validateSegment("skinName", &params.skinName)?;
    validateSegment("partName", &params.partName)?;
    let skinDir = dataPaths::resolveSkinRoot(&params.skinRoot).join(&params.skinName);
    let map = baseSizes::load(&skinDir);
    let catDir = categoryDir(params.category);
    let primary = baseSizes::keyFor(catDir, &params.partName);
    let hit = map.get(&primary).or_else(|| {
        let stripped = baseSizes::stripSideSuffixForLookup(&params.partName);
        if stripped == params.partName {
            return None;
        }
        map.get(&baseSizes::keyFor(catDir, stripped))
    });
    match hit {
        Some((w, h)) => Ok(GetBaseSizeResult {
            found: true,
            width: w,
            height: h,
        }),
        None => Ok(GetBaseSizeResult {
            found: false,
            width: 0,
            height: 0,
        }),
    }
}

pub(super) fn createSidePart(
    params: CreateSidePartParams,
) -> Result<CreateSidePartResult, ApiError> {
    validateSegment("skinName", &params.skinName)?;
    validateSegment("partName", &params.partName)?;
    if params.side != "F" && params.side != "B" {
        return Err(ApiError {
            code: "invalid_side".into(),
            message: format!("side must be \"F\" or \"B\", got: {}", params.side),
        });
    }
    if !matches!(params.category, PartCategory::Body | PartCategory::Head)
        || !isSideSplittablePartName(&params.partName)
    {
        return Err(ApiError {
            code: "not_splittable".into(),
            message: format!("part {} is not in side-split whitelist", params.partName),
        });
    }
    if endsWithSideSuffix(&params.partName) {
        return Err(ApiError {
            code: "already_sided".into(),
            message: format!("part {} already has a side suffix", params.partName),
        });
    }
    let skinDir = dataPaths::resolveSkinRoot(&params.skinRoot).join(&params.skinName);
    let catDir = skinDir.join(categoryDir(params.category));
    let src = catDir.join(format!("{}.png", params.partName));
    if !src.exists() {
        return Err(ApiError {
            code: "source_missing".into(),
            message: format!("source PNG not found: {}", src.display()),
        });
    }
    let sideName = format!("{}{}", params.partName, params.side);
    let dst = catDir.join(format!("{}.png", sideName));
    if dst.exists() {
        return Err(ApiError {
            code: "side_part_exists".into(),
            message: format!("side PNG already exists: {}", dst.display()),
        });
    }
    std::fs::copy(&src, &dst).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("copy {} -> {} failed: {}", src.display(), dst.display(), e),
    })?;
    Ok(CreateSidePartResult {
        sidePartName: sideName,
    })
}

pub(super) fn createOrientationPart(
    params: CreateOrientationPartParams,
) -> Result<CreateOrientationPartResult, ApiError> {
    validateSegment("skinName", &params.skinName)?;
    validateSegment("partName", &params.partName)?;
    if params.partName.starts_with("R_") {
        return Err(ApiError {
            code: "already_oriented".into(),
            message: format!("part {} already has R_ prefix", params.partName),
        });
    }
    if !isOrientationSplittablePart(&params.partName, params.category) {
        return Err(ApiError {
            code: "not_orientation_splittable".into(),
            message: format!("part {} is not orientation-splittable", params.partName),
        });
    }
    let skinDir = dataPaths::resolveSkinRoot(&params.skinRoot).join(&params.skinName);
    let catDir = skinDir.join(categoryDir(params.category));
    let src = catDir.join(format!("{}.png", params.partName));
    if !src.exists() {
        return Err(ApiError {
            code: "source_missing".into(),
            message: format!("source PNG not found: {}", src.display()),
        });
    }
    let orientName = format!("R_{}", params.partName);
    let dst = catDir.join(format!("{}.png", orientName));
    if dst.exists() {
        return Err(ApiError {
            code: "orientation_part_exists".into(),
            message: format!("R_ PNG already exists: {}", dst.display()),
        });
    }
    std::fs::copy(&src, &dst).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("copy {} -> {} failed: {}", src.display(), dst.display(), e),
    })?;
    Ok(CreateOrientationPartResult {
        orientationPartName: orientName,
    })
}

pub(super) fn createPart(params: CreatePartParams) -> Result<CreatePartResult, ApiError> {
    validateSegment("skinName", &params.skinName)?;
    let name = validateSegment("fileName", params.fileName.trim())?;
    if params.width == 0
        || params.height == 0
        || params.width > imageOps::MAX_PART_DIM
        || params.height > imageOps::MAX_PART_DIM
    {
        return Err(ApiError {
            code: "invalid_size".into(),
            message: format!("invalid size {}x{}", params.width, params.height),
        });
    }
    let catDirName = categoryDir(params.category);
    let skinDir = dataPaths::resolveSkinRoot(&params.skinRoot).join(&params.skinName);
    let catDir = skinDir.join(catDirName);
    std::fs::create_dir_all(&catDir).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("mkdir {} failed: {}", catDir.display(), e),
    })?;
    let dst = catDir.join(format!("{}.png", name));
    if dst.exists() {
        return Err(ApiError {
            code: "part_exists".into(),
            message: format!("part PNG already exists: {}", dst.display()),
        });
    }
    let pixelCount = (params.width as usize)
        .checked_mul(params.height as usize)
        .ok_or_else(|| ApiError {
            code: "invalid_size".into(),
            message: "pixel count overflow".into(),
        })?;
    let mut pixels = vec![0u8; pixelCount * 4];
    for i in 0..pixelCount {
        pixels[i * 4 + 3] = 255;
    }
    imageOps::savePng(&dst, params.width, params.height, &pixels)?;
    let _ = baseSizes::upsert(
        &skinDir,
        &baseSizes::keyFor(catDirName, name),
        params.width,
        params.height,
    );
    Ok(CreatePartResult {
        partName: name.to_string(),
    })
}

pub(super) fn createPartFromTemplate(
    params: CreatePartFromTemplateParams,
) -> Result<CreatePartResult, ApiError> {
    validateSegment("skinName", &params.skinName)?;
    let name = validateSegment("partName", params.partName.trim())?;
    let baseTemplateName = name.strip_prefix("R_").unwrap_or(name);
    let catDirName = categoryDir(params.category);
    let rel = format!("{}/{}.png", catDirName, name);
    let bytes = crate::embeddedTemplateBytes(&rel)
        .or_else(|| {
            if baseTemplateName != name {
                crate::embeddedTemplateBytes(&format!("{}/{}.png", catDirName, baseTemplateName))
            } else {
                None
            }
        })
        .ok_or_else(|| ApiError {
            code: "template_not_found".into(),
            message: format!("no embedded template at {}", rel),
        })?;
    let skinDir = dataPaths::resolveSkinRoot(&params.skinRoot).join(&params.skinName);
    let catDir = skinDir.join(catDirName);
    let dst = catDir.join(format!("{}.png", name));
    if dst.exists() {
        return Err(ApiError {
            code: "part_exists".into(),
            message: format!("part PNG already exists: {}", dst.display()),
        });
    }
    dataPaths::atomicWrite(&dst, &bytes).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("write {} failed: {}", dst.display(), e),
    })?;
    let (w, h, _) = imageOps::loadPng(&dst)?;
    let _ = baseSizes::upsert(&skinDir, &baseSizes::keyFor(catDirName, name), w, h);
    if matches!(params.category, PartCategory::Accessories) {
        let _ = appendAccessoryEntryFromTemplate(&skinDir, baseTemplateName);
    }
    Ok(CreatePartResult {
        partName: name.to_string(),
    })
}

pub(super) fn copyPart(
    sessionsMutex: &Mutex<HashMap<String, PartSession>>,
    params: CopyPartParams,
) -> Result<CreatePartResult, ApiError> {
    validateSegment("skinName", &params.skinName)?;
    validateSegment("sourcePartName", &params.sourcePartName)?;
    let target = validateSegment("targetPartName", params.targetPartName.trim())?;
    let catDirName = categoryDir(params.category);
    let skinDir = dataPaths::resolveSkinRoot(&params.skinRoot).join(&params.skinName);
    let catDir = skinDir.join(catDirName);
    let dstPng = catDir.join(format!("{}.png", target));
    if dstPng.exists() && !params.overwrite {
        return Err(ApiError {
            code: "part_exists".into(),
            message: format!("target part already exists: {}", dstPng.display()),
        });
    }

    let srcPartId = partIdKey(&params.skinName, params.category, &params.sourcePartName);
    let dstPartId = partIdKey(&params.skinName, params.category, target);
    let (mut state, activeIdx) = {
        let mut sessions = lockSessions(sessionsMutex)?;
        let pair = if let Some(s) = sessions.get(&srcPartId) {
            (s.state.clone(), s.activeLayerIndex)
        } else {
            loadStateFromDisk(&skinDir, catDirName, &params.sourcePartName)?
        };
        sessions.remove(&dstPartId);
        pair
    };
    state.partName = target.to_string();
    let flat = imageOps::flattenPersisted(&state);
    imageOps::savePng(&dstPng, state.width, state.height, &flat)?;
    layerSidecar::save(&skinDir, catDirName, target, &state, activeIdx)?;

    // 优先继承源部件登记的 1x 基准尺寸，避免复制已放大的高清部件时把放大尺寸误写入 `baseSizes.json`。
    let existingBase = baseSizes::load(&skinDir);
    let srcKey = baseSizes::keyFor(catDirName, &params.sourcePartName);
    let (baseW, baseH) = existingBase
        .get(&srcKey)
        .or_else(|| {
            let stripped = baseSizes::stripSideSuffixForLookup(&params.sourcePartName);
            existingBase.get(&baseSizes::keyFor(catDirName, stripped))
        })
        .or_else(|| baseSizes::defaultSize(target))
        .unwrap_or((state.width, state.height));
    let _ = baseSizes::upsert(&skinDir, &baseSizes::keyFor(catDirName, target), baseW, baseH);

    for suffix in ["zones.png", "zones.json"] {
        let srcZone = catDir.join(format!("{}.{}", params.sourcePartName, suffix));
        let dstZone = catDir.join(format!("{}.{}", target, suffix));
        if srcZone.is_file() {
            let _ = std::fs::copy(&srcZone, &dstZone);
        } else if params.overwrite && dstZone.exists() {
            let _ = std::fs::remove_file(&dstZone);
        }
    }
    Ok(CreatePartResult {
        partName: target.to_string(),
    })
}

pub(super) fn deletePart(
    sessionsMutex: &Mutex<HashMap<String, PartSession>>,
    params: DeletePartParams,
) -> Result<(), ApiError> {
    validateSegment("skinName", &params.skinName)?;
    validateSegment("partName", &params.partName)?;
    let catDirName = categoryDir(params.category);
    let skinDir = dataPaths::resolveSkinRoot(&params.skinRoot).join(&params.skinName);
    let catDir = skinDir.join(catDirName);
    let png = catDir.join(format!("{}.png", params.partName));
    if png.exists() {
        std::fs::remove_file(&png).map_err(|e| ApiError {
            code: "io_failed".into(),
            message: format!("remove {} failed: {}", png.display(), e),
        })?;
    }
    for suffix in ["zones.png", "zones.json"] {
        let zoneFile = catDir.join(format!("{}.{}", params.partName, suffix));
        if zoneFile.exists() {
            let _ = std::fs::remove_file(&zoneFile);
        }
    }
    let sideDir = layerSidecar::sidecarDir(&skinDir, catDirName, &params.partName);
    if sideDir.exists() {
        let _ = std::fs::remove_dir_all(&sideDir);
    }
    let _ = baseSizes::remove(&skinDir, &baseSizes::keyFor(catDirName, &params.partName));
    let partId = partIdKey(&params.skinName, params.category, &params.partName);
    let mut sessions = lockSessions(sessionsMutex)?;
    sessions.remove(&partId);
    Ok(())
}

fn loadStateFromDisk(
    skinDir: &Path,
    catDirName: &str,
    partName: &str,
) -> Result<(PartEditState, usize), ApiError> {
    if let Some((state, idx)) = layerSidecar::loadIfPresent(skinDir, catDirName, partName) {
        return Ok((state, idx));
    }
    let png = skinDir.join(catDirName).join(format!("{}.png", partName));
    let decoded = skinLoader::decodePart(&png)?;
    Ok((
        PartEditState {
            partName: partName.to_string(),
            width: decoded.width,
            height: decoded.height,
            layers: vec![Layer {
                id: "layer0".into(),
                name: "layer0".into(),
                visible: true,
                opacity: 255,
                pixels: decoded.pixels,
                transform: None,
            }],
        },
        0,
    ))
}

fn appendAccessoryEntryFromTemplate(skinDir: &Path, accessoryId: &str) -> Result<(), ApiError> {
    let Some(templateBytes) = crate::embeddedTemplateBytes("accessories.json") else {
        return Ok(());
    };
    let templateList: Vec<accessories::AccessoryEntry> =
        serde_json::from_slice(&templateBytes).unwrap_or_default();
    let Some(entry) = templateList.into_iter().find(|e| e.id == accessoryId) else {
        return Ok(());
    };
    let path = accessories::accessoriesPath(
        skinDir.parent().unwrap_or(Path::new("")),
        skinDir.file_name().and_then(|s| s.to_str()).unwrap_or(""),
    );
    let mut list = accessories::loadAccessories(&path);
    if list.iter().any(|e| e.id == accessoryId) {
        return Ok(());
    }
    list.push(entry);
    accessories::saveAccessories(&path, &list)
}

fn isSideSplittablePartName(partName: &str) -> bool {
    let lower = partName.to_ascii_lowercase();
    if lower.ends_with("handf") || lower.ends_with("handb") {
        return false;
    }
    const SHARED_SUFFIXES: &[&str] = &[
        "uptorso",
        "downtorso",
        "head",
        "headback",
        "uparm",
        "downarm",
        "mildownarm",
        "milkytorso",
        "thigh",
        "crus",
        "foot",
        "tail",
    ];
    SHARED_SUFFIXES.iter().any(|s| lower.ends_with(s))
}

fn endsWithSideSuffix(partName: &str) -> bool {
    partName.ends_with('F') || partName.ends_with('B')
}

fn isOrientationSplittablePart(partName: &str, category: PartCategory) -> bool {
    !partName.is_empty()
        && !partName.starts_with("R_")
        && matches!(
            category,
            PartCategory::Body | PartCategory::Head | PartCategory::Accessories
        )
}
