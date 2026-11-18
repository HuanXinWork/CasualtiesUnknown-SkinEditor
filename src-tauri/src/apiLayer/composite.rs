// 静态角色装配合成与跨角色贴图选取（对齐 SkinSync `SkinPreviewRenderer`）。

use std::collections::HashMap;
use std::path::Path;

use crate::accessories;
use crate::assemblyTable::{
    self, AssemblyEntry, AssemblyPosition, AssemblyVariants, HeadVariant, Orientation,
};
use crate::baseSizes;
use crate::dataPaths;
use crate::imageOps;
use crate::skinLoader::{self, PartCategory};

use super::types::{
    ApiError, AssemblyOverride, CompositeParams, CompositeResult, WingPieceConfig, WingsConfig,
};
use super::zoneRender::{renderZoneEffectsForPart, renderZoneLightsForPart};
use super::{categoryDir, partIdKey, PartSession};

pub(super) const COMPOSITE_W: u32 = 100;
pub(super) const COMPOSITE_H: u32 = 100;

pub(super) struct AccDrawSpec<'a> {
    pub(super) sprite: &'a str,
    pub(super) offX: i32,
    pub(super) offY: i32,
    pub(super) parentRot: f32,
}

pub(super) fn renderComposite(
    params: &CompositeParams,
    wingsConfig: Option<&WingsConfig>,
    overrides: &HashMap<(String, PartCategory), AssemblyOverride>,
    sessions: &HashMap<String, PartSession>,
) -> Result<CompositeResult, ApiError> {
    let skinRoot = dataPaths::resolvePath(&params.skinRoot);
    let skinDir = skinRoot.join(&params.skinName);
    let (table, _source) = assemblyTable::loadAssembly(&skinRoot.join("assembly.json"));
    let baseSizesMap = baseSizes::load(&skinDir);

    let mut entries: Vec<&AssemblyEntry> = table
        .parts
        .iter()
        .filter(|e| {
            variantMatches(
                &e.variants,
                &params.orientation,
                params.expressionIndex,
                &params.headVariant,
            )
        })
        .collect();

    let wingPiece = |name: &str| -> Option<&WingPieceConfig> {
        wingsConfig.and_then(|c| match name {
            "wingUL" => Some(&c.wingUL),
            "wingDL" => Some(&c.wingDL),
            "wingUR" => Some(&c.wingUR),
            "wingDR" => Some(&c.wingDR),
            _ => None,
        })
    };
    let resolveWingPos =
        |entry: &AssemblyEntry, ovr: Option<&AssemblyOverride>| -> AssemblyPosition {
            if let Some(o) = ovr {
                return o.position;
            }
            if let Some(p) = wingPiece(&entry.partName) {
                return AssemblyPosition { x: p.x, y: p.y };
            }
            entry.position
        };
    let resolveWingRot = |entry: &AssemblyEntry, ovr: Option<&AssemblyOverride>| -> f32 {
        if let Some(r) = ovr.and_then(|o| o.rotation) {
            return r;
        }
        if let Some(p) = wingPiece(&entry.partName) {
            return p.rotation;
        }
        entry.rotation
    };
    let resolveWingZ = |entry: &AssemblyEntry, ovr: Option<&AssemblyOverride>| -> i32 {
        if let Some(z) = ovr.and_then(|o| o.zOrder) {
            return z;
        }
        if let Some(p) = wingPiece(&entry.partName) {
            return p.zOrder;
        }
        entry.zOrder
    };

    // 上翼关节高度必须基于 `baseSizes` 缩回后的逻辑高度计算，避免高清上翼导致下翼飞出。
    let upperWingPose = |upperName: &str| -> Option<(AssemblyPosition, f32, f32)> {
        let entry = entries
            .iter()
            .find(|e| e.partName == upperName && e.category == PartCategory::Wings)?;
        let ovr = overrides.get(&(entry.partName.clone(), entry.category));
        let pos = resolveWingPos(entry, ovr);
        let rotation = resolveWingRot(entry, ovr);
        let baseH = baseSizesMap
            .get(&baseSizes::keyFor("Wings", &entry.partName))
            .map(|(_, h)| h);
        let effectiveH = if let Some(bh) = baseH {
            bh as f32
        } else {
            let key = partIdKey(&params.skinName, entry.category, &entry.partName);
            if let Some(session) = sessions.get(&key) {
                session.state.height as f32
            } else {
                let pngPath = skinDir
                    .join("Wings")
                    .join(format!("{}.png", entry.partName));
                skinLoader::decodePart(&pngPath)
                    .map(|d| d.height as f32)
                    .unwrap_or(32.0)
            }
        };
        Some((pos, rotation, effectiveH * 0.5))
    };
    let lowerLAnchor = upperWingPose("wingUL");
    let lowerRAnchor = upperWingPose("wingUR");

    let accList =
        accessories::loadAccessories(&accessories::accessoriesPath(&skinRoot, &params.skinName));
    let mut accVirtuals: Vec<AssemblyEntry> = Vec::new();
    let mut accSpecs: HashMap<String, AccDrawSpec<'_>> = HashMap::new();
    for a in accList.iter().filter(|a| a.enabled) {
        if let Some(parent) = accessoryParentEntry(&table, &a.limb) {
            let tag = format!("__acc:{}", a.id);
            accSpecs.insert(
                tag.clone(),
                AccDrawSpec {
                    sprite: a.sprite.as_str(),
                    offX: a.offX,
                    offY: a.offY,
                    parentRot: parent.rotation,
                },
            );
            accVirtuals.push(AssemblyEntry {
                partName: tag,
                category: PartCategory::Accessories,
                position: parent.position,
                zOrder: parent.zOrder + a.z,
                flipX: parent.flipX,
                rotation: parent.rotation + a.rot,
                variants: None,
            });
        }
        if let Some(secs) = &a.secondaryLimbs {
            for (idx, sec) in secs.iter().enumerate() {
                let Some(secParent) = accessoryParentEntry(&table, &sec.limb) else {
                    continue;
                };
                let tag = format!("__acc:{}#{}", a.id, idx);
                accSpecs.insert(
                    tag.clone(),
                    AccDrawSpec {
                        sprite: sec.sprite.as_str(),
                        offX: sec.offX,
                        offY: sec.offY,
                        parentRot: secParent.rotation,
                    },
                );
                accVirtuals.push(AssemblyEntry {
                    partName: tag,
                    category: PartCategory::Accessories,
                    position: secParent.position,
                    zOrder: secParent.zOrder + sec.z,
                    flipX: secParent.flipX,
                    rotation: secParent.rotation + sec.rot,
                    variants: None,
                });
            }
        }
    }
    for v in &accVirtuals {
        entries.push(v);
    }

    entries.sort_by_key(|e| {
        let ovr = overrides.get(&(e.partName.clone(), e.category));
        if e.category == PartCategory::Wings {
            resolveWingZ(e, ovr)
        } else {
            ovr.and_then(|o| o.zOrder).unwrap_or(e.zOrder)
        }
    });

    let mut canvas = vec![0u8; (COMPOSITE_W * COMPOSITE_H * 4) as usize];
    for entry in entries {
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
                params.isRight,
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
                entry.flipX,
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
                entry.flipX,
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
                entry.flipX,
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
        let sideChar = if entry.zOrder >= 0 { 'F' } else { 'B' };
        let sidedName = sidedCandidateName(&actualBase, sideChar);
        let Some((pickedName, rawW, rawH, rawPixels)) = pickPartPixels(
            sessions,
            &skinDir,
            &params.skinName,
            entry.category,
            &actualBase,
            sidedName.as_deref(),
            params.isRight,
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

        let ovr = overrides.get(&(entry.partName.clone(), entry.category));
        let mut pos;
        let mut rotation;
        let flipX;
        if entry.category == PartCategory::Wings {
            pos = resolveWingPos(entry, ovr);
            rotation = resolveWingRot(entry, ovr);
            flipX = ovr.and_then(|o| o.flipX).unwrap_or(entry.flipX);
        } else {
            pos = ovr.map(|o| o.position).unwrap_or(entry.position);
            rotation = ovr.and_then(|o| o.rotation).unwrap_or(entry.rotation);
            flipX = ovr.and_then(|o| o.flipX).unwrap_or(entry.flipX);
        }

        if entry.category == PartCategory::Wings {
            let anchor = match entry.partName.as_str() {
                "wingDL" => lowerLAnchor.as_ref(),
                "wingDR" => lowerRAnchor.as_ref(),
                _ => None,
            };
            if let Some((rootPos, rootRot, halfH)) = anchor {
                let localX = pos.x as f32;
                let localY = halfH + pos.y as f32;
                let rad = -rootRot.to_radians();
                let c = rad.cos();
                let s = rad.sin();
                let dx = localX * c - localY * s;
                let dy = localX * s + localY * c;
                pos = AssemblyPosition {
                    x: rootPos.x + dx.round() as i32,
                    y: rootPos.y + dy.round() as i32,
                };
                rotation += rootRot;
            }
        }

        let centerX = (COMPOSITE_W as i32) / 2 + pos.x;
        let centerY = (COMPOSITE_H as i32) / 2 + pos.y;
        imageOps::blitWithRotation(
            &mut canvas,
            COMPOSITE_W,
            COMPOSITE_H,
            &pixels,
            partW,
            partH,
            centerX,
            centerY,
            rotation,
            flipX,
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
            rotation,
            flipX,
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
            rotation,
            flipX,
            params.timeSec,
            sessions,
        );
    }

    Ok(CompositeResult {
        width: COMPOSITE_W,
        height: COMPOSITE_H,
        pixels: canvas,
    })
}

fn accessoryParentEntry<'a>(
    table: &'a assemblyTable::AssemblyTable,
    limb: &str,
) -> Option<&'a AssemblyEntry> {
    let (base, sideSign): (&str, Option<i32>) = match limb {
        "Head" => {
            return table.parts.iter().find(|e| {
                e.partName == "experimentHeadBack"
                    && matches!(
                        e.variants.as_ref().and_then(|v| v.headVariant.as_ref()),
                        Some(HeadVariant::Default)
                    )
            })
        }
        "UpTorso" => ("experimentUpTorso", None),
        "DownTorso" => ("experimentDownTorso", None),
        "Tail" => ("experimentTail", None),
        "HandF" | "Hand" => ("experimentHandF", None),
        "HandB" => ("experimentHandB", None),
        "UpArmF" | "UpArm" => ("experimentUpArm", Some(1)),
        "UpArmB" => ("experimentUpArm", Some(-1)),
        "DownArmF" | "DownArm" => ("experimentDownArm", Some(1)),
        "DownArmB" => ("experimentDownArm", Some(-1)),
        "ThighF" | "Thigh" => ("experimentThigh", Some(1)),
        "ThighB" => ("experimentThigh", Some(-1)),
        "CrusF" | "Crus" => ("experimentCrus", Some(1)),
        "CrusB" => ("experimentCrus", Some(-1)),
        "FootF" | "Foot" => ("experimentFoot", Some(1)),
        "FootB" => ("experimentFoot", Some(-1)),
        _ => (limb, None),
    };
    table.parts.iter().find(|e| {
        if e.partName != base {
            return false;
        }
        match sideSign {
            None => true,
            Some(1) => e.zOrder >= 0,
            Some(-1) => e.zOrder < 0,
            _ => true,
        }
    })
}

fn variantMatches(
    variants: &Option<AssemblyVariants>,
    orientation: &Orientation,
    expressionIndex: u8,
    headVariant: &Option<HeadVariant>,
) -> bool {
    let Some(v) = variants else {
        return true;
    };
    if let Some(o) = &v.orientation {
        if o != orientation {
            return false;
        }
    }
    if let Some(idx) = v.expressionIndex {
        if idx != expressionIndex {
            return false;
        }
    }
    if let Some(hv) = &v.headVariant {
        let effective = headVariant.clone().unwrap_or(HeadVariant::Default);
        if hv != &effective {
            return false;
        }
    }
    true
}

/// 当默认 `experiment*` 贴图不存在时，按词根回退匹配 `milky*` / `dune*` 等跨角色贴图名。
pub(super) fn resolveActualPartName(
    skinDir: &Path,
    category: PartCategory,
    defaultName: &str,
    sessions: &HashMap<String, PartSession>,
    skinName: &str,
) -> String {
    let catDirName = categoryDir(category);
    let directKey = partIdKey(skinName, category, defaultName);
    if sessions.contains_key(&directKey)
        || skinDir
            .join(catDirName)
            .join(format!("{}.png", defaultName))
            .is_file()
    {
        return defaultName.to_string();
    }
    let Some(lemma) = defaultName.strip_prefix("experiment") else {
        return defaultName.to_string();
    };
    if lemma.is_empty() {
        return defaultName.to_string();
    }
    let dir = skinDir.join(catDirName);
    let Ok(rd) = std::fs::read_dir(&dir) else {
        return defaultName.to_string();
    };
    let mut stems: Vec<String> = rd
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if !p.is_file() {
                return None;
            }
            let fname = p.file_name()?.to_str()?;
            if !fname.to_ascii_lowercase().ends_with(".png")
                || fname.to_ascii_lowercase().ends_with(".zones.png")
            {
                return None;
            }
            let stem = Path::new(fname).file_stem()?.to_str()?;
            if stem.starts_with("R_") {
                return None;
            }
            Some(stem.to_string())
        })
        .collect();
    stems.sort();

    let aliases: &[&str] = match lemma {
        "UpTorso" => &["milkytorso"],
        "DownTorso" => &["milkydowntorso"],
        "DownArm" => &["mildownarm"],
        "HeadBackMouth" => &["milkyheadbackmouthopen", "duneHeadMouth"],
        "HeadBackMouthMini" => &["milkyheadbackmouthhalfopen", "duneHeadMouthHalf"],
        "HeadDisfigured1" => &["milkydisfigure1", "duneDisfigured"],
        "HeadDisfigured1Healed" => &["milkydisfigure1healed", "duneDisfiguredHealed"],
        "HeadDisfigured2" => &["milkydisfigure2"],
        "HeadDisfigured2Healed" => &["milkydisfigure2healed"],
        _ => &[],
    };
    for alias in aliases {
        if let Some(hit) = stems.iter().find(|s| s.eq_ignore_ascii_case(alias)) {
            return hit.clone();
        }
    }
    let lemmaLower = lemma.to_ascii_lowercase();
    if let Some(hit) = stems
        .iter()
        .find(|s| s.to_ascii_lowercase().ends_with(&lemmaLower))
    {
        return hit.clone();
    }
    defaultName.to_string()
}

pub(super) fn sidedCandidateName(actualBase: &str, side: char) -> Option<String> {
    if side != 'F' && side != 'B' {
        return None;
    }
    if side == 'B' && actualBase.starts_with("dune") {
        const DUNE_ALT: &[&str] = &["UpArm", "DownArm", "Hand", "Thigh"];
        if DUNE_ALT.iter().any(|l| actualBase.ends_with(l)) {
            return Some(format!("{}Alt", actualBase));
        }
    }
    const SHARED_SUFFIXES: &[&str] = &[
        "UpArm",
        "DownArm",
        "Thigh",
        "Crus",
        "Foot",
        "UpTorso",
        "DownTorso",
        "Head",
        "HeadBack",
        "Tail",
        "mildownarm",
        "milkytorso",
    ];
    let lower = actualBase.to_ascii_lowercase();
    if SHARED_SUFFIXES
        .iter()
        .any(|s| lower.ends_with(&s.to_ascii_lowercase()))
    {
        Some(format!("{}{}", actualBase, side))
    } else {
        None
    }
}

/// 按 `R_<sided> -> R_<base> -> <sided> -> <base>` 优先级依次查询内存会话与磁盘 PNG，并返回实际命中的部件名。
pub(super) fn pickPartPixels(
    sessions: &HashMap<String, PartSession>,
    skinDir: &Path,
    skinName: &str,
    category: PartCategory,
    basePart: &str,
    sided: Option<&str>,
    isRight: bool,
) -> Option<(String, u32, u32, Vec<u8>)> {
    let mut candidates: Vec<String> = Vec::with_capacity(4);
    if isRight {
        if let Some(s) = sided {
            candidates.push(format!("R_{}", s));
        }
        candidates.push(format!("R_{}", basePart));
    }
    if let Some(s) = sided {
        candidates.push(s.to_string());
    }
    candidates.push(basePart.to_string());

    let catDirName = categoryDir(category);
    for name in candidates {
        let key = partIdKey(skinName, category, &name);
        if let Some(session) = sessions.get(&key) {
            return Some((
                name,
                session.state.width,
                session.state.height,
                imageOps::flatten(&session.state),
            ));
        }
        let png = skinDir.join(catDirName).join(format!("{}.png", name));
        if png.exists() {
            if let Ok(d) = skinLoader::decodePart(&png) {
                return Some((name, d.width, d.height, d.pixels));
            }
        }
    }
    None
}

pub(super) fn applyBaseSizeFit(
    map: &baseSizes::BaseSizes,
    category: PartCategory,
    primaryName: &str,
    fallbackName: &str,
    w: u32,
    h: u32,
    pixels: Vec<u8>,
) -> (u32, u32, Vec<u8>) {
    let catDir = categoryDir(category);
    let primaryKey = baseSizes::keyFor(catDir, primaryName);
    let noOrient = primaryName.strip_prefix("R_").unwrap_or(primaryName);
    let target = map
        .get(&primaryKey)
        .or_else(|| {
            if noOrient != primaryName {
                map.get(&baseSizes::keyFor(catDir, noOrient))
            } else {
                None
            }
        })
        .or_else(|| {
            if primaryName != fallbackName {
                map.get(&baseSizes::keyFor(catDir, fallbackName))
            } else {
                None
            }
        });
    match target {
        Some((bw, bh)) if bw > 0 && bh > 0 && (bw != w || bh != h) => {
            let scaled = imageOps::scaleNearest(&pixels, w, h, bw, bh);
            (bw, bh, scaled)
        }
        _ => (w, h, pixels),
    }
}
