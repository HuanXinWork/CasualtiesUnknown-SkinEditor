// `apiLayer` 编辑会话、图层管理与部件文件操作单元测试。

use super::*;
use crate::assemblyTable::AssemblySource;
use crate::baseSizes;
use crate::windowManager::PanelSize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

pub(super) struct TempDir(PathBuf);

impl TempDir {
    pub(super) fn new() -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path = std::env::temp_dir().join(format!(
            "spe_apiLayer_{}_{}_{}",
            std::process::id(),
            nanos,
            seq
        ));
        fs::create_dir_all(&path).expect("create temp dir");
        TempDir(path)
    }

    pub(super) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

pub(super) fn writeTinyPng(path: &Path, color: [u8; 4]) {
    let buf = image::RgbaImage::from_pixel(1, 1, image::Rgba(color));
    buf.save(path).expect("write tiny png");
}

fn loadStdPart(api: &CoreApi, root: &Path) -> LoadPartResult {
    api.loadPartImage(LoadPartParams {
        skinRoot: root.to_string_lossy().into_owned(),
        skinName: "st1".into(),
        category: PartCategory::Body,
        partName: "p".into(),
    })
    .expect("load")
}

fn loadedApi() -> (TempDir, CoreApi, String) {
    let tmp = TempDir::new();
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    writeTinyPng(&bodyDir.join("p.png"), [0, 0, 0, 0]);
    let api = CoreApi::new();
    let loaded = loadStdPart(&api, tmp.path());
    (tmp, api, loaded.partId)
}

#[test]
fn loadAndBrushApplies() {
    let tmp = TempDir::new();
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    writeTinyPng(&bodyDir.join("p.png"), [0, 0, 0, 0]);
    let api = CoreApi::new();
    let loaded = loadStdPart(&api, tmp.path());
    assert_eq!(loaded.pixels, vec![0, 0, 0, 0]);

    api.applyBrush(BrushParams {
        partId: loaded.partId.clone(),
        cx: 0,
        cy: 0,
        brushSize: 1,
        color: [10, 20, 30, 255],
    })
    .expect("brush");

    let undoDiff = api
        .undo(PartIdParams {
            partId: loaded.partId.clone(),
        })
        .expect("undo");
    assert_eq!(undoDiff.before, vec![0, 0, 0, 0]);
    assert_eq!(undoDiff.after, vec![10, 20, 30, 255]);

    let sessions = api.sessions.lock().unwrap();
    let session = sessions.get(&loaded.partId).expect("session");
    assert_eq!(session.state.layers[0].pixels, vec![0, 0, 0, 0]);
}

#[test]
fn applyBrushWithoutLoadReturnsError() {
    let api = CoreApi::new();
    let err = api
        .applyBrush(BrushParams {
            partId: "missing".into(),
            cx: 0,
            cy: 0,
            brushSize: 1,
            color: [0, 0, 0, 0],
        })
        .expect_err("should fail");
    assert_eq!(err.code, "not_loaded");
}

#[test]
fn discardPartDropsDirtySession() {
    let tmp = TempDir::new();
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    writeTinyPng(&bodyDir.join("p.png"), [10, 20, 30, 255]);
    let api = CoreApi::new();
    let loaded = loadStdPart(&api, tmp.path());
    api.applyBrush(BrushParams {
        partId: loaded.partId.clone(),
        cx: 0,
        cy: 0,
        brushSize: 1,
        color: [200, 0, 0, 255],
    })
    .expect("brush");
    api.discardPart(PartIdParams {
        partId: loaded.partId,
    })
    .expect("discard");
    let reloaded = loadStdPart(&api, tmp.path());
    assert_eq!(reloaded.pixels, vec![10, 20, 30, 255]);
}

#[test]
fn removeMiddleLayerThenAddLayerProducesUniqueIds() {
    let (_tmp, api, partId) = loadedApi();
    api.addLayer(AddLayerParams {
        partId: partId.clone(),
    })
    .expect("add 1");
    api.addLayer(AddLayerParams {
        partId: partId.clone(),
    })
    .expect("add 2");
    api.removeLayer(RemoveLayerParams {
        partId: partId.clone(),
        layerId: "layer1".into(),
    })
    .expect("remove middle");
    let snap = api
        .addLayer(AddLayerParams {
            partId: partId.clone(),
        })
        .expect("add 3");
    let ids: Vec<String> = snap.layers.iter().map(|l| l.id.clone()).collect();
    assert_eq!(ids, vec!["layer0", "layer2", "layer3"]);

    let reversed: Vec<String> = ids.into_iter().rev().collect();
    let reordered = api
        .reorderLayers(ReorderLayersParams {
            partId,
            order: reversed.clone(),
        })
        .expect("reorder must succeed without duplicate ids");
    assert_eq!(
        reordered.layers.iter().map(|l| l.id.clone()).collect::<Vec<_>>(),
        reversed
    );
}

#[test]
fn resizePartScalesZonesMaskAndKeepsCleanExternalDirs() {
    let tmp = TempDir::new();
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    let pngPath = bodyDir.join("p.png");
    image::RgbaImage::from_pixel(2, 2, image::Rgba([10, 20, 30, 255]))
        .save(&pngPath)
        .unwrap();
    let maskPath = bodyDir.join("p.zones.png");
    zones::saveMask(&maskPath, 2, 2, &[1, 2, 3, 4]).unwrap();

    let api = CoreApi::new();
    let loaded = loadStdPart(&api, tmp.path());
    api.resizePart(ResizePartParams {
        partId: loaded.partId,
        width: 4,
        height: 4,
        targetPath: pngPath.to_string_lossy().into_owned(),
    })
    .expect("resizePart");

    let (mw, mh, scaledIds) = zones::loadMask(&maskPath).expect("scaled mask");
    assert_eq!((mw, mh), (4, 4));
    assert_eq!(scaledIds[0], 1);
    assert_eq!(scaledIds[15], 4);
}

#[test]
fn getAssemblyFallbackOnMissingFile() {
    let tmp = TempDir::new();
    let api = CoreApi::new();
    let missing = tmp.path().join("nope.json");
    let result = api
        .getAssemblyTable(AssemblyParams {
            path: missing.to_string_lossy().into_owned(),
        })
        .expect("getAssembly");
    assert_eq!(result.source, AssemblySource::Fallback);
    assert!(!result.table.parts.is_empty());
}

#[test]
fn savePartWritesFlatPngWithoutPollutingExternalParentDir() {
    let tmp = TempDir::new();
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    writeTinyPng(&bodyDir.join("p.png"), [0, 0, 0, 0]);
    let api = CoreApi::new();
    let loaded = loadStdPart(&api, tmp.path());

    api.applyBrush(BrushParams {
        partId: loaded.partId.clone(),
        cx: 0,
        cy: 0,
        brushSize: 1,
        color: [11, 22, 33, 255],
    })
    .expect("brush");

    let externalDir = tmp.path().join("exportOut");
    let target = externalDir.join("out.png");
    api.savePart(SavePartParams {
        partId: loaded.partId,
        targetPath: target.to_string_lossy().into_owned(),
    })
    .expect("savePart");

    let (w, h, pixels) = imageOps::loadPng(&target).expect("reload");
    assert_eq!((w, h), (1, 1));
    assert_eq!(pixels, vec![11, 22, 33, 255]);
    assert!(!tmp.path().join("layers").exists());
}

#[test]
fn createPartCreatesMissingCategoryDirectory() {
    let tmp = TempDir::new();
    fs::create_dir_all(tmp.path().join("st1")).unwrap();
    let api = CoreApi::new();

    let result = api
        .createPart(CreatePartParams {
            skinRoot: tmp.path().to_string_lossy().into_owned(),
            skinName: "st1".into(),
            category: PartCategory::Wings,
            fileName: "wingUL".into(),
            width: 32,
            height: 32,
        })
        .expect("create part");

    assert_eq!(result.partName, "wingUL");
    assert!(tmp.path().join("st1").join("Wings").join("wingUL.png").is_file());
}

#[test]
fn addLayerAppendsAndCapsAt8() {
    let (_tmp, api, partId) = loadedApi();
    for _ in 0..7 {
        api.addLayer(AddLayerParams {
            partId: partId.clone(),
        })
        .expect("add");
    }
    let snap = api
        .getLayers(PartIdParams {
            partId: partId.clone(),
        })
        .expect("get");
    assert_eq!(snap.layers.len(), 8);
    let err = api
        .addLayer(AddLayerParams { partId })
        .expect_err("9th add should fail");
    assert_eq!(err.code, "layer_limit_reached");
}

#[test]
fn removeLayerCannotEmpty() {
    let (_tmp, api, partId) = loadedApi();
    let err = api
        .removeLayer(RemoveLayerParams {
            partId,
            layerId: "layer0".into(),
        })
        .expect_err("remove last should fail");
    assert_eq!(err.code, "cannot_remove_last_layer");
}

#[test]
fn copyPartCreatesPngSidecarAndPreservesBaseSize() {
    let (tmp, api, partId) = loadedApi();
    let skinDir = tmp.path().join("st1");
    baseSizes::upsert(&skinDir, "Body/p", 1, 1).unwrap();
    api.resizePart(ResizePartParams {
        partId: partId.clone(),
        width: 4,
        height: 4,
        targetPath: skinDir.join("Body/p.png").to_string_lossy().into_owned(),
    })
    .unwrap();
    api.applyBrush(BrushParams {
        partId: partId.clone(),
        cx: 0,
        cy: 0,
        brushSize: 1,
        color: [9, 8, 7, 255],
    })
    .expect("brush");

    let res = api
        .copyPart(CopyPartParams {
            skinRoot: tmp.path().to_string_lossy().into_owned(),
            skinName: "st1".into(),
            category: PartCategory::Body,
            sourcePartName: "p".into(),
            targetPartName: "pCopy".into(),
            overwrite: false,
        })
        .expect("copyPart");
    assert_eq!(res.partName, "pCopy");
    let png = skinDir.join("Body").join("pCopy.png");
    assert!(png.is_file());
    let (w, h, pixels) = imageOps::loadPng(&png).expect("reload");
    assert_eq!((w, h), (4, 4));
    assert_eq!(&pixels[0..4], &[9, 8, 7, 255]);
    assert_eq!(baseSizes::load(&skinDir).get("Body/pCopy"), Some((1, 1)));

    let err = api
        .copyPart(CopyPartParams {
            skinRoot: tmp.path().to_string_lossy().into_owned(),
            skinName: "st1".into(),
            category: PartCategory::Body,
            sourcePartName: "p".into(),
            targetPartName: "pCopy".into(),
            overwrite: false,
        })
        .expect_err("dup should fail");
    assert_eq!(err.code, "part_exists");
    api.copyPart(CopyPartParams {
        skinRoot: tmp.path().to_string_lossy().into_owned(),
        skinName: "st1".into(),
        category: PartCategory::Body,
        sourcePartName: "p".into(),
        targetPartName: "pCopy".into(),
        overwrite: true,
    })
    .expect("overwrite should succeed");
}

#[test]
fn deletePartRemovesPngAndZones() {
    let (tmp, api, _partId) = loadedApi();
    let bodyDir = tmp.path().join("st1").join("Body");
    let png = bodyDir.join("p.png");
    let zPng = bodyDir.join("p.zones.png");
    let zJson = bodyDir.join("p.zones.json");
    fs::write(&zPng, b"mask").unwrap();
    fs::write(&zJson, b"{}").unwrap();
    assert!(png.is_file());
    api.deletePart(DeletePartParams {
        skinRoot: tmp.path().to_string_lossy().into_owned(),
        skinName: "st1".into(),
        category: PartCategory::Body,
        partName: "p".into(),
    })
    .expect("deletePart");
    assert!(!png.exists());
    assert!(!zPng.exists());
    assert!(!zJson.exists());
}

#[test]
fn copyLayerToPartAppendsLayer() {
    let tmp = TempDir::new();
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    writeTinyPng(&bodyDir.join("a.png"), [1, 2, 3, 255]);
    writeTinyPng(&bodyDir.join("b.png"), [0, 0, 0, 0]);
    let api = CoreApi::new();
    let srcRoot = tmp.path().to_string_lossy().into_owned();
    let src = api
        .loadPartImage(LoadPartParams {
            skinRoot: srcRoot.clone(),
            skinName: "st1".into(),
            category: PartCategory::Body,
            partName: "a".into(),
        })
        .expect("load a");
    let dst = api
        .loadPartImage(LoadPartParams {
            skinRoot: srcRoot,
            skinName: "st1".into(),
            category: PartCategory::Body,
            partName: "b".into(),
        })
        .expect("load b");
    let snap = api
        .copyLayerToPart(CopyLayerToPartParams {
            sourcePartId: src.partId,
            sourceLayerId: "layer0".into(),
            targetPartId: dst.partId.clone(),
        })
        .expect("copyLayer");
    assert_eq!(snap.layers.len(), 2);
    let sessions = api.sessions.lock().unwrap();
    let session = sessions.get(&dst.partId).expect("session");
    assert_eq!(session.state.layers[1].pixels, vec![1, 2, 3, 255]);
}

#[test]
fn reorderLayersValidatesOrder() {
    let (_tmp, api, partId) = loadedApi();
    api.addLayer(AddLayerParams {
        partId: partId.clone(),
    })
    .expect("add");
    let err = api
        .reorderLayers(ReorderLayersParams {
            partId: partId.clone(),
            order: vec!["layer0".into(), "ghost".into()],
        })
        .expect_err("bad order");
    assert_eq!(err.code, "invalid_order");
    let snap = api
        .reorderLayers(ReorderLayersParams {
            partId,
            order: vec!["layer1".into(), "layer0".into()],
        })
        .expect("ok");
    assert_eq!(
        snap.layers.iter().map(|l| l.id.clone()).collect::<Vec<_>>(),
        vec!["layer1".to_string(), "layer0".to_string()]
    );
}

#[test]
fn setLayerOpacityChangesField() {
    let (_tmp, api, partId) = loadedApi();
    let snap = api
        .setLayerOpacity(LayerOpacityParams {
            partId: partId.clone(),
            layerId: "layer0".into(),
            opacity: 64,
        })
        .expect("set opacity");
    assert_eq!(snap.layers[0].opacity, 64);
    let err = api
        .setLayerOpacity(LayerOpacityParams {
            partId,
            layerId: "ghost".into(),
            opacity: 0,
        })
        .expect_err("missing layer");
    assert_eq!(err.code, "layer_not_found");
}

#[test]
fn setActiveLayerAffectsBrushTarget() {
    let (_tmp, api, partId) = loadedApi();
    api.addLayer(AddLayerParams {
        partId: partId.clone(),
    })
    .expect("add");
    api.setActiveLayer(SetActiveLayerParams {
        partId: partId.clone(),
        layerIndex: 1,
    })
    .expect("set active");
    api.applyBrush(BrushParams {
        partId: partId.clone(),
        cx: 0,
        cy: 0,
        brushSize: 1,
        color: [9, 8, 7, 255],
    })
    .expect("brush");
    let sessions = api.sessions.lock().unwrap();
    let session = sessions.get(&partId).expect("session");
    assert_eq!(session.state.layers[0].pixels, vec![0, 0, 0, 0]);
    assert_eq!(session.state.layers[1].pixels, vec![9, 8, 7, 255]);
    assert_eq!(session.activeLayerIndex, 1);
}

#[test]
fn getWorkspaceFallbackOnMissingFile() {
    let tmp = TempDir::new();
    let api = CoreApi::new();
    let result = api
        .getWorkspace(WorkspacePathParams {
            path: tmp.path().join("workspace.json").to_string_lossy().into_owned(),
        })
        .expect("getWorkspace");
    assert_eq!(result.source, WorkspaceSource::Fallback);
    assert_eq!(result.layout.panels.len(), 4);
}

#[test]
fn saveAndReloadRoundTrip() {
    let tmp = TempDir::new();
    let path = tmp.path().join("workspace.json");
    let api = CoreApi::new();
    let mut layout = windowManager::defaultWorkspace();
    layout.panels[0].size = PanelSize {
        width: 300,
        height: 700,
    };
    let theme = windowManager::defaultTheme();
    api.saveWorkspace(SaveWorkspaceParams {
        path: path.to_string_lossy().into_owned(),
        layout: layout.clone(),
        theme: theme.clone(),
    })
    .expect("save");
    let result = api
        .getWorkspace(WorkspacePathParams {
            path: path.to_string_lossy().into_owned(),
        })
        .expect("get");
    assert_eq!(result.source, WorkspaceSource::File);
    assert_eq!(result.layout.panels[0].size.width, 300);
    assert_eq!(result.layout.panels[0].size.height, 700);
    assert_eq!(result.theme.primary, theme.primary);
}

#[test]
fn savePartLastWriteWins() {
    let tmp = TempDir::new();
    let bodyDir = tmp.path().join("st1").join("Body");
    fs::create_dir_all(&bodyDir).unwrap();
    let target = bodyDir.join("p.png");
    writeTinyPng(&target, [0, 0, 0, 0]);
    let api = CoreApi::new();
    let loaded = loadStdPart(&api, tmp.path());

    for color in [[10, 20, 30, 255], [200, 100, 50, 255]] {
        api.applyBrush(BrushParams {
            partId: loaded.partId.clone(),
            cx: 0,
            cy: 0,
            brushSize: 1,
            color,
        })
        .expect("brush");
        api.savePart(SavePartParams {
            partId: loaded.partId.clone(),
            targetPath: target.to_string_lossy().into_owned(),
        })
        .expect("save");
    }

    let (w, h, pixels) = imageOps::loadPng(&target).expect("reload");
    assert_eq!((w, h), (1, 1));
    assert_eq!(pixels, vec![200, 100, 50, 255]);
    assert_eq!(target.file_name().unwrap(), "p.png");
}

#[test]
fn resetLayoutDoesNotTouchFile() {
    let tmp = TempDir::new();
    let path = tmp.path().join("workspace.json");
    let api = CoreApi::new();
    let mut layout = windowManager::defaultWorkspace();
    layout.panels[0].size = PanelSize {
        width: 300,
        height: 700,
    };
    api.saveWorkspace(SaveWorkspaceParams {
        path: path.to_string_lossy().into_owned(),
        layout,
        theme: windowManager::defaultTheme(),
    })
    .expect("save");
    let snapshotBytes = std::fs::read(&path).unwrap();
    let reset = api.resetLayout().expect("reset");
    assert_eq!(reset.source, WorkspaceSource::Fallback);
    assert_eq!(reset.layout.panels[0].size.width, 240);
    assert_eq!(std::fs::read(&path).unwrap(), snapshotBytes);
    let reloaded = api
        .getWorkspace(WorkspacePathParams {
            path: path.to_string_lossy().into_owned(),
        })
        .expect("reload");
    assert_eq!(reloaded.source, WorkspaceSource::File);
    assert_eq!(reloaded.layout.panels[0].size.width, 300);
}
