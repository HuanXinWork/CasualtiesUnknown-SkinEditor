// 皮肤目录扫描与 PNG 尺寸/像素读取。
#![allow(non_snake_case)]

mod pack;
pub use pack::{exportSkinPack, importSkinPack, writeBaseSizesForSkin, ExportLayout, ImportResult};

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::accessories::{self, AccessoryEntry};
use crate::apiLayer::ApiError;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Skin {
    pub name: String,
    pub body: Vec<PartInfo>,
    pub head: Vec<PartInfo>,
    pub wings: Vec<PartInfo>,
    #[serde(default)]
    pub accessories: Vec<PartInfo>,
    #[serde(default)]
    pub accessoryConfigs: Vec<AccessoryEntry>,
    #[serde(default)]
    pub blood: Vec<PartInfo>,
}

pub type Stage = Skin;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartInfo {
    pub name: String,
    pub category: PartCategory,
    pub width: u32,
    pub height: u32,
    pub corrupted: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum PartCategory {
    Body,
    Head,
    Wings,
    Accessories,
    Blood,
}

impl PartCategory {
    fn dirName(self) -> &'static str {
        match self {
            PartCategory::Body => "Body",
            PartCategory::Head => "Head",
            PartCategory::Wings => "Wings",
            PartCategory::Accessories => "Accessories",
            PartCategory::Blood => "Blood",
        }
    }
}

pub struct DecodedPart {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

pub fn scanStages(skinRoot: &Path) -> Vec<Stage> {
    (1..=9)
        .map(|i| scanSkin(skinRoot, &format!("st{}", i)))
        .collect()
}

pub fn scanSkin(skinsRoot: &Path, skinName: &str) -> Skin {
    let skinDir = skinsRoot.join(skinName);
    if !skinDir.is_dir() {
        return Skin {
            name: skinName.to_string(),
            body: vec![],
            head: vec![],
            wings: vec![],
            accessories: vec![],
            accessoryConfigs: vec![],
            blood: vec![],
        };
    }
    Skin {
        name: skinName.to_string(),
        body: scanCategory(&skinDir, PartCategory::Body),
        head: scanCategory(&skinDir, PartCategory::Head),
        wings: scanCategory(&skinDir, PartCategory::Wings),
        accessories: scanCategory(&skinDir, PartCategory::Accessories),
        accessoryConfigs: accessories::loadAccessories(&accessories::accessoriesPath(
            skinsRoot, skinName,
        )),
        blood: scanCategory(&skinDir, PartCategory::Blood),
    }
}

pub fn listSkins(skinsRoot: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(skinsRoot) else {
        return vec![];
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().to_str().map(|s| s.to_string()))
        .collect();
    names.sort();
    names
}

fn scanCategory(stageDir: &Path, category: PartCategory) -> Vec<PartInfo> {
    let categoryDir = stageDir.join(category.dirName());
    let Ok(entries) = fs::read_dir(&categoryDir) else {
        return vec![];
    };
    let mut parts = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || !isPng(&path) {
            continue;
        }
        let fname = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        // `<part>.zones.png` 为区块遮罩而非独立部件，从部件列表中排除。
        if fname.to_ascii_lowercase().ends_with(".zones.png") {
            continue;
        }
        let name = path
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let (width, height, corrupted) = match readPngDimensions(&path) {
            Some((w, h)) => (w, h, false),
            None => (0, 0, true),
        };
        parts.push(PartInfo {
            name,
            category,
            width,
            height,
            corrupted,
        });
    }
    parts.sort_by(|a, b| a.name.cmp(&b.name));
    parts
}

pub(super) fn isPng(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("png"))
        .unwrap_or(false)
}

pub(super) fn readPngDimensions(path: &Path) -> Option<(u32, u32)> {
    image::ImageReader::open(path)
        .ok()?
        .into_dimensions()
        .ok()
}

pub fn decodePart(path: &Path) -> Result<DecodedPart, ApiError> {
    let reader = image::ImageReader::open(path).map_err(|e| ApiError {
        code: "decode_failed".into(),
        message: format!("open {} failed: {}", path.display(), e),
    })?;
    let img = reader.decode().map_err(|e| ApiError {
        code: "decode_failed".into(),
        message: format!("decode {} failed: {}", path.display(), e),
    })?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();
    Ok(DecodedPart {
        width,
        height,
        pixels: rgba.into_raw(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
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
                "spe_skinLoader_{}_{}_{}",
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

    fn writeTinyPng(path: &Path) {
        let buf = image::RgbaImage::from_pixel(1, 1, image::Rgba([10, 20, 30, 40]));
        buf.save(path).expect("write tiny png");
    }

    #[test]
    fn missingStageDirsReturnEmptySlots() {
        let tmp = TempDir::new();
        let stages = scanStages(tmp.path());
        assert_eq!(stages.len(), 9);
        for (i, stage) in stages.iter().enumerate() {
            assert_eq!(stage.name, format!("st{}", i + 1));
            assert!(stage.body.is_empty());
            assert!(stage.head.is_empty());
        }
    }

    #[test]
    fn emptyCategoryReturnsEmptyList() {
        let tmp = TempDir::new();
        fs::create_dir_all(tmp.path().join("st1").join("Body")).unwrap();
        fs::create_dir_all(tmp.path().join("st1").join("Head")).unwrap();
        let stages = scanStages(tmp.path());
        let st1 = stages.iter().find(|s| s.name == "st1").unwrap();
        assert!(st1.body.is_empty());
        assert!(st1.head.is_empty());
    }

    #[test]
    fn corruptedPngMarksCorrupted() {
        let tmp = TempDir::new();
        let bodyDir = tmp.path().join("st2").join("Body");
        fs::create_dir_all(&bodyDir).unwrap();
        fs::write(bodyDir.join("broken.png"), b"not a png").unwrap();
        let stages = scanStages(tmp.path());
        let st2 = stages.iter().find(|s| s.name == "st2").unwrap();
        assert_eq!(st2.body.len(), 1);
        let part = &st2.body[0];
        assert_eq!(part.name, "broken");
        assert_eq!(part.category, PartCategory::Body);
        assert!(part.corrupted);
        assert_eq!((part.width, part.height), (0, 0));
    }

    #[test]
    fn validPngLoadsDimensions() {
        let tmp = TempDir::new();
        let headDir = tmp.path().join("st3").join("Head");
        fs::create_dir_all(&headDir).unwrap();
        let pngPath = headDir.join("eyeFront0.png");
        writeTinyPng(&pngPath);
        let stages = scanStages(tmp.path());
        let st3 = stages.iter().find(|s| s.name == "st3").unwrap();
        assert_eq!(st3.head.len(), 1);
        let part = &st3.head[0];
        assert_eq!(part.name, "eyeFront0");
        assert_eq!(part.category, PartCategory::Head);
        assert!(!part.corrupted);
        assert_eq!((part.width, part.height), (1, 1));

        let decoded = decodePart(&pngPath).expect("decode tiny png");
        assert_eq!((decoded.width, decoded.height), (1, 1));
        assert_eq!(decoded.pixels, vec![10, 20, 30, 40]);
    }

    #[test]
    fn txtFilesAreSkippedAndNotModified() {
        let tmp = TempDir::new();
        let bodyDir = tmp.path().join("st4").join("Body");
        fs::create_dir_all(&bodyDir).unwrap();
        let txtPath = bodyDir.join("notes.txt");
        let originalBytes: Vec<u8> = b"keep me intact\n\xff\x00".to_vec();
        fs::write(&txtPath, &originalBytes).unwrap();

        let stages = scanStages(tmp.path());
        let st4 = stages.iter().find(|s| s.name == "st4").unwrap();
        assert!(st4.body.is_empty());
        assert!(st4.head.is_empty());
        assert_eq!(fs::read(&txtPath).unwrap(), originalBytes);
    }

    #[test]
    fn scanSkinReturnsEmptySlotsWhenMissing() {
        let tmp = TempDir::new();
        let skin = scanSkin(tmp.path(), "default");
        assert_eq!(skin.name, "default");
        assert!(skin.body.is_empty());
        assert!(skin.head.is_empty());
    }

    #[test]
    fn scanSkinDecodesBodyAndHead() {
        let tmp = TempDir::new();
        let bodyDir = tmp.path().join("foo").join("Body");
        let headDir = tmp.path().join("foo").join("Head");
        fs::create_dir_all(&bodyDir).unwrap();
        fs::create_dir_all(&headDir).unwrap();
        writeTinyPng(&bodyDir.join("UpTorso.png"));
        writeTinyPng(&headDir.join("EyeOpen.png"));

        let skin = scanSkin(tmp.path(), "foo");
        assert_eq!(skin.name, "foo");
        assert_eq!(skin.body.len(), 1);
        assert_eq!(skin.body[0].name, "UpTorso");
        assert_eq!(skin.head.len(), 1);
        assert_eq!(skin.head[0].name, "EyeOpen");
    }

    #[test]
    fn listSkinsReturnsSortedSubdirNames() {
        let tmp = TempDir::new();
        fs::create_dir_all(tmp.path().join("c")).unwrap();
        fs::create_dir_all(tmp.path().join("a")).unwrap();
        fs::create_dir_all(tmp.path().join("b")).unwrap();
        fs::write(tmp.path().join("file.txt"), b"not a dir").unwrap();
        assert_eq!(
            listSkins(tmp.path()),
            vec!["a".to_string(), "b".to_string(), "c".to_string()]
        );
    }

    #[test]
    fn listSkinsReturnsEmptyWhenRootMissing() {
        let tmp = TempDir::new();
        assert!(listSkins(&tmp.path().join("doesNotExist")).is_empty());
    }
}
