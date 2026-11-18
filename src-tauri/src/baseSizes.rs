// 标准部件分类表与单皮肤基准尺寸表（`<skin>/baseSizes.json`，与 SkinSync `BaseSizesLoader` 契约一致）。
#![allow(non_snake_case)]

use std::collections::{BTreeMap, HashMap};
use std::path::Path;
use std::sync::OnceLock;

use crate::apiLayer::ApiError;
use crate::dataPaths;

pub const BASE_SIZES_FILE: &str = "baseSizes.json";

pub fn standardParts(category: &str) -> Option<&'static [&'static str]> {
    static TABLE: OnceLock<HashMap<&'static str, Vec<&'static str>>> = OnceLock::new();
    let table = TABLE.get_or_init(buildPartsTable);
    table.get(category).map(|v| v.as_slice())
}

pub fn keyFor(categoryDir: &str, partName: &str) -> String {
    format!("{}/{}", categoryDir, partName)
}

/// 按部件名反查标准分类目录；自动剥离 `R_` 朝右前缀与 `F`/`B` 前后侧后缀。
pub fn categoryFor(partName: &str) -> Option<&'static str> {
    let base = partName.strip_prefix("R_").unwrap_or(partName);
    for cat in ["Body", "Head", "Wings", "Accessories", "Blood"] {
        if isStandardPart(cat, base) {
            return Some(cat);
        }
    }
    let stripped = stripSideSuffix(base);
    if stripped != base {
        for cat in ["Body", "Head", "Wings", "Accessories", "Blood"] {
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

pub(crate) fn stripSideSuffixForLookup(name: &str) -> &str {
    stripSideSuffix(name.strip_prefix("R_").unwrap_or(name))
}

pub struct BaseSizes {
    entries: HashMap<String, (u32, u32)>,
}

impl BaseSizes {
    pub fn empty() -> Self {
        BaseSizes {
            entries: HashMap::new(),
        }
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

pub fn load(skinDir: &Path) -> BaseSizes {
    let path = skinDir.join(BASE_SIZES_FILE);
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return BaseSizes::empty();
    };
    match parse(&raw) {
        Some(map) => BaseSizes { entries: map },
        None => BaseSizes::empty(),
    }
}

/// 写入 `<skinDir>/baseSizes.json`（空表跳过写盘）。
pub fn write(skinDir: &Path, map: &HashMap<String, (u32, u32)>) -> Result<(), ApiError> {
    if map.is_empty() {
        return Ok(());
    }
    let path = skinDir.join(BASE_SIZES_FILE);
    let json = serialize(map);
    dataPaths::atomicWrite(&path, json.as_bytes()).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("write {} failed: {}", path.display(), e),
    })
}

pub fn upsert(skinDir: &Path, key: &str, w: u32, h: u32) -> Result<(), ApiError> {
    let path = skinDir.join(BASE_SIZES_FILE);
    let mut map = match std::fs::read_to_string(&path) {
        Ok(s) => parse(&s).unwrap_or_default(),
        Err(_) => HashMap::new(),
    };
    map.insert(key.to_string(), (w, h));
    write(skinDir, &map)
}

/// 移除单条基准尺寸记录；删空最后一条时同步移除 `baseSizes.json` 文件。
pub fn remove(skinDir: &Path, key: &str) -> Result<(), ApiError> {
    let path = skinDir.join(BASE_SIZES_FILE);
    let mut map = match std::fs::read_to_string(&path) {
        Ok(s) => parse(&s).unwrap_or_default(),
        Err(_) => return Ok(()),
    };
    if map.remove(key).is_none() {
        return Ok(());
    }
    if map.is_empty() {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| ApiError {
                code: "io_failed".into(),
                message: format!("remove {} failed: {}", path.display(), e),
            })?;
        }
        return Ok(());
    }
    write(skinDir, &map)
}

/// 兼容 SkinSync 标准 `{ "entries": { ... } }` 结构与旧版扁平顶层键值对象。
fn parse(raw: &str) -> Option<HashMap<String, (u32, u32)>> {
    let value: serde_json::Value = serde_json::from_str(raw).ok()?;
    let rootObj = value.as_object()?;
    let targetObj = rootObj
        .get("entries")
        .and_then(|v| v.as_object())
        .unwrap_or(rootObj);
    let mut map = HashMap::new();
    for (k, v) in targetObj {
        let Some(arr) = v.as_array() else {
            continue;
        };
        if arr.len() != 2 {
            continue;
        }
        let (Some(w), Some(h)) = (arr[0].as_u64(), arr[1].as_u64()) else {
            continue;
        };
        if let (Ok(wu), Ok(hu)) = (u32::try_from(w), u32::try_from(h)) {
            if wu > 0 && hu > 0 {
                map.insert(k.clone(), (wu, hu));
            }
        }
    }
    Some(map)
}

/// 输出 `{ "entries": { "<Cat>/<part>": [w, h] } }`，对齐 SkinSync `BaseSizesLoader.Parse`。
fn serialize(map: &HashMap<String, (u32, u32)>) -> String {
    let sorted: BTreeMap<&String, &(u32, u32)> = map.iter().collect();
    let mut out = String::from("{\n  \"entries\": {\n");
    for (idx, (k, (w, h))) in sorted.into_iter().enumerate() {
        if idx > 0 {
            out.push_str(",\n");
        }
        let escapedKey = serde_json::to_string(k).unwrap_or_else(|_| format!("\"{}\"", k));
        out.push_str(&format!("    {}: [{}, {}]", escapedKey, w, h));
    }
    out.push_str("\n  }\n}\n");
    out
}

pub fn defaultSize(partName: &str) -> Option<(u32, u32)> {
    static TABLE: OnceLock<HashMap<&'static str, (u32, u32)>> = OnceLock::new();
    let table = TABLE.get_or_init(buildSizeTable);
    let base = partName.strip_prefix("R_").unwrap_or(partName);
    if let Some(sz) = table.get(base) {
        return Some(*sz);
    }
    let stripped = stripSideSuffix(base);
    table.get(stripped).copied()
}

fn buildSizeTable() -> HashMap<&'static str, (u32, u32)> {
    let mut m: HashMap<&'static str, (u32, u32)> = HashMap::new();
    m.insert("experimentUpArm", (8, 12));
    m.insert("experimentDownArm", (12, 14));
    m.insert("experimentHandF", (6, 12));
    m.insert("experimentHandB", (5, 12));
    m.insert("experimentThigh", (10, 15));
    m.insert("experimentCrus", (8, 10));
    m.insert("experimentFoot", (11, 12));
    m.insert("experimentUpTorso", (12, 18));
    m.insert("experimentDownTorso", (12, 12));
    m.insert("experimentTail", (68, 22));
    m.insert("experimentHead", (26, 18));
    m.insert("experimentHeadBack", (26, 18));
    m.insert("experimentHeadBackMouth", (26, 18));
    m.insert("experimentHeadBackMouthMini", (26, 18));
    m.insert("experimentHeadDisfigured1", (26, 18));
    m.insert("experimentHeadDisfigured1Healed", (26, 18));
    m.insert("experimentHeadDisfigured2", (26, 18));
    m.insert("experimentHeadDisfigured2Healed", (26, 18));
    m.insert("experimentHeadDisfigured3", (26, 18));
    m.insert("experimentHeadDisfigured3Healed", (26, 18));
    m.insert("experimentNosebleed", (14, 12));
    m.insert("experimentEyeClosed", (26, 12));
    m.insert("experimentEyeGone", (26, 12));
    m.insert("experimentEyeGoneHealed", (26, 12));
    m.insert("experimentEyeHalfClosed", (26, 12));
    m.insert("experimentEyeHalfClosedBack", (26, 12));
    m.insert("experimentEyeHappy", (26, 12));
    m.insert("experimentEyeLookBack", (26, 12));
    m.insert("experimentEyeOpen", (26, 12));
    m.insert("experimentEyePanic", (26, 12));
    m.insert("experimentEyeSad", (26, 12));
    m.insert("experimentEyeSadBack", (26, 12));
    m.insert("experimentEyeScared", (26, 12));
    m.insert("experimentEyeScaredBack", (26, 12));
    m.insert("experimentEyeLockedIn", (26, 12));
    m.insert("experimentEyeLockedInBack", (26, 12));
    m.insert("wingUL", (32, 32));
    m.insert("wingUR", (32, 32));
    m.insert("wingDL", (32, 32));
    m.insert("wingDR", (32, 32));
    m
}

fn buildPartsTable() -> HashMap<&'static str, Vec<&'static str>> {
    let mut m: HashMap<&'static str, Vec<&'static str>> = HashMap::new();
    m.insert(
        "Body",
        vec![
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
            "milkytorso",
            "milkydowntorso",
            "milkyuparm",
            "mildownarm",
            "milkyhandf",
            "milkyhandb",
            "milkythigh",
            "milkycrus",
            "milkyfoot",
            "milkytail",
            "duneUpTorso",
            "duneDownTorso",
            "duneUpArm",
            "duneUpArmAlt",
            "duneDownArm",
            "duneDownArmAlt",
            "duneHand",
            "duneHandAlt",
            "duneThigh",
            "duneThighAlt",
            "duneCrus",
            "duneFoot",
            "duneTail",
        ],
    );
    m.insert(
        "Head",
        vec![
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
            "experimentEyeLockedIn",
            "experimentEyeLockedInBack",
            "milkyheadback",
            "milkyheadbackmouthopen",
            "milkyheadbackmouthhalfopen",
            "milkydisfigure1",
            "milkydisfigure1healed",
            "milkydisfigure2",
            "milkydisfigure2healed",
            "milkyeyeopen",
            "milkyeyeopenback",
            "milkyeyehalfclosed",
            "milkyeyehalfclosedback",
            "milkyeyeclosed",
            "milkyeyegone",
            "milkyeyegonehealed",
            "milkyeyehappy",
            "milkyeyehappyback",
            "milkyeyelockedin",
            "milkyeyelockedinback",
            "milkyeyepanic",
            "milkyeyesad",
            "milkyeyesadback",
            "milkyeyescared",
            "milkyeyescaredback",
            "duneHeadBack",
            "duneHeadMouth",
            "duneHeadMouthHalf",
            "duneDisfigured",
            "duneDisfiguredHealed",
            "duneeyelockedin",
            "dunetradereyes",
            "dunetradereyesangry",
            "dunetradereyessleep",
        ],
    );
    m.insert("Wings", vec!["wingUL", "wingUR", "wingDL", "wingDR"]);
    m.insert(
        "Accessories",
        vec![
            "autopump",
            "autozoomgoggles",
            "balaclava",
            "bellyarmor",
            "belt",
            "bigpack",
            "bikehelmet",
            "blindfold",
            "carapace",
            "climbingclaws",
            "duffelbag",
            "dustmask",
            "fannypack",
            "headlamp",
            "holidayhat",
            "jetpack",
            "latexgloves",
            "legpouch",
            "makeshiftheadlamp",
            "makeshifthelmet",
            "materialpouch",
            "safetyglasses",
            "scarf",
            "slingbag",
            "smallpack",
            "sneakers",
            "woodsandals",
            "liquidpouch",
            "waterpouch1",
            "riothelmet",
            "earmuffs",
            "mercscarf",
            "tacticalgloves",
            "armwarmers",
            "warmerdown",
            "limbwraps",
            "limbwrapsarm",
            "tornshirt",
            "tornshirttop",
            "scubadivinggear",
            "scubatorso",
            "tacticalboots",
            "hoodie",
            "hoodieup",
            "striderpelt",
            "striderpeltup",
            "bandolier",
            "bandolierup",
            "kneepads",
            "kneepad",
            "traumarig",
        ],
    );
    m.insert(
        "Blood",
        vec![
            "BloodParticle",
            "BloodParticle_splat",
            "limbBlood",
            "nosebleed",
        ],
    );
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
        assert!(standardParts("Blood").unwrap().contains(&"nosebleed"));
        assert!(standardParts("Unknown").is_none());
    }

    #[test]
    fn categoryForLooksUpAcrossCatsAndPrefixes() {
        assert_eq!(categoryFor("experimentUpTorso"), Some("Body"));
        assert_eq!(categoryFor("R_experimentUpArmF"), Some("Body"));
        assert_eq!(categoryFor("experimentHead"), Some("Head"));
        assert_eq!(categoryFor("experimentNosebleed"), Some("Head"));
        assert_eq!(categoryFor("nosebleed"), Some("Blood"));
        assert_eq!(categoryFor("wingUL"), Some("Wings"));
        assert_eq!(categoryFor("autopump"), Some("Accessories"));
        assert_eq!(categoryFor("unknownCustomPart"), None);
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
    fn writeEntriesEnvelopeAndLegacyFallback() {
        let dir = std::env::temp_dir().join(format!("baseSizes_rw_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut m = HashMap::new();
        m.insert("Body/experimentCrus".to_string(), (8, 10));
        m.insert("Wings/wingUL".to_string(), (32, 32));
        write(&dir, &m).unwrap();
        let raw = std::fs::read_to_string(dir.join(BASE_SIZES_FILE)).unwrap();
        assert!(raw.contains("\"entries\""));
        let loaded = load(&dir);
        assert_eq!(loaded.get("Body/experimentCrus"), Some((8, 10)));
        assert_eq!(loaded.get("Wings/wingUL"), Some((32, 32)));

        // 旧版无 entries 外壳的扁平 JSON 仍可解析
        std::fs::write(dir.join(BASE_SIZES_FILE), "{\"Body/old\": [12, 18]}").unwrap();
        let legacy = load(&dir);
        assert_eq!(legacy.get("Body/old"), Some((12, 18)));

        // 删除最后一条记录后文件应被移除
        remove(&dir, "Body/old").unwrap();
        assert!(!dir.join(BASE_SIZES_FILE).exists());
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
