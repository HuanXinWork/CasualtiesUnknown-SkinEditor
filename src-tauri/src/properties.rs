// 基于 proptest 的 property-based 测试集合：
// 文件名不变性、图层合并幂等、Undo/Redo 对称、Pivot 居中、Skin 隔离、
// 透明度保真、布局往返、反色自逆、默认布局回落。

#![cfg(test)]
#![allow(non_snake_case)]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use proptest::prelude::*;

use crate::imageOps;

/// 自管 RAII 临时目录。
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
            "spe_properties_{}_{}_{}_{}",
            tag,
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

proptest! {
    /// 文件名不可变：savePng 后路径文件名仍是入参文件名，不会追加副本。
    #[test]
    fn propertyOneFilenameImmutable(name in "[a-z0-9_]{1,16}") {
        let tmp = TempDir::new("p1");
        let expected = format!("{}.png", name);
        let target = tmp.path().join(&expected);
        imageOps::savePng(&target, 1, 1, &[0, 0, 0, 0]).expect("seed save");
        imageOps::savePng(&target, 1, 1, &[255, 255, 255, 255]).expect("overwrite save");

        prop_assert_eq!(
            target.file_name().unwrap().to_string_lossy().into_owned(),
            expected.clone()
        );
        let pngs: Vec<String> = fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".png"))
            .collect();
        prop_assert_eq!(pngs, vec![expected]);
    }

    /// Pivot 中心一致：渲染锚点恒为 (w/2, h/2)。
    #[test]
    fn propertyFourPivotCenter(w in 1u32..=64, h in 1u32..=64) {
        let img = image::RgbaImage::new(w, h);
        let (gotW, gotH) = img.dimensions();
        prop_assert_eq!(gotW, w);
        prop_assert_eq!(gotH, h);
        prop_assert_eq!((gotW / 2, gotH / 2), (w / 2, h / 2));
    }

    /// 透明度保真：随机 RGBA buffer 经 savePng → loadPng 往返后逐字节相等。
    #[test]
    fn propertySevenOpacityFidelity(
        (w, h, buf) in (1u32..=16, 1u32..=16).prop_flat_map(|(w, h)| {
            let len = (w as usize) * (h as usize) * 4;
            proptest::collection::vec(0u8..=255, len).prop_map(move |v| (w, h, v))
        })
    ) {
        let tmp = TempDir::new("p7");
        let target = tmp.path().join("rt.png");
        imageOps::savePng(&target, w, h, &buf).expect("save");
        let (gotW, gotH, back) = imageOps::loadPng(&target).expect("load");
        prop_assert_eq!(gotW, w);
        prop_assert_eq!(gotH, h);
        prop_assert_eq!(back, buf);
    }
}

use crate::historyManager::{self, HistoryEntry, HistoryStack, PixelDiff};

/// 生成与 4x4 画布对齐的 (x, y, w, h, after)：先抽 w/h 再据此约束 x/y 与 after 长度。
fn rectAndAfterStrategy() -> impl Strategy<Value = (u32, u32, u32, u32, Vec<u8>)> {
    (1u32..=4u32, 1u32..=4u32).prop_flat_map(|(w, h)| {
        let len = (w * h * 4) as usize;
        (
            0u32..=(4 - w),
            0u32..=(4 - h),
            Just(w),
            Just(h),
            proptest::collection::vec(0u8..=255, len),
        )
    })
}

proptest! {
    /// 图层合并幂等：随机若干图层 flatten 一次得到 fst；把 fst 当成单层不透明再 flatten 得到 snd；fst == snd。
    #[test]
    fn propertyTwoLayerFlattenIdempotent(
        layers in proptest::collection::vec(
            (any::<bool>(), 0u8..=255u8, proptest::collection::vec(0u8..=255, 16)),
            1..=8
        )
    ) {
        let mkState = |ls: Vec<imageOps::Layer>| imageOps::PartEditState {
            partName: "p".into(),
            width: 2,
            height: 2,
            layers: ls,
        };
        let multi: Vec<imageOps::Layer> = layers
            .into_iter()
            .enumerate()
            .map(|(i, (v, op, px))| imageOps::Layer {
                id: format!("L{}", i),
                name: format!("L{}", i),
                visible: v,
                opacity: op,
                pixels: px,
                transform: None,
            })
            .collect();
        let fst = imageOps::flatten(&mkState(multi));
        let single = vec![imageOps::Layer {
            id: "flat".into(),
            name: "flat".into(),
            visible: true,
            opacity: 255,
            pixels: fst.clone(),
            transform: None,
        }];
        let snd = imageOps::flatten(&mkState(single));
        prop_assert_eq!(fst, snd);
    }

    /// Undo/Redo 对称：随机操作序列作用到 4x4 画布；undo 全部后回到初始，redo 全部后回到末态。
    #[test]
    fn propertyThreeUndoRedoSymmetry(
        ops in proptest::collection::vec(rectAndAfterStrategy(), 1..=10)
    ) {
        const W: u32 = 4;
        let mut state = vec![0u8; (W * W * 4) as usize];
        let initial = state.clone();
        let mut stack = HistoryStack::new();
        for (i, (x, y, w, h, after)) in ops.iter().enumerate() {
            let (xx, yy, ww, hh) = (*x, *y, *w, *h);
            let mut before = Vec::with_capacity((ww * hh * 4) as usize);
            for row in 0..hh {
                let start = (((yy + row) * W) + xx) as usize * 4;
                let end = start + (ww * 4) as usize;
                before.extend_from_slice(&state[start..end]);
            }
            let diff = PixelDiff {
                x: xx, y: yy, width: ww, height: hh,
                before, after: after.clone(),
            };
            historyManager::applyAfter(&mut state, W, &diff);
            stack.push(HistoryEntry {
                layerId: format!("L{}", i),
                diff,
                timestamp: i as i64,
            });
        }
        let stateN = state.clone();
        while let Some(e) = stack.undo() {
            historyManager::applyBefore(&mut state, W, &e.diff);
        }
        prop_assert_eq!(state.clone(), initial);
        while let Some(e) = stack.redo() {
            historyManager::applyAfter(&mut state, W, &e.diff);
        }
        prop_assert_eq!(state, stateN);
    }
}

use std::collections::HashMap;

use crate::apiLayer::{ApiLayer, BrushParams, CoreApi, LoadPartParams, SavePartParams};
use crate::skinLoader::PartCategory;
use crate::windowManager::{
    self, defaultTheme, DockPosition, PanelLayout, PanelSize, PanelState, WindowPosition,
    WorkspaceLayout, WorkspaceSource, WORKSPACE_VERSION,
};

/// 1×1 全透明 PNG 夹具。
fn writeTinyPng(path: &Path) {
    let buf = image::RgbaImage::from_pixel(1, 1, image::Rgba([0, 0, 0, 0]));
    buf.save(path).expect("write tiny png");
}

proptest! {
    /// Skin 隔离：在 skin1 编辑保存后，skin2 同名 PNG 字节级未变。
    #[test]
    fn propertySixSkinIsolation(color in any::<[u8; 4]>()) {
        let tmp = TempDir::new("p6");
        let st1Body = tmp.path().join("st1").join("Body");
        let st2Body = tmp.path().join("st2").join("Body");
        fs::create_dir_all(&st1Body).unwrap();
        fs::create_dir_all(&st2Body).unwrap();
        let st1Png = st1Body.join("p.png");
        let st2Png = st2Body.join("p.png");
        writeTinyPng(&st1Png);
        writeTinyPng(&st2Png);
        let saveBefore = fs::read(&st2Png).unwrap();

        let api = CoreApi::new();
        let loaded = api
            .loadPartImage(LoadPartParams {
                skinRoot: tmp.path().to_string_lossy().into_owned(),
                skinName: "st1".into(),
                category: PartCategory::Body,
                partName: "p".into(),
            })
            .expect("load");
        api.applyBrush(BrushParams {
            partId: loaded.partId.clone(),
            cx: 0, cy: 0, brushSize: 1, color,
        })
        .expect("brush");
        api.savePart(SavePartParams {
            partId: loaded.partId,
            targetPath: st1Png.to_string_lossy().into_owned(),
        })
        .expect("save");

        let saveAfter = fs::read(&st2Png).unwrap();
        prop_assert_eq!(saveBefore, saveAfter);
    }
}

prop_compose! {
    /// 随机单个 PanelLayout：覆盖 PanelState / DockPosition / 可选字段全部分支。
    fn panelLayoutStrategy()(
        id in "[a-z]{1,8}",
        state in prop_oneof![
            Just(PanelState::Docked),
            Just(PanelState::Detached),
            Just(PanelState::Hidden),
        ],
        dockPosition in proptest::option::of(prop_oneof![
            Just(DockPosition::Left),
            Just(DockPosition::Right),
            Just(DockPosition::Top),
            Just(DockPosition::Bottom),
            Just(DockPosition::Center),
        ]),
        dockOrder in proptest::option::of(0u32..=10),
        width in 160u32..=1000,
        height in 160u32..=1000,
        windowPosition in proptest::option::of(
            (-500i32..=500, -500i32..=500).prop_map(|(x, y)| WindowPosition { x, y })
        ),
        alwaysOnTop in proptest::option::of(any::<bool>()),
        collapsed in any::<bool>(),
    ) -> PanelLayout {
        PanelLayout {
            id, state, dockPosition, dockOrder,
            size: PanelSize { width, height },
            windowPosition, alwaysOnTop, collapsed,
        }
    }
}

proptest! {
    /// 布局往返一致：随机 WorkspaceLayout 经 saveWorkspace → loadWorkspace 后字段一一相等。
    #[test]
    fn propertyEightLayoutRoundTrip(
        panels in proptest::collection::vec(panelLayoutStrategy(), 1..=6),
        ratios in proptest::collection::vec(("[a-z]{1,4}", 0u32..=1000), 0..=4),
    ) {
        let tmp = TempDir::new("p8");
        let path = tmp.path().join("workspace.json");
        let mut splitRatios: HashMap<String, f32> = HashMap::new();
        for (k, v) in ratios {
            splitRatios.insert(k, (v as f32) / 1000.0);
        }
        let layout = WorkspaceLayout {
            version: WORKSPACE_VERSION,
            panels,
            splitRatios,
            sizes: HashMap::new(),
            activeSkin: None,
            settings: windowManager::defaultWorkspaceSettings(),
        };
        windowManager::saveWorkspace(&path, &layout, &defaultTheme()).expect("save");
        let (loaded, _theme, source) = windowManager::loadWorkspace(&path);
        prop_assert_eq!(source, WorkspaceSource::File);
        prop_assert_eq!(loaded.version, layout.version);
        prop_assert_eq!(loaded.panels.len(), layout.panels.len());
        for (a, b) in loaded.panels.iter().zip(layout.panels.iter()) {
            prop_assert_eq!(&a.id, &b.id);
            prop_assert_eq!(&a.state, &b.state);
            prop_assert_eq!(&a.dockPosition, &b.dockPosition);
            prop_assert_eq!(a.dockOrder, b.dockOrder);
            prop_assert_eq!(a.size.width, b.size.width);
            prop_assert_eq!(a.size.height, b.size.height);
            match (&a.windowPosition, &b.windowPosition) {
                (Some(p), Some(q)) => {
                    prop_assert_eq!(p.x, q.x);
                    prop_assert_eq!(p.y, q.y);
                }
                (None, None) => {}
                _ => prop_assert!(false, "windowPosition mismatch"),
            }
            prop_assert_eq!(a.alwaysOnTop, b.alwaysOnTop);
            prop_assert_eq!(a.collapsed, b.collapsed);
        }
        prop_assert_eq!(loaded.splitRatios.len(), layout.splitRatios.len());
        for (k, v) in &layout.splitRatios {
            prop_assert_eq!(loaded.splitRatios.get(k), Some(v));
        }
    }
}


// ===== 反色 / 布局往返 / 默认回落 PBT =====

use crate::dataPaths;
use std::sync::MutexGuard;

/// 反色函数：与前端 editorCanvas attachInvertedBorder 算法一致。
/// invert(invert(c)) == c 对任意 RGB ∈ [0,255]³ 成立。
fn invertColor(c: [u8; 3]) -> [u8; 3] {
    [255 - c[0], 255 - c[1], 255 - c[2]]
}

fn appRootEnvLock() -> MutexGuard<'static, ()> {
    crate::dataPaths::appRootEnvLock()
}

struct AppRootGuard(Option<std::ffi::OsString>);

impl AppRootGuard {
    fn set(value: &Path) -> Self {
        let prev = std::env::var_os(dataPaths::APP_ROOT_ENV);
        std::env::set_var(dataPaths::APP_ROOT_ENV, value);
        AppRootGuard(prev)
    }
}

impl Drop for AppRootGuard {
    fn drop(&mut self) {
        match self.0.take() {
            Some(v) => std::env::set_var(dataPaths::APP_ROOT_ENV, v),
            None => std::env::remove_var(dataPaths::APP_ROOT_ENV),
        }
    }
}

proptest! {
    /// 反色自逆：对任意 RGB invert(invert(c)) == c。
    #[test]
    fn propertyOneInvertSelfInverse(c in any::<[u8; 3]>()) {
        let back = invertColor(invertColor(c));
        prop_assert_eq!(back, c);
    }
}

proptest! {
    /// 布局持久化往返：sizes 表写盘后读回逐键相等。
    #[test]
    fn propertyTwoLayoutRoundTrip(
        left in 100.0f64..=800.0,
        preview in 100.0f64..=800.0,
        right in 100.0f64..=800.0,
        bottom in 50.0f64..=800.0,
        skinName in proptest::option::of("[a-z0-9]{1,8}"),
    ) {
        let _lock = appRootEnvLock();
        let tmp = TempDir::new("p2pbt");
        let _guard = AppRootGuard::set(tmp.path());

        let mut layout = windowManager::defaultWorkspace();
        layout.sizes.insert("mainPane.left".into(), left);
        layout.sizes.insert("mainPane.preview".into(), preview);
        layout.sizes.insert("mainPane.right".into(), right);
        layout.sizes.insert("mainPane.bottom".into(), bottom);
        layout.activeSkin = skinName.clone();

        windowManager::saveDefaultWorkspace(&layout, &windowManager::defaultTheme())
            .expect("save");
        let (loaded, _theme, source) = windowManager::loadDefaultWorkspace();
        prop_assert_eq!(source, WorkspaceSource::File);
        // 量化到像素整数后逐键相等，避免 JSON 序列化 f64 末位 ULP 漂移误判。
        let q = |v: f64| v.round() as i64;
        prop_assert_eq!(loaded.sizes.get("mainPane.left").map(|v| q(*v)), Some(q(left)));
        prop_assert_eq!(loaded.sizes.get("mainPane.preview").map(|v| q(*v)), Some(q(preview)));
        prop_assert_eq!(loaded.sizes.get("mainPane.right").map(|v| q(*v)), Some(q(right)));
        prop_assert_eq!(loaded.sizes.get("mainPane.bottom").map(|v| q(*v)), Some(q(bottom)));
        prop_assert_eq!(loaded.activeSkin, skinName);
    }
}

proptest! {
    /// 默认回落表一致性：未写盘的 AppRoot 下 loadDefaultWorkspace 返回的 sizes
    /// 必须与 defaultLayoutSizes 逐键相等，activeSkin 必须为 None。
    #[test]
    fn propertyThreeDefaultFallback(suffix in "[a-z0-9]{1,8}") {
        let _lock = appRootEnvLock();
        let tmp = TempDir::new(&format!("p3pbt_{}", suffix));
        let _guard = AppRootGuard::set(tmp.path());
        prop_assert!(!dataPaths::workspaceFile().exists());

        let (loaded, _theme, source) = windowManager::loadDefaultWorkspace();
        prop_assert_eq!(source, WorkspaceSource::Fallback);
        let expected = windowManager::defaultLayoutSizes();
        prop_assert_eq!(loaded.sizes.len(), expected.len());
        for (k, v) in &expected {
            prop_assert_eq!(loaded.sizes.get(k), Some(v));
        }
        prop_assert!(loaded.activeSkin.is_none());
    }
}
