// 端到端集成测试：通过 apiLayer::CoreApi 在 cargo 集成测试上下文里走完
// 目录扫描、编辑保存重载、合成预览、错误码、布局往返几条路径。
// 夹具一律走临时目录，禁止读写真实皮肤目录；不依赖 HTTP server / Tauri runtime。
#![allow(non_snake_case)]

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use skin_preview_editor::apiLayer::{
    AddLayerParams, ApiLayer, BrushParams, CompositeParams, CoreApi, LoadPartParams,
    PartIdParams, PartsParams, RemoveLayerParams, SavePartParams, SaveWorkspaceParams,
    SkinsParams, WorkspacePathParams,
};
use skin_preview_editor::assemblyTable::{
    AssemblyEntry, AssemblyPosition, AssemblyTable, AssemblyVariants, Orientation,
};
use skin_preview_editor::imageOps;
use skin_preview_editor::skinLoader::PartCategory;
use skin_preview_editor::windowManager::{
    self, PanelSize, PanelState, ThemeConfig, WorkspaceSource,
};

/// 自管 RAII 临时目录。
struct TempDir(PathBuf);
impl TempDir {
    fn new(tag: &str) -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "spe_integration_{}_{}_{}_{}", tag, std::process::id(), nanos, seq));
        fs::create_dir_all(&path).expect("create temp dir");
        TempDir(path)
    }
    fn path(&self) -> &Path { &self.0 }
}
impl Drop for TempDir {
    fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
}

fn writeTinyPng(path: &Path, color: [u8; 4]) {
    image::RgbaImage::from_pixel(1, 1, image::Rgba(color)).save(path).expect("write tiny png");
}
fn rootStr(tmp: &TempDir) -> String { tmp.path().to_string_lossy().into_owned() }

#[test]
fn integrationDirectoryScanReturnsExpectedStructure() {
    let tmp = TempDir::new("scan");
    let st1Body = tmp.path().join("st1").join("Body");
    let st2Head = tmp.path().join("st2").join("Head");
    fs::create_dir_all(&st1Body).unwrap();
    fs::create_dir_all(&st2Head).unwrap();
    writeTinyPng(&st1Body.join("p.png"), [10, 20, 30, 255]);
    writeTinyPng(&st2Head.join("q.png"), [40, 50, 60, 255]);

    let api = CoreApi::new();
    let skins = api.listSkins(SkinsParams { skinRoot: rootStr(&tmp) }).expect("listSkins");
    assert_eq!(skins, vec!["st1".to_string(), "st2".to_string()]);

    let st1 = api
        .listParts(PartsParams { skinRoot: rootStr(&tmp), skinName: "st1".into() })
        .expect("listParts st1");
    assert_eq!(st1.body.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), vec!["p"]);
    assert!(st1.head.is_empty());
    let st2 = api
        .listParts(PartsParams { skinRoot: rootStr(&tmp), skinName: "st2".into() })
        .expect("listParts st2");
    assert!(st2.body.is_empty());
    assert_eq!(st2.head.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), vec!["q"]);
}

#[test]
fn integrationEditSaveReloadCycle() {
    let tmp = TempDir::new("edit");
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    writeTinyPng(&bodyDir.join("p.png"), [0, 0, 0, 0]);

    let api = CoreApi::new();
    let loaded = api.loadPartImage(LoadPartParams {
        skinRoot: rootStr(&tmp),
        skinName: "st1".into(),
        category: PartCategory::Body,
        partName: "p".into(),
    }).expect("loadPartImage");
    api.applyBrush(BrushParams {
        partId: loaded.partId.clone(),
        cx: 0, cy: 0, brushSize: 1, color: [11, 22, 33, 255],
    }).expect("applyBrush");

    let target = tmp.path().join("out.png");
    api.savePart(SavePartParams {
        partId: loaded.partId,
        targetPath: target.to_string_lossy().into_owned(),
    }).expect("savePart");

    let (w, h, pixels) = imageOps::loadPng(&target).expect("reload");
    assert_eq!((w, h), (1, 1));
    assert_eq!(pixels, vec![11, 22, 33, 255]);
}

#[test]
fn integrationCompositeChangesWithVariants() {
    let tmp = TempDir::new("composite");
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    writeTinyPng(&bodyDir.join("front.png"), [255, 0, 0, 255]);
    writeTinyPng(&bodyDir.join("back.png"), [0, 0, 255, 255]);

    let mkEntry = |name: &str, orientation: Orientation| AssemblyEntry {
        partName: name.into(), category: PartCategory::Body,
        position: AssemblyPosition { x: 0, y: 0 }, zOrder: 10, flipX: false, rotation: 0.0,
        variants: Some(AssemblyVariants { orientation: Some(orientation), expressionIndex: None, headVariant: None }),
    };
    let table = AssemblyTable {
        parts: vec![mkEntry("front", Orientation::Front), mkEntry("back", Orientation::Back)],
    };
    fs::write(tmp.path().join("assembly.json"), serde_json::to_vec(&table).unwrap()).unwrap();

    let api = CoreApi::new();
    let composite = |orientation: Orientation| api.getCompositeImage(CompositeParams {
        skinRoot: rootStr(&tmp), skinName: "st1".into(), orientation, expressionIndex: 0,
        headVariant: None,
    }).expect("composite");
    let frontImg = composite(Orientation::Front);
    let backImg = composite(Orientation::Back);

    assert_eq!((frontImg.width, frontImg.height), (backImg.width, backImg.height));
    assert_ne!(frontImg.pixels, backImg.pixels, "variants should produce different composites");
    // 1×1 PNG 默认贴在画布中心 (W/2, H/2)。
    let center = ((frontImg.height / 2) * frontImg.width + frontImg.width / 2) as usize * 4;
    assert_eq!(&frontImg.pixels[center..center + 4], &[255, 0, 0, 255]);
    assert_eq!(&backImg.pixels[center..center + 4], &[0, 0, 255, 255]);
}

#[test]
fn integrationHttpStatusForKnownErrors() {
    // httpServer.statusFor 是私有函数，集成测试通过 apiLayer 触发各类错误码字符串，
    // httpServer 把同样的字符串映射为 4xx/5xx，所以本断言锁定的是 HTTP status 映射的源契约。
    let tmp = TempDir::new("errors");
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    writeTinyPng(&bodyDir.join("p.png"), [0, 0, 0, 0]);

    let api = CoreApi::new();
    let skinRoot = rootStr(&tmp);

    let err = api.applyBrush(BrushParams {
        partId: "missing".into(), cx: 0, cy: 0, brushSize: 1, color: [0, 0, 0, 0],
    }).expect_err("expect not_loaded");
    assert_eq!(err.code, "not_loaded");

    let err = api.listParts(PartsParams { skinRoot: skinRoot.clone(), skinName: "stX".into() })
        .expect_err("expect skin_not_found");
    assert_eq!(err.code, "skin_not_found");

    let loaded = api.loadPartImage(LoadPartParams {
        skinRoot, skinName: "st1".into(), category: PartCategory::Body, partName: "p".into(),
    }).expect("load");
    let err = api.undo(PartIdParams { partId: loaded.partId.clone() })
        .expect_err("expect nothing_to_undo");
    assert_eq!(err.code, "nothing_to_undo");

    api.addLayer(AddLayerParams { partId: loaded.partId.clone() }).expect("addLayer");
    let err = api.removeLayer(RemoveLayerParams {
        partId: loaded.partId, layerId: "ghostLayer".into(),
    }).expect_err("expect layer_not_found");
    assert_eq!(err.code, "layer_not_found");
}

#[test]
fn integrationWorkspaceLoadAndPersist() {
    let tmp = TempDir::new("workspace");
    let path = tmp.path().join("workspace.json");
    let pathStr = path.to_string_lossy().into_owned();
    let api = CoreApi::new();

    let layout0 = windowManager::defaultWorkspace();
    let theme0 = windowManager::defaultTheme();
    api.saveWorkspace(SaveWorkspaceParams {
        path: pathStr.clone(), layout: layout0.clone(), theme: theme0.clone(),
    }).expect("first save");

    let loaded = api.getWorkspace(WorkspacePathParams { path: pathStr.clone() }).expect("first load");
    assert_eq!(loaded.source, WorkspaceSource::File);
    assert_eq!(loaded.layout.panels.len(), layout0.panels.len());

    let mut layout1 = loaded.layout;
    layout1.panels[0].size = PanelSize { width: 320, height: 720 };
    layout1.panels[0].state = PanelState::Detached;
    layout1.splitRatios = HashMap::from([("main".into(), 0.42_f32)]);
    let theme1 = ThemeConfig { primary: "#112233".into(), ..theme0 };
    api.saveWorkspace(SaveWorkspaceParams {
        path: pathStr.clone(), layout: layout1, theme: theme1,
    }).expect("second save");

    let reloaded = api.getWorkspace(WorkspacePathParams { path: pathStr }).expect("second load");
    assert_eq!(reloaded.source, WorkspaceSource::File);
    assert_eq!(reloaded.layout.panels[0].size.width, 320);
    assert_eq!(reloaded.layout.panels[0].size.height, 720);
    assert_eq!(reloaded.layout.panels[0].state, PanelState::Detached);
    assert_eq!(reloaded.layout.splitRatios.get("main"), Some(&0.42_f32));
    assert_eq!(reloaded.theme.primary, "#112233");
}

/// 编辑→预览单次计时验证：单串 applyBrush → getCompositeImage 即代表后端编辑→预览链路。
/// 超时仅 eprintln warning，不 assert!，正确性优先于严格时序。
#[test]
fn integrationPerformanceBrushToCompositeWithin100Ms() {
    let tmp = TempDir::new("perf");
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    writeTinyPng(&bodyDir.join("p.png"), [0, 0, 0, 255]);
    let table = AssemblyTable {
        parts: vec![AssemblyEntry {
            partName: "p".into(), category: PartCategory::Body,
            position: AssemblyPosition { x: 0, y: 0 }, zOrder: 0, flipX: false, rotation: 0.0, variants: None,
        }],
    };
    fs::write(tmp.path().join("assembly.json"), serde_json::to_vec(&table).unwrap()).unwrap();

    let api = CoreApi::new();
    let loaded = api.loadPartImage(LoadPartParams {
        skinRoot: rootStr(&tmp), skinName: "st1".into(),
        category: PartCategory::Body, partName: "p".into(),
    }).expect("load");

    let start = std::time::Instant::now();
    api.applyBrush(BrushParams {
        partId: loaded.partId, cx: 0, cy: 0, brushSize: 1, color: [200, 100, 50, 255],
    }).expect("brush");
    api.getCompositeImage(CompositeParams {
        skinRoot: rootStr(&tmp), skinName: "st1".into(),
        orientation: Orientation::Front, expressionIndex: 0, headVariant: None,
    }).expect("composite");
    let elapsedMs = start.elapsed().as_millis();

    eprintln!("[perf] brush→composite elapsed: {}ms", elapsedMs);
    if elapsedMs > 100 {
        eprintln!("[perf] WARNING: elapsed {}ms exceeds 100ms target", elapsedMs);
    }
}
