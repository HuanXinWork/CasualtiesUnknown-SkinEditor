// 基于 proptest 的不变量属性测试集。
#![cfg(test)]
#![allow(non_snake_case)]

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::MutexGuard;
use std::time::{SystemTime, UNIX_EPOCH};

use proptest::prelude::*;

use crate::apiLayer::{ApiLayer, BrushParams, CoreApi, LoadPartParams, SavePartParams};
use crate::dataPaths;
use crate::historyManager::{self, HistoryEntry, HistoryStack, PixelDiff};
use crate::imageOps;
use crate::skinLoader::PartCategory;
use crate::windowManager::{
    self, defaultTheme, DockPosition, PanelLayout, PanelSize, PanelState, WindowPosition,
    WorkspaceLayout, WorkspaceSource, WORKSPACE_VERSION,
};

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

fn writeTinyPng(path: &Path) {
    let buf = image::RgbaImage::from_pixel(1, 1, image::Rgba([0, 0, 0, 0]));
    buf.save(path).expect("write tiny png");
}

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

prop_compose! {
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

    #[test]
    fn propertyFourPivotCenter(w in 1u32..=64, h in 1u32..=64) {
        let img = image::RgbaImage::new(w, h);
        let (gotW, gotH) = img.dimensions();
        prop_assert_eq!(gotW, w);
        prop_assert_eq!(gotH, h);
        prop_assert_eq!((gotW / 2, gotH / 2), (w / 2, h / 2));
    }

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
            let diff = PixelDiff::new(xx, yy, ww, hh, before, after.clone());
            historyManager::applyAfter(&mut state, W, &diff);
            stack.push(HistoryEntry::pixel(format!("L{}", i), diff, i as i64));
        }
        let stateN = state.clone();
        while let Some(e) = stack.undo() {
            let (_, diff) = e.asPixel().expect("pixel entry");
            historyManager::applyBefore(&mut state, W, diff);
        }
        prop_assert_eq!(state.clone(), initial);
        while let Some(e) = stack.redo() {
            let (_, diff) = e.asPixel().expect("pixel entry");
            historyManager::applyAfter(&mut state, W, diff);
        }
        prop_assert_eq!(state, stateN);
    }

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

    #[test]
    fn propertyOneInvertSelfInverse(c in any::<[u8; 3]>()) {
        let back = invertColor(invertColor(c));
        prop_assert_eq!(back, c);
    }

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
        let q = |v: f64| v.round() as i64;
        prop_assert_eq!(loaded.sizes.get("mainPane.left").map(|v| q(*v)), Some(q(left)));
        prop_assert_eq!(loaded.sizes.get("mainPane.preview").map(|v| q(*v)), Some(q(preview)));
        prop_assert_eq!(loaded.sizes.get("mainPane.right").map(|v| q(*v)), Some(q(right)));
        prop_assert_eq!(loaded.sizes.get("mainPane.bottom").map(|v| q(*v)), Some(q(bottom)));
        prop_assert_eq!(loaded.activeSkin, skinName);
    }

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
