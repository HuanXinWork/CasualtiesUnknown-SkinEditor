// 应用库入口：初始化本地数据目录与内置 `exp` 默认皮肤，驱动 Tauri 桌面壳或 Axum HTTP 服务。
#![allow(non_snake_case)]

pub mod accessories;
pub mod apiLayer;
pub mod assemblyTable;
pub mod baseSizes;
pub mod blood;
pub mod dataPaths;
pub mod historyManager;
pub mod imageOps;
pub mod imageStore;
pub mod layerSidecar;
pub mod skinLoader;
pub mod windowManager;
pub mod zones;
mod httpServer;
mod tauriCommands;

#[cfg(test)]
mod properties;

use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};

use apiLayer::CoreApi;
use rust_embed::RustEmbed;

const EMBEDDED_DEFAULT_SKIN_NAME: &str = "exp";

#[derive(RustEmbed)]
#[folder = "../data/skin/exp/"]
struct EmbeddedDefaultSkin;

/// 主窗口关闭拦截状态：拦截首次关闭请求交由前端弹窗确认，确认后置 `forceClose` 放行。
#[derive(Default)]
pub struct CloseGuard {
    pub closeRequested: Mutex<bool>,
    pub forceClose: Mutex<bool>,
}

/// 跨窗口取色激活标志，供参考图子窗口同步取色光标。
#[derive(Default)]
pub struct PickActiveFlag(pub Mutex<bool>);

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
    let seededDefaultSkin = ensureEmbeddedDefaultSkin(&skinRoot);
    if !dataPaths::workspaceFile().exists() {
        let mut layout = windowManager::defaultWorkspace();
        if seededDefaultSkin {
            layout.activeSkin = Some(EMBEDDED_DEFAULT_SKIN_NAME.into());
        }
        let theme = windowManager::defaultTheme();
        if let Err(e) = windowManager::saveDefaultWorkspace(&layout, &theme) {
            eprintln!("[init] 写默认 workspace.json 失败: {}", e.message);
        }
    }
    backfillBaseSizes(&skinRoot);
}

/// 当 `data/skin/` 为空时解包编译期内嵌的 `exp` 默认皮肤。
pub fn ensureEmbeddedDefaultSkin(skinRoot: &std::path::Path) -> bool {
    if !skinLoader::listSkins(skinRoot).is_empty() {
        return false;
    }
    let targetSkinDir = skinRoot.join(EMBEDDED_DEFAULT_SKIN_NAME);
    for rel in EmbeddedDefaultSkin::iter() {
        let relPath = rel.as_ref();
        let Some(file) = EmbeddedDefaultSkin::get(relPath) else {
            continue;
        };
        let dst = targetSkinDir.join(relPath);
        if let Err(e) = dataPaths::atomicWrite(&dst, file.data.as_ref()) {
            eprintln!("[init] 写入 {} 失败: {}", dst.display(), e);
            return false;
        }
    }
    true
}

pub fn embeddedTemplateBytes(rel: &str) -> Option<Vec<u8>> {
    EmbeddedDefaultSkin::get(rel).map(|f| f.data.into_owned())
}

fn backfillBaseSizes(skinRoot: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(skinRoot) else {
        return;
    };
    for entry in entries.flatten() {
        let dir = entry.path();
        if !dir.is_dir() || dir.join(baseSizes::BASE_SIZES_FILE).exists() {
            continue;
        }
        if let Err(e) = skinLoader::writeBaseSizesForSkin(&dir) {
            eprintln!(
                "[init] 生成 {}/baseSizes.json 失败: {}",
                dir.display(),
                e.message
            );
        }
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

pub fn runDesktop() {
    ensureInitialized();
    let api = Arc::new(CoreApi::new());
    let closeGuard = Arc::new(CloseGuard::default());
    let imageStore = Arc::new(imageStore::ImageStore::default());
    let pickActiveFlag = Arc::new(PickActiveFlag::default());
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(api)
        .manage(closeGuard.clone())
        .manage(imageStore.clone())
        .manage(pickActiveFlag)
        .on_window_event({
            let guard = closeGuard;
            let store = imageStore;
            move |window, event| {
                let label = window.label();
                if let Some(token) = label.strip_prefix("image_") {
                    if matches!(event, tauri::WindowEvent::Destroyed) {
                        store.remove(token);
                    }
                    return;
                }
                if label != "main" {
                    return;
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    let forced = *guard.forceClose.lock().unwrap_or_else(|e| e.into_inner());
                    if forced {
                        return;
                    }
                    api.prevent_close();
                    *guard
                        .closeRequested
                        .lock()
                        .unwrap_or_else(|e| e.into_inner()) = true;
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
            tauriCommands::api_discardPart,
            tauriCommands::api_applyBrush,
            tauriCommands::api_applyEraser,
            tauriCommands::api_applyGradient,
            tauriCommands::api_applyFill,
            tauriCommands::api_applySoftBrush,
            tauriCommands::api_undo,
            tauriCommands::api_redo,
            tauriCommands::api_beginStroke,
            tauriCommands::api_endStroke,
            tauriCommands::api_getFlatten,
            tauriCommands::api_getAssemblyTable,
            tauriCommands::api_savePart,
            tauriCommands::api_resizePart,
            tauriCommands::api_getBaseSize,
            tauriCommands::api_createSidePart,
            tauriCommands::api_createOrientationPart,
            tauriCommands::api_createPart,
            tauriCommands::api_copyPart,
            tauriCommands::api_createPartFromTemplate,
            tauriCommands::api_deletePart,
            tauriCommands::api_copyLayerToPart,
            tauriCommands::api_setLayerTransform,
            tauriCommands::api_bakeLayerTransform,
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
            tauriCommands::api_setAccessoryEnabled,
            tauriCommands::api_saveAccessoryConfig,
            tauriCommands::api_loadBloodConfig,
            tauriCommands::api_saveBloodConfig,
            tauriCommands::api_loadZones,
            tauriCommands::api_saveZones,
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
        .setup(|app| {
            createMainWindow(app)?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Tauri 桌面壳失败");
}

fn createMainWindow(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let url = tauri::WebviewUrl::App("index.html".into());
    let builder = tauri::WebviewWindowBuilder::new(app, "main", url)
        .title("CasualtiesUnknown-SkinEditor")
        .inner_size(1440.0, 900.0)
        .min_inner_size(1024.0, 640.0)
        .center();
    // Windows 下关闭 WebView2 原生拖放拦截，放行前端 HTML5 拖入图片。
    #[cfg(windows)]
    let builder = builder.drag_and_drop(false);
    builder.build()?;
    Ok(())
}

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
        assert!(dataPaths::skinDir("exp").join("Body").is_dir());
        assert!(dataPaths::skinDir("exp").join("Head").is_dir());
        assert!(dataPaths::skinDir("exp").join("Accessories").is_dir());
        assert!(dataPaths::skinDir("exp").join("Blood").is_dir());
        let (layout, _theme, _source) = windowManager::loadDefaultWorkspace();
        assert_eq!(layout.activeSkin.as_deref(), Some("exp"));
        assert!(!dataPaths::skinDir("default").exists());
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
    fn seedsExpWhenListSkinsWouldBeEmpty() {
        let _lock = dataPaths::appRootEnvLock();
        let tmp = TempDir::new();
        let _guard = EnvGuard::set(tmp.path());
        let skinRoot = dataPaths::dataDir().join("skin");
        assert!(skinLoader::listSkins(&skinRoot).is_empty());
        assert!(ensureEmbeddedDefaultSkin(&skinRoot));
        let names = skinLoader::listSkins(&skinRoot);
        assert_eq!(names, vec!["exp".to_string()]);
        assert!(skinRoot
            .join("exp")
            .join("Body")
            .join("experimentUpTorso.png")
            .is_file());
    }

    #[test]
    fn skipsDefaultSkeletonWhenSkinDirHasContent() {
        let _lock = dataPaths::appRootEnvLock();
        let tmp = TempDir::new();
        let _guard = EnvGuard::set(tmp.path());
        fs::create_dir_all(dataPaths::skinDir("st1").join("Body")).unwrap();
        ensureInitialized();
        assert!(!dataPaths::skinDir("exp").exists());
        assert!(!dataPaths::skinDir("default").exists());
        assert!(dataPaths::skinDir("st1").join("Body").is_dir());
    }

    #[test]
    fn backfillsBaseSizesForExistingSkin() {
        let _lock = dataPaths::appRootEnvLock();
        let tmp = TempDir::new();
        let _guard = EnvGuard::set(tmp.path());
        let skin = dataPaths::skinDir("oldSkin");
        let bodyDir = skin.join("Body");
        fs::create_dir_all(&bodyDir).unwrap();
        let pngPath = bodyDir.join("experimentUpTorso.png");
        image::RgbaImage::from_pixel(12, 18, image::Rgba([0, 0, 0, 255]))
            .save(&pngPath)
            .unwrap();
        ensureInitialized();
        let json = fs::read_to_string(skin.join("baseSizes.json"))
            .expect("baseSizes.json should be created");
        assert!(json.contains("\"entries\""));
        assert!(json.contains("\"Body/experimentUpTorso\": [12, 18]"));
    }

    #[test]
    fn backfillSkipsWhenBaseSizesAlreadyExists() {
        let _lock = dataPaths::appRootEnvLock();
        let tmp = TempDir::new();
        let _guard = EnvGuard::set(tmp.path());
        let skin = dataPaths::skinDir("oldSkin2");
        fs::create_dir_all(skin.join("Body")).unwrap();
        let existing = "{ \"manualOverride\": [99, 99] }";
        fs::write(skin.join("baseSizes.json"), existing).unwrap();
        ensureInitialized();
        let json = fs::read_to_string(skin.join("baseSizes.json")).unwrap();
        assert_eq!(json, existing);
    }
}
