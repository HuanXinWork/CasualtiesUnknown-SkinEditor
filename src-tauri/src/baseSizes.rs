// 部件标准尺寸常量表，合成预览按此 nearest-neighbor 缩回；数据取自 huanxin 物理 PNG 尺寸。

#![allow(non_snake_case)]

use std::collections::HashMap;
use std::sync::OnceLock;

/// 标准尺寸表容器。
pub struct BaseSizes {
    entries: HashMap<&'static str, (u32, u32)>,
}

impl BaseSizes {
    pub fn get(&self, key: &str) -> Option<(u32, u32)> {
        self.entries.get(key).copied()
    }
}

/// 返回全局标准尺寸表。
pub fn standardSizes() -> &'static BaseSizes {
    static TABLE: OnceLock<BaseSizes> = OnceLock::new();
    TABLE.get_or_init(buildTable)
}

/// 兼容旧 load(skinDir) 签名，忽略路径返回常量表。
pub fn load(_skinDir: &std::path::Path) -> &'static BaseSizes {
    standardSizes()
}

/// `<categoryDir>/<partName>` 形式的查表 key。
pub fn keyFor(categoryDir: &str, partName: &str) -> String {
    format!("{}/{}", categoryDir, partName)
}

/// 按部件名反查所属分类目录；F/B 后缀副本剥后缀回查 base 名，未命中返回 None。
pub fn categoryFor(partName: &str) -> Option<&'static str> {
    let table = standardSizes();
    for cat in ["Body", "Head", "Wings", "Accessories"] {
        if table.entries.contains_key(keyFor(cat, partName).as_str()) {
            return Some(cat);
        }
    }
    let stripped = stripSideSuffix(partName);
    if stripped != partName {
        for cat in ["Body", "Head", "Wings", "Accessories"] {
            if table.entries.contains_key(keyFor(cat, stripped).as_str()) {
                return Some(cat);
            }
        }
    }
    None
}

/// 剥末尾的 F / B 后缀；其它情况原样返回。
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

fn buildTable() -> BaseSizes {
    let mut m: HashMap<&'static str, (u32, u32)> = HashMap::new();
    // ---- Body（10）----
    m.insert("Body/experimentCrus", (8, 10));
    m.insert("Body/experimentDownArm", (12, 14));
    m.insert("Body/experimentDownTorso", (12, 12));
    m.insert("Body/experimentFoot", (11, 12));
    m.insert("Body/experimentHandB", (5, 12));
    m.insert("Body/experimentHandF", (6, 12));
    m.insert("Body/experimentTail", (68, 22));
    m.insert("Body/experimentThigh", (10, 15));
    m.insert("Body/experimentUpArm", (8, 12));
    m.insert("Body/experimentUpTorso", (12, 18));
    // ---- Head 主体（9）----
    m.insert("Head/experimentHead", (26, 18));
    m.insert("Head/experimentHeadBack", (26, 18));
    m.insert("Head/experimentHeadBackMouth", (26, 18));
    m.insert("Head/experimentHeadBackMouthMini", (26, 18));
    m.insert("Head/experimentHeadDisfigured1", (26, 18));
    m.insert("Head/experimentHeadDisfigured1Healed", (26, 18));
    m.insert("Head/experimentHeadDisfigured2", (26, 18));
    m.insert("Head/experimentHeadDisfigured2Healed", (26, 18));
    m.insert("Head/experimentHeadDisfigured3", (26, 18));
    m.insert("Head/experimentHeadDisfigured3Healed", (26, 18));
    m.insert("Head/experimentNosebleed", (14, 12));
    // ---- Head 表情（11）----
    m.insert("Head/experimentEyeClosed", (26, 12));
    m.insert("Head/experimentEyeGone", (26, 12));
    m.insert("Head/experimentEyeGoneHealed", (26, 12));
    m.insert("Head/experimentEyeHalfClosed", (26, 12));
    m.insert("Head/experimentEyeHalfClosedBack", (26, 12));
    m.insert("Head/experimentEyeHappy", (26, 12));
    m.insert("Head/experimentEyeLookBack", (26, 12));
    m.insert("Head/experimentEyeOpen", (26, 12));
    m.insert("Head/experimentEyePanic", (26, 12));
    m.insert("Head/experimentEyeSad", (26, 12));
    m.insert("Head/experimentEyeSadBack", (26, 12));
    m.insert("Head/experimentEyeScared", (26, 12));
    m.insert("Head/experimentEyeScaredBack", (26, 12));
    // ---- Wings（4）全部 32×32 ----
    m.insert("Wings/wingUL", (32, 32));
    m.insert("Wings/wingUR", (32, 32));
    m.insert("Wings/wingDL", (32, 32));
    m.insert("Wings/wingDR", (32, 32));
    // ---- Accessories（27 个标准配件）----
    m.insert("Accessories/autopump", (12, 12));
    m.insert("Accessories/autozoomgoggles", (16, 12));
    m.insert("Accessories/balaclava", (26, 12));
    m.insert("Accessories/bellyarmor", (12, 12));
    m.insert("Accessories/belt", (10, 8));
    m.insert("Accessories/bigpack", (24, 24));
    m.insert("Accessories/bikehelmet", (20, 18));
    m.insert("Accessories/blindfold", (26, 12));
    m.insert("Accessories/carapace", (12, 18));
    m.insert("Accessories/climbingclaws", (8, 12));
    m.insert("Accessories/duffelbag", (20, 24));
    m.insert("Accessories/dustmask", (26, 12));
    m.insert("Accessories/fannypack", (16, 10));
    m.insert("Accessories/headlamp", (26, 12));
    m.insert("Accessories/holidayhat", (22, 18));
    m.insert("Accessories/jetpack", (24, 30));
    m.insert("Accessories/latexgloves", (6, 8));
    m.insert("Accessories/legpouch", (10, 12));
    m.insert("Accessories/makeshiftheadlamp", (20, 20));
    m.insert("Accessories/makeshifthelmet", (22, 18));
    m.insert("Accessories/materialpouch", (12, 12));
    m.insert("Accessories/safetyglasses", (26, 12));
    m.insert("Accessories/scarf", (12, 14));
    m.insert("Accessories/slingbag", (26, 16));
    m.insert("Accessories/smallpack", (16, 14));
    m.insert("Accessories/sneakers", (8, 11));
    m.insert("Accessories/woodsandals", (10, 11));
    BaseSizes { entries: m }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standardSizesContainsCoreParts() {
        let t = standardSizes();
        assert_eq!(t.get("Body/experimentUpTorso"), Some((12, 18)));
        assert_eq!(t.get("Body/experimentCrus"), Some((8, 10)));
        assert_eq!(t.get("Wings/wingUL"), Some((32, 32)));
        assert_eq!(t.get("Accessories/autopump"), Some((12, 12)));
        assert_eq!(t.get("Head/experimentEyeOpen"), Some((26, 12)));
    }

    #[test]
    fn missingKeyReturnsNone() {
        // 用户自定义新部件未列入常量表 → 不缩回，保持磁盘实尺
        assert!(standardSizes().get("Accessories/customNewItem").is_none());
    }

    #[test]
    fn keyForJoinsCategoryAndName() {
        assert_eq!(keyFor("Body", "experimentCrus"), "Body/experimentCrus");
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
        // experimentEyeOpenF / experimentEyeOpenB 不在表内，但 base 名命中 Head
        assert_eq!(categoryFor("experimentEyeOpenF"), Some("Head"));
        assert_eq!(categoryFor("experimentEyeOpenB"), Some("Head"));
        assert_eq!(categoryFor("experimentHandF"), Some("Body"));
    }
}
