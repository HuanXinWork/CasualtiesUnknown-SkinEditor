// 动作捕捉文件读取与逐帧角色合成渲染。

use std::collections::HashMap;
use std::path::Path;

use crate::accessories;
use crate::assemblyTable::{self, AssemblyEntry, AssemblyPosition, HeadVariant};
use crate::baseSizes;
use crate::dataPaths;
use crate::imageOps;
use crate::skinLoader::PartCategory;

use super::composite::{
    applyBaseSizeFit, pickPartPixels, resolveActualPartName, sidedCandidateName, AccDrawSpec,
    COMPOSITE_H, COMPOSITE_W,
};
use super::types::{
    ApiError, MotionCaptureFile, MotionCaptureFrame, MotionCaptureLimb, MotionCaptureListParams,
    MotionCaptureMeta, MotionCaptureResult, MotionCompositeParams, MotionCompositeResult,
};
use super::zoneRender::{renderZoneEffectsForPart, renderZoneLightsForPart};
use super::{categoryDir, PartSession};

pub(super) fn listMotionCaptures(
    params: MotionCaptureListParams,
) -> Result<Vec<MotionCaptureMeta>, ApiError> {
    let root = dataPaths::resolvePath(&params.captureRoot);
    if !root.exists() {
        std::fs::create_dir_all(&root).map_err(|e| ApiError {
            code: "capture_root_failed".into(),
            message: format!("create {} failed: {}", root.display(), e),
        })?;
        return Ok(Vec::new());
    }
    let entries = std::fs::read_dir(&root).map_err(|e| ApiError {
        code: "capture_root_failed".into(),
        message: format!("read_dir {} failed: {}", root.display(), e),
    })?;
    let mut out = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| ApiError {
            code: "capture_root_failed".into(),
            message: format!("read_dir {} failed: {}", root.display(), e),
        })?;
        let path = entry.path();
        if path
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.eq_ignore_ascii_case("json"))
            != Some(true)
        {
            continue;
        }
        let Ok(capture) = readMotionCapture(&path) else {
            continue;
        };
        out.push(MotionCaptureMeta {
            path: path.to_string_lossy().into_owned(),
            fileName: path
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or_default()
                .to_string(),
            frameCount: capture.frameCount,
            durationSeconds: capture.frames.last().map(|f| f.t).unwrap_or(0.0),
        });
    }
    out.sort_by(|a, b| a.fileName.cmp(&b.fileName));
    Ok(out)
}

pub(super) fn loadMotionCapture(path: String) -> Result<MotionCaptureResult, ApiError> {
    let pathBuf = dataPaths::resolvePath(&path);
    let capture = readMotionCapture(&pathBuf)?;
    Ok(MotionCaptureResult {
        path: pathBuf.to_string_lossy().into_owned(),
        fileName: pathBuf
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string(),
        version: capture.version,
        modVersion: capture.modVersion,
        startedAtUnixMs: capture.startedAtUnixMs,
        playerName: capture.playerName,
        frameCount: capture.frameCount,
        durationSeconds: capture.frames.last().map(|f| f.t).unwrap_or(0.0),
        frames: capture.frames,
    })
}

pub(super) fn readMotionCapture(path: &Path) -> Result<MotionCaptureFile, ApiError> {
    let bytes = std::fs::read(path).map_err(|e| ApiError {
        code: "capture_not_found".into(),
        message: format!("read {} failed: {}", path.display(), e),
    })?;
    serde_json::from_slice::<MotionCaptureFile>(&bytes).map_err(|e| ApiError {
        code: "capture_parse_failed".into(),
        message: format!("parse {} failed: {}", path.display(), e),
    })
}

pub(super) fn renderMotionComposite(
    params: &MotionCompositeParams,
    capture: &MotionCaptureFile,
    sessions: &HashMap<String, PartSession>,
) -> Result<MotionCompositeResult, ApiError> {
    let frame = capture
        .frames
        .get(params.frameIndex)
        .cloned()
        .ok_or_else(|| ApiError {
            code: "frame_out_of_range".into(),
            message: format!(
                "frame {} out of range (len {})",
                params.frameIndex,
                capture.frames.len()
            ),
        })?;

    let skinRoot = dataPaths::resolvePath(&params.skinRoot);
    let skinDir = skinRoot.join(&params.skinName);
    let baseSizesMap = baseSizes::load(&skinDir);
    let mut entries =
        buildMotionCompositeEntries(&frame, params.expressionIndex, &params.headVariant);

    let accList =
        accessories::loadAccessories(&accessories::accessoriesPath(&skinRoot, &params.skinName));
    let mut accSpecs: HashMap<String, AccDrawSpec<'_>> = HashMap::new();
    for a in accList.iter().filter(|a| a.enabled) {
        if let Some(parent) = findMotionLimbForAccessory(&frame, &a.limb) {
            let tag = format!("__acc:{}", a.id);
            accSpecs.insert(
                tag.clone(),
                AccDrawSpec {
                    sprite: a.sprite.as_str(),
                    offX: a.offX,
                    offY: a.offY,
                    parentRot: parent.rotZ,
                },
            );
            entries.push((
                AssemblyEntry {
                    partName: tag,
                    category: PartCategory::Accessories,
                    position: motionCompositePosition(parent),
                    zOrder: parent.sortingOrder + a.z,
                    flipX: false,
                    rotation: parent.rotZ + a.rot,
                    variants: None,
                },
                None,
            ));
        }
        if let Some(secs) = &a.secondaryLimbs {
            for (idx, sec) in secs.iter().enumerate() {
                let Some(secParent) = findMotionLimbForAccessory(&frame, &sec.limb) else {
                    continue;
                };
                let tag = format!("__acc:{}#{}", a.id, idx);
                accSpecs.insert(
                    tag.clone(),
                    AccDrawSpec {
                        sprite: sec.sprite.as_str(),
                        offX: sec.offX,
                        offY: sec.offY,
                        parentRot: secParent.rotZ,
                    },
                );
                entries.push((
                    AssemblyEntry {
                        partName: tag,
                        category: PartCategory::Accessories,
                        position: motionCompositePosition(secParent),
                        zOrder: secParent.sortingOrder + sec.z,
                        flipX: false,
                        rotation: secParent.rotZ + sec.rot,
                        variants: None,
                    },
                    None,
                ));
            }
        }
    }

    entries.sort_by_key(|(e, _)| e.zOrder);
    let mut canvas = vec![0u8; (COMPOSITE_W * COMPOSITE_H * 4) as usize];

    for (entry, sideHint) in entries {
        if entry.category == PartCategory::Accessories {
            let Some(spec) = accSpecs.get(&entry.partName) else {
                continue;
            };
            let Some((pickedName, rawW, rawH, rawPixels)) = pickPartPixels(
                sessions,
                &skinDir,
                &params.skinName,
                PartCategory::Accessories,
                spec.sprite,
                None,
                frame.isRight,
            ) else {
                continue;
            };
            let (partW, partH, pixels) = applyBaseSizeFit(
                &baseSizesMap,
                PartCategory::Accessories,
                &pickedName,
                spec.sprite,
                rawW,
                rawH,
                rawPixels,
            );
            let parentRad = -spec.parentRot.to_radians();
            let c = parentRad.cos();
            let s = parentRad.sin();
            let dx = (spec.offX as f32) * c - (spec.offY as f32) * s;
            let dy = (spec.offX as f32) * s + (spec.offY as f32) * c;
            let centerX = (COMPOSITE_W as i32) / 2 + entry.position.x + dx.round() as i32;
            let centerY = (COMPOSITE_H as i32) / 2 + entry.position.y + dy.round() as i32;
            imageOps::blitWithRotation(
                &mut canvas,
                COMPOSITE_W,
                COMPOSITE_H,
                &pixels,
                partW,
                partH,
                centerX,
                centerY,
                entry.rotation,
                false,
            );
            renderZoneLightsForPart(
                &mut canvas,
                COMPOSITE_W,
                COMPOSITE_H,
                &skinRoot,
                &params.skinName,
                "Accessories",
                &pickedName,
                spec.sprite,
                partW,
                partH,
                centerX,
                centerY,
                entry.rotation,
                false,
                params.timeSec,
            );
            renderZoneEffectsForPart(
                &mut canvas,
                COMPOSITE_W,
                COMPOSITE_H,
                &skinRoot,
                &params.skinName,
                "Accessories",
                &pickedName,
                spec.sprite,
                partW,
                partH,
                centerX,
                centerY,
                entry.rotation,
                false,
                params.timeSec,
                sessions,
            );
            continue;
        }

        let actualBase = resolveActualPartName(
            &skinDir,
            entry.category,
            &entry.partName,
            sessions,
            &params.skinName,
        );
        let sidedName = sideHint.and_then(|c| sidedCandidateName(&actualBase, c));
        let Some((pickedName, rawW, rawH, rawPixels)) = pickPartPixels(
            sessions,
            &skinDir,
            &params.skinName,
            entry.category,
            &actualBase,
            sidedName.as_deref(),
            frame.isRight,
        ) else {
            continue;
        };
        let (partW, partH, pixels) = applyBaseSizeFit(
            &baseSizesMap,
            entry.category,
            &pickedName,
            &actualBase,
            rawW,
            rawH,
            rawPixels,
        );
        let centerX = (COMPOSITE_W as i32) / 2 + entry.position.x;
        let centerY = (COMPOSITE_H as i32) / 2 + entry.position.y;
        imageOps::blitWithRotation(
            &mut canvas,
            COMPOSITE_W,
            COMPOSITE_H,
            &pixels,
            partW,
            partH,
            centerX,
            centerY,
            entry.rotation,
            false,
        );
        let catDir = categoryDir(entry.category);
        renderZoneLightsForPart(
            &mut canvas,
            COMPOSITE_W,
            COMPOSITE_H,
            &skinRoot,
            &params.skinName,
            catDir,
            &pickedName,
            &actualBase,
            partW,
            partH,
            centerX,
            centerY,
            entry.rotation,
            false,
            params.timeSec,
        );
        renderZoneEffectsForPart(
            &mut canvas,
            COMPOSITE_W,
            COMPOSITE_H,
            &skinRoot,
            &params.skinName,
            catDir,
            &pickedName,
            &actualBase,
            partW,
            partH,
            centerX,
            centerY,
            entry.rotation,
            false,
            params.timeSec,
            sessions,
        );
    }

    Ok(MotionCompositeResult {
        width: COMPOSITE_W,
        height: COMPOSITE_H,
        pixels: canvas,
        frame,
    })
}

fn findMotionLimbForAccessory<'a>(
    frame: &'a MotionCaptureFrame,
    limb: &str,
) -> Option<&'a MotionCaptureLimb> {
    if let Some(hit) = frame.limbs.iter().find(|l| l.visible && l.name == limb) {
        return Some(hit);
    }
    let fallback = match limb {
        "UpArm" => "UpArmF",
        "DownArm" => "DownArmF",
        "Hand" => "HandF",
        "Thigh" => "ThighF",
        "Crus" => "CrusF",
        "Foot" => "FootF",
        _ => return None,
    };
    frame.limbs.iter().find(|l| l.visible && l.name == fallback)
}

fn motionEyePartName(expression: i32) -> &'static str {
    match expression {
        1 => "experimentEyeHalfClosed",
        2 => "experimentEyeClosed",
        3 => "experimentEyeScared",
        4 => "experimentEyePanic",
        5 => "experimentEyeSad",
        6 => "experimentEyeHappy",
        7 => "experimentEyeLockedIn",
        _ => "experimentEyeOpen",
    }
}

fn motionHeadPartName(headVariant: &Option<HeadVariant>, captured: &str) -> String {
    match headVariant.clone().unwrap_or(HeadVariant::Default) {
        HeadVariant::Default => {
            if captured.is_empty() {
                "experimentHeadBack".to_string()
            } else {
                captured.to_string()
            }
        }
        HeadVariant::MouthHalf => "experimentHeadBackMouthMini".to_string(),
        HeadVariant::Mouth => "experimentHeadBackMouth".to_string(),
        HeadVariant::Disfigured1 => "experimentHeadDisfigured1".to_string(),
        HeadVariant::Disfigured2 => "experimentHeadDisfigured2".to_string(),
        HeadVariant::Disfigured3 => "experimentHeadDisfigured3".to_string(),
        HeadVariant::Disfigured1Healed => "experimentHeadDisfigured1Healed".to_string(),
        HeadVariant::Disfigured2Healed => "experimentHeadDisfigured2Healed".to_string(),
        HeadVariant::Disfigured3Healed => "experimentHeadDisfigured3Healed".to_string(),
    }
}

fn motionBodyPartName(limbName: &str) -> Option<&'static str> {
    match limbName {
        "UpTorso" => Some("experimentUpTorso"),
        "DownTorso" => Some("experimentDownTorso"),
        "UpArmF" | "UpArmB" => Some("experimentUpArm"),
        "DownArmF" | "DownArmB" => Some("experimentDownArm"),
        "HandF" => Some("experimentHandF"),
        "HandB" => Some("experimentHandB"),
        "ThighF" | "ThighB" => Some("experimentThigh"),
        "CrusF" | "CrusB" => Some("experimentCrus"),
        "FootF" | "FootB" => Some("experimentFoot"),
        "Tail" | "experimentTail" => Some("experimentTail"),
        _ => None,
    }
}

fn motionCompositePosition(limb: &MotionCaptureLimb) -> AssemblyPosition {
    let isAttached = matches!(
        limb.name.as_str(),
        "Tail" | "experimentTail" | "wingUL" | "wingUR" | "wingDL" | "wingDR"
    );
    let (x, y) = if isAttached {
        (limb.bcx, limb.bcy)
    } else {
        (limb.px, limb.py)
    };
    AssemblyPosition {
        x: (x * 8.0).round() as i32,
        y: (-y * 8.0).round() as i32,
    }
}

pub(super) fn buildMotionCompositeEntries(
    frame: &MotionCaptureFrame,
    expressionIndex: u8,
    headVariant: &Option<HeadVariant>,
) -> Vec<(AssemblyEntry, Option<char>)> {
    let mut out: Vec<(AssemblyEntry, Option<char>)> = Vec::new();
    let mut headPose: Option<(AssemblyPosition, f32)> = None;
    for limb in &frame.limbs {
        if !limb.visible {
            continue;
        }
        let sideHint: Option<char> = limb.name.chars().last().filter(|c| *c == 'F' || *c == 'B');
        if limb.name == "Head" {
            let pos = motionCompositePosition(limb);
            let partName = motionHeadPartName(headVariant, &limb.spriteName);
            headPose = Some((pos, limb.rotZ));
            out.push((
                AssemblyEntry {
                    partName,
                    category: PartCategory::Head,
                    position: pos,
                    zOrder: limb.sortingOrder,
                    flipX: false,
                    rotation: limb.rotZ,
                    variants: None,
                },
                None,
            ));
            continue;
        }
        if matches!(
            limb.name.as_str(),
            "wingUL" | "wingUR" | "wingDL" | "wingDR"
        ) {
            out.push((
                AssemblyEntry {
                    partName: limb.name.clone(),
                    category: PartCategory::Wings,
                    position: motionCompositePosition(limb),
                    zOrder: limb.sortingOrder,
                    flipX: false,
                    rotation: limb.rotZ,
                    variants: None,
                },
                None,
            ));
            continue;
        }
        let Some(partName) = motionBodyPartName(&limb.name) else {
            continue;
        };
        out.push((
            AssemblyEntry {
                partName: partName.to_string(),
                category: PartCategory::Body,
                position: motionCompositePosition(limb),
                zOrder: limb.sortingOrder,
                flipX: false,
                rotation: limb.rotZ,
                variants: None,
            },
            sideHint,
        ));
    }

    if let Some((pos, rot)) = headPose {
        out.push((
            AssemblyEntry {
                partName: motionEyePartName(i32::from(expressionIndex)).to_string(),
                category: PartCategory::Head,
                position: pos,
                zOrder: 53,
                flipX: false,
                rotation: rot,
                variants: None,
            },
            None,
        ));
    }

    let hasTail = frame
        .limbs
        .iter()
        .any(|limb| limb.visible && (limb.name == "Tail" || limb.name == "experimentTail"));
    if !hasTail {
        if let Some(tail) = defaultAssemblyTailEntry() {
            out.push((tail, None));
        }
    }
    out
}

fn defaultAssemblyTailEntry() -> Option<AssemblyEntry> {
    assemblyTable::defaultAssembly()
        .parts
        .into_iter()
        .find(|e| e.category == PartCategory::Body && e.partName == "experimentTail")
}
