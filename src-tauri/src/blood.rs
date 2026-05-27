use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::apiLayer::ApiError;

/// per-skin 自定义血液配置，与 mod 端 BloodConfigLoader 字段 1:1 对齐。
/// 所有字段都是 Option，缺省时 mod 端用游戏默认。
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BloodConfig {
    /// 起始色 RGBA 0~255。
    pub particle_start_color: Option<[u8; 4]>,
    /// 末尾色（与 startColor 渐变）。
    pub particle_end_color: Option<[u8; 4]>,
    /// 多色随机池。非空时每次发射粒子从池中随机抽一色（覆盖 start/end 渐变）。
    pub random_colors: Option<Vec<[u8; 4]>>,
    /// 粒子单颗大小（Unity unit）。
    pub particle_size: Option<f32>,
    /// 粒子寿命（秒）。
    pub particle_lifetime: Option<f32>,
    /// alpha 渐隐曲线："linear" / "easeOut" / "blink" / "constant"。
    pub fade_curve: Option<String>,

    /// limb shader uniform _BloodDark（深血色）。
    pub blood_dark: Option<[u8; 4]>,
    /// limb shader uniform _BloodLight（浅血色）。
    pub blood_light: Option<[u8; 4]>,

    /// 发光：粒子用 Additive blend。
    pub glow: Option<bool>,
    /// 发光强度（startColor × 倍率），>1 时亮度更高。
    pub glow_intensity: Option<f32>,

    /// 多帧动效：true = 用 textureSheetAnimation。
    pub animated: Option<bool>,
    /// 动效贴图横向帧数。
    pub anim_frames: Option<i32>,
    /// 动效循环每秒帧数。
    pub anim_fps: Option<f32>,
}

/// 单皮肤的 blood.json 路径。
pub fn bloodConfigPath(skinRoot: &Path, skinName: &str) -> PathBuf {
    skinRoot.join(skinName).join("blood.json")
}

/// 读 blood.json，文件不存在 / 解析失败返回 Default（全 None）。
pub fn loadBloodConfig(path: &Path) -> BloodConfig {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(_) => return BloodConfig::default(),
    };
    serde_json::from_slice::<BloodConfig>(&bytes).unwrap_or_default()
}

/// 落盘 blood.json，UTF-8 无 BOM；目录不存在自动创建。
pub fn saveBloodConfig(path: &Path, cfg: &BloodConfig) -> Result<(), ApiError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| ApiError {
            code: "io".into(),
            message: format!("mkdir {}: {}", parent.display(), e),
        })?;
    }
    let bytes = serde_json::to_vec_pretty(cfg).map_err(|e| ApiError {
        code: "json".into(),
        message: format!("serialize blood.json: {}", e),
    })?;
    fs::write(path, bytes).map_err(|e| ApiError {
        code: "io".into(),
        message: format!("write {}: {}", path.display(), e),
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> std::path::PathBuf {
        let p = std::env::temp_dir().join(format!("skinEditor_blood_{}", name));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn missingPathReturnsDefault() {
        let dir = tmp("missing");
        let path = dir.join("blood.json");
        let cfg = loadBloodConfig(&path);
        assert_eq!(cfg, BloodConfig::default());
        let _ = std::fs::remove_dir_all(&dir);
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
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn corruptedJsonReturnsDefault() {
        let dir = tmp("corrupt");
        let path = dir.join("blood.json");
        std::fs::write(&path, "not json").unwrap();
        assert_eq!(loadBloodConfig(&path), BloodConfig::default());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
