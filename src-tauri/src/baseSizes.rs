// 部件分类清单 + per-skin 标准尺寸表（合成预览按尺寸表 nearest-neighbor 缩回）。

#![allow(non_snake_case)]

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::OnceLock;

use crate::apiLayer::ApiError;

pub const BASE_SIZES_FILE: &str = "baseSizes.json";

/// 标准分类清单：每个分类下游戏内的部件名集合。仅用于按文件名归类，不再带尺寸。
pub fn standardParts(category: &str) -> Option<&'static [&'static str]> {
    static TABLE: OnceLock<HashMap<&'static str, Vec<&'static str>>> = OnceLock::new();
    let table = TABLE.get_or_init(buildPartsTable);
    table.get(category).map(|v| v.as_slice())
}

/// `<categoryDir>/<partName>` 形式的查表 key。
pub fn keyFor(categoryDir: &str, partName: &str) -> String {
    format!("{}/{}", categoryDir, partName)
}

/// 按部件名反查所属分类目录；F/B 后缀副本剥后缀回查 base 名，未命中返回 None。
pub fn categoryFor(partName: &str) -> Option<&'static str> {
    for cat in ["Body", "Head", "Wings", "Accessories"] {
        if isStandardPart(cat, partName) {
            return Some(cat);
        }
    }
    let stripped = stripSideSuffix(partName);
    if stripped != partName {
        for cat in ["Body", "Head", "Wings", "Accessories"] {
            if isStandardPart(cat, stripped) {
                return Some(cat);
            }
        }
    }
    None
}

fn isStandardPart(category: &str, partName: &str) -> bool {
    standardParts(category)
        .map(|list| list.contains(&partName))
        .unwrap_or(false)
}

fn stripSideSuffix(name: &str) -> &str {
    if name.len() < 2 {
        return name;
    }
    let last = name.as_bytes()[name.len() - 1];
    if last == b'F' || last == b'B' {
        &name[..name.len() - 1]
    } else {
        name
    }
}

/// `stripSideSuffix` 的 crate 内可见包装，供 importSkinPack 等扫盘生成时复用。
pub(crate) fn stripSideSuffixForLookup(name: &str) -> &str {
    stripSideSuffix(name)
}

/// 标准尺寸表容器。空表（无 baseSizes.json）合法，合成时跳过缩回。
pub struct BaseSizes {
    entries: HashMap<String, (u32, u32)>,
}

impl BaseSizes {
    pub fn empty() -> Self {
        BaseSizes { entries: HashMap::new() }
    }

    pub fn get(&self, key: &str) -> Option<(u32, u32)> {
        self.entries.get(key).copied()
    }

    pub fn isEmpty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn fromMap(map: HashMap<String, (u32, u32)>) -> Self {
        BaseSizes { entries: map }
    }
}

/// 读 `<skinDir>/baseSizes.json`；缺文件 / 解析失败返回空表（不报错）。
pub fn load(skinDir: &Path) -> BaseSizes {
    let path = skinDir.join(BASE_SIZES_FILE);
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(_) => return BaseSizes::empty(),
    };
    match parse(&raw) {
        Some(map) => BaseSizes { entries: map },
        None => BaseSizes::empty(),
    }
}

/// 把尺寸表写到 `<skinDir>/baseSizes.json`（已存在则覆盖）。空表不写盘。
pub fn write(skinDir: &Path, map: &HashMap<String, (u32, u32)>) -> Result<(), ApiError> {
    if map.is_empty() {
        return Ok(());
    }
    let path = skinDir.join(BASE_SIZES_FILE);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ApiError {
            code: "io_failed".into(),
            message: format!("mkdir {} failed: {}", parent.display(), e),
        })?;
    }
    let json = serialize(map);
    std::fs::write(&path, json).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("write {} failed: {}", path.display(), e),
    })
}

fn parse(raw: &str) -> Option<HashMap<String, (u32, u32)>> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let obj = value.as_object()?;
    let mut map = HashMap::new();
    for (k, v) in obj {
        let arr = v.as_array()?;
        if arr.len() != 2 {
            continue;
        }
        let w = arr[0].as_u64()? as u32;
        let h = arr[1].as_u64()? as u32;
        map.insert(k.clone(), (w, h));
    }
    Some(map)
}

fn serialize(map: &HashMap<String, (u32, u32)>) -> String {
    let sorted: BTreeMap<&String, &(u32, u32)> = map.iter().collect();
    let mut out = String::from("{\n");
    let mut first = true;
    for (k, (w, h)) in sorted {
        if !first {
            out.push_str(",\n");
        }
        first = false;
        out.push_str(&format!("  \"{}\": [{}, {}]", k, w, h));
    }
    out.push_str("\n}\n");
    out
}

fn buildPartsTable() -> HashMap<&'static str, Vec<&'static str>> {
    let mut m: HashMap<&'static str, Vec<&'static str>> = HashMap::new();
    m.insert("Body", vec![
        "experimentCrus",
        "experimentDownArm",
        "experimentDownTorso",
        "experimentFoot",
        "experimentHandB",
        "experimentHandF",
        "experimentTail",
        "experimentThigh",
        "experimentUpArm",
        "experimentUpTorso",
    ]);
    m.insert("Head", vec![
        "experimentHead",
        "experimentHeadBack",
        "experimentHeadBackMouth",
        "experimentHeadBackMouthMini",
        "experimentHeadDisfigured1",
        "experimentHeadDisfigured1Healed",
        "experimentHeadDisfigured2",
        "experimentHeadDisfigured2Healed",
        "experimentHeadDisfigured3",
        "experimentHeadDisfigured3Healed",
        "experimentNosebleed",
        "experimentEyeClosed",
        "experimentEyeGone",
        "experimentEyeGoneHealed",
        "experimentEyeHalfClosed",
        "experimentEyeHalfClosedBack",
        "experimentEyeHappy",
        "experimentEyeLookBack",
        "experimentEyeOpen",
        "experimentEyePanic",
        "experimentEyeSad",
        "experimentEyeSadBack",
        "experimentEyeScared",
        "experimentEyeScaredBack",
    ]);
    m.insert("Wings", vec!["wingUL", "wingUR", "wingDL", "wingDR"]);
    m.insert("Accessories", vec![
        "autopump", "autozoomgoggles", "balaclava", "bellyarmor", "belt",
        "bigpack", "bikehelmet", "blindfold", "carapace", "climbingclaws",
        "duffelbag", "dustmask", "fannypack", "headlamp", "holidayhat",
        "jetpack", "latexgloves", "legpouch", "makeshiftheadlamp", "makeshifthelmet",
        "materialpouch", "safetyglasses", "scarf", "slingbag", "smallpack",
        "sneakers", "woodsandals",
    ]);
    m
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standardPartsCoversAllCategories() {
        assert!(standardParts("Body").unwrap().contains(&"experimentUpTorso"));
        assert!(standardParts("Head").unwrap().contains(&"experimentEyeOpen"));
        assert!(standardParts("Wings").unwrap().contains(&"wingUL"));
        assert!(standardParts("Accessories").unwrap().contains(&"autopump"));
        assert!(standardParts("Unknown").is_none());
    }

    #[test]
    fn categoryForLooksUpAcrossCats() {
        assert_eq!(categoryFor("experimentUpTorso"), Some("Body"));
        assert_eq!(categoryFor("experimentHead"), Some("Head"));
        assert_eq!(categoryFor("wingUL"), Some("Wings"));
        assert_eq!(categoryFor("autopump"), Some("Accessories"));
        assert!(categoryFor("unknownCustomPart").is_none());
    }

    #[test]
    fn categoryForStripsSidedSuffix() {
        assert_eq!(categoryFor("experimentEyeOpenF"), Some("Head"));
        assert_eq!(categoryFor("experimentHandF"), Some("Body"));
    }

    #[test]
    fn loadMissingReturnsEmpty() {
        let dir = std::env::temp_dir().join(format!("baseSizes_test_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let map = load(&dir);
        assert!(map.isEmpty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn writeAndReloadRoundTrip() {
        let dir = std::env::temp_dir().join(format!("baseSizes_rw_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut m = HashMap::new();
        m.insert("Body/experimentCrus".to_string(), (8, 10));
        m.insert("Wings/wingUL".to_string(), (32, 32));
        write(&dir, &m).unwrap();
        let loaded = load(&dir);
        assert_eq!(loaded.get("Body/experimentCrus"), Some((8, 10)));
        assert_eq!(loaded.get("Wings/wingUL"), Some((32, 32)));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn writeEmptySkipsFile() {
        let dir = std::env::temp_dir().join(format!("baseSizes_empty_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        write(&dir, &HashMap::new()).unwrap();
        assert!(!dir.join(BASE_SIZES_FILE).exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
