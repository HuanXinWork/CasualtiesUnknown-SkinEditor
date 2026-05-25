// 装配表：合成预览用到的部件位置/Z序/翻转/变体过滤数据。
#![allow(non_snake_case)]

use serde::{Deserialize, Serialize};

use crate::skinLoader::PartCategory;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssemblyTable {
    pub parts: Vec<AssemblyEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssemblyEntry {
    pub partName: String,
    pub category: PartCategory,
    pub position: AssemblyPosition,
    pub zOrder: i32,
    pub flipX: bool,
    /// sprite 自身绕中心的旋转角（度，逆时针为正，与 Unity transform.localEulerAngles.z 一致）。
    /// 不存在时回退 0.0，旧 assembly.json 仍能正确反序列化。
    #[serde(default)]
    pub rotation: f32,
    pub variants: Option<AssemblyVariants>,
}

/// 相对角色中心的像素偏移，可正可负。
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct AssemblyPosition {
    pub x: i32,
    pub y: i32,
}

/// 头部 / 眼部的朝向、表情与状态过滤。三个字段都是可选，None 表示不限定。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssemblyVariants {
    pub orientation: Option<Orientation>,
    pub expressionIndex: Option<u8>,
    pub headVariant: Option<HeadVariant>,
}

/// 头部状态枚举，与游戏 FacialExpression 的字段一一对齐。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum HeadVariant {
    /// 闭嘴默认头，对应 PNG `experimentHead`。
    #[serde(rename = "default")]
    Default,
    /// 嘴半张，对应 PNG `experimentHeadBackMouthMini`。
    #[serde(rename = "mouthHalf")]
    MouthHalf,
    /// 嘴全张，对应 PNG `experimentHeadBackMouth`。
    #[serde(rename = "mouth")]
    Mouth,
    /// 毁容 1，对应 PNG `experimentHeadDisfigured1`。
    #[serde(rename = "disfigured1")]
    Disfigured1,
    /// 毁容 2，对应 PNG `experimentHeadDisfigured2`。
    #[serde(rename = "disfigured2")]
    Disfigured2,
    /// 毁容 3，对应 PNG `experimentHeadDisfigured3`。
    #[serde(rename = "disfigured3")]
    Disfigured3,
    /// 毁容 1 愈合，对应 PNG `experimentHeadDisfigured1Healed`。
    #[serde(rename = "disfigured1Healed")]
    Disfigured1Healed,
    /// 毁容 2 愈合，对应 PNG `experimentHeadDisfigured2Healed`。
    #[serde(rename = "disfigured2Healed")]
    Disfigured2Healed,
    /// 毁容 3 愈合，对应 PNG `experimentHeadDisfigured3Healed`。
    #[serde(rename = "disfigured3Healed")]
    Disfigured3Healed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Orientation {
    #[serde(rename = "front")]
    Front,
    #[serde(rename = "back")]
    Back,
}

/// loadAssembly 返回的表来源，让上层 UI 区分用户文件与回退默认。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AssemblySource {
    #[serde(rename = "file")]
    File,
    #[serde(rename = "fallback")]
    Fallback,
}

/// 内置默认装配表。基础姿态直接来自 `captures/奔跑.json` 的一帧：
/// `t=1.195s` / `dir=right` / `exp=1`。
/// 单位：1 Unity = 8 像素；Y 取负让画布下行；rotation 直接复用 Unity transform.localEulerAngles.z（度）。
/// zOrder 复用游戏 SpriteRenderer.sortingOrder。
pub fn defaultAssembly() -> AssemblyTable {
    let body = |name: &str, x: i32, y: i32, rot: f32, zOrder: i32| AssemblyEntry {
        partName: name.to_string(),
        category: PartCategory::Body,
        position: AssemblyPosition { x, y },
        zOrder,
        flipX: false,
        rotation: rot,
        variants: None,
    };
    let wing = |name: &str, x: i32, y: i32, rot: f32, zOrder: i32, flipX: bool| AssemblyEntry {
        partName: name.to_string(),
        category: PartCategory::Wings,
        position: AssemblyPosition { x, y },
        zOrder,
        flipX,
        rotation: rot,
        variants: None,
    };
    // 头部走 9 个互斥变体 entry：所有变体公用同一个位置 / 旋转 / zOrder，仅靠
    // headVariant 字段在合成时互斥过滤。
    let headVar = |name: &str, variant: HeadVariant| AssemblyEntry {
        partName: name.to_string(),
        category: PartCategory::Head,
        position: AssemblyPosition { x: 10, y: -19 },
        zOrder: 50,
        flipX: false,
        rotation: 347.0,
        variants: Some(AssemblyVariants {
            orientation: None,
            expressionIndex: None,
            headVariant: Some(variant),
        }),
    };
    // 眼睛叠在头之上（zOrder=53 > head 50），按 expressionIndex 互斥过滤。
    let eye = |name: &str, expr: u8| AssemblyEntry {
        partName: name.to_string(),
        category: PartCategory::Head,
        position: AssemblyPosition { x: 10, y: -19 },
        zOrder: 53,
        flipX: false,
        rotation: 347.0,
        variants: Some(AssemblyVariants {
            orientation: None,
            expressionIndex: Some(expr),
            headVariant: None,
        }),
    };
    AssemblyTable {
        parts: vec![
            body("experimentUpArm",    1, -11, 276.0, -50),
            body("experimentDownArm", -2,  -5,   2.0, -60),
            body("experimentHandB",   -1,   2,  28.0, -40),
            body("experimentThigh",   -3,   2, 322.0, -10),
            body("experimentCrus",    -9,   6, 281.0, -20),
            body("experimentFoot",   -14,  10, 337.0, -30),
            body("experimentDownTorso", 1,  -3, 331.0, 10),
            body("experimentUpTorso",   6, -10, 322.0, 20),
            body("experimentTail",      0,   3,   1.0, 0),
            body("experimentThigh",    2,   1,  55.0, 100),
            body("experimentCrus",     3,   5, 316.0,  90),
            body("experimentFoot",     1,  12,  16.0,  80),
            body("experimentUpArm",    3,  -8, 324.0, 150),
            body("experimentDownArm",  6,  -1,  58.0, 160),
            body("experimentHandF",   12,   2,  70.0, 170),
            // 翅膀 4 片（左上 / 左下 / 右上 / 右下）。
            // 翼根 = PNG 图像中心 (16,16)，pivot=(0.5,0.5)。
            // 默认值取自 huanxin 实测：上翼朝身后偏上（314°/318°），下翼相对上翼末端共线（rotation=0）。
            // 下翼 (x,y) 是相对上翼根的局部偏移；下翼 rotation 是相对上翼末端的偏移。
            // 单皮肤可在 <skin>/wings.json 覆盖这套默认值。
            // zOrder：UR/UL=5、DR/DL=4 均 < UpTorso(20) 让翼显示在躯干背后。
            wing("wingUL", -2, -8, 314.0, 5, false),
            wing("wingDL", -1, -10, 0.0, 4, false),
            wing("wingUR", -2, -9, 318.0, 5, false),
            wing("wingDR", 0, -12, 0.0, 4, false),
            // 头部 9 个互斥变体。默认指向 experimentHeadBack（与游戏
            // FacialExpression.defaultHead 一致），experimentHead 在游戏装配里实际未引用。
            headVar("experimentHeadBack",                HeadVariant::Default),
            headVar("experimentHeadBackMouthMini",       HeadVariant::MouthHalf),
            headVar("experimentHeadBackMouth",           HeadVariant::Mouth),
            headVar("experimentHeadDisfigured1",         HeadVariant::Disfigured1),
            headVar("experimentHeadDisfigured2",         HeadVariant::Disfigured2),
            headVar("experimentHeadDisfigured3",         HeadVariant::Disfigured3),
            headVar("experimentHeadDisfigured1Healed",   HeadVariant::Disfigured1Healed),
            headVar("experimentHeadDisfigured2Healed",   HeadVariant::Disfigured2Healed),
            headVar("experimentHeadDisfigured3Healed",   HeadVariant::Disfigured3Healed),
            // 眼睛 7 项：index 0..6 = neutral / halfclosed / closed / scared / panic / sad / happy
            eye("experimentEyeOpen",       0),
            eye("experimentEyeHalfClosed", 1),
            eye("experimentEyeClosed",     2),
            eye("experimentEyeScared",     3),
            eye("experimentEyePanic",      4),
            eye("experimentEyeSad",        5),
            eye("experimentEyeHappy",      6),
        ],
    }
}

use std::path::Path;

use crate::apiLayer::ApiError;

/// 读装配表 JSON。文件不存在或解析失败时回退到默认表，返回 Fallback 让上层 UI 提示。
/// 本函数不报错——装配表是可降级输入。
pub fn loadAssembly(path: &Path) -> (AssemblyTable, AssemblySource) {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(_) => return (defaultAssembly(), AssemblySource::Fallback),
    };
    match serde_json::from_slice::<AssemblyTable>(&bytes) {
        Ok(table) => (table, AssemblySource::File),
        Err(_) => (defaultAssembly(), AssemblySource::Fallback),
    }
}

/// 写装配表 JSON。仅在调用方显式请求时触发。父目录不存在时不自动创建。
pub fn saveAssembly(path: &Path, table: &AssemblyTable) -> Result<(), ApiError> {
    let bytes = serde_json::to_vec_pretty(table).map_err(|e| ApiError {
        code: "encode_failed".into(),
        message: format!("serialize assembly table failed: {}", e),
    })?;
    std::fs::write(path, bytes).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("write {} failed: {}", path.display(), e),
    })
}

/// 按 `(category, partName)` 查询装配条目。
/// 当前实现忽略 stage 参数，按部件名匹配。stage 入参保留作未来扩展点。
pub fn findEntry<'a>(
    table: &'a AssemblyTable,
    _stage: &str,
    category: PartCategory,
    partName: &str,
) -> Option<&'a AssemblyEntry> {
    table
        .parts
        .iter()
        .find(|e| e.category == category && e.partName == partName)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    /// 自管 RAII 临时目录。
    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static SEQ: AtomicU64 = AtomicU64::new(0);
            let seq = SEQ.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir()
                .join(format!("spe_assemblyTable_{}_{}_{}", std::process::id(), nanos, seq));
            fs::create_dir_all(&path).expect("create temp dir");
            TempDir(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn defaultAssemblyHasMinimalParts() {
        let table = defaultAssembly();
        let names: Vec<&str> = table.parts.iter().map(|e| e.partName.as_str()).collect();
        assert!(names.contains(&"experimentHeadBack"));
        assert!(names.contains(&"experimentUpTorso"));
    }

    #[test]
    fn missingFileReturnsFallback() {
        let tmp = TempDir::new();
        let missing = tmp.path().join("doesNotExist.json");
        let (table, source) = loadAssembly(&missing);
        assert_eq!(source, AssemblySource::Fallback);
        assert_eq!(table.parts.len(), defaultAssembly().parts.len());
        assert!(!missing.exists());
    }

    #[test]
    fn corruptedJsonReturnsFallback() {
        let tmp = TempDir::new();
        let path = tmp.path().join("assembly.json");
        fs::write(&path, b"not json").unwrap();
        let (table, source) = loadAssembly(&path);
        assert_eq!(source, AssemblySource::Fallback);
        assert_eq!(table.parts.len(), defaultAssembly().parts.len());
    }

    #[test]
    fn validJsonParsesAsFile() {
        let tmp = TempDir::new();
        let path = tmp.path().join("assembly.json");
        let original = AssemblyTable {
            parts: vec![AssemblyEntry {
                partName: "customPart".into(),
                category: PartCategory::Body,
                position: AssemblyPosition { x: 3, y: -7 },
                zOrder: 12,
                flipX: true,
                rotation: 0.0,
                variants: None,
            }],
        };
        fs::write(&path, serde_json::to_vec(&original).unwrap()).unwrap();
        let (table, source) = loadAssembly(&path);
        assert_eq!(source, AssemblySource::File);
        assert_eq!(table.parts.len(), 1);
        assert_eq!(table.parts[0].partName, "customPart");
        assert_eq!(table.parts[0].position.x, 3);
        assert_eq!(table.parts[0].position.y, -7);
        assert_eq!(table.parts[0].zOrder, 12);
        assert!(table.parts[0].flipX);
    }

    #[test]
    fn roundTripPreservesEntries() {
        let tmp = TempDir::new();
        let path = tmp.path().join("assembly.json");
        let table = defaultAssembly();
        saveAssembly(&path, &table).expect("save default");
        let (loaded, source) = loadAssembly(&path);
        assert_eq!(source, AssemblySource::File);
        assert_eq!(loaded.parts.len(), table.parts.len());
        for (a, b) in loaded.parts.iter().zip(table.parts.iter()) {
            assert_eq!(a.partName, b.partName);
            assert_eq!(a.category, b.category);
            assert_eq!(a.position.x, b.position.x);
            assert_eq!(a.position.y, b.position.y);
            assert_eq!(a.zOrder, b.zOrder);
            assert_eq!(a.flipX, b.flipX);
        }
    }

    #[test]
    fn findEntryHitAndMiss() {
        let table = defaultAssembly();
        assert!(findEntry(&table, "st1", PartCategory::Head, "experimentHeadBack").is_some());
        assert!(findEntry(&table, "st1", PartCategory::Body, "experimentHeadBack").is_none());
        assert!(findEntry(&table, "st1", PartCategory::Head, "nonExistent").is_none());
    }
}
