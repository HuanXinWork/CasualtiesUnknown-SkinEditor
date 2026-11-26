// `resizeCanvas` 无损裁扩撤销栈、F/B 与 `R_` 副本继承 `baseSizes`、以及旁车过时回退测试。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use super::*;
use crate::baseSizes;
use crate::imageOps;
use crate::skinLoader::PartCategory;
use crate::zones;

struct TempDir(PathBuf);
impl TempDir {
    fn new(tag: &str) -> Self {
        static SEQ: AtomicU64 = AtomicU64::new(0);
        let seq = SEQ.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let p = std::env::temp_dir().join(format!(
            "spe_rc_{}_{}_{}_{}",
            tag,
            std::process::id(),
            nanos,
            seq
        ));
        fs::create_dir_all(&p).unwrap();
        TempDir(p)
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

fn writeSolidPng(path: &Path, w: u32, h: u32, rgba: [u8; 4]) {
    if let Some(p) = path.parent() {
        fs::create_dir_all(p).unwrap();
    }
    let mut px = Vec::with_capacity((w * h * 4) as usize);
    for _ in 0..(w * h) {
        px.extend_from_slice(&rgba);
    }
    imageOps::savePng(path, w, h, &px).unwrap();
}

fn pxAt(buf: &[u8], w: u32, x: u32, y: u32) -> [u8; 4] {
    let i = ((y * w + x) * 4) as usize;
    [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]
}

#[test]
fn resizeCanvasExpandsAndUndoesAcrossLayersZonesAndStrokesWithoutTouchingDiskPng() {
    let tmp = TempDir::new("expand_undo");
    let skinRoot = tmp.path().to_string_lossy().into_owned();
    let skinDir = tmp.path().join("s1");
    let pngPath = skinDir.join("Head").join("experimentHeadBack.png");
    writeSolidPng(&pngPath, 4, 4, [10, 20, 30, 255]);
    let diskBytesBefore = fs::read(&pngPath).unwrap();

    let maskPath = zones::maskPath(tmp.path(), "s1", "Head", "experimentHeadBack");
    let origMask = vec![
        1, 0, 0, 0, //
        0, 2, 0, 0, //
        0, 0, 0, 0, //
        0, 0, 0, 3, //
    ];
    zones::saveMask(&maskPath, 4, 4, &origMask).unwrap();

    let api = CoreApi::new();
    let loaded = api
        .loadPartImage(LoadPartParams {
            skinRoot: skinRoot.clone(),
            skinName: "s1".into(),
            category: PartCategory::Head,
            partName: "experimentHeadBack".into(),
        })
        .unwrap();
    let partId = loaded.partId;

    // 建第二层并画一个特征点，验证多图层与笔触联合撤销。
    let _snap = api
        .addLayer(AddLayerParams {
            partId: partId.clone(),
        })
        .unwrap();
    api.setActiveLayer(SetActiveLayerParams {
        partId: partId.clone(),
        layerIndex: 1,
    })
    .unwrap();
    api.applyBrush(BrushParams {
        partId: partId.clone(),
        cx: 1,
        cy: 1,
        brushSize: 1,
        color: [250, 0, 0, 255],
    })
    .unwrap();

    // 扩展画布到 6x8，偏移 (1, 3)，不勾选 syncBaseSize。
    let res = api
        .resizeCanvas(ResizeCanvasParams {
            partId: partId.clone(),
            width: 6,
            height: 8,
            offsetX: 1,
            offsetY: 3,
            syncBaseSize: false,
        })
        .unwrap();
    assert_eq!((res.width, res.height), (6, 8));
    assert_eq!(res.baseSize, None);
    // 绝对不触碰 baseSizes.json，也不直接覆写磁盘主 PNG。
    assert!(!skinDir.join(baseSizes::BASE_SIZES_FILE).exists());
    assert_eq!(fs::read(&pngPath).unwrap(), diskBytesBefore);

    let flatAfter = api
        .getFlatten(PartIdParams {
            partId: partId.clone(),
        })
        .unwrap();
    assert_eq!((flatAfter.width, flatAfter.height), (6, 8));
    assert_eq!(pxAt(&flatAfter.pixels, 6, 0, 0), [0, 0, 0, 0]);
    assert_eq!(pxAt(&flatAfter.pixels, 6, 1, 3), [10, 20, 30, 255]);
    assert_eq!(pxAt(&flatAfter.pixels, 6, 2, 4), [250, 0, 0, 255]);

    // 验证 .zones.png 已同步按偏移搬运。
    let (mw, mh, idsAfter) = zones::loadMask(&maskPath).unwrap();
    assert_eq!((mw, mh), (6, 8));
    assert_eq!(idsAfter[(3 * 6 + 1) as usize], 1);
    assert_eq!(idsAfter[(4 * 6 + 2) as usize], 2);
    assert_eq!(idsAfter[(6 * 6 + 4) as usize], 3);
    assert_eq!(idsAfter[0], 0);

    // 撤销 resizeCanvas：应返回 resized: Some(true)，且画布、图层与 zones 全部精确还原。
    let undoDiff = api
        .undo(PartIdParams {
            partId: partId.clone(),
        })
        .unwrap();
    assert_eq!(undoDiff.resized, Some(true));
    assert_eq!(undoDiff.canvasWidth, Some(4));
    assert_eq!(undoDiff.canvasHeight, Some(4));

    let flatRestored = api
        .getFlatten(PartIdParams {
            partId: partId.clone(),
        })
        .unwrap();
    assert_eq!((flatRestored.width, flatRestored.height), (4, 4));
    assert_eq!(pxAt(&flatRestored.pixels, 4, 1, 1), [250, 0, 0, 255]);
    let (rmw, rmh, restoredIds) = zones::loadMask(&maskPath).unwrap();
    assert_eq!((rmw, rmh), (4, 4));
    assert_eq!(restoredIds, origMask);

    // 继续撤销前一步画笔（验证未清空历史栈）。
    let undoBrush = api
        .undo(PartIdParams {
            partId: partId.clone(),
        })
        .unwrap();
    assert_eq!(undoBrush.resized, None);
    let flatBeforeBrush = api
        .getFlatten(PartIdParams {
            partId: partId.clone(),
        })
        .unwrap();
    assert_eq!(pxAt(&flatBeforeBrush.pixels, 4, 1, 1), [10, 20, 30, 255]);

    // 连续重做画笔 + resizeCanvas。
    api.redo(PartIdParams {
        partId: partId.clone(),
    })
    .unwrap();
    let redoResize = api
        .redo(PartIdParams {
            partId: partId.clone(),
        })
        .unwrap();
    assert_eq!(redoResize.resized, Some(true));
    assert_eq!(redoResize.canvasWidth, Some(6));
    assert_eq!(redoResize.canvasHeight, Some(8));
    let (mw2, mh2, idsRedo) = zones::loadMask(&maskPath).unwrap();
    assert_eq!((mw2, mh2), (6, 8));
    assert_eq!(idsRedo, idsAfter);
}

#[test]
fn resizeCanvasSyncBaseSizeRespectsHdScaleAndUndoesCleanly() {
    let tmp = TempDir::new("sync_base");
    let skinRoot = tmp.path().to_string_lossy().into_owned();
    let skinDir = tmp.path().join("hdSkin");
    let pngPath = skinDir.join("Head").join("experimentHeadBack.png");
    // 2x 高清图 52x24，基准 26x12。
    writeSolidPng(&pngPath, 52, 24, [100, 150, 200, 255]);
    baseSizes::upsert(&skinDir, "Head/experimentHeadBack", 26, 12).unwrap();

    let api = CoreApi::new();
    let loaded = api
        .loadPartImage(LoadPartParams {
            skinRoot: skinRoot.clone(),
            skinName: "hdSkin".into(),
            category: PartCategory::Head,
            partName: "experimentHeadBack".into(),
        })
        .unwrap();
    let partId = loaded.partId;

    // 扩展高度到 40（2x 倍率下新基准应为 26x20），并勾选 syncBaseSize。
    let res = api
        .resizeCanvas(ResizeCanvasParams {
            partId: partId.clone(),
            width: 52,
            height: 40,
            offsetX: 0,
            offsetY: 16,
            syncBaseSize: true,
        })
        .unwrap();
    assert_eq!(res.baseSize, Some([26, 20]));
    assert_eq!(
        baseSizes::load(&skinDir).get("Head/experimentHeadBack"),
        Some((26, 20))
    );

    // 撤销应同步回滚 baseSizes.json 到 (26, 12)。
    api.undo(PartIdParams {
        partId: partId.clone(),
    })
    .unwrap();
    assert_eq!(
        baseSizes::load(&skinDir).get("Head/experimentHeadBack"),
        Some((26, 12))
    );

    // 重做应恢复 baseSizes.json 为 (26, 20)。
    api.redo(PartIdParams {
        partId: partId.clone(),
    })
    .unwrap();
    assert_eq!(
        baseSizes::load(&skinDir).get("Head/experimentHeadBack"),
        Some((26, 20))
    );
}

#[test]
fn resizeCanvasSyncBaseSizeUndoRemovesNewEntryWhenPreviouslyAbsent() {
    let tmp = TempDir::new("sync_base_absent");
    let skinRoot = tmp.path().to_string_lossy().into_owned();
    let skinDir = tmp.path().join("s2");
    writeSolidPng(&skinDir.join("Body").join("custom.png"), 10, 10, [1, 2, 3, 255]);

    let api = CoreApi::new();
    let loaded = api
        .loadPartImage(LoadPartParams {
            skinRoot,
            skinName: "s2".into(),
            category: PartCategory::Body,
            partName: "custom".into(),
        })
        .unwrap();

    let res = api
        .resizeCanvas(ResizeCanvasParams {
            partId: loaded.partId.clone(),
            width: 8,
            height: 6,
            offsetX: -1,
            offsetY: -2,
            syncBaseSize: true,
        })
        .unwrap();
    assert_eq!(res.baseSize, Some([8, 6]));
    assert_eq!(baseSizes::load(&skinDir).get("Body/custom"), Some((8, 6)));

    api.undo(PartIdParams {
        partId: loaded.partId,
    })
    .unwrap();
    assert!(baseSizes::load(&skinDir).get("Body/custom").is_none());
}

#[test]
fn resizeCanvasUndoHandlesLayerAddedAfterResize() {
    let tmp = TempDir::new("layer_after_resize");
    let skinRoot = tmp.path().to_string_lossy().into_owned();
    let skinDir = tmp.path().join("s3");
    writeSolidPng(&skinDir.join("Body").join("p.png"), 4, 4, [5, 5, 5, 255]);

    let api = CoreApi::new();
    let loaded = api
        .loadPartImage(LoadPartParams {
            skinRoot,
            skinName: "s3".into(),
            category: PartCategory::Body,
            partName: "p".into(),
        })
        .unwrap();
    api.resizeCanvas(ResizeCanvasParams {
        partId: loaded.partId.clone(),
        width: 8,
        height: 8,
        offsetX: 2,
        offsetY: 2,
        syncBaseSize: false,
    })
    .unwrap();
    api.addLayer(AddLayerParams {
        partId: loaded.partId.clone(),
    })
    .unwrap();

    // 撤销后全部图层（含后建图层）都必须恢复为 4x4 长度，getFlatten 不越界。
    api.undo(PartIdParams {
        partId: loaded.partId.clone(),
    })
    .unwrap();
    let flat = api
        .getFlatten(PartIdParams {
            partId: loaded.partId,
        })
        .unwrap();
    assert_eq!((flat.width, flat.height), (4, 4));
    assert_eq!(flat.pixels.len(), 4 * 4 * 4);
}

#[test]
fn createSidePartAndOrientationPartInheritBaseSizes() {
    let tmp = TempDir::new("inherit_base");
    let skinRoot = tmp.path().to_string_lossy().into_owned();
    let skinDir = tmp.path().join("s4");
    writeSolidPng(
        &skinDir.join("Body").join("experimentUpArm.png"),
        16,
        24,
        [255, 255, 255, 255],
    );
    baseSizes::upsert(&skinDir, "Body/experimentUpArm", 8, 12).unwrap();

    let api = CoreApi::new();
    let side = api
        .createSidePart(CreateSidePartParams {
            skinRoot: skinRoot.clone(),
            skinName: "s4".into(),
            category: PartCategory::Body,
            partName: "experimentUpArm".into(),
            side: "F".into(),
        })
        .unwrap();
    assert_eq!(side.sidePartName, "experimentUpArmF");
    assert_eq!(
        baseSizes::load(&skinDir).get("Body/experimentUpArmF"),
        Some((8, 12))
    );

    let orient = api
        .createOrientationPart(CreateOrientationPartParams {
            skinRoot,
            skinName: "s4".into(),
            category: PartCategory::Body,
            partName: "experimentUpArmF".into(),
        })
        .unwrap();
    assert_eq!(orient.orientationPartName, "R_experimentUpArmF");
    assert_eq!(
        baseSizes::load(&skinDir).get("Body/R_experimentUpArmF"),
        Some((8, 12))
    );
}

#[test]
fn loadPartImageFallsBackToMainPngWhenSidecarStale() {
    let tmp = TempDir::new("stale_sidecar");
    let skinRoot = tmp.path().to_string_lossy().into_owned();
    let skinDir = tmp.path().join("s5");
    let pngPath = skinDir.join("Body").join("experimentUpTorso.png");
    writeSolidPng(&pngPath, 4, 4, [10, 20, 30, 255]);

    let api = CoreApi::new();
    let loaded = api
        .loadPartImage(LoadPartParams {
            skinRoot: skinRoot.clone(),
            skinName: "s5".into(),
            category: PartCategory::Body,
            partName: "experimentUpTorso".into(),
        })
        .unwrap();
    api.addLayer(AddLayerParams {
        partId: loaded.partId.clone(),
    })
    .unwrap();
    api.savePart(SavePartParams {
        partId: loaded.partId.clone(),
        targetPath: pngPath.to_string_lossy().into_owned(),
    })
    .unwrap();
    api.discardPart(PartIdParams {
        partId: loaded.partId,
    })
    .unwrap();

    // 外部工具直接把主 PNG 改成 6x6 绿色。
    writeSolidPng(&pngPath, 6, 6, [0, 255, 0, 255]);

    let reloaded = api
        .loadPartImage(LoadPartParams {
            skinRoot,
            skinName: "s5".into(),
            category: PartCategory::Body,
            partName: "experimentUpTorso".into(),
        })
        .unwrap();
    assert_eq!((reloaded.width, reloaded.height), (6, 6));
    assert_eq!(pxAt(&reloaded.pixels, 6, 0, 0), [0, 255, 0, 255]);
    let layers = api
        .getLayers(PartIdParams {
            partId: reloaded.partId,
        })
        .unwrap();
    assert_eq!(layers.layers.len(), 1);
}
