// 部件特效区块遮罩（`<part>.zones.png`，R 通道存 1..=255 区块 ID）与配置（`<part>.zones.json`）读写。
#![allow(non_snake_case)]

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::accessories::{AnimationConfig, LightConfig, ParticleConfig};
use crate::apiLayer::ApiError;
use crate::dataPaths;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ZoneEntry {
    pub id: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 仅用于编辑器画布区块覆盖层着色，不参与游戏端渲染。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub displayColor: Option<[u8; 3]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub light: Option<LightConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub particle: Option<ParticleConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub animation: Option<AnimationConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ZonesConfig {
    pub zones: Vec<ZoneEntry>,
}

pub fn maskPath(skinRoot: &Path, skinName: &str, categoryDir: &str, partName: &str) -> PathBuf {
    skinRoot
        .join(skinName)
        .join(categoryDir)
        .join(format!("{}.zones.png", partName))
}

pub fn configPath(skinRoot: &Path, skinName: &str, categoryDir: &str, partName: &str) -> PathBuf {
    skinRoot
        .join(skinName)
        .join(categoryDir)
        .join(format!("{}.zones.json", partName))
}

/// 读取遮罩 PNG 并还原单字节区块 ID 数组（`A == 0` 视为无区块 `0`）。
pub fn loadMask(path: &Path) -> Option<(u32, u32, Vec<u8>)> {
    let decoded = crate::skinLoader::decodePart(path).ok()?;
    let total = (decoded.width as usize).checked_mul(decoded.height as usize)?;
    if decoded.pixels.len() < total.checked_mul(4)? {
        return None;
    }
    let mut ids = Vec::with_capacity(total);
    for i in 0..total {
        let r = decoded.pixels[i * 4];
        let a = decoded.pixels[i * 4 + 3];
        ids.push(if a == 0 { 0 } else { r });
    }
    Some((decoded.width, decoded.height, ids))
}

pub fn saveMask(path: &Path, width: u32, height: u32, ids: &[u8]) -> Result<(), ApiError> {
    let expected = (width as usize)
        .checked_mul(height as usize)
        .ok_or_else(|| ApiError {
            code: "shape_mismatch".into(),
            message: format!("dimensions overflow: {}x{}", width, height),
        })?;
    if ids.len() != expected {
        return Err(ApiError {
            code: "shape_mismatch".into(),
            message: format!("ids len {} != {}*{}={}", ids.len(), width, height, expected),
        });
    }
    let rgbaLen = expected.checked_mul(4).ok_or_else(|| ApiError {
        code: "shape_mismatch".into(),
        message: "rgba buffer overflow".into(),
    })?;
    let mut rgba = vec![0u8; rgbaLen];
    for (i, &id) in ids.iter().enumerate() {
        if id != 0 {
            rgba[i * 4] = id;
            rgba[i * 4 + 3] = 255;
        }
    }
    crate::imageOps::savePng(path, width, height, &rgba)
}

/// 最近邻缩放区块遮罩 ID 数组，保持离散区块编号不被线性插值破坏。
pub fn scaleMaskNearest(ids: &[u8], oldW: u32, oldH: u32, newW: u32, newH: u32) -> Vec<u8> {
    let Some(outLen) = (newW as usize).checked_mul(newH as usize) else {
        return Vec::new();
    };
    let mut out = vec![0u8; outLen];
    if oldW == 0 || oldH == 0 || newW == 0 || newH == 0 {
        return out;
    }
    let Some(inLen) = (oldW as usize).checked_mul(oldH as usize) else {
        return out;
    };
    if ids.len() != inLen {
        return out;
    }
    for ny in 0..newH {
        let sy = ((ny as u64) * (oldH as u64) / (newH as u64)) as u32;
        for nx in 0..newW {
            let sx = ((nx as u64) * (oldW as u64) / (newW as u64)) as u32;
            out[(ny * newW + nx) as usize] = ids[(sy * oldW + sx) as usize];
        }
    }
    out
}

/// 计算各非零区块在遮罩像素空间中的包围盒中心与半对角线 `(id, cx, cy, halfDiagonal)`。
pub fn computeGeometry(width: u32, height: u32, ids: &[u8]) -> Vec<(u8, f32, f32, f32)> {
    let Some(expected) = (width as usize).checked_mul(height as usize) else {
        return Vec::new();
    };
    if ids.len() < expected {
        return Vec::new();
    }
    let mut bounds: HashMap<u8, (u32, u32, u32, u32)> = HashMap::new();
    for y in 0..height {
        for x in 0..width {
            let id = ids[(y as usize) * (width as usize) + (x as usize)];
            if id == 0 {
                continue;
            }
            let entry = bounds.entry(id).or_insert((x, x, y, y));
            if x < entry.0 {
                entry.0 = x;
            }
            if x > entry.1 {
                entry.1 = x;
            }
            if y < entry.2 {
                entry.2 = y;
            }
            if y > entry.3 {
                entry.3 = y;
            }
        }
    }
    let mut out = Vec::with_capacity(bounds.len());
    for (id, (x0, x1, y0, y1)) in bounds {
        let cx = (x0 + x1) as f32 * 0.5;
        let cy = (y0 + y1) as f32 * 0.5;
        let dx = (x1 - x0) as f32 * 0.5;
        let dy = (y1 - y0) as f32 * 0.5;
        out.push((id, cx, cy, (dx * dx + dy * dy).sqrt()));
    }
    out
}

pub fn loadConfig(path: &Path) -> ZonesConfig {
    let Ok(bytes) = fs::read(path) else {
        return ZonesConfig::default();
    };
    serde_json::from_slice::<ZonesConfig>(&bytes).unwrap_or_default()
}

pub fn saveConfig(path: &Path, cfg: &ZonesConfig) -> Result<(), ApiError> {
    let json = serde_json::to_string_pretty(cfg).map_err(|e| ApiError {
        code: "encode_failed".into(),
        message: format!("serialize zones failed: {}", e),
    })?;
    dataPaths::atomicWrite(path, json.as_bytes()).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("write {} failed: {}", path.display(), e),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "skinPreviewEditor_zones_{}_{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn maskRoundTripAndNearestScale() {
        let dir = tmp("maskRt");
        let path = dir.join("Body").join("a.zones.png");
        let ids = vec![0u8, 1, 0, 2, 3, 0, 0, 1];
        saveMask(&path, 4, 2, &ids).unwrap();
        let (w, h, loaded) = loadMask(&path).unwrap();
        assert_eq!((w, h), (4, 2));
        assert_eq!(loaded, ids);

        let scaled = scaleMaskNearest(&[1u8, 2, 3, 4], 2, 2, 4, 4);
        assert_eq!(scaled[0], 1);
        assert_eq!(scaled[1], 1);
        assert_eq!(scaled[2], 2);
        assert_eq!(scaled[15], 4);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn configRoundTrip() {
        let dir = tmp("cfgRt");
        let path = dir.join("a.zones.json");
        let cfg = ZonesConfig {
            zones: vec![ZoneEntry {
                id: 1,
                name: Some("eyes".into()),
                displayColor: None,
                light: Some(LightConfig {
                    color: [255, 200, 100, 255],
                    intensity: 1.5,
                    outerRadius: 2.0,
                    innerRadius: 0.3,
                    color2: None,
                    mode: "radial".into(),
                    direction: 0.0,
                    spread: 60.0,
                    falloffPower: 2.0,
                    breathing: false,
                    breathSpeed: 1.0,
                    breathAmplitude: 0.5,
                }),
                particle: None,
                animation: None,
            }],
        };
        saveConfig(&path, &cfg).unwrap();
        let loaded = loadConfig(&path);
        assert_eq!(loaded, cfg);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn missingMaskReturnsNone() {
        let dir = tmp("missing");
        let path = dir.join("missing.zones.png");
        assert!(loadMask(&path).is_none());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn shapeMismatchSaveFails() {
        let dir = tmp("shape");
        let path = dir.join("bad.zones.png");
        let ids = vec![0u8; 5];
        let err = saveMask(&path, 4, 2, &ids).unwrap_err();
        assert_eq!(err.code, "shape_mismatch");
        let _ = fs::remove_dir_all(&dir);
    }
}
