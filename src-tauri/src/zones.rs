// 部件区块（mask + 配置）IO 层。
// mask PNG：RGBA8，R 通道存区块 ID（1~255），A 通道镜像（0=无、255=有）。
// zones.json：每个区块的可选 light / particle / animation 配置，复用 accessories 模块的同款 struct。
#![allow(non_snake_case)]

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::accessories::{AnimationConfig, LightConfig, ParticleConfig};
use crate::apiLayer::ApiError;
/// 单个区块条目。pixels 字段不存储——区块所属像素由 mask PNG 的 R 通道决定。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ZoneEntry {
    /// 1~255 之间的区块 ID，与 mask PNG 的 R 通道值对齐。0 保留为"无区块"。
    pub id: u8,
    /// 用户可选展示名。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// 编辑器画布上 overlay 的填充色（RGB 0~255）；缺失时回退到自动 hue 调色板。
    /// 仅影响编辑器视觉，不参与 mod 渲染逻辑。
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

/// 同一 part 的 mask 与 config 一对：相邻同名 + 不同后缀（.zones.png / .zones.json）。
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

/// 读 mask PNG：返回 (width, height, ids) 三元组；ids[i] = R 通道值（A=0 时强制为 0）。
/// 文件缺失或解码失败均返回 None（非致命）。
pub fn loadMask(path: &Path) -> Option<(u32, u32, Vec<u8>)> {
    let decoded = crate::skinLoader::decodePart(path).ok()?;
    let total = (decoded.width * decoded.height) as usize;
    let mut ids = Vec::with_capacity(total);
    for i in 0..total {
        let r = decoded.pixels[i * 4];
        let a = decoded.pixels[i * 4 + 3];
        ids.push(if a == 0 { 0 } else { r });
    }
    Some((decoded.width, decoded.height, ids))
}

/// 写 mask PNG：把 ids（与原 part 像素同形）的非零值写入 R 通道，对应 A=255；零值写全 0 透明像素。
pub fn saveMask(path: &Path, width: u32, height: u32, ids: &[u8]) -> Result<(), ApiError> {
    if ids.len() != (width * height) as usize {
        return Err(ApiError {
            code: "shape_mismatch".into(),
            message: format!(
                "ids len {} != {}*{}={}",
                ids.len(),
                width,
                height,
                width * height
            ),
        });
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| ApiError {
            code: "io_error".into(),
            message: format!("mkdir {} failed: {}", parent.display(), e),
        })?;
    }
    let mut rgba = vec![0u8; ids.len() * 4];
    for (i, &id) in ids.iter().enumerate() {
        if id == 0 {
            // 保持 0,0,0,0
        } else {
            rgba[i * 4] = id;
            rgba[i * 4 + 3] = 255;
        }
    }
    crate::imageOps::savePng(path, width, height, &rgba)
}

/// 取区块在 mask 中的几何：返回 [(id, cx, cy, halfDiagonal)]，坐标在 mask 像素空间。
pub fn computeGeometry(width: u32, height: u32, ids: &[u8]) -> Vec<(u8, f32, f32, f32)> {
    use std::collections::HashMap;
    let mut bounds: HashMap<u8, (u32, u32, u32, u32)> = HashMap::new();
    for y in 0..height {
        for x in 0..width {
            let id = ids[(y * width + x) as usize];
            if id == 0 { continue; }
            let entry = bounds.entry(id).or_insert((x, x, y, y));
            if x < entry.0 { entry.0 = x; }
            if x > entry.1 { entry.1 = x; }
            if y < entry.2 { entry.2 = y; }
            if y > entry.3 { entry.3 = y; }
        }
    }
    let mut out = Vec::with_capacity(bounds.len());
    for (id, (x0, x1, y0, y1)) in bounds {
        let cx = (x0 + x1) as f32 * 0.5;
        let cy = (y0 + y1) as f32 * 0.5;
        let dx = (x1 - x0) as f32 * 0.5;
        let dy = (y1 - y0) as f32 * 0.5;
        let radius = (dx * dx + dy * dy).sqrt();
        out.push((id, cx, cy, radius));
    }
    out
}

pub fn loadConfig(path: &Path) -> ZonesConfig {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(_) => return ZonesConfig::default(),
    };
    serde_json::from_slice::<ZonesConfig>(&bytes).unwrap_or_default()
}

pub fn saveConfig(path: &Path, cfg: &ZonesConfig) -> Result<(), ApiError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| ApiError {
            code: "io_error".into(),
            message: format!("mkdir {} failed: {}", parent.display(), e),
        })?;
    }
    let json = serde_json::to_string_pretty(cfg).map_err(|e| ApiError {
        code: "serialize_failed".into(),
        message: format!("serialize zones failed: {}", e),
    })?;
    fs::write(path, json).map_err(|e| ApiError {
        code: "io_error".into(),
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
    fn maskRoundTrip() {
        let dir = tmp("maskRt");
        let path = dir.join("Body").join("a.zones.png");
        let ids = vec![0u8, 1, 0, 2, 3, 0, 0, 1];
        saveMask(&path, 4, 2, &ids).unwrap();
        let (w, h, loaded) = loadMask(&path).unwrap();
        assert_eq!((w, h), (4, 2));
        assert_eq!(loaded, ids);
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
