// 皮肤配件配置（`<skin>/accessories.json`）及区块复用的灯光/粒子/帧动画数据结构，与 SkinSync 模组对齐。
#![allow(non_snake_case)]

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::apiLayer::ApiError;
use crate::dataPaths;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AccessoryEntry {
    pub id: String,
    pub limb: String,
    pub sprite: String,
    #[serde(default)]
    pub offX: i32,
    #[serde(default)]
    pub offY: i32,
    #[serde(default)]
    pub rot: f32,
    #[serde(default = "defaultZ")]
    pub z: i32,
    #[serde(default = "defaultEnabled")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secondaryLimbs: Option<Vec<SecondaryLimb>>,
    /// 限定穿戴对应 `wearSlotId` 装备时才显示；为空表示常驻显示，读取时兼容旧键名 `slot`。
    #[serde(default, alias = "slot", skip_serializing_if = "Option::is_none")]
    pub requireWornSlot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SecondaryLimb {
    pub limb: String,
    pub sprite: String,
    #[serde(default)]
    pub offX: i32,
    #[serde(default)]
    pub offY: i32,
    #[serde(default)]
    pub rot: f32,
    #[serde(default = "defaultZ")]
    pub z: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LightConfig {
    #[serde(default = "defaultLightColor")]
    pub color: [u8; 4],
    pub intensity: f32,
    pub outerRadius: f32,
    pub innerRadius: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color2: Option<[u8; 4]>,
    #[serde(default = "defaultLightMode")]
    pub mode: String,
    /// 定向/散射模式角度（度，0 为右、90 为上）。
    #[serde(default)]
    pub direction: f32,
    #[serde(default = "defaultLightSpread")]
    pub spread: f32,
    #[serde(default = "defaultFalloff")]
    pub falloffPower: f32,
    #[serde(default)]
    pub breathing: bool,
    #[serde(default = "defaultBreathSpeed")]
    pub breathSpeed: f32,
    #[serde(default = "defaultBreathAmplitude")]
    pub breathAmplitude: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParticleConfig {
    pub rate: f32,
    pub lifetime: f32,
    pub startSize: f32,
    #[serde(default = "defaultLightColor")]
    pub startColor: [u8; 4],
    #[serde(default)]
    pub gravity: f32,
    #[serde(default = "defaultShape")]
    pub shape: String,
    pub shapeRadius: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endColor: Option<[u8; 4]>,
    /// 行为模式：`gravity` / `star` / `fire` / `water` / `orbit`。
    #[serde(default = "defaultParticleMode")]
    pub mode: String,
    #[serde(default)]
    pub speed: f32,
    #[serde(default)]
    pub direction: f32,
    #[serde(default = "defaultParticleSpread")]
    pub spread: f32,
    #[serde(default = "defaultEndScale")]
    pub endSizeScale: f32,
    /// Alpha 衰减曲线：`linear` / `easeOut` / `blink` / `constant`。
    #[serde(default = "defaultFadeCurve")]
    pub fadeCurve: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnimationConfig {
    pub frames: Vec<String>,
    pub fps: f32,
    #[serde(default, rename = "loop")]
    pub loop_: bool,
}

fn defaultLightColor() -> [u8; 4] {
    [255, 255, 255, 255]
}
fn defaultShape() -> String {
    "circle".to_string()
}
fn defaultLightMode() -> String {
    "radial".to_string()
}
fn defaultLightSpread() -> f32 {
    60.0
}
fn defaultFalloff() -> f32 {
    2.0
}
fn defaultBreathSpeed() -> f32 {
    1.0
}
fn defaultBreathAmplitude() -> f32 {
    0.5
}
fn defaultParticleMode() -> String {
    "gravity".to_string()
}
fn defaultParticleSpread() -> f32 {
    360.0
}
fn defaultEndScale() -> f32 {
    1.0
}
fn defaultFadeCurve() -> String {
    "linear".to_string()
}
fn defaultZ() -> i32 {
    5
}
fn defaultEnabled() -> bool {
    true
}

pub fn accessoriesPath(skinRoot: &Path, skinName: &str) -> PathBuf {
    skinRoot.join(skinName).join("accessories.json")
}

/// 读取 `accessories.json`；文件不存在或解析失败时返回空列表。
pub fn loadAccessories(path: &Path) -> Vec<AccessoryEntry> {
    let Ok(bytes) = fs::read(path) else {
        return Vec::new();
    };
    serde_json::from_slice::<Vec<AccessoryEntry>>(&bytes).unwrap_or_default()
}

pub fn saveAccessories(path: &Path, list: &[AccessoryEntry]) -> Result<(), ApiError> {
    let json = serde_json::to_string_pretty(list).map_err(|e| ApiError {
        code: "encode_failed".into(),
        message: format!("serialize accessories failed: {}", e),
    })?;
    dataPaths::atomicWrite(path, json.as_bytes()).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("write {} failed: {}", path.display(), e),
    })
}

/// 更新指定 `id` 条目的启用状态，返回是否命中已有条目。
pub fn setEnabledById(list: &mut [AccessoryEntry], id: &str, enabled: bool) -> bool {
    let mut hit = false;
    for entry in list.iter_mut() {
        if entry.id == id {
            entry.enabled = enabled;
            hit = true;
        }
    }
    hit
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!(
            "skinPreviewEditor_acc_{}_{}",
            name,
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn missingFileReturnsEmpty() {
        let dir = tmp("missing");
        let path = dir.join("accessories.json");
        assert!(loadAccessories(&path).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn corruptedJsonReturnsEmpty() {
        let dir = tmp("corrupt");
        let path = dir.join("accessories.json");
        fs::write(&path, "not json").unwrap();
        assert!(loadAccessories(&path).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn roundTripPreservesFields() {
        let dir = tmp("rt");
        let path = dir.join("accessories.json");
        let list = vec![AccessoryEntry {
            id: "holidayhat".into(),
            limb: "Head".into(),
            sprite: "holidayhat".into(),
            offX: 1,
            offY: -2,
            rot: 0.0,
            z: 3,
            enabled: true,
            secondaryLimbs: None,
            requireWornSlot: Some("hat".into()),
        }];
        saveAccessories(&path, &list).unwrap();
        let loaded = loadAccessories(&path);
        assert_eq!(loaded, list);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn setEnabledFlipsMatchingId() {
        let mut list = vec![AccessoryEntry {
            id: "a".into(),
            limb: "Head".into(),
            sprite: "a".into(),
            offX: 0,
            offY: 0,
            rot: 0.0,
            z: 5,
            enabled: false,
            secondaryLimbs: None,
            requireWornSlot: None,
        }];
        assert!(setEnabledById(&mut list, "a", true));
        assert!(list[0].enabled);
        assert!(!setEnabledById(&mut list, "missing", true));
    }

    #[test]
    fn roundTripPreservesSecondaryLimbs() {
        let dir = tmp("rt2");
        let path = dir.join("accessories.json");
        let list = vec![AccessoryEntry {
            id: "wizard".into(),
            limb: "Head".into(),
            sprite: "wizardHat".into(),
            offX: 0,
            offY: -2,
            rot: 0.0,
            z: 8,
            enabled: true,
            secondaryLimbs: Some(vec![SecondaryLimb {
                limb: "UpTorso".into(),
                sprite: "wizardCape".into(),
                offX: 0,
                offY: 1,
                rot: 0.0,
                z: 6,
            }]),
            requireWornSlot: None,
        }];
        saveAccessories(&path, &list).unwrap();
        let loaded = loadAccessories(&path);
        assert_eq!(loaded, list);
        let _ = fs::remove_dir_all(&dir);
    }
}
