// 静态装配表数据结构与默认站立/奔跑帧姿态定义。
#![allow(non_snake_case)]

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::apiLayer::ApiError;
use crate::dataPaths;
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
    /// 绕贴图中心的逆时针旋转角（度，对齐 Unity `localEulerAngles.z`）。
    #[serde(default)]
    pub rotation: f32,
    pub variants: Option<AssemblyVariants>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct AssemblyPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssemblyVariants {
    pub orientation: Option<Orientation>,
    pub expressionIndex: Option<u8>,
    pub headVariant: Option<HeadVariant>,
}

/// 头部状态变体，对齐游戏 `FacialExpression` 各状态贴图槽位。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum HeadVariant {
    #[serde(rename = "default")]
    Default,
    #[serde(rename = "mouthHalf")]
    MouthHalf,
    #[serde(rename = "mouth")]
    Mouth,
    #[serde(rename = "disfigured1")]
    Disfigured1,
    #[serde(rename = "disfigured2")]
    Disfigured2,
    #[serde(rename = "disfigured3")]
    Disfigured3,
    #[serde(rename = "disfigured1Healed")]
    Disfigured1Healed,
    #[serde(rename = "disfigured2Healed")]
    Disfigured2Healed,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum AssemblySource {
    #[serde(rename = "file")]
    File,
    #[serde(rename = "fallback")]
    Fallback,
}

/// 内置默认装配表（朝右基准姿态，1 Unity 单位 = 8 像素，画布 Y 向下取负）。
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
            body("experimentUpArm", 1, -11, 276.0, -50),
            body("experimentDownArm", -2, -5, 2.0, -60),
            body("experimentHandB", -1, 2, 28.0, -40),
            body("experimentThigh", -3, 2, 322.0, -10),
            body("experimentCrus", -9, 6, 281.0, -20),
            body("experimentFoot", -14, 10, 337.0, -30),
            body("experimentDownTorso", 1, -3, 331.0, 10),
            body("experimentUpTorso", 6, -10, 322.0, 20),
            body("experimentTail", 0, 3, 1.0, 0),
            body("experimentThigh", 2, 1, 55.0, 100),
            body("experimentCrus", 3, 5, 316.0, 90),
            body("experimentFoot", 1, 12, 16.0, 80),
            body("experimentUpArm", 3, -8, 324.0, 150),
            body("experimentDownArm", 6, -1, 58.0, 160),
            body("experimentHandF", 12, 2, 70.0, 170),
            // 下翼 `(x, y, rotation)` 为相对上翼根与末端的局部偏移。
            wing("wingUL", -2, -8, 314.0, 5, false),
            wing("wingDL", -1, -10, 0.0, 4, false),
            wing("wingUR", -2, -9, 318.0, 5, false),
            wing("wingDR", 0, -12, 0.0, 4, false),
            // 游戏默认头部引用 `experimentHeadBack`，`experimentHead` 未挂入默认骨架。
            headVar("experimentHeadBack", HeadVariant::Default),
            headVar("experimentHeadBackMouthMini", HeadVariant::MouthHalf),
            headVar("experimentHeadBackMouth", HeadVariant::Mouth),
            headVar("experimentHeadDisfigured1", HeadVariant::Disfigured1),
            headVar("experimentHeadDisfigured2", HeadVariant::Disfigured2),
            headVar("experimentHeadDisfigured3", HeadVariant::Disfigured3),
            headVar("experimentHeadDisfigured1Healed", HeadVariant::Disfigured1Healed),
            headVar("experimentHeadDisfigured2Healed", HeadVariant::Disfigured2Healed),
            headVar("experimentHeadDisfigured3Healed", HeadVariant::Disfigured3Healed),
            eye("experimentEyeOpen", 0),
            eye("experimentEyeHalfClosed", 1),
            eye("experimentEyeClosed", 2),
            eye("experimentEyeScared", 3),
            eye("experimentEyePanic", 4),
            eye("experimentEyeSad", 5),
            eye("experimentEyeHappy", 6),
            eye("experimentEyeLockedIn", 7),
        ],
    }
}

pub fn loadAssembly(path: &Path) -> (AssemblyTable, AssemblySource) {
    let Ok(bytes) = std::fs::read(path) else {
        return (defaultAssembly(), AssemblySource::Fallback);
    };
    match serde_json::from_slice::<AssemblyTable>(&bytes) {
        Ok(table) => (table, AssemblySource::File),
        Err(_) => (defaultAssembly(), AssemblySource::Fallback),
    }
}

pub fn saveAssembly(path: &Path, table: &AssemblyTable) -> Result<(), ApiError> {
    let bytes = serde_json::to_vec_pretty(table).map_err(|e| ApiError {
        code: "encode_failed".into(),
        message: format!("serialize assembly table failed: {}", e),
    })?;
    dataPaths::atomicWrite(path, &bytes).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("write {} failed: {}", path.display(), e),
    })
}

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

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static SEQ: AtomicU64 = AtomicU64::new(0);
            let seq = SEQ.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!(
                "spe_assemblyTable_{}_{}_{}",
                std::process::id(),
                nanos,
                seq
            ));
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
