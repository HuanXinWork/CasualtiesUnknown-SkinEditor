// 扫描 <skinRoot>/<skinName>/{Body,Head}/ 下的 PNG，输出元信息或 RGBA 字节。
#![allow(non_snake_case)]

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::accessories::{self, AccessoryEntry};
use crate::apiLayer::ApiError;

/// 单个皮肤：name 是目录名，body/head/wings/accessories 是该目录下四个分类的 PartInfo 列表，
/// accessoryConfigs 是 `<skin>/accessories.json` 解析结果（缺失为空），用于 enabled / limb / 偏移叠加。
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
    /// `<skin>/Blood/*.png` 列表——血液粒子贴图，可在编辑画布编辑像素，不参与装配预览。
    #[serde(default)]
    pub blood: Vec<PartInfo>,
}

/// 旧名别名，保留供仍引用 `Stage` 字面量的代码路径。
pub type Stage = Skin;

/// 单个 PNG 部件的元信息。corrupted=true 表示文件存在但解码失败。
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

/// PNG 解码后的 RGBA 扁平像素，长度 = width * height * 4。
pub struct DecodedPart {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

/// 扫描 st1~st9 共 9 个固定子目录，缺失目录返回空 body/head 占位。
pub fn scanStages(skinRoot: &Path) -> Vec<Stage> {
    (1..=9)
        .map(|i| {
            let id = format!("st{}", i);
            let stageDir = skinRoot.join(&id);
            if stageDir.is_dir() {
                Skin {
                    name: id.clone(),
                    body: scanCategory(&stageDir, PartCategory::Body),
                    head: scanCategory(&stageDir, PartCategory::Head),
                    wings: scanCategory(&stageDir, PartCategory::Wings),
                    accessories: scanCategory(&stageDir, PartCategory::Accessories),
                    accessoryConfigs: accessories::loadAccessories(
                        &accessories::accessoriesPath(skinRoot, &id),
                    ),
                    blood: scanCategory(&stageDir, PartCategory::Blood),
                }
            } else {
                Skin {
                    name: id,
                    body: vec![],
                    head: vec![],
                    wings: vec![],
                    accessories: vec![],
                    accessoryConfigs: vec![],
                    blood: vec![],
                }
            }
        })
        .collect()
}

/// 扫描单个皮肤目录。目录不存在时返回所有分类都空的占位 Skin。
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
        accessoryConfigs: accessories::loadAccessories(&accessories::accessoriesPath(skinsRoot, skinName)),
        blood: scanCategory(&skinDir, PartCategory::Blood),
    }
}

/// 列出皮肤根目录下所有子目录名，按字典序升序保证 UI 顺序稳定。
/// 根不存在或不是目录返回空 Vec；非目录条目跳过。
pub fn listSkins(skinsRoot: &Path) -> Vec<String> {
    let entries = match fs::read_dir(skinsRoot) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.path().is_dir())
        .filter_map(|entry| entry.file_name().to_str().map(|s| s.to_string()))
        .collect();
    names.sort();
    names
}

/// 扫描单个皮肤的 Body/ 或 Head/ 子目录，返回所有 PNG 的元信息。
fn scanCategory(stageDir: &Path, category: PartCategory) -> Vec<PartInfo> {
    let categoryDir = stageDir.join(category.dirName());
    let entries = match fs::read_dir(&categoryDir) {
        Ok(e) => e,
        Err(_) => return vec![],
    };
    let mut parts = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if !isPng(&path) {
            // 非 PNG 扩展名一律跳过，不读内容也不计入结果。
            continue;
        }
        // 区块 mask 文件名形如 `<part>.zones.png`，不是部件本体，从列表里剔除。
        let fname = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("");
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
        parts.push(PartInfo { name, category, width, height, corrupted });
    }
    parts
}

fn isPng(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("png"))
        .unwrap_or(false)
}

fn readPngDimensions(path: &Path) -> Option<(u32, u32)> {
    image::ImageReader::open(path).ok()?.into_dimensions().ok()
}

/// 把 PNG 解码为 RGBA 扁平 buffer。文件损坏返回 ApiError，不 panic。
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
    Ok(DecodedPart { width, height, pixels: rgba.into_raw() })
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    /// 自管 RAII 临时目录，避免引入 tempfile 开发依赖。
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
                .join(format!("spe_skinLoader_{}_{}_{}", std::process::id(), nanos, seq));
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
        assert_eq!(part.width, 0);
        assert_eq!(part.height, 0);
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
        assert_eq!(part.width, 1);
        assert_eq!(part.height, 1);

        let decoded = decodePart(&pngPath).expect("decode tiny png");
        assert_eq!(decoded.width, 1);
        assert_eq!(decoded.height, 1);
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

        let after = fs::read(&txtPath).unwrap();
        assert_eq!(after, originalBytes);
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
        assert_eq!(skin.body[0].category, PartCategory::Body);
        assert!(!skin.body[0].corrupted);
        assert_eq!(skin.head.len(), 1);
        assert_eq!(skin.head[0].name, "EyeOpen");
        assert_eq!(skin.head[0].category, PartCategory::Head);
        assert!(!skin.head[0].corrupted);
    }

    #[test]
    fn listSkinsReturnsSortedSubdirNames() {
        let tmp = TempDir::new();
        fs::create_dir_all(tmp.path().join("c")).unwrap();
        fs::create_dir_all(tmp.path().join("a")).unwrap();
        fs::create_dir_all(tmp.path().join("b")).unwrap();
        fs::write(tmp.path().join("file.txt"), b"not a dir").unwrap();
        let names = listSkins(tmp.path());
        assert_eq!(names, vec!["a".to_string(), "b".to_string(), "c".to_string()]);
    }

    #[test]
    fn listSkinsReturnsEmptyWhenRootMissing() {
        let tmp = TempDir::new();
        let missing = tmp.path().join("doesNotExist");
        let names = listSkins(&missing);
        assert!(names.is_empty());
    }
}


// ===== 皮肤包 zip 导入导出 =====
// 包结构：zip 顶层即 Body/ Head/，扩展名只接受 png 与 txt。
// zip slip 防御：含 `..` / 绝对路径 / drive 前缀的条目直接报错；其余形状不匹配静默丢弃。

use std::io::{self, Write};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
}

/// 导出格式：flat = 全部平铺到 `<皮肤名>/Body/`；categorized = 按分类放 Body/Head/Wings/Accessories。
/// 两种格式 zip 顶层都套 `<皮肤名>/`；wings.json / accessories.json / blood.json 始终落根。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportLayout {
    Flat,
    Categorized,
}

impl ExportLayout {
    pub fn fromStr(s: &str) -> Self {
        match s {
            "flat" | "topLevel" => ExportLayout::Flat,
            _ => ExportLayout::Categorized,
        }
    }
}

/// 把 `<skinDir>/{Body,Head,Wings,Accessories}/*.{png,txt}` 与根目录的 wings.json /
/// accessories.json / blood.json（按 includeBlood 决定）打成 zip。
/// 顶层结构由 layout 决定。
pub fn exportSkinPack(
    skinDir: &Path,
    zipPath: &Path,
    layout: ExportLayout,
    includeBlood: bool,
) -> Result<usize, ApiError> {
    let skinName = skinDir
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("skin");
    let prefix = format!("{}/", skinName);
    let categoryDir = |cat: &str| -> String {
        match layout {
            ExportLayout::Flat => "Body".to_string(),
            ExportLayout::Categorized => cat.to_string(),
        }
    };
    let file = fs::File::create(zipPath).map_err(|e| ioErr("create zip", zipPath, e))?;
    let mut zip = zip::ZipWriter::new(file);
    let opts: zip::write::SimpleFileOptions = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    let mut count = 0usize;
    let writeFile = |zip: &mut zip::ZipWriter<fs::File>, relInZip: &str, bytes: &[u8]| -> Result<(), ApiError> {
        let entryPath = format!("{}{}", prefix, relInZip);
        zip.start_file(&entryPath, opts).map_err(zipErr)?;
        zip.write_all(bytes).map_err(|e| ApiError {
            code: "zip_failed".into(),
            message: format!("write zip entry {} failed: {}", entryPath, e),
        })?;
        Ok(())
    };
    for cat in ["Body", "Head", "Wings", "Accessories"] {
        let dir = skinDir.join(cat);
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || !isExportable(&path) {
                continue;
            }
            let fname = match path.file_name().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            let rel = format!("{}/{}", categoryDir(cat), fname);
            let bytes = fs::read(&path).map_err(|e| ioErr("read", &path, e))?;
            writeFile(&mut zip, &rel, &bytes)?;
            count += 1;
        }
    }
    // wings.json / accessories.json：与皮肤同级的元数据文件，永远跟随导出。
    for meta in ["wings.json", "accessories.json"] {
        let metaPath = skinDir.join(meta);
        if metaPath.is_file() {
            let bytes = fs::read(&metaPath).map_err(|e| ioErr("read", &metaPath, e))?;
            writeFile(&mut zip, meta, &bytes)?;
            count += 1;
        }
    }
    // blood.json + Blood/*.png 由 includeBlood 控制；Flat 模式贴图跟随平铺去 Body/。
    if includeBlood {
        let bloodPath = skinDir.join("blood.json");
        if bloodPath.is_file() {
            let bytes = fs::read(&bloodPath).map_err(|e| ioErr("read", &bloodPath, e))?;
            writeFile(&mut zip, "blood.json", &bytes)?;
            count += 1;
        }
        // Blood/*.png：Flat 跟随 Body/，Categorized 保持 Blood/。
        let bloodDir = skinDir.join("Blood");
        if let Ok(entries) = fs::read_dir(&bloodDir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_file() || !isExportable(&path) {
                    continue;
                }
                let fname = match path.file_name().and_then(|s| s.to_str()) {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let rel = format!("{}/{}", categoryDir("Blood"), fname);
                let bytes = fs::read(&path).map_err(|e| ioErr("read", &path, e))?;
                writeFile(&mut zip, &rel, &bytes)?;
                count += 1;
            }
        }
    }
    zip.finish().map_err(zipErr)?;
    Ok(count)
}

/// 解压 zip 到 skinRoot。`overwrite=false` 时已有同名文件跳过；
/// 形状不匹配条目静默丢弃；含 `..` / 绝对路径条目直接报 `unsafe_path`。
pub fn importSkinPack(
    zipPath: &Path,
    skinRoot: &Path,
    overwrite: bool,
) -> Result<ImportResult, ApiError> {
    let file = fs::File::open(zipPath).map_err(|e| ioErr("open zip", zipPath, e))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| ApiError {
        code: "not_a_zip".into(),
        message: format!("not a zip: {}", e),
    })?;
    let mut imported = 0usize;
    let mut skipped = 0usize;
    for idx in 0..archive.len() {
        let mut entry = archive.by_index(idx).map_err(zipErr)?;
        if entry.is_dir() {
            continue;
        }
        let name = entry.name().to_string();
        match classifyEntry(&name) {
            EntryKind::Unsafe => {
                return Err(ApiError {
                    code: "unsafe_path".into(),
                    message: format!("unsafe zip entry: {}", name),
                });
            }
            EntryKind::Drop => continue,
            EntryKind::Accept(rel) => {
                let target = skinRoot.join(&rel);
                if !overwrite && target.exists() {
                    skipped += 1;
                    continue;
                }
                if let Some(parent) = target.parent() {
                    fs::create_dir_all(parent).map_err(|e| ioErr("mkdir", parent, e))?;
                }
                let mut out = fs::File::create(&target)
                    .map_err(|e| ioErr("create", &target, e))?;
                io::copy(&mut entry, &mut out).map_err(|e| ioErr("write", &target, e))?;
                imported += 1;
            }
        }
    }
    Ok(ImportResult { imported, skipped })
}

enum EntryKind {
    Unsafe,
    Drop,
    Accept(std::path::PathBuf),
}

fn classifyEntry(name: &str) -> EntryKind {
    if name.is_empty() || name.starts_with('/') || name.starts_with('\\') {
        return EntryKind::Unsafe;
    }
    let bytes = name.as_bytes();
    if bytes.len() >= 2 && bytes[1] == b':' {
        return EntryKind::Unsafe;
    }
    let normalized = name.replace('\\', "/");
    let mut comps: Vec<&str> = Vec::new();
    for seg in normalized.split('/') {
        if seg.is_empty() || seg == "." {
            continue;
        }
        if seg == ".." {
            return EntryKind::Unsafe;
        }
        comps.push(seg);
    }
    if comps.is_empty() {
        return EntryKind::Drop;
    }
    let fname = comps[comps.len() - 1];

    // 根级 wings.json 直通：导入端按文件名落回 skinDir 根目录。
    if fname.eq_ignore_ascii_case("wings.json") {
        return EntryKind::Accept(std::path::PathBuf::from("wings.json"));
    }
    // 根级 accessories.json 同样直通。
    if fname.eq_ignore_ascii_case("accessories.json") {
        return EntryKind::Accept(std::path::PathBuf::from("accessories.json"));
    }
    // 根级 blood.json：跟随血液配置一起导入回原位。
    if fname.eq_ignore_ascii_case("blood.json") {
        return EntryKind::Accept(std::path::PathBuf::from("blood.json"));
    }
    // Blood/ 子目录：自定义粒子贴图整目录直通。
    for seg in comps.iter().rev().skip(1) {
        if seg.eq_ignore_ascii_case("Blood") {
            if !isExportableName(fname) {
                return EntryKind::Drop;
            }
            return EntryKind::Accept(std::path::PathBuf::from(format!("Blood/{}", fname)));
        }
    }
    // Accessories/ 路径段：把 PNG 落回 <skinDir>/Accessories/<file>。
    for seg in comps.iter().rev().skip(1) {
        if seg.eq_ignore_ascii_case("Accessories") {
            if !isExportableName(fname) {
                return EntryKind::Drop;
            }
            return EntryKind::Accept(std::path::PathBuf::from(format!("Accessories/{}", fname)));
        }
    }

    if !isExportableName(fname) {
        return EntryKind::Drop;
    }

    // 文件名优先归类：baseSizes 命中 → 按 baseSizes；含 head/wing/blood 等关键字 → 按 keyword。
    if fname.to_lowercase().ends_with(".png") {
        let stem = std::path::Path::new(fname)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(fname);
        if let Some(cat) = crate::baseSizes::categoryFor(stem) {
            return EntryKind::Accept(std::path::PathBuf::from(format!("{}/{}", cat, fname)));
        }
        let lower = fname.to_lowercase();
        if lower.contains("blood") || lower.contains("wing") {
            let cat = classifyByName(fname);
            return EntryKind::Accept(std::path::PathBuf::from(format!("{}/{}", cat, fname)));
        }
        const HEAD_HINTS: &[&str] = &[
            "head", "face", "eye", "mouth", "hair", "ear", "horn", "disfigured",
        ];
        for hint in HEAD_HINTS {
            if lower.contains(hint) {
                return EntryKind::Accept(std::path::PathBuf::from(format!("Head/{}", fname)));
            }
        }
    }

    // 路径段 fallback：未知部件名沿用 zip 的目录归类。
    for seg in comps.iter().rev().skip(1) {
        if *seg == "Body" || *seg == "Head" || *seg == "Wings" {
            return EntryKind::Accept(std::path::PathBuf::from(format!("{}/{}", seg, fname)));
        }
    }

    let cat = classifyByName(fname);
    EntryKind::Accept(std::path::PathBuf::from(format!("{}/{}", cat, fname)))
}

/// 文件名（不含路径）按关键字归类：含 blood → Blood，含 wing → Wings，
/// 含 head/face/eye/mouth/disfigured → Head，其余落到 Body。
/// 匹配大小写不敏感；wings.json 等元数据文件不进此函数（被 isExportableName 过滤）。
fn classifyByName(fname: &str) -> &'static str {
    let lower = fname.to_lowercase();
    if lower.contains("blood") {
        return "Blood";
    }
    if lower.contains("wing") {
        return "Wings";
    }
    const HEAD_HINTS: &[&str] = &[
        "head", "face", "eye", "mouth", "hair", "ear", "horn", "disfigured",
    ];
    for hint in HEAD_HINTS {
        if lower.contains(hint) {
            return "Head";
        }
    }
    "Body"
}

fn isExportable(path: &Path) -> bool {
    path.file_name()
        .and_then(|s| s.to_str())
        .map(isExportableName)
        .unwrap_or(false)
}

fn isExportableName(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.ends_with(".png") || lower.ends_with(".txt")
}

fn zipErr(e: zip::result::ZipError) -> ApiError {
    ApiError {
        code: "zip_failed".into(),
        message: format!("zip op failed: {}", e),
    }
}

fn ioErr(action: &str, path: &Path, e: io::Error) -> ApiError {
    ApiError {
        code: "io_failed".into(),
        message: format!("{} {} failed: {}", action, path.display(), e),
    }
}

#[cfg(test)]
mod skinPackTests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir(std::path::PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            static SEQ: AtomicU64 = AtomicU64::new(0);
            let seq = SEQ.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir()
                .join(format!("spe_skinPack_{}_{}_{}_{}", tag, std::process::id(), nanos, seq));
            fs::create_dir_all(&path).expect("mkdir tmp");
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

    fn writePng(path: &Path) {
        image::RgbaImage::from_pixel(1, 1, image::Rgba([1, 2, 3, 255]))
            .save(path)
            .expect("write png");
    }

    fn buildZip(zipPath: &Path, entries: &[(&str, &[u8])]) {
        let f = fs::File::create(zipPath).unwrap();
        let mut zw = zip::ZipWriter::new(f);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (name, data) in entries {
            zw.start_file(*name, opts).unwrap();
            zw.write_all(data).unwrap();
        }
        zw.finish().unwrap();
    }

    fn listZipEntries(zipPath: &Path) -> Vec<String> {
        let f = fs::File::open(zipPath).unwrap();
        let mut a = zip::ZipArchive::new(f).unwrap();
        (0..a.len()).map(|i| a.by_index(i).unwrap().name().to_string()).collect()
    }

    #[test]
    fn exportEmptyRootProducesZeroEntries() {
        let tmp = TempDir::new("expEmpty");
        let skinDir = tmp.path().join("st1");
        fs::create_dir_all(&skinDir).unwrap();
        let zipPath = tmp.path().join("out.zip");
        let n = exportSkinPack(&skinDir, &zipPath, ExportLayout::Categorized, false).expect("export");
        assert_eq!(n, 0);
        assert!(listZipEntries(&zipPath).is_empty());
    }

    #[test]
    fn exportFlatLayoutPutsAllUnderBody() {
        let tmp = TempDir::new("expFlat");
        let skinDir = tmp.path().join("st1");
        fs::create_dir_all(skinDir.join("Body")).unwrap();
        fs::create_dir_all(skinDir.join("Head")).unwrap();
        fs::create_dir_all(skinDir.join("Wings")).unwrap();
        writePng(&skinDir.join("Body").join("UpTorso.png"));
        writePng(&skinDir.join("Head").join("EyeOpen.png"));
        writePng(&skinDir.join("Wings").join("wingUL.png"));

        let zipPath = tmp.path().join("out.zip");
        let n = exportSkinPack(&skinDir, &zipPath, ExportLayout::Flat, false).expect("export");
        assert_eq!(n, 3);
        let mut names = listZipEntries(&zipPath);
        names.sort();
        // flat 模式：所有 PNG 都落 `<皮肤名>/Body/`，无 Head/Wings 子目录。
        assert_eq!(
            names,
            vec![
                "st1/Body/EyeOpen.png".to_string(),
                "st1/Body/UpTorso.png".to_string(),
                "st1/Body/wingUL.png".to_string(),
            ]
        );
    }

    #[test]
    fn exportCategorizedKeepsSubfolders() {
        let tmp = TempDir::new("expCategorized");
        let skinDir = tmp.path().join("st1");
        fs::create_dir_all(skinDir.join("Body")).unwrap();
        fs::create_dir_all(skinDir.join("Head")).unwrap();
        writePng(&skinDir.join("Body").join("UpTorso.png"));
        fs::write(skinDir.join("Body").join("notes.txt"), b"hi").unwrap();
        writePng(&skinDir.join("Head").join("EyeOpen.png"));

        let zipPath = tmp.path().join("out.zip");
        let n = exportSkinPack(&skinDir, &zipPath, ExportLayout::Categorized, false).expect("export");
        assert_eq!(n, 3);
        let mut names = listZipEntries(&zipPath);
        names.sort();
        assert_eq!(
            names,
            vec![
                "st1/Body/UpTorso.png".to_string(),
                "st1/Body/notes.txt".to_string(),
                "st1/Head/EyeOpen.png".to_string(),
            ]
        );
    }

    #[test]
    fn exportIncludesWingsAndWingsJson() {
        let tmp = TempDir::new("expWings");
        let skinDir = tmp.path().join("st1");
        fs::create_dir_all(skinDir.join("Body")).unwrap();
        fs::create_dir_all(skinDir.join("Wings")).unwrap();
        writePng(&skinDir.join("Body").join("UpTorso.png"));
        writePng(&skinDir.join("Wings").join("wingUL.png"));
        writePng(&skinDir.join("Wings").join("wingUR.png"));
        fs::write(skinDir.join("wings.json"), b"{\"wingUL\":{\"x\":-2}}").unwrap();

        let zipPath = tmp.path().join("out.zip");
        let n = exportSkinPack(&skinDir, &zipPath, ExportLayout::Categorized, false).expect("export");
        assert_eq!(n, 4);
        let mut names = listZipEntries(&zipPath);
        names.sort();
        assert_eq!(
            names,
            vec![
                "st1/Body/UpTorso.png".to_string(),
                "st1/Wings/wingUL.png".to_string(),
                "st1/Wings/wingUR.png".to_string(),
                "st1/wings.json".to_string(),
            ]
        );
    }

    #[test]
    fn importRestoresWingsAndWingsJson() {
        let tmp = TempDir::new("impWings");
        let out = tmp.path().join("out");
        fs::create_dir_all(&out).unwrap();
        let zipPath = tmp.path().join("in.zip");
        buildZip(
            &zipPath,
            &[
                ("Wings/wingUL.png", b"WUL"),
                ("Wings/wingDR.png", b"WDR"),
                ("wings.json", b"{\"wingUL\":{\"x\":-2}}"),
            ],
        );
        let r = importSkinPack(&zipPath, &out, true).expect("import");
        assert_eq!(r.imported, 3);
        assert_eq!(fs::read(out.join("Wings/wingUL.png")).unwrap(), b"WUL");
        assert_eq!(fs::read(out.join("Wings/wingDR.png")).unwrap(), b"WDR");
        assert_eq!(fs::read(out.join("wings.json")).unwrap(), b"{\"wingUL\":{\"x\":-2}}");
    }

    #[test]
    fn importExtractsAllAndDropsIrrelevant() {
        let tmp = TempDir::new("imp");
        let zipPath = tmp.path().join("in.zip");
        let out = tmp.path().join("out");
        fs::create_dir_all(&out).unwrap();
        buildZip(
            &zipPath,
            &[
                ("Body/UpTorso.png", b"PNG-A"),
                ("Body/notes.txt", b"meta"),
                ("Head/EyeOpen.png", b"PNG-B"),
                ("README.md", b"drop me"),
                ("Body/cover.jpg", b"drop too"),
                ("huanxin/Body/extra.png", b"PNG-C"),
            ],
        );
        let r = importSkinPack(&zipPath, &out, true).expect("import");
        assert_eq!(r.imported, 4);
        assert_eq!(r.skipped, 0);
        assert_eq!(fs::read(out.join("Body/UpTorso.png")).unwrap(), b"PNG-A");
        assert_eq!(fs::read(out.join("Body/notes.txt")).unwrap(), b"meta");
        assert_eq!(fs::read(out.join("Head/EyeOpen.png")).unwrap(), b"PNG-B");
        assert_eq!(fs::read(out.join("Body/extra.png")).unwrap(), b"PNG-C");
        assert!(!out.join("README.md").exists());
        assert!(!out.join("Body/cover.jpg").exists());
    }

    #[test]
    fn importOverwriteFalseSkipsExisting() {
        let tmp = TempDir::new("impSkip");
        let out = tmp.path().join("out");
        fs::create_dir_all(out.join("Body")).unwrap();
        fs::write(out.join("Body/UpTorso.png"), b"OLD").unwrap();

        let zipPath = tmp.path().join("in.zip");
        buildZip(
            &zipPath,
            &[
                ("Body/UpTorso.png", b"NEW"),
                ("Body/DownTorso.png", b"FRESH"),
            ],
        );
        let r = importSkinPack(&zipPath, &out, false).expect("import");
        assert_eq!(r.imported, 1);
        assert_eq!(r.skipped, 1);
        assert_eq!(fs::read(out.join("Body/UpTorso.png")).unwrap(), b"OLD");
        assert_eq!(fs::read(out.join("Body/DownTorso.png")).unwrap(), b"FRESH");
    }

    #[test]
    fn importClassifiesByFilenameWhenNoCategoryFolder() {
        let tmp = TempDir::new("impKeyword");
        let out = tmp.path().join("out");
        fs::create_dir_all(&out).unwrap();
        let zipPath = tmp.path().join("flat.zip");
        // 全部塞在一个 Body 文件夹下，但实际包含头部 / 翼部件。
        buildZip(
            &zipPath,
            &[
                ("Body/UpTorso.png", b"BODY"),
                ("Body/HeadDefault.png", b"HEAD"),
                ("Body/wingUL.png", b"WING"),
                ("Body/eyeOpen.png", b"EYE"),
                ("Body/disfiguredHead0.png", b"DISF"),
                ("Body/topPlate.png", b"BODY2"),
            ],
        );
        let r = importSkinPack(&zipPath, &out, true).expect("import");
        assert_eq!(r.imported, 6);
        // 文件名优先：HeadDefault / wingUL / eyeOpen / disfiguredHead0 即使被塞进 Body/ 也按真实分类落地。
        assert_eq!(fs::read(out.join("Body/UpTorso.png")).unwrap(), b"BODY");
        assert_eq!(fs::read(out.join("Head/HeadDefault.png")).unwrap(), b"HEAD");
        assert_eq!(fs::read(out.join("Wings/wingUL.png")).unwrap(), b"WING");
        assert_eq!(fs::read(out.join("Head/eyeOpen.png")).unwrap(), b"EYE");
        assert_eq!(fs::read(out.join("Head/disfiguredHead0.png")).unwrap(), b"DISF");
        // topPlate 不在 baseSizes 表里且无 keyword，路径段 fallback → Body。
        assert_eq!(fs::read(out.join("Body/topPlate.png")).unwrap(), b"BODY2");

        // 完全平铺：路径无 Body/Head/Wings 段，走 keyword 归类。
        let zipPath2 = tmp.path().join("plain.zip");
        buildZip(
            &zipPath2,
            &[
                ("st1/UpTorso.png", b"BODY"),
                ("st1/HeadDefault.png", b"HEAD"),
                ("st1/wingUL.png", b"WING"),
                ("st1/eyeOpen.png", b"EYE"),
                ("st1/disfiguredHead0.png", b"DISF"),
                ("st1/topPlate.png", b"BODY2"),
            ],
        );
        let out2 = tmp.path().join("out2");
        fs::create_dir_all(&out2).unwrap();
        let r2 = importSkinPack(&zipPath2, &out2, true).expect("import");
        assert_eq!(r2.imported, 6);
        assert_eq!(fs::read(out2.join("Body/UpTorso.png")).unwrap(), b"BODY");
        assert_eq!(fs::read(out2.join("Head/HeadDefault.png")).unwrap(), b"HEAD");
        assert_eq!(fs::read(out2.join("Wings/wingUL.png")).unwrap(), b"WING");
        assert_eq!(fs::read(out2.join("Head/eyeOpen.png")).unwrap(), b"EYE");
        assert_eq!(fs::read(out2.join("Head/disfiguredHead0.png")).unwrap(), b"DISF");
        assert_eq!(fs::read(out2.join("Body/topPlate.png")).unwrap(), b"BODY2");
    }

    #[test]
    fn importRejectsZipSlip() {
        let tmp = TempDir::new("impEvil");
        let out = tmp.path().join("out");
        fs::create_dir_all(&out).unwrap();
        let zipPath = tmp.path().join("evil.zip");
        buildZip(&zipPath, &[("../evil.png", b"x")]);
        let err = importSkinPack(&zipPath, &out, true).expect_err("must reject");
        assert_eq!(err.code, "unsafe_path");

        let zipPath2 = tmp.path().join("evil2.zip");
        buildZip(&zipPath2, &[("/etc/passwd", b"x")]);
        let err2 = importSkinPack(&zipPath2, &out, true).expect_err("must reject abs");
        assert_eq!(err2.code, "unsafe_path");
    }
}
