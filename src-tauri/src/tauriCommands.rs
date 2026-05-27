// 把 apiLayer 的调用包装为 #[tauri::command]，与 httpServer handlers 对称。
// Tauri 内部以 snake_case 路由 command 名，所以函数本身用 snake_case；
// 业务实现完全委托给 apiLayer，本模块只做参数解码与错误转字符串。
#![allow(non_snake_case)]

use std::sync::Arc;

use tauri::State;

use crate::apiLayer::{
    AddLayerParams, ApiError, ApiLayer, AssemblyParams, AssemblyResult, BrushParams,
    CompositeParams, CompositeResult, CoreApi, EraserParams, ExportSkinPackParams,
    ExportSkinPackResult, GradientParams, ImportSkinPackParams, LayerOpacityParams, LayerVisibilityParams,
    LayersSnapshot, LoadPartParams, LoadPartResult, MotionCaptureListParams, MotionCaptureMeta,
    MotionCaptureResult, MotionCompositeParams, MotionCompositeResult, PartIdParams, PartsParams,
    RemoveLayerParams, ReorderLayersParams, ResizePartParams, ResizePartResult, SavePartParams, SaveWorkspaceParams,
    CreateSidePartParams, CreateSidePartResult,
    SetActiveLayerParams, SetAssemblyOverrideParams, SetAccessoryEnabledParams, SaveAccessoryConfigParams, LoadZonesParams, LoadZonesResult, SaveZonesParams, SkinsParams, SaveWingsConfigParams,
    BloodConfigPathParams, SaveBloodConfigParams,
    WingsConfig, WingsConfigPathParams, WorkspacePathParams,
    WorkspaceResult,
};
use crate::historyManager::PixelDiff;
use crate::skinLoader::{ImportResult, Stage};

type SharedApi = Arc<CoreApi>;

fn toErrString(err: ApiError) -> String {
    serde_json::to_string(&err).unwrap_or_else(|_| err.message)
}

#[tauri::command]
pub fn api_listSkins(api: State<'_, SharedApi>, params: SkinsParams) -> Result<Vec<String>, String> {
    api.listSkins(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_listParts(api: State<'_, SharedApi>, params: PartsParams) -> Result<Stage, String> {
    api.listParts(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_loadPartImage(
    api: State<'_, SharedApi>,
    params: LoadPartParams,
) -> Result<LoadPartResult, String> {
    api.loadPartImage(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_listMotionCaptures(
    api: State<'_, SharedApi>,
    params: MotionCaptureListParams,
) -> Result<Vec<MotionCaptureMeta>, String> {
    api.listMotionCaptures(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_loadMotionCapture(
    api: State<'_, SharedApi>,
    path: String,
) -> Result<MotionCaptureResult, String> {
    api.loadMotionCapture(path).map_err(toErrString)
}

#[tauri::command]
pub fn api_getMotionCompositeImage(
    api: State<'_, SharedApi>,
    params: MotionCompositeParams,
) -> Result<MotionCompositeResult, String> {
    api.getMotionCompositeImage(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_applyBrush(api: State<'_, SharedApi>, params: BrushParams) -> Result<PixelDiff, String> {
    api.applyBrush(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_applyEraser(
    api: State<'_, SharedApi>,
    params: EraserParams,
) -> Result<PixelDiff, String> {
    api.applyEraser(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_applyGradient(
    api: State<'_, SharedApi>,
    params: GradientParams,
) -> Result<PixelDiff, String> {
    api.applyGradient(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_undo(api: State<'_, SharedApi>, params: PartIdParams) -> Result<PixelDiff, String> {
    api.undo(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_redo(api: State<'_, SharedApi>, params: PartIdParams) -> Result<PixelDiff, String> {
    api.redo(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_beginStroke(api: State<'_, SharedApi>, params: PartIdParams) -> Result<(), String> {
    api.beginStroke(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_endStroke(
    api: State<'_, SharedApi>,
    params: PartIdParams,
) -> Result<PixelDiff, String> {
    api.endStroke(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_getFlatten(
    api: State<'_, SharedApi>,
    params: PartIdParams,
) -> Result<crate::apiLayer::LoadPartResult, String> {
    api.getFlatten(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_getAssemblyTable(
    api: State<'_, SharedApi>,
    params: AssemblyParams,
) -> Result<AssemblyResult, String> {
    api.getAssemblyTable(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_savePart(api: State<'_, SharedApi>, params: SavePartParams) -> Result<(), String> {
    api.savePart(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_resizePart(
    api: State<'_, SharedApi>,
    params: ResizePartParams,
) -> Result<ResizePartResult, String> {
    api.resizePart(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_createSidePart(
    api: State<'_, SharedApi>,
    params: CreateSidePartParams,
) -> Result<CreateSidePartResult, String> {
    api.createSidePart(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_addLayer(
    api: State<'_, SharedApi>,
    params: AddLayerParams,
) -> Result<LayersSnapshot, String> {
    api.addLayer(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_removeLayer(
    api: State<'_, SharedApi>,
    params: RemoveLayerParams,
) -> Result<LayersSnapshot, String> {
    api.removeLayer(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_setLayerVisibility(
    api: State<'_, SharedApi>,
    params: LayerVisibilityParams,
) -> Result<LayersSnapshot, String> {
    api.setLayerVisibility(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_setLayerOpacity(
    api: State<'_, SharedApi>,
    params: LayerOpacityParams,
) -> Result<LayersSnapshot, String> {
    api.setLayerOpacity(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_reorderLayers(
    api: State<'_, SharedApi>,
    params: ReorderLayersParams,
) -> Result<LayersSnapshot, String> {
    api.reorderLayers(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_setActiveLayer(
    api: State<'_, SharedApi>,
    params: SetActiveLayerParams,
) -> Result<LayersSnapshot, String> {
    api.setActiveLayer(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_getLayers(
    api: State<'_, SharedApi>,
    params: PartIdParams,
) -> Result<LayersSnapshot, String> {
    api.getLayers(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_getCompositeImage(
    api: State<'_, SharedApi>,
    params: CompositeParams,
) -> Result<CompositeResult, String> {
    api.getCompositeImage(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_getWorkspace(
    api: State<'_, SharedApi>,
    params: WorkspacePathParams,
) -> Result<WorkspaceResult, String> {
    api.getWorkspace(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_saveWorkspace(
    api: State<'_, SharedApi>,
    params: SaveWorkspaceParams,
) -> Result<(), String> {
    api.saveWorkspace(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_resetLayout(api: State<'_, SharedApi>) -> Result<WorkspaceResult, String> {
    api.resetLayout().map_err(toErrString)
}

#[tauri::command]
pub fn api_exportSkinPack(
    api: State<'_, SharedApi>,
    params: ExportSkinPackParams,
) -> Result<ExportSkinPackResult, String> {
    api.exportSkinPack(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_importSkinPack(
    api: State<'_, SharedApi>,
    params: ImportSkinPackParams,
) -> Result<ImportResult, String> {
    api.importSkinPack(params).map_err(toErrString)
}

/// 跨窗口关闭命令。Tauri v2 的 plugin:window|close 默认对当前窗口操作，
/// 不支持传 label，所以通过 AppHandle 自定义命令路由到指定子窗口。
#[tauri::command]
pub fn api_closeSubwindow(app: tauri::AppHandle, label: String) -> Result<(), String> {
    use tauri::Manager;
    match app.get_webview_window(&label) {
        Some(w) => w.close().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

/// 装配位置覆盖。预览拖动选中部件时调用，运行时改 entry.position（不持久化）。
#[tauri::command]
pub fn api_setAssemblyOverride(
    api: State<'_, SharedApi>,
    params: SetAssemblyOverrideParams,
) -> Result<(), String> {
    api.setAssemblyOverride(params).map_err(toErrString)
}

/// 加载单皮肤翼装配配置 wings.json；不存在时回落默认值。
#[tauri::command]
pub fn api_loadWingsConfig(
    api: State<'_, SharedApi>,
    params: WingsConfigPathParams,
) -> Result<WingsConfig, String> {
    api.loadWingsConfig(params).map_err(toErrString)
}

/// 保存单皮肤翼装配配置到 <skin>/wings.json。
#[tauri::command]
pub fn api_saveWingsConfig(
    api: State<'_, SharedApi>,
    params: SaveWingsConfigParams,
) -> Result<(), String> {
    api.saveWingsConfig(params).map_err(toErrString)
}

/// 切换单皮肤指定 id 配件的 enabled 字段并落盘 accessories.json。
#[tauri::command]
pub fn api_setAccessoryEnabled(
    api: State<'_, SharedApi>,
    params: SetAccessoryEnabledParams,
) -> Result<(), String> {
    api.setAccessoryEnabled(params).map_err(toErrString)
}

/// 写整条配件配置；entry.id 已存在则原位替换，否则追加。
#[tauri::command]
pub fn api_saveAccessoryConfig(
    api: State<'_, SharedApi>,
    params: SaveAccessoryConfigParams,
) -> Result<(), String> {
    api.saveAccessoryConfig(params).map_err(toErrString)
}

/// 读 per-skin blood.json；缺失返回全 None 默认。
#[tauri::command]
pub fn api_loadBloodConfig(
    api: State<'_, SharedApi>,
    params: BloodConfigPathParams,
) -> Result<crate::blood::BloodConfig, String> {
    api.loadBloodConfig(params).map_err(toErrString)
}

/// 整体覆写 blood.json。
#[tauri::command]
pub fn api_saveBloodConfig(
    api: State<'_, SharedApi>,
    params: SaveBloodConfigParams,
) -> Result<(), String> {
    api.saveBloodConfig(params).map_err(toErrString)
}

/// 加载部件区块 mask + 配置；缺失返回零 ids 与空 zones。
#[tauri::command]
pub fn api_loadZones(
    api: State<'_, SharedApi>,
    params: LoadZonesParams,
) -> Result<LoadZonesResult, String> {
    api.loadZones(params).map_err(toErrString)
}

/// 写整张 mask + 整份 config。
#[tauri::command]
pub fn api_saveZones(
    api: State<'_, SharedApi>,
    params: SaveZonesParams,
) -> Result<(), String> {
    api.saveZones(params).map_err(toErrString)
}

/// 关闭拦截轮询。前端按 ~250ms 间隔读，返回 true 表示用户点过 X 触发了
/// prevent_close。读取后立即清零防止重复触发。
#[tauri::command]
pub fn api_pollCloseRequest(
    guard: State<'_, std::sync::Arc<crate::CloseGuard>>,
) -> Result<bool, String> {
    let mut flag = guard.closeRequested.lock().unwrap();
    let cur = *flag;
    *flag = false;
    Ok(cur)
}

/// 用户在确认对话框选"丢弃 / 保存后退出"后调用：置 forceClose 让
/// on_window_event 不再 prevent_close，并主动关窗。
#[tauri::command]
pub fn api_confirmCloseMain(
    app: tauri::AppHandle,
    guard: State<'_, std::sync::Arc<crate::CloseGuard>>,
) -> Result<(), String> {
    use tauri::Manager;
    *guard.forceClose.lock().unwrap() = true;
    if let Some(w) = app.get_webview_window("main") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 主窗口拖入图片时调用：解码 base64 → RGBA → 存进进程级 imageStore。
/// 子窗口启动后用同 token 取回字节渲染。
#[tauri::command]
pub fn api_storeImage(
    store: State<'_, std::sync::Arc<crate::imageStore::ImageStore>>,
    params: StoreImageParams,
) -> Result<(), String> {
    let bytes = base64Decode(&params.base64Data).map_err(|e| format!("base64 decode: {}", e))?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("decode image: {}", e))?;
    let rgba = img.to_rgba8();
    let (width, height) = (rgba.width(), rgba.height());
    store.put(
        params.token,
        crate::imageStore::StoredImage {
            width,
            height,
            pixels: rgba.into_raw(),
        },
    );
    Ok(())
}

/// 图片子窗口启动时按 token 取回 RGBA + 尺寸渲染。
#[tauri::command]
pub fn api_loadImage(
    store: State<'_, std::sync::Arc<crate::imageStore::ImageStore>>,
    params: LoadImageParams,
) -> Result<LoadImageResult, String> {
    match store.get(&params.token) {
        Some((width, height, pixels)) => Ok(LoadImageResult {
            width,
            height,
            pixels,
        }),
        None => Err("image_not_found".into()),
    }
}

/// 子窗口关闭时清掉 token 的字节缓存。
#[tauri::command]
pub fn api_releaseImage(
    store: State<'_, std::sync::Arc<crate::imageStore::ImageStore>>,
    params: LoadImageParams,
) -> Result<(), String> {
    store.remove(&params.token);
    Ok(())
}

/// 取色器调用：传屏幕坐标，遍历所有 `image_*` 子窗口找命中者，按 contain
/// 缩放映射到图片像素后取色。返回 None 表示坐标不在任何图片子窗口内。
#[tauri::command]
pub fn api_pickImagePixelByScreenCoord(
    app: tauri::AppHandle,
    store: State<'_, std::sync::Arc<crate::imageStore::ImageStore>>,
    params: PickPixelParams,
) -> Result<Option<[u8; 3]>, String> {
    use tauri::Manager;
    for (label, win) in app.webview_windows() {
        if !label.starts_with("image_") {
            continue;
        }
        let token = label.trim_start_matches("image_").to_string();
        let pos = win.outer_position().map_err(|e| e.to_string())?;
        let size = win.outer_size().map_err(|e| e.to_string())?;
        let inner_size = win.inner_size().map_err(|e| e.to_string())?;
        // 屏幕坐标转 inner（客户区）：装饰厚度 = outer - inner。
        let offsetX = params.screenX as i32 - pos.x;
        let offsetY = params.screenY as i32 - pos.y;
        if offsetX < 0
            || offsetY < 0
            || offsetX >= size.width as i32
            || offsetY >= size.height as i32
        {
            continue;
        }
        let chromeY = (size.height as i32) - (inner_size.height as i32);
        let chromeX = ((size.width as i32) - (inner_size.width as i32)) / 2;
        let clientX = offsetX - chromeX;
        let clientY = offsetY - chromeY;
        if clientX < 0
            || clientY < 0
            || clientX >= inner_size.width as i32
            || clientY >= inner_size.height as i32
        {
            continue;
        }
        // 减去前端写死的 toolbar 高度（约 28px），再按 contain 算图片像素坐标。
        let toolbarH = params.toolbarHeight as i32;
        let stageY = clientY - toolbarH;
        if stageY < 0 {
            continue;
        }
        let stageH = (inner_size.height as i32) - toolbarH;
        if stageH <= 0 {
            continue;
        }
        let stageW = inner_size.width as i32;

        let (imgW, imgH) = match store.get(&token) {
            Some((w, h, _)) => (w as i32, h as i32),
            None => continue,
        };
        if imgW <= 0 || imgH <= 0 {
            continue;
        }
        let scale = (stageW as f64 / imgW as f64).min(stageH as f64 / imgH as f64);
        let drawW = (imgW as f64 * scale) as i32;
        let drawH = (imgH as f64 * scale) as i32;
        let drawX = (stageW - drawW) / 2;
        let drawY = (stageH - drawH) / 2;
        let dx = clientX - drawX;
        let dy = stageY - drawY;
        if dx < 0 || dy < 0 || dx >= drawW || dy >= drawH {
            continue;
        }
        let imgX = ((dx as f64 / drawW as f64) * imgW as f64) as u32;
        let imgY = ((dy as f64 / drawH as f64) * imgH as f64) as u32;
        if let Some(rgb) = store.pickPixel(&token, imgX, imgY) {
            return Ok(Some(rgb));
        }
    }
    Ok(None)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoreImageParams {
    pub token: String,
    pub base64Data: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadImageParams {
    pub token: String,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadImageResult {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PickPixelParams {
    pub screenX: i32,
    pub screenY: i32,
    pub toolbarHeight: u32,
}

fn base64Decode(s: &str) -> Result<Vec<u8>, String> {
    // 跳过 dataURL 前缀 `data:...;base64,`。
    let body = if let Some(i) = s.find(',') {
        &s[i + 1..]
    } else {
        s
    };
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(body.as_bytes())
        .map_err(|e| e.to_string())
}

/// 屏幕坐标系下当前光标位置。前端取色笔轮询本接口解决"鼠标移出主窗口
/// 后浏览器 mousemove 不再触发"的问题。
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorPos {
    pub x: i32,
    pub y: i32,
}

#[cfg(windows)]
#[tauri::command]
pub fn api_getCursorScreenPos() -> Result<CursorPos, String> {
    use windows_sys::Win32::Foundation::POINT;
    use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let mut pt = POINT { x: 0, y: 0 };
    let ok = unsafe { GetCursorPos(&mut pt) };
    if ok == 0 {
        return Err("GetCursorPos failed".into());
    }
    Ok(CursorPos { x: pt.x, y: pt.y })
}

#[cfg(not(windows))]
#[tauri::command]
pub fn api_getCursorScreenPos() -> Result<CursorPos, String> {
    Err("not_supported_on_this_platform".into())
}

/// 鼠标左键按下检测。前端取色笔轮询，未按 → 按下边沿即视为确认取色。
#[cfg(windows)]
#[tauri::command]
pub fn api_isMouseLeftDown() -> Result<bool, String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    const VK_LBUTTON: i32 = 0x01;
    let s = unsafe { GetAsyncKeyState(VK_LBUTTON) };
    // 高位 0x8000 为 1 表示当前按下。
    Ok((s as u16 & 0x8000) != 0)
}

#[cfg(not(windows))]
#[tauri::command]
pub fn api_isMouseLeftDown() -> Result<bool, String> {
    Ok(false)
}

/// 取色态全局 flag。主窗口启停时写入，图片子窗口轮询读取以同步光标样式。
#[tauri::command]
pub fn api_setPickActive(
    flag: State<'_, std::sync::Arc<crate::PickActiveFlag>>,
    active: bool,
) -> Result<(), String> {
    *flag.0.lock().unwrap() = active;
    Ok(())
}

#[tauri::command]
pub fn api_isPickActive(
    flag: State<'_, std::sync::Arc<crate::PickActiveFlag>>,
) -> Result<bool, String> {
    Ok(*flag.0.lock().unwrap())
}
