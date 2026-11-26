// zip 皮肤包导入导出与 `baseSizes.json` 自动回填。

use std::fs;
use std::io::{self, Cursor, Read, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::apiLayer::ApiError;
use crate::dataPaths;

use super::{isPng, readPngDimensions};

const MAX_ZIP_ENTRY_BYTES: u64 = 16 * 1024 * 1024;
const MAX_ZIP_TOTAL_BYTES: u64 = 128 * 1024 * 1024;
const MAX_ZIP_FILES: usize = 2048;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportResult {
    pub imported: usize,
    pub skipped: usize,
}

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

/// 打包皮肤目录为 zip（含部件 PNG/TXT、`*.zones.*` 及根级 `wings/accessories/baseSizes/Default.txt`，可选包含血液配置，排除 `layers/`）。
pub fn exportSkinPack(
    skinDir: &Path,
    zipPath: &Path,
    layout: ExportLayout,
    includeBlood: bool,
) -> Result<usize, ApiError> {
    if !skinDir.is_dir() {
        return Err(ApiError {
            code: "skin_not_found".into(),
            message: format!("skin directory not found: {}", skinDir.display()),
        });
    }
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

    let mut rawZip = Vec::new();
    let mut count = 0usize;
    {
        let mut zip = zip::ZipWriter::new(Cursor::new(&mut rawZip));
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        let writeFile = |zip: &mut zip::ZipWriter<Cursor<&mut Vec<u8>>>,
                         relInZip: &str,
                         bytes: &[u8]|
         -> Result<(), ApiError> {
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
            let Ok(entries) = fs::read_dir(&dir) else {
                continue;
            };
            let mut files: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_file() && isExportable(p))
                .collect();
            files.sort();
            for path in files {
                let Some(fname) = path.file_name().and_then(|s| s.to_str()) else {
                    continue;
                };
                let rel = format!("{}/{}", categoryDir(cat), fname);
                let bytes = fs::read(&path).map_err(|e| ioErr("read", &path, e))?;
                writeFile(&mut zip, &rel, &bytes)?;
                count += 1;
            }
        }

        if layout == ExportLayout::Categorized {
            let woundDir = skinDir.join("WoundView");
            if let Ok(entries) = fs::read_dir(&woundDir) {
                let mut files: Vec<PathBuf> = entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.is_file() && isExportable(p))
                    .collect();
                files.sort();
                for path in files {
                    let Some(fname) = path.file_name().and_then(|s| s.to_str()) else {
                        continue;
                    };
                    let rel = format!("WoundView/{}", fname);
                    let bytes = fs::read(&path).map_err(|e| ioErr("read", &path, e))?;
                    writeFile(&mut zip, &rel, &bytes)?;
                    count += 1;
                }
            }
        }

        for meta in ["wings.json", "accessories.json", "baseSizes.json", "Default.txt"] {
            let metaPath = skinDir.join(meta);
            if metaPath.is_file() {
                let bytes = fs::read(&metaPath).map_err(|e| ioErr("read", &metaPath, e))?;
                writeFile(&mut zip, meta, &bytes)?;
                count += 1;
            }
        }

        if includeBlood {
            let bloodPath = skinDir.join("blood.json");
            if bloodPath.is_file() {
                let bytes = fs::read(&bloodPath).map_err(|e| ioErr("read", &bloodPath, e))?;
                writeFile(&mut zip, "blood.json", &bytes)?;
                count += 1;
            }
            let bloodDir = skinDir.join("Blood");
            if let Ok(entries) = fs::read_dir(&bloodDir) {
                let mut files: Vec<PathBuf> = entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.is_file() && isExportable(p))
                    .collect();
                files.sort();
                for path in files {
                    let Some(fname) = path.file_name().and_then(|s| s.to_str()) else {
                        continue;
                    };
                    let rel = format!("{}/{}", categoryDir("Blood"), fname);
                    let bytes = fs::read(&path).map_err(|e| ioErr("read", &path, e))?;
                    writeFile(&mut zip, &rel, &bytes)?;
                    count += 1;
                }
            }
        }
        zip.finish().map_err(zipErr)?;
    }

    dataPaths::atomicWrite(zipPath, &rawZip).map_err(|e| ioErr("write zip", zipPath, e))?;
    Ok(count)
}

/// 解压皮肤包 zip 到目标皮肤目录，拦截路径穿越与超大压缩炸弹，缺失 `baseSizes.json` 时自动补建。
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
    if archive.len() > MAX_ZIP_FILES {
        return Err(ApiError {
            code: "zip_too_large".into(),
            message: format!("zip contains too many entries: {}", archive.len()),
        });
    }
    let mut imported = 0usize;
    let mut skipped = 0usize;
    let mut totalBytes = 0u64;
    for idx in 0..archive.len() {
        let entry = archive.by_index(idx).map_err(zipErr)?;
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
                let mut buf = Vec::new();
                entry
                    .take(MAX_ZIP_ENTRY_BYTES + 1)
                    .read_to_end(&mut buf)
                    .map_err(|e| ioErr("read zip entry", zipPath, e))?;
                if (buf.len() as u64) > MAX_ZIP_ENTRY_BYTES {
                    return Err(ApiError {
                        code: "zip_too_large".into(),
                        message: format!("zip entry {} exceeds {} bytes", name, MAX_ZIP_ENTRY_BYTES),
                    });
                }
                totalBytes = totalBytes.saturating_add(buf.len() as u64);
                if totalBytes > MAX_ZIP_TOTAL_BYTES {
                    return Err(ApiError {
                        code: "zip_too_large".into(),
                        message: format!("zip total size exceeds {} bytes", MAX_ZIP_TOTAL_BYTES),
                    });
                }
                dataPaths::atomicWrite(&target, &buf)
                    .map_err(|e| ioErr("write", &target, e))?;
                imported += 1;
            }
        }
    }
    let _ = writeBaseSizesForSkin(skinRoot);
    Ok(ImportResult { imported, skipped })
}

/// 扫描皮肤目录生成缺失的 `<skin>/baseSizes.json`；若已有文件且为旧版扁平格式则原地升级为标准 `{ "entries": ... }`，已有标准格式则不覆盖。
pub fn writeBaseSizesForSkin(skinRoot: &Path) -> Result<(), ApiError> {
    let target = skinRoot.join(crate::baseSizes::BASE_SIZES_FILE);
    if target.exists() {
        let _ = crate::baseSizes::upgradeLegacyIfNeeded(skinRoot)?;
        return Ok(());
    }
    let mut map: std::collections::HashMap<String, (u32, u32)> = std::collections::HashMap::new();
    for cat in ["Body", "Head", "Wings", "Accessories"] {
        let dir = skinRoot.join(cat);
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_file() || !isPng(&path) {
                continue;
            }
            let fname = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if fname.to_ascii_lowercase().ends_with(".zones.png") {
                continue;
            }
            let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
                continue;
            };
            let baseStem = crate::baseSizes::stripSideSuffixForLookup(stem);
            let noOrient = stem.strip_prefix("R_").unwrap_or(stem);
            let isStandard = crate::baseSizes::standardParts(cat)
                .map(|list| {
                    list.iter()
                        .any(|s| *s == stem || *s == noOrient || *s == baseStem)
                })
                .unwrap_or(false);
            if !isStandard {
                continue;
            }
            let Some((w, h)) = readPngDimensions(&path) else {
                continue;
            };
            map.insert(crate::baseSizes::keyFor(cat, stem), (w, h));
        }
    }
    crate::baseSizes::write(skinRoot, &map)
}

enum EntryKind {
    Unsafe,
    Drop,
    Accept(PathBuf),
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
        if seg == "__MACOSX" {
            return EntryKind::Drop;
        }
        comps.push(seg);
    }
    if comps.is_empty() {
        return EntryKind::Drop;
    }
    let fname = comps[comps.len() - 1];
    if fname.starts_with("._")
        || fname.eq_ignore_ascii_case(".DS_Store")
        || fname.eq_ignore_ascii_case("Thumbs.db")
    {
        return EntryKind::Drop;
    }
    if !dataPaths::isValidSingleSegment(fname) {
        return EntryKind::Unsafe;
    }

    for canonical in ["wings.json", "accessories.json", "blood.json", "baseSizes.json"] {
        if fname.eq_ignore_ascii_case(canonical) {
            return EntryKind::Accept(PathBuf::from(canonical));
        }
    }

    let parentCat = comps.iter().rev().skip(1).find_map(|seg| {
        for cat in ["Blood", "Accessories", "WoundView", "Body", "Head", "Wings"] {
            if seg.eq_ignore_ascii_case(cat) {
                return Some(cat);
            }
        }
        None
    });

    if fname.eq_ignore_ascii_case("Default.txt") && parentCat.is_none() {
        return EntryKind::Accept(PathBuf::from("Default.txt"));
    }

    if matches!(parentCat, Some("Blood") | Some("Accessories") | Some("WoundView")) {
        let cat = parentCat.unwrap();
        if !isExportableName(fname) {
            return EntryKind::Drop;
        }
        return EntryKind::Accept(PathBuf::from(format!("{}/{}", cat, fname)));
    }

    if !isExportableName(fname) {
        return EntryKind::Drop;
    }

    let lower = fname.to_ascii_lowercase();
    if lower.ends_with(".png") || lower.ends_with(".zones.json") {
        let stem = partStemForClassify(fname);
        if let Some(cat) = crate::baseSizes::categoryFor(stem) {
            return EntryKind::Accept(PathBuf::from(format!("{}/{}", cat, fname)));
        }
        let stemLower = stem.to_ascii_lowercase();
        if stemLower.contains("blood") || stemLower.contains("wing") {
            let cat = classifyByName(stem);
            return EntryKind::Accept(PathBuf::from(format!("{}/{}", cat, fname)));
        }
        const HEAD_HINTS: &[&str] = &[
            "head", "face", "eye", "mouth", "hair", "ear", "horn", "disfigured",
        ];
        if HEAD_HINTS.iter().any(|hint| stemLower.contains(hint)) {
            return EntryKind::Accept(PathBuf::from(format!("Head/{}", fname)));
        }
    }

    if let Some(cat) = parentCat {
        return EntryKind::Accept(PathBuf::from(format!("{}/{}", cat, fname)));
    }

    let cat = classifyByName(partStemForClassify(fname));
    EntryKind::Accept(PathBuf::from(format!("{}/{}", cat, fname)))
}

fn partStemForClassify(fname: &str) -> &str {
    let lower = fname.to_ascii_lowercase();
    if lower.ends_with(".zones.png") {
        &fname[..fname.len() - ".zones.png".len()]
    } else if lower.ends_with(".zones.json") {
        &fname[..fname.len() - ".zones.json".len()]
    } else {
        Path::new(fname)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or(fname)
    }
}

fn classifyByName(stem: &str) -> &'static str {
    let lower = stem.to_ascii_lowercase();
    if lower.contains("blood") {
        return "Blood";
    }
    if lower.contains("wing") {
        return "Wings";
    }
    const HEAD_HINTS: &[&str] = &[
        "head", "face", "eye", "mouth", "hair", "ear", "horn", "disfigured",
    ];
    if HEAD_HINTS.iter().any(|hint| lower.contains(hint)) {
        return "Head";
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
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".png") || lower.ends_with(".txt") || lower.ends_with(".zones.json")
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
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir(PathBuf);
    impl TempDir {
        fn new(tag: &str) -> Self {
            static SEQ: AtomicU64 = AtomicU64::new(0);
            let seq = SEQ.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir().join(format!(
                "spe_skinPack_{}_{}_{}_{}",
                tag,
                std::process::id(),
                nanos,
                seq
            ));
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
        (0..a.len())
            .map(|i| a.by_index(i).unwrap().name().to_string())
            .collect()
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
    fn exportCategorizedKeepsSubfoldersAndZonesJson() {
        let tmp = TempDir::new("expCategorized");
        let skinDir = tmp.path().join("st1");
        fs::create_dir_all(skinDir.join("Body")).unwrap();
        fs::create_dir_all(skinDir.join("Head")).unwrap();
        writePng(&skinDir.join("Body").join("UpTorso.png"));
        fs::write(skinDir.join("Body").join("notes.txt"), b"hi").unwrap();
        writePng(&skinDir.join("Head").join("EyeOpen.png"));
        writePng(&skinDir.join("Head").join("EyeOpen.zones.png"));
        fs::write(skinDir.join("Head").join("EyeOpen.zones.json"), b"{\"zones\":[]}").unwrap();
        fs::write(skinDir.join("baseSizes.json"), b"{\"entries\":{\"Body/UpTorso\":[12,18]}}").unwrap();

        let zipPath = tmp.path().join("out.zip");
        let n = exportSkinPack(&skinDir, &zipPath, ExportLayout::Categorized, false).expect("export");
        assert_eq!(n, 6);
        let mut names = listZipEntries(&zipPath);
        names.sort();
        assert_eq!(
            names,
            vec![
                "st1/Body/UpTorso.png".to_string(),
                "st1/Body/notes.txt".to_string(),
                "st1/Head/EyeOpen.png".to_string(),
                "st1/Head/EyeOpen.zones.json".to_string(),
                "st1/Head/EyeOpen.zones.png".to_string(),
                "st1/baseSizes.json".to_string(),
            ]
        );

        let reimported = tmp.path().join("reimp");
        let r = importSkinPack(&zipPath, &reimported, true).expect("reimport");
        assert_eq!(r.imported, 6);
        assert!(reimported.join("Head/EyeOpen.zones.json").is_file());
        assert!(reimported.join("Head/EyeOpen.zones.png").is_file());
        assert_eq!(
            fs::read_to_string(reimported.join("baseSizes.json")).unwrap(),
            "{\"entries\":{\"Body/UpTorso\":[12,18]}}"
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
                ("__MACOSX/Body/._UpTorso.png", b"mac junk"),
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
        buildZip(
            &zipPath,
            &[
                ("Body/UpTorso.png", b"BODY"),
                ("Body/HeadDefault.png", b"HEAD"),
                ("Body/wingUL.png", b"WING"),
                ("Body/autopump.zones.png", b"ACC_MASK"),
                ("Body/autopump.zones.json", b"{\"zones\":[]}"),
                ("Body/nosebleed.png", b"BLOOD_NB"),
                ("Body/eyeOpen.png", b"EYE"),
                ("Body/disfiguredHead0.png", b"DISF"),
                ("Body/topPlate.png", b"BODY2"),
            ],
        );
        let r = importSkinPack(&zipPath, &out, true).expect("import");
        assert_eq!(r.imported, 9);
        assert_eq!(fs::read(out.join("Body/UpTorso.png")).unwrap(), b"BODY");
        assert_eq!(fs::read(out.join("Head/HeadDefault.png")).unwrap(), b"HEAD");
        assert_eq!(fs::read(out.join("Wings/wingUL.png")).unwrap(), b"WING");
        assert_eq!(fs::read(out.join("Accessories/autopump.zones.png")).unwrap(), b"ACC_MASK");
        assert_eq!(fs::read(out.join("Accessories/autopump.zones.json")).unwrap(), b"{\"zones\":[]}");
        assert_eq!(fs::read(out.join("Blood/nosebleed.png")).unwrap(), b"BLOOD_NB");
        assert_eq!(fs::read(out.join("Head/eyeOpen.png")).unwrap(), b"EYE");
        assert_eq!(fs::read(out.join("Head/disfiguredHead0.png")).unwrap(), b"DISF");
        assert_eq!(fs::read(out.join("Body/topPlate.png")).unwrap(), b"BODY2");

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
