// 工作区布局、用户设置与主题的持久化（`workspace.json`）。
#![allow(non_snake_case)]

use std::collections::HashMap;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::apiLayer::ApiError;
use crate::dataPaths;

pub const WORKSPACE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelLayout {
    pub id: String,
    pub state: PanelState,
    pub dockPosition: Option<DockPosition>,
    pub dockOrder: Option<u32>,
    pub size: PanelSize,
    pub windowPosition: Option<WindowPosition>,
    pub alwaysOnTop: Option<bool>,
    pub collapsed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PanelSize {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum PanelState {
    #[serde(rename = "docked")]
    Docked,
    #[serde(rename = "detached")]
    Detached,
    #[serde(rename = "hidden")]
    Hidden,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum DockPosition {
    #[serde(rename = "left")]
    Left,
    #[serde(rename = "right")]
    Right,
    #[serde(rename = "top")]
    Top,
    #[serde(rename = "bottom")]
    Bottom,
    #[serde(rename = "center")]
    Center,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceLayout {
    pub version: u32,
    pub panels: Vec<PanelLayout>,
    pub splitRatios: HashMap<String, f32>,
    #[serde(default)]
    pub sizes: HashMap<String, f64>,
    #[serde(default)]
    pub activeSkin: Option<String>,
    #[serde(default = "defaultWorkspaceSettings")]
    pub settings: WorkspaceSettings,
}

fn defaultTrue() -> bool {
    true
}

fn defaultAutoSaveIntervalSec() -> u32 {
    60
}

fn defaultSwitchSaveBehavior() -> String {
    "ask".into()
}

fn defaultSoftBrushHardness() -> f32 {
    0.5
}

/// 工作区用户偏好，字段与前端 `WorkspaceSettings` 对齐。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceSettings {
    #[serde(default = "defaultTrue")]
    pub showMotionDebugPanel: bool,
    #[serde(default)]
    pub showWingDebugPanel: bool,
    #[serde(default)]
    pub showBloodPanel: bool,
    #[serde(default)]
    pub colorPaletteRecent: Vec<[u8; 3]>,
    #[serde(default)]
    pub colorPaletteCustom: Vec<Option<[u8; 3]>>,
    #[serde(default)]
    pub partGroupsCollapsed: HashMap<String, bool>,
    #[serde(default)]
    pub autoSaveEnabled: bool,
    #[serde(default = "defaultAutoSaveIntervalSec")]
    pub autoSaveIntervalSec: u32,
    #[serde(default = "defaultSwitchSaveBehavior")]
    pub switchSaveBehavior: String,
    #[serde(default = "defaultSoftBrushHardness")]
    pub softBrushHardness: f32,
    #[serde(default)]
    pub shortcuts: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThemeConfig {
    pub primary: String,
    pub background: String,
    pub surface: String,
    pub onPrimary: String,
    pub onBackground: String,
    pub borderOpacity: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceFile {
    pub version: u32,
    pub layout: WorkspaceLayout,
    pub theme: ThemeConfig,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum WorkspaceSource {
    #[serde(rename = "file")]
    File,
    #[serde(rename = "fallback")]
    Fallback,
}

/// 内置浅色主题，与前端 `stateStore/theme.ts::defaultTheme` 保持一致。
pub fn defaultTheme() -> ThemeConfig {
    ThemeConfig {
        primary: "#000000".into(),
        background: "#FFFFFF".into(),
        surface: "#F5F5F5".into(),
        onPrimary: "#FFFFFF".into(),
        onBackground: "#000000".into(),
        borderOpacity: 0.16,
    }
}

pub fn defaultWorkspaceSettings() -> WorkspaceSettings {
    WorkspaceSettings {
        showMotionDebugPanel: true,
        showWingDebugPanel: false,
        showBloodPanel: false,
        colorPaletteRecent: Vec::new(),
        colorPaletteCustom: Vec::new(),
        partGroupsCollapsed: HashMap::new(),
        autoSaveEnabled: false,
        autoSaveIntervalSec: defaultAutoSaveIntervalSec(),
        switchSaveBehavior: defaultSwitchSaveBehavior(),
        softBrushHardness: defaultSoftBrushHardness(),
        shortcuts: HashMap::new(),
    }
}

pub fn defaultWorkspace() -> WorkspaceLayout {
    let docked = |id: &str, dock: DockPosition, width: u32, height: u32| PanelLayout {
        id: id.into(),
        state: PanelState::Docked,
        dockPosition: Some(dock),
        dockOrder: None,
        size: PanelSize { width, height },
        windowPosition: None,
        alwaysOnTop: None,
        collapsed: false,
    };
    WorkspaceLayout {
        version: WORKSPACE_VERSION,
        panels: vec![
            docked("partPanel", DockPosition::Left, 240, 600),
            docked("layerPanel", DockPosition::Right, 240, 280),
            docked("colorPalette", DockPosition::Bottom, 320, 120),
            docked("previewCanvas", DockPosition::Right, 320, 360),
        ],
        splitRatios: HashMap::new(),
        sizes: defaultLayoutSizes(),
        activeSkin: None,
        settings: defaultWorkspaceSettings(),
    }
}

/// 默认主窗格像素尺寸，与前端 `DEFAULT_LAYOUT_SIZES` 对应。
pub fn defaultLayoutSizes() -> HashMap<String, f64> {
    let mut m = HashMap::new();
    m.insert("mainPane.left".into(), 220.0);
    m.insert("mainPane.preview".into(), 320.0);
    m.insert("mainPane.right".into(), 280.0);
    m.insert("mainPane.bottom".into(), 200.0);
    m
}

/// 读取 `workspace.json`；缺失时回退默认，损坏或版本不兼容时备份 `.json.bak` 后回退。
pub fn loadWorkspace(path: &Path) -> (WorkspaceLayout, ThemeConfig, WorkspaceSource) {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(_) => return (defaultWorkspace(), defaultTheme(), WorkspaceSource::Fallback),
    };
    match serde_json::from_slice::<WorkspaceFile>(&bytes) {
        Ok(file) if file.version == WORKSPACE_VERSION => {
            (file.layout, file.theme, WorkspaceSource::File)
        }
        _ => {
            let bak = path.with_extension("json.bak");
            let _ = std::fs::write(&bak, &bytes);
            (defaultWorkspace(), defaultTheme(), WorkspaceSource::Fallback)
        }
    }
}

pub fn saveWorkspace(
    path: &Path,
    layout: &WorkspaceLayout,
    theme: &ThemeConfig,
) -> Result<(), ApiError> {
    let file = WorkspaceFile {
        version: WORKSPACE_VERSION,
        layout: layout.clone(),
        theme: theme.clone(),
    };
    let bytes = serde_json::to_vec_pretty(&file).map_err(|e| ApiError {
        code: "encode_failed".into(),
        message: format!("serialize workspace failed: {}", e),
    })?;
    dataPaths::atomicWrite(path, &bytes).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("write {} failed: {}", path.display(), e),
    })
}

pub fn saveDefaultWorkspace(layout: &WorkspaceLayout, theme: &ThemeConfig) -> Result<(), ApiError> {
    saveWorkspace(&dataPaths::workspaceFile(), layout, theme)
}

pub fn loadDefaultWorkspace() -> (WorkspaceLayout, ThemeConfig, WorkspaceSource) {
    loadWorkspace(&dataPaths::workspaceFile())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::MutexGuard;
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
                "spe_windowManager_{}_{}_{}",
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

    #[test]
    fn defaultWorkspaceCoversDetachablePanels() {
        let layout = defaultWorkspace();
        let ids: Vec<&str> = layout.panels.iter().map(|p| p.id.as_str()).collect();
        assert!(ids.contains(&"partPanel"));
        assert!(ids.contains(&"layerPanel"));
        assert!(ids.contains(&"colorPalette"));
        assert!(ids.contains(&"previewCanvas"));
        assert_eq!(layout.version, WORKSPACE_VERSION);
    }

    #[test]
    fn missingFileReturnsFallback() {
        let tmp = TempDir::new();
        let missing = tmp.path().join("workspace.json");
        let (layout, theme, source) = loadWorkspace(&missing);
        assert_eq!(source, WorkspaceSource::Fallback);
        assert_eq!(layout.panels.len(), defaultWorkspace().panels.len());
        assert_eq!(theme.primary, defaultTheme().primary);
        assert!(layout.settings.showMotionDebugPanel);
        assert!(!missing.exists());
        assert!(!tmp.path().join("workspace.json.bak").exists());
    }

    #[test]
    fn corruptedJsonReturnsFallbackAndBacksUp() {
        let tmp = TempDir::new();
        let path = tmp.path().join("workspace.json");
        fs::write(&path, b"not json").unwrap();
        let (layout, _theme, source) = loadWorkspace(&path);
        assert_eq!(source, WorkspaceSource::Fallback);
        assert_eq!(layout.panels.len(), defaultWorkspace().panels.len());
        assert!(layout.settings.showMotionDebugPanel);
        let bak = tmp.path().join("workspace.json.bak");
        assert!(bak.exists());
        assert_eq!(fs::read(&bak).unwrap(), b"not json");
    }

    #[test]
    fn roundTripPreservesLayoutThemeAndExtendedSettings() {
        let tmp = TempDir::new();
        let path = tmp.path().join("workspace.json");
        let mut layout = defaultWorkspace();
        layout.splitRatios.insert("main".into(), 0.42);
        layout.panels[0].size = PanelSize { width: 280, height: 640 };
        layout.panels[1].state = PanelState::Detached;
        layout.panels[1].windowPosition = Some(WindowPosition { x: 100, y: 50 });
        layout.panels[1].alwaysOnTop = Some(true);
        layout.settings.showMotionDebugPanel = false;
        layout.settings.autoSaveEnabled = true;
        layout.settings.autoSaveIntervalSec = 120;
        layout.settings.switchSaveBehavior = "save".into();
        layout.settings.softBrushHardness = 0.75;
        layout.settings.shortcuts.insert("tool.brush".into(), "KeyQ".into());
        let theme = ThemeConfig {
            primary: "#112233".into(),
            background: "#FFEEDD".into(),
            surface: "#AABBCC".into(),
            onPrimary: "#FFFFFF".into(),
            onBackground: "#000000".into(),
            borderOpacity: 0.32,
        };
        saveWorkspace(&path, &layout, &theme).expect("save");
        let (loaded, loadedTheme, source) = loadWorkspace(&path);
        assert_eq!(source, WorkspaceSource::File);
        assert_eq!(loaded.panels.len(), layout.panels.len());
        assert_eq!(loaded.splitRatios.get("main"), Some(&0.42));
        assert_eq!(loaded.panels[0].size.width, 280);
        assert_eq!(loaded.panels[1].state, PanelState::Detached);
        assert_eq!(loaded.panels[1].alwaysOnTop, Some(true));
        assert!(!loaded.settings.showMotionDebugPanel);
        assert!(loaded.settings.autoSaveEnabled);
        assert_eq!(loaded.settings.autoSaveIntervalSec, 120);
        assert_eq!(loaded.settings.switchSaveBehavior, "save");
        assert!((loaded.settings.softBrushHardness - 0.75).abs() < f32::EPSILON);
        assert_eq!(loaded.settings.shortcuts.get("tool.brush").map(String::as_str), Some("KeyQ"));
        let pos = loaded.panels[1].windowPosition.as_ref().unwrap();
        assert_eq!((pos.x, pos.y), (100, 50));
        assert_eq!(loadedTheme.primary, "#112233");
        assert!((loadedTheme.borderOpacity - 0.32).abs() < f32::EPSILON);
    }

    #[test]
    fn missingFileFallsBackToDefaultLayout() {
        let _lock = envLock();
        let tmp = TempDir::new();
        let _guard = EnvGuard::set(dataPaths::APP_ROOT_ENV, tmp.path());
        let (layout, theme, source) = loadDefaultWorkspace();
        assert_eq!(source, WorkspaceSource::Fallback);
        assert_eq!(layout.sizes, defaultLayoutSizes());
        assert!(layout.activeSkin.is_none());
        assert!(layout.settings.showMotionDebugPanel);
        assert_eq!(theme.primary, defaultTheme().primary);
        assert!(!dataPaths::workspaceFile().exists());
    }

    #[test]
    fn saveAndLoadDefaultWorkspaceRoundTrip() {
        let _lock = envLock();
        let tmp = TempDir::new();
        let _guard = EnvGuard::set(dataPaths::APP_ROOT_ENV, tmp.path());
        let mut layout = defaultWorkspace();
        layout.sizes.insert("mainPane.left".into(), 333.0);
        layout.sizes.insert("dockable.toolPanel.height".into(), 96.0);
        layout.activeSkin = Some("st1".into());
        layout.settings.showMotionDebugPanel = false;
        saveDefaultWorkspace(&layout, &defaultTheme()).expect("save");
        assert!(dataPaths::workspaceFile().exists());
        let (loaded, _theme, source) = loadDefaultWorkspace();
        assert_eq!(source, WorkspaceSource::File);
        assert_eq!(loaded.sizes.get("mainPane.left"), Some(&333.0));
        assert_eq!(loaded.sizes.get("dockable.toolPanel.height"), Some(&96.0));
        assert_eq!(loaded.activeSkin.as_deref(), Some("st1"));
        assert!(!loaded.settings.showMotionDebugPanel);
    }

    #[test]
    fn saveDefaultWorkspaceCreatesDataDir() {
        let _lock = envLock();
        let tmp = TempDir::new();
        let _guard = EnvGuard::set(dataPaths::APP_ROOT_ENV, tmp.path());
        assert!(!dataPaths::dataDir().exists());
        saveDefaultWorkspace(&defaultWorkspace(), &defaultTheme()).expect("save");
        assert!(dataPaths::dataDir().is_dir());
        assert!(dataPaths::workspaceFile().is_file());
    }

    fn envLock() -> MutexGuard<'static, ()> {
        crate::dataPaths::appRootEnvLock()
    }

    struct EnvGuard(&'static str, Option<std::ffi::OsString>);

    impl EnvGuard {
        fn set(key: &'static str, value: &Path) -> Self {
            let prev = std::env::var_os(key);
            std::env::set_var(key, value);
            EnvGuard(key, prev)
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match self.1.take() {
                Some(v) => std::env::set_var(self.0, v),
                None => std::env::remove_var(self.0),
            }
        }
    }
}
