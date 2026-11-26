// Tauri 命令适配层：转发 `apiLayer` 业务调用，并提供桌面子窗口控制与跨窗口高分屏取色支持。
#![allow(non_snake_case)]

use std::sync::Arc;

use tauri::State;

use crate::apiLayer::{
    AddLayerParams, ApiError, ApiLayer, AssemblyParams, AssemblyResult, BloodConfigPathParams,
    BrushParams, CompositeParams, CompositeResult, CopyLayerToPartParams, CopyPartParams, CoreApi,
    CreateOrientationPartParams, CreateOrientationPartResult, CreatePartFromTemplateParams,
    CreatePartParams, CreatePartResult, CreateSidePartParams, CreateSidePartResult,
    DeletePartParams, EraserParams, ExportSkinPackParams, ExportSkinPackResult, FillParams,
    GetBaseSizeParams, GetBaseSizeResult, GradientParams, ImportSkinPackParams, LayerOpacityParams,
    LayerVisibilityParams, LayersSnapshot, LoadPartParams, LoadPartResult, LoadZonesParams,
    LoadZonesResult, MotionCaptureListParams, MotionCaptureMeta, MotionCaptureResult,
    MotionCompositeParams, MotionCompositeResult, PartIdParams, PartsParams, RemoveLayerParams,
    ReorderLayersParams, ResizeCanvasParams, ResizeCanvasResult, ResizePartParams,
    ResizePartResult, SaveAccessoryConfigParams,
    SaveBloodConfigParams, SavePartParams, SaveWingsConfigParams, SaveWorkspaceParams,
    SaveZonesParams, SetAccessoryEnabledParams, SetActiveLayerParams, SetAssemblyOverrideParams,
    SetLayerTransformParams, SkinsParams, SoftBrushParams, WingsConfig, WingsConfigPathParams,
    WorkspacePathParams, WorkspaceResult,
};
use crate::historyManager::PixelDiff;
use crate::skinLoader::{ImportResult, Stage};

type SharedApi = Arc<CoreApi>;

fn toErrString(err: ApiError) -> String {
    serde_json::to_string(&err).unwrap_or_else(|_| err.message)
}

#[tauri::command]
pub fn api_listSkins(
    api: State<'_, SharedApi>,
    params: SkinsParams,
) -> Result<Vec<String>, String> {
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
pub fn api_discardPart(api: State<'_, SharedApi>, params: PartIdParams) -> Result<(), String> {
    api.discardPart(params).map_err(toErrString)
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
pub fn api_applyFill(api: State<'_, SharedApi>, params: FillParams) -> Result<PixelDiff, String> {
    api.applyFill(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_applySoftBrush(
    api: State<'_, SharedApi>,
    params: SoftBrushParams,
) -> Result<PixelDiff, String> {
    api.applySoftBrush(params).map_err(toErrString)
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
pub fn api_endStroke(api: State<'_, SharedApi>, params: PartIdParams) -> Result<PixelDiff, String> {
    api.endStroke(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_getFlatten(
    api: State<'_, SharedApi>,
    params: PartIdParams,
) -> Result<LoadPartResult, String> {
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
pub fn api_resizeCanvas(
    api: State<'_, SharedApi>,
    params: ResizeCanvasParams,
) -> Result<ResizeCanvasResult, String> {
    api.resizeCanvas(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_getBaseSize(
    api: State<'_, SharedApi>,
    params: GetBaseSizeParams,
) -> Result<GetBaseSizeResult, String> {
    api.getBaseSize(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_createSidePart(
    api: State<'_, SharedApi>,
    params: CreateSidePartParams,
) -> Result<CreateSidePartResult, String> {
    api.createSidePart(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_createOrientationPart(
    api: State<'_, SharedApi>,
    params: CreateOrientationPartParams,
) -> Result<CreateOrientationPartResult, String> {
    api.createOrientationPart(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_createPart(
    api: State<'_, SharedApi>,
    params: CreatePartParams,
) -> Result<CreatePartResult, String> {
    api.createPart(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_copyPart(
    api: State<'_, SharedApi>,
    params: CopyPartParams,
) -> Result<CreatePartResult, String> {
    api.copyPart(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_createPartFromTemplate(
    api: State<'_, SharedApi>,
    params: CreatePartFromTemplateParams,
) -> Result<CreatePartResult, String> {
    api.createPartFromTemplate(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_deletePart(api: State<'_, SharedApi>, params: DeletePartParams) -> Result<(), String> {
    api.deletePart(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_copyLayerToPart(
    api: State<'_, SharedApi>,
    params: CopyLayerToPartParams,
) -> Result<LayersSnapshot, String> {
    api.copyLayerToPart(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_setLayerTransform(
    api: State<'_, SharedApi>,
    params: SetLayerTransformParams,
) -> Result<(), String> {
    api.setLayerTransform(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_bakeLayerTransform(
    api: State<'_, SharedApi>,
    params: RemoveLayerParams,
) -> Result<PixelDiff, String> {
    api.bakeLayerTransform(params).map_err(toErrString)
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

/// 关闭指定 `label` 的独立面板或参考图子窗口。
#[tauri::command]
pub fn api_closeSubwindow(app: tauri::AppHandle, label: String) -> Result<(), String> {
    use tauri::Manager;
    match app.get_webview_window(&label) {
        Some(w) => w.close().map_err(|e| e.to_string()),
        None => Ok(()),
    }
}

#[tauri::command]
pub fn api_setAssemblyOverride(
    api: State<'_, SharedApi>,
    params: SetAssemblyOverrideParams,
) -> Result<(), String> {
    api.setAssemblyOverride(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_loadWingsConfig(
    api: State<'_, SharedApi>,
    params: WingsConfigPathParams,
) -> Result<WingsConfig, String> {
    api.loadWingsConfig(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_saveWingsConfig(
    api: State<'_, SharedApi>,
    params: SaveWingsConfigParams,
) -> Result<(), String> {
    api.saveWingsConfig(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_setAccessoryEnabled(
    api: State<'_, SharedApi>,
    params: SetAccessoryEnabledParams,
) -> Result<(), String> {
    api.setAccessoryEnabled(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_saveAccessoryConfig(
    api: State<'_, SharedApi>,
    params: SaveAccessoryConfigParams,
) -> Result<(), String> {
    api.saveAccessoryConfig(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_loadBloodConfig(
    api: State<'_, SharedApi>,
    params: BloodConfigPathParams,
) -> Result<crate::blood::BloodConfig, String> {
    api.loadBloodConfig(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_saveBloodConfig(
    api: State<'_, SharedApi>,
    params: SaveBloodConfigParams,
) -> Result<(), String> {
    api.saveBloodConfig(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_loadZones(
    api: State<'_, SharedApi>,
    params: LoadZonesParams,
) -> Result<LoadZonesResult, String> {
    api.loadZones(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_saveZones(api: State<'_, SharedApi>, params: SaveZonesParams) -> Result<(), String> {
    api.saveZones(params).map_err(toErrString)
}

#[tauri::command]
pub fn api_pollCloseRequest(guard: State<'_, Arc<crate::CloseGuard>>) -> Result<bool, String> {
    let mut flag = guard
        .closeRequested
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let cur = *flag;
    *flag = false;
    Ok(cur)
}

#[tauri::command]
pub fn api_confirmCloseMain(
    app: tauri::AppHandle,
    guard: State<'_, Arc<crate::CloseGuard>>,
) -> Result<(), String> {
    use tauri::Manager;
    *guard.forceClose.lock().unwrap_or_else(|e| e.into_inner()) = true;
    if let Some(w) = app.get_webview_window("main") {
        w.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn api_storeImage(
    store: State<'_, Arc<crate::imageStore::ImageStore>>,
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

#[tauri::command]
pub fn api_loadImage(
    store: State<'_, Arc<crate::imageStore::ImageStore>>,
    params: LoadImageParams,
) -> Result<LoadImageResult, String> {
    match store.get(&params.token) {
        Some((width, height, pixels)) => Ok(LoadImageResult {
            width,
            height,
            pixels,
        }),
        None => Err(toErrString(ApiError {
            code: "image_not_found".into(),
            message: "image data not found".into(),
        })),
    }
}

#[tauri::command]
pub fn api_releaseImage(
    store: State<'_, Arc<crate::imageStore::ImageStore>>,
    params: LoadImageParams,
) -> Result<(), String> {
    store.remove(&params.token);
    Ok(())
}

/// 按物理屏幕坐标命中可见的 `image_<token>` 子窗口客户区，换算 DPI 顶栏高度与 contain 缩放后采样原图像素。
#[tauri::command]
pub fn api_pickImagePixelByScreenCoord(
    app: tauri::AppHandle,
    store: State<'_, Arc<crate::imageStore::ImageStore>>,
    params: PickPixelParams,
) -> Result<Option<[u8; 3]>, String> {
    use tauri::Manager;
    for (label, win) in app.webview_windows() {
        let Some(token) = label.strip_prefix("image_") else {
            continue;
        };
        if win.is_minimized().unwrap_or(false) || !win.is_visible().unwrap_or(true) {
            continue;
        }
        let innerPos = match win.inner_position() {
            Ok(p) => p,
            Err(_) => continue,
        };
        let innerSize = match win.inner_size() {
            Ok(s) => s,
            Err(_) => continue,
        };
        let clientX = params.screenX - innerPos.x;
        let clientY = params.screenY - innerPos.y;
        if clientX < 0
            || clientY < 0
            || clientX >= innerSize.width as i32
            || clientY >= innerSize.height as i32
        {
            continue;
        }
        let scaleFactor = win.scale_factor().unwrap_or(1.0);
        let toolbarH = ((params.toolbarHeight as f64) * scaleFactor).round() as i32;
        let stageY = clientY - toolbarH;
        let stageH = (innerSize.height as i32) - toolbarH;
        let stageW = innerSize.width as i32;
        if stageY < 0 || stageH <= 0 || stageW <= 0 {
            continue;
        }

        let Some((imgWU, imgHU)) = store.dimensions(token) else {
            continue;
        };
        let (imgW, imgH) = (imgWU as i32, imgHU as i32);
        if imgW <= 0 || imgH <= 0 {
            continue;
        }
        let scale = (stageW as f64 / imgW as f64).min(stageH as f64 / imgH as f64);
        let drawW = (imgW as f64 * scale).round() as i32;
        let drawH = (imgH as f64 * scale).round() as i32;
        if drawW <= 0 || drawH <= 0 {
            continue;
        }
        let drawX = (stageW - drawW) / 2;
        let drawY = (stageH - drawH) / 2;
        let dx = clientX - drawX;
        let dy = stageY - drawY;
        if dx < 0 || dy < 0 || dx >= drawW || dy >= drawH {
            continue;
        }
        let imgX = ((dx as f64 / drawW as f64) * imgW as f64) as u32;
        let imgY = ((dy as f64 / drawH as f64) * imgH as f64) as u32;
        if let Some(rgb) = store.pickPixel(token, imgX, imgY) {
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
    let body = match s.find(',') {
        Some(i) => &s[i + 1..],
        None => s,
    };
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(body.as_bytes())
        .map_err(|e| e.to_string())
}

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
    if unsafe { GetCursorPos(&mut pt) } == 0 {
        return Err("GetCursorPos failed".into());
    }
    Ok(CursorPos { x: pt.x, y: pt.y })
}

#[cfg(not(windows))]
#[tauri::command]
pub fn api_getCursorScreenPos() -> Result<CursorPos, String> {
    Err("not_supported_on_this_platform".into())
}

#[cfg(windows)]
#[tauri::command]
pub fn api_isMouseLeftDown() -> Result<bool, String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState;
    const VK_LBUTTON: i32 = 0x01;
    let s = unsafe { GetAsyncKeyState(VK_LBUTTON) };
    Ok((s as u16 & 0x8000) != 0)
}

#[cfg(not(windows))]
#[tauri::command]
pub fn api_isMouseLeftDown() -> Result<bool, String> {
    Ok(false)
}

#[tauri::command]
pub fn api_setPickActive(
    flag: State<'_, Arc<crate::PickActiveFlag>>,
    active: bool,
) -> Result<(), String> {
    *flag.0.lock().unwrap_or_else(|e| e.into_inner()) = active;
    Ok(())
}

#[tauri::command]
pub fn api_isPickActive(flag: State<'_, Arc<crate::PickActiveFlag>>) -> Result<bool, String> {
    Ok(*flag.0.lock().unwrap_or_else(|e| e.into_inner()))
}
