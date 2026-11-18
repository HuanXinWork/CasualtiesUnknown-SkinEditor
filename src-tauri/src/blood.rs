// 皮肤血液与受伤着色覆盖配置（`<skin>/blood.json`），字段与 SkinSync `BloodConfigLoader` 对齐。
#![allow(non_snake_case)]

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::apiLayer::ApiError;
use crate::dataPaths;

/// 所有字段均为可选覆盖项，为 `None` 时游戏侧保持原版默认行为。
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BloodConfig {
    pub particle_start_color: Option<[u8; 4]>,
    pub particle_end_color: Option<[u8; 4]>,
    /// 非空时每次发射随机抽取一色，覆盖起止渐变色。
    pub random_colors: Option<Vec<[u8; 4]>>,
    pub particle_size: Option<f32>,
    pub particle_lifetime: Option<f32>,
    pub fade_curve: Option<String>,
    /// 对应肢体受伤 Shader 的 `_BloodDark` / `_BloodLight`。
    pub blood_dark: Option<[u8; 4]>,
    pub blood_light: Option<[u8; 4]>,
    pub glow: Option<bool>,
    pub glow_intensity: Option<f32>,
    pub animated: Option<bool>,
    pub anim_frames: Option<i32>,
    pub anim_fps: Option<f32>,
}

pub fn bloodConfigPath(skinRoot: &Path, skinName: &str) -> PathBuf {
    skinRoot.join(skinName).join("blood.json")
}

pub fn loadBloodConfig(path: &Path) -> BloodConfig {
    let Ok(bytes) = fs::read(path) else {
        return BloodConfig::default();
    };
    serde_json::from_slice::<BloodConfig>(&bytes).unwrap_or_default()
}

pub fn saveBloodConfig(path: &Path, cfg: &BloodConfig) -> Result<(), ApiError> {
    let bytes = serde_json::to_vec_pretty(cfg).map_err(|e| ApiError {
        code: "encode_failed".into(),
        message: format!("serialize blood.json: {}", e),
    })?;
    dataPaths::atomicWrite(path, &bytes).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("write {}: {}", path.display(), e),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("skinEditor_blood_{}", name));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn missingPathReturnsDefault() {
        let dir = tmp("missing");
        let path = dir.join("blood.json");
        let cfg = loadBloodConfig(&path);
        assert_eq!(cfg, BloodConfig::default());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn roundTripPreservesAllFields() {
        let dir = tmp("rt");
        let path = dir.join("blood.json");
        let cfg = BloodConfig {
            particle_start_color: Some([255, 0, 0, 255]),
            particle_end_color: Some([120, 0, 0, 0]),
            random_colors: Some(vec![[255, 0, 0, 255], [0, 255, 0, 255]]),
            particle_size: Some(0.18),
            particle_lifetime: Some(2.5),
            fade_curve: Some("easeOut".into()),
            blood_dark: Some([80, 0, 0, 255]),
            blood_light: Some([220, 30, 30, 255]),
            glow: Some(true),
            glow_intensity: Some(1.5),
            animated: Some(true),
            anim_frames: Some(4),
            anim_fps: Some(8.0),
        };
        saveBloodConfig(&path, &cfg).expect("save");
        let loaded = loadBloodConfig(&path);
        assert_eq!(loaded, cfg);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corruptedJsonReturnsDefault() {
        let dir = tmp("corrupt");
        let path = dir.join("blood.json");
        fs::write(&path, "not json").unwrap();
        assert_eq!(loadBloodConfig(&path), BloodConfig::default());
        let _ = fs::remove_dir_all(&dir);
    }
}
