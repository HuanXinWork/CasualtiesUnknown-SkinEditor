// 配件元数据：解析皮肤目录下 accessories.json，存储格式与 SkinSync mod 完全对齐。
#![allow(non_snake_case)]

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::apiLayer::ApiError;

/// 单个配件条目。字段名与 mod 端 RawEntry 一一对应。
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
    /// 副件列表，仿游戏 Wearable.secondaryLimbs。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub secondaryLimbs: Option<Vec<SecondaryLimb>>,
    /// 仅元数据备注，导出导入保持原样不参与渲染。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub slot: Option<String>,
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
    /// 主色 RGBA 0~255。缺省白光。
    #[serde(default = "defaultLightColor")]
    pub color: [u8; 4],
    pub intensity: f32,
    pub outerRadius: f32,
    pub innerRadius: f32,
    /// 渐变末端色；缺省与 color 相同（无渐变）。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color2: Option<[u8; 4]>,
    /// "radial" / "directional" / "scatter"，缺省 radial。
    #[serde(default = "defaultLightMode")]
    pub mode: String,
    /// directional / scatter 模式的方向角（度，0=右，90=上）。
    #[serde(default)]
    pub direction: f32,
    /// directional 圆锥角宽（度，0~360）；scatter 时为束的散开角。
    #[serde(default = "defaultLightSpread")]
    pub spread: f32,
    /// 衰减幂次。1=线性、2=平方衰减（默认）、4=锐衰减。
    #[serde(default = "defaultFalloff")]
    pub falloffPower: f32,
    /// 是否呼吸（强度按时间正弦上下浮动）。
    #[serde(default)]
    pub breathing: bool,
    /// 呼吸频率（Hz，默认 1.0）。
    #[serde(default = "defaultBreathSpeed")]
    pub breathSpeed: f32,
    /// 呼吸幅度（0~1，默认 0.5 = 强度在 ±50% 之间摆动）。
    #[serde(default = "defaultBreathAmplitude")]
    pub breathAmplitude: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ParticleConfig {
    pub rate: f32,
    pub lifetime: f32,
    pub startSize: f32,
    /// 起始色 RGBA 0~255。缺省白色。
    #[serde(default = "defaultLightColor")]
    pub startColor: [u8; 4],
    #[serde(default)]
    pub gravity: f32,
    /// "circle" / "sphere"，缺省 circle（仅生成形状，不影响行为模式）。
    #[serde(default = "defaultShape")]
    pub shape: String,
    pub shapeRadius: f32,
    /// 渐变末端色；缺省 alpha 衰减到 0 的同色。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endColor: Option<[u8; 4]>,
    /// 行为模式：gravity（默认重力）/ star（原地闪烁）/ fire（向上飘+收缩）/ water（向下流）/ orbit（环绕中心）。
    #[serde(default = "defaultParticleMode")]
    pub mode: String,
    /// gravity / fire / water 等基础速度（每秒像素位移）。
    #[serde(default)]
    pub speed: f32,
    /// 发射方向（度，0=右，90=上）；缺省按 mode 定向。
    #[serde(default)]
    pub direction: f32,
    /// 发射方向散射角（度，默认 360 = 全向）。
    #[serde(default = "defaultParticleSpread")]
    pub spread: f32,
    /// 末态相对起始大小的比例（默认 1=不变；fire 0.2 收缩；orbit 1.5 膨胀）。
    #[serde(default = "defaultEndScale")]
    pub endSizeScale: f32,
    /// alpha 衰减曲线："linear" 线性 / "easeOut" 末段缓退 / "blink" 闪烁 / "constant" 始终满 alpha。
    #[serde(default = "defaultFadeCurve")]
    pub fadeCurve: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnimationConfig {
    pub frames: Vec<String>,
    pub fps: f32,
    /// JSON key 是 `loop`；Rust 关键字冲突，重命名字段名。
    #[serde(default, rename = "loop")]
    pub loop_: bool,
}

fn defaultLightColor() -> [u8; 4] { [255, 255, 255, 255] }
fn defaultShape() -> String { "circle".to_string() }
fn defaultLightMode() -> String { "radial".to_string() }
fn defaultLightSpread() -> f32 { 60.0 }
fn defaultFalloff() -> f32 { 2.0 }
fn defaultBreathSpeed() -> f32 { 1.0 }
fn defaultBreathAmplitude() -> f32 { 0.5 }
fn defaultParticleMode() -> String { "gravity".to_string() }
fn defaultParticleSpread() -> f32 { 360.0 }
fn defaultEndScale() -> f32 { 1.0 }
fn defaultFadeCurve() -> String { "linear".to_string() }

fn defaultZ() -> i32 { 5 }
fn defaultEnabled() -> bool { true }

/// 单皮肤的 accessories.json 路径。
pub fn accessoriesPath(skinRoot: &Path, skinName: &str) -> PathBuf {
    skinRoot.join(skinName).join("accessories.json")
}

/// 读 accessories.json。文件不存在 / 解析失败均返回空列表（不构成致命错误）。
pub fn loadAccessories(path: &Path) -> Vec<AccessoryEntry> {
    let bytes = match fs::read(path) {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    serde_json::from_slice::<Vec<AccessoryEntry>>(&bytes).unwrap_or_default()
}

/// 整列覆写落盘，UTF-8 无 BOM；目录不存在自动创建。
pub fn saveAccessories(path: &Path, list: &[AccessoryEntry]) -> Result<(), ApiError> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| ApiError {
            code: "io_error".into(),
            message: format!("mkdir {} failed: {}", parent.display(), e),
        })?;
    }
    let json = serde_json::to_string_pretty(list).map_err(|e| ApiError {
        code: "serialize_failed".into(),
        message: format!("serialize accessories failed: {}", e),
    })?;
    fs::write(path, json).map_err(|e| ApiError {
        code: "io_error".into(),
        message: format!("write {} failed: {}", path.display(), e),
    })
}

/// 把 list 里 id 命中的条目 enabled 翻转为指定值；不存在的 id 不创建条目。
/// 返回 true 表示有匹配条目被改动。
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
            slot: Some("hat".into()),
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
            offX: 0, offY: 0, rot: 0.0, z: 5, enabled: false,
            secondaryLimbs: None,
            slot: None,
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
            offX: 0, offY: -2, rot: 0.0, z: 8, enabled: true,
            secondaryLimbs: Some(vec![SecondaryLimb {
                limb: "UpTorso".into(),
                sprite: "wizardCape".into(),
                offX: 0, offY: 1, rot: 0.0, z: 6,
            }]),
            slot: None,
        }];
        saveAccessories(&path, &list).unwrap();
        let loaded = loadAccessories(&path);
        assert_eq!(loaded, list);
        let _ = fs::remove_dir_all(&dir);
    }
}
