// 桌面壳与 HTTP 服务共用同一份 apiLayer，通过 runDesktop / runHttp 两个入口区分形态。
#![allow(non_snake_case)]

pub mod dataPaths;
pub mod skinLoader;
pub mod imageOps;
pub mod assemblyTable;
pub mod historyManager;
pub mod windowManager;
pub mod layerSidecar;
pub mod imageStore;
pub mod baseSizes;
pub mod apiLayer;
mod httpServer;
mod tauriCommands;

#[cfg(test)]
mod properties;

use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};

use apiLayer::CoreApi;

/// 主窗口关闭拦截。点 X 时拦截关窗、置 closeRequested；前端确认后置 forceClose
/// 并主动关窗，on_window_event 检测到 forceClose 即放行。仅作用于 label = "main"。
#[derive(Default)]
pub struct CloseGuard {
    pub closeRequested: Mutex<bool>,
    pub forceClose: Mutex<bool>,
}

/// 取色器激活态全局标志。主窗口启停时写入，图片子窗口轮询读取以同步光标样式。
#[derive(Default)]
pub struct PickActiveFlag(pub Mutex<bool>);

/// 启动时确保 data/ 目录与默认 workspace.json 存在。任何 IO 失败仅打印不阻塞，
/// 后续读盘各自有兜底（loadDefaultWorkspace 回退默认布局，listSkins 返回空 Vec）。
pub fn ensureInitialized() {
    let dataDir = dataPaths::dataDir();
    if let Err(e) = std::fs::create_dir_all(&dataDir) {
        eprintln!("[init] 创建 {} 失败: {}", dataDir.display(), e);
        return;
    }
    let skinRoot = dataDir.join("skin");
    if let Err(e) = std::fs::create_dir_all(&skinRoot) {
        eprintln!("[init] 创建 {} 失败: {}", skinRoot.display(), e);
        return;
    }
    if !dataPaths::workspaceFile().exists() {
        let layout = windowManager::defaultWorkspace();
        let theme = windowManager::defaultTheme();
        if let Err(e) = windowManager::saveDefaultWorkspace(&layout, &theme) {
            eprintln!("[init] 写默认 workspace.json 失败: {}", e.message);
        }
    }
    // 没有任何皮肤目录时建一个空 default 骨架，partPanel 启动至少有一项可选。
    let hasAny = std::fs::read_dir(&skinRoot)
        .map(|it| it.flatten().any(|e| e.path().is_dir()))
        .unwrap_or(false);
    if !hasAny {
        let default = skinRoot.join("default");
        let _ = std::fs::create_dir_all(default.join("Body"));
        let _ = std::fs::create_dir_all(default.join("Head"));
    }
}

#[derive(Debug, Clone)]
pub struct HttpConfig {
    pub bind: IpAddr,
    pub port: u16,
}

impl HttpConfig {
    pub fn socketAddr(&self) -> SocketAddr {
        SocketAddr::new(self.bind, self.port)
    }
}

/// 启动桌面壳。前端产物路径在 tauri.conf.json 的 frontendDist 配置。
pub fn runDesktop() {
    ensureInitialized();
    let api = Arc::new(CoreApi::new());
    let closeGuard: Arc<CloseGuard> = Arc::new(CloseGuard::default());
    let imageStore: Arc<imageStore::ImageStore> = Arc::new(imageStore::ImageStore::default());
    let pickActiveFlag: Arc<PickActiveFlag> = Arc::new(PickActiveFlag::default());
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // opener 让前端通过 invoke("plugin:opener|open_url", { url }) 唤起系统浏览器，
        // 避免 webview 内 `<a target="_blank">` 不打开外部应用。
        .plugin(tauri_plugin_opener::init())
        .manage(api)
        .manage(closeGuard.clone())
        .manage(imageStore.clone())
        .manage(pickActiveFlag.clone())
        .on_window_event({
            let guard = closeGuard.clone();
            move |window, event| {
                if window.label() != "main" {
                    return;
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    if *guard.forceClose.lock().unwrap() {
                        return;
                    }
                    api.prevent_close();
                    *guard.closeRequested.lock().unwrap() = true;
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            tauriCommands::api_listSkins,
            tauriCommands::api_listParts,
            tauriCommands::api_listMotionCaptures,
            tauriCommands::api_loadMotionCapture,
            tauriCommands::api_getMotionCompositeImage,
            tauriCommands::api_loadPartImage,
            tauriCommands::api_applyBrush,
            tauriCommands::api_applyEraser,
            tauriCommands::api_applyGradient,
            tauriCommands::api_undo,
            tauriCommands::api_redo,
            tauriCommands::api_beginStroke,
            tauriCommands::api_endStroke,
            tauriCommands::api_getFlatten,
            tauriCommands::api_getAssemblyTable,
            tauriCommands::api_savePart,
            tauriCommands::api_resizePart,
            tauriCommands::api_createSidePart,
            tauriCommands::api_addLayer,
            tauriCommands::api_removeLayer,
            tauriCommands::api_setLayerVisibility,
            tauriCommands::api_setLayerOpacity,
            tauriCommands::api_reorderLayers,
            tauriCommands::api_setActiveLayer,
            tauriCommands::api_getLayers,
            tauriCommands::api_getCompositeImage,
            tauriCommands::api_getWorkspace,
            tauriCommands::api_saveWorkspace,
            tauriCommands::api_resetLayout,
            tauriCommands::api_exportSkinPack,
            tauriCommands::api_importSkinPack,
            tauriCommands::api_closeSubwindow,
            tauriCommands::api_setAssemblyOverride,
            tauriCommands::api_loadWingsConfig,
            tauriCommands::api_saveWingsConfig,
            tauriCommands::api_pollCloseRequest,
            tauriCommands::api_confirmCloseMain,
            tauriCommands::api_storeImage,
            tauriCommands::api_loadImage,
            tauriCommands::api_releaseImage,
            tauriCommands::api_pickImagePixelByScreenCoord,
            tauriCommands::api_getCursorScreenPos,
            tauriCommands::api_isMouseLeftDown,
            tauriCommands::api_setPickActive,
            tauriCommands::api_isPickActive,
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 桌面壳失败");
}

/// 启动 HTTP 模式。同一进程同时承担 REST API 与前端静态资源分发。
#[tokio::main(flavor = "multi_thread")]
pub async fn runHttp(config: HttpConfig) {
    ensureInitialized();
    let api = Arc::new(CoreApi::new());
    httpServer::serve(config, api).await;
}

#[cfg(test)]
mod ensureInitializedTests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
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
                "spe_init_{}_{}_{}",
                std::process::id(),
                nanos,
                seq
            ));
            fs::create_dir_all(&path).unwrap();
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

    struct EnvGuard(Option<std::ffi::OsString>);
    impl EnvGuard {
        fn set(value: &Path) -> Self {
            let prev = std::env::var_os(dataPaths::APP_ROOT_ENV);
            std::env::set_var(dataPaths::APP_ROOT_ENV, value);
            EnvGuard(prev)
        }
    }
    impl Drop for EnvGuard {
        fn drop(&mut self) {
            match self.0.take() {
                Some(v) => std::env::set_var(dataPaths::APP_ROOT_ENV, v),
                None => std::env::remove_var(dataPaths::APP_ROOT_ENV),
            }
        }
    }

    #[test]
    fn createsEverythingFromBlankRoot() {
        let _lock = dataPaths::appRootEnvLock();
        let tmp = TempDir::new();
        let _guard = EnvGuard::set(tmp.path());
        ensureInitialized();
        assert!(dataPaths::dataDir().is_dir());
        assert!(dataPaths::dataDir().join("skin").is_dir());
        assert!(dataPaths::workspaceFile().is_file());
        assert!(dataPaths::skinDir("default").is_dir());
        assert!(dataPaths::skinDir("default").join("Body").is_dir());
        assert!(dataPaths::skinDir("default").join("Head").is_dir());
    }

    #[test]
    fn preservesExistingWorkspace() {
        let _lock = dataPaths::appRootEnvLock();
        let tmp = TempDir::new();
        let _guard = EnvGuard::set(tmp.path());
        let mut layout = windowManager::defaultWorkspace();
        layout.activeSkin = Some("custom".into());
        windowManager::saveDefaultWorkspace(&layout, &windowManager::defaultTheme()).unwrap();
        let bytesBefore = fs::read(dataPaths::workspaceFile()).unwrap();
        ensureInitialized();
        let bytesAfter = fs::read(dataPaths::workspaceFile()).unwrap();
        assert_eq!(bytesBefore, bytesAfter);
    }

    #[test]
    fn skipsDefaultSkeletonWhenSkinDirHasContent() {
        let _lock = dataPaths::appRootEnvLock();
        let tmp = TempDir::new();
        let _guard = EnvGuard::set(tmp.path());
        fs::create_dir_all(dataPaths::skinDir("st1").join("Body")).unwrap();
        ensureInitialized();
        assert!(!dataPaths::skinDir("default").exists());
        assert!(dataPaths::skinDir("st1").join("Body").is_dir());
    }
}
