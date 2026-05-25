// Axum HTTP 服务：REST API + 前端 build 产物（rust-embed 编译期嵌入）。
// handlers 仅做参数解码与错误码映射，业务委托给 apiLayer。
// 编译前必须先在 web/ 下执行 `npm run build` 产出 dist/。
#![allow(non_snake_case)]

use std::sync::Arc;

use axum::extract::{Query, State};
use axum::http::{header, StatusCode, Uri};
use axum::response::{IntoResponse, Json, Response};
use axum::routing::{get, post};
use axum::Router;

use crate::apiLayer::{
    AddLayerParams, ApiError, ApiLayer, AssemblyParams, AssemblyResult, BrushParams,
    CompositeParams, CompositeResult, CoreApi, EraserParams, ExportSkinPackParams,
    ExportSkinPackResult, GradientParams, ImportSkinPackParams, LayerOpacityParams, LayerVisibilityParams,
    LayersSnapshot, LoadPartParams, LoadPartResult, MotionCaptureListParams, MotionCaptureMeta,
    MotionCaptureResult, MotionCompositeParams, MotionCompositeResult, PartIdParams, PartsParams,
    RemoveLayerParams, ReorderLayersParams, SavePartParams, SaveWorkspaceParams,
    SetActiveLayerParams, SetAssemblyOverrideParams, SkinsParams, SaveWingsConfigParams,
    WingsConfig, WingsConfigPathParams, WorkspacePathParams,
    WorkspaceResult,
};
use crate::historyManager::PixelDiff;
use crate::skinLoader::Stage;
use crate::HttpConfig;

#[derive(rust_embed::Embed)]
#[folder = "../web/dist/"]
struct Frontend;

type SharedApi = Arc<CoreApi>;

pub async fn serve(config: HttpConfig, api: SharedApi) {
    let app = Router::new()
        .route("/api/skins", get(handleListSkins))
        .route("/api/parts", get(handleListParts))
        .route("/api/motionCaptures", get(handleListMotionCaptures))
        .route("/api/motionCapture", get(handleLoadMotionCapture))
        .route("/api/motionComposite", post(handleMotionComposite))
        .route("/api/loadPart", post(handleLoadPart))
        .route("/api/brush", post(handleBrush))
        .route("/api/eraser", post(handleEraser))
        .route("/api/gradient", post(handleGradient))
        .route("/api/undo", post(handleUndo))
        .route("/api/redo", post(handleRedo))
        .route("/api/strokeBegin", post(handleBeginStroke))
        .route("/api/strokeEnd", post(handleEndStroke))
        .route("/api/flatten", get(handleGetFlatten))
        .route("/api/assembly", get(handleAssembly))
        .route("/api/savePart", post(handleSavePart))
        .route("/api/layer/add", post(handleAddLayer))
        .route("/api/layer/remove", post(handleRemoveLayer))
        .route("/api/layer/visibility", post(handleSetLayerVisibility))
        .route("/api/layer/opacity", post(handleSetLayerOpacity))
        .route("/api/layer/reorder", post(handleReorderLayers))
        .route("/api/layer/active", post(handleSetActiveLayer))
        .route("/api/layers", get(handleGetLayers))
        .route("/api/composite", post(handleComposite))
        .route("/api/workspace", get(handleGetWorkspace).post(handleSaveWorkspace))
        .route("/api/workspace/reset", post(handleResetLayout))
        .route("/api/skinPack/export", post(handleExportSkinPack))
        .route("/api/skinPack/import", post(handleImportSkinPack))
        .route("/api/assembly/override", post(handleSetAssemblyOverride))
        .route("/api/wings", post(handleLoadWingsConfig))
        .route("/api/wings/save", post(handleSaveWingsConfig))
        .with_state(api)
        .fallback(handleStatic);

    let addr = config.socketAddr();
    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|e| panic!("绑定 {} 失败: {}", addr, e));

    println!("Skin Preview Editor HTTP server listening on http://{}", addr);
    axum::serve(listener, app)
        .await
        .expect("HTTP server 异常退出");
}

/// 嵌入资源中找不到对应路径时回退 index.html，对齐 SPA 路由行为。
async fn handleStatic(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    let key = if path.is_empty() { "index.html" } else { path };
    if let Some(file) = Frontend::get(key) {
        return ([(header::CONTENT_TYPE, mimeOf(key))], file.data.into_owned()).into_response();
    }
    match Frontend::get("index.html") {
        Some(file) => (
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            file.data.into_owned(),
        )
            .into_response(),
        None => (StatusCode::NOT_FOUND, "frontend bundle missing").into_response(),
    }
}

fn mimeOf(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

fn intoResponse<T: serde::Serialize>(result: Result<T, ApiError>) -> axum::response::Response {
    match result {
        Ok(value) => Json(value).into_response(),
        Err(err) => (statusFor(&err.code), Json(err)).into_response(),
    }
}

fn statusFor(code: &str) -> StatusCode {
    match code {
        "not_loaded" | "skin_not_found" | "layer_not_found" | "capture_not_found" => StatusCode::NOT_FOUND,
        "nothing_to_undo" | "nothing_to_redo" => StatusCode::CONFLICT,
        c if c.ends_with("_failed") || c == "lock_poisoned" => StatusCode::INTERNAL_SERVER_ERROR,
        _ => StatusCode::BAD_REQUEST,
    }
}

async fn handleListSkins(
    State(api): State<SharedApi>,
    Query(params): Query<SkinsParams>,
) -> axum::response::Response {
    let result: Result<Vec<String>, ApiError> = api.listSkins(params);
    intoResponse(result)
}

async fn handleListParts(
    State(api): State<SharedApi>,
    Query(params): Query<PartsParams>,
) -> axum::response::Response {
    let result: Result<Stage, ApiError> = api.listParts(params);
    intoResponse(result)
}

async fn handleListMotionCaptures(
    State(api): State<SharedApi>,
    Query(params): Query<MotionCaptureListParams>,
) -> axum::response::Response {
    let result: Result<Vec<MotionCaptureMeta>, ApiError> = api.listMotionCaptures(params);
    intoResponse(result)
}

#[derive(serde::Deserialize)]
struct MotionCapturePathQuery {
    path: String,
}

async fn handleLoadMotionCapture(
    State(api): State<SharedApi>,
    Query(params): Query<MotionCapturePathQuery>,
) -> axum::response::Response {
    let result: Result<MotionCaptureResult, ApiError> = api.loadMotionCapture(params.path);
    intoResponse(result)
}

async fn handleMotionComposite(
    State(api): State<SharedApi>,
    Json(params): Json<MotionCompositeParams>,
) -> axum::response::Response {
    let result: Result<MotionCompositeResult, ApiError> = api.getMotionCompositeImage(params);
    intoResponse(result)
}

async fn handleLoadPart(
    State(api): State<SharedApi>,
    Json(params): Json<LoadPartParams>,
) -> axum::response::Response {
    let result: Result<LoadPartResult, ApiError> = api.loadPartImage(params);
    intoResponse(result)
}

async fn handleBrush(
    State(api): State<SharedApi>,
    Json(params): Json<BrushParams>,
) -> axum::response::Response {
    let result: Result<PixelDiff, ApiError> = api.applyBrush(params);
    intoResponse(result)
}

async fn handleEraser(
    State(api): State<SharedApi>,
    Json(params): Json<EraserParams>,
) -> axum::response::Response {
    let result: Result<PixelDiff, ApiError> = api.applyEraser(params);
    intoResponse(result)
}

async fn handleGradient(
    State(api): State<SharedApi>,
    Json(params): Json<GradientParams>,
) -> axum::response::Response {
    let result: Result<PixelDiff, ApiError> = api.applyGradient(params);
    intoResponse(result)
}

async fn handleUndo(
    State(api): State<SharedApi>,
    Json(params): Json<PartIdParams>,
) -> axum::response::Response {
    let result: Result<PixelDiff, ApiError> = api.undo(params);
    intoResponse(result)
}

async fn handleRedo(
    State(api): State<SharedApi>,
    Json(params): Json<PartIdParams>,
) -> axum::response::Response {
    let result: Result<PixelDiff, ApiError> = api.redo(params);
    intoResponse(result)
}

async fn handleBeginStroke(
    State(api): State<SharedApi>,
    Json(params): Json<PartIdParams>,
) -> axum::response::Response {
    let result: Result<(), ApiError> = api.beginStroke(params);
    intoResponse(result)
}

async fn handleEndStroke(
    State(api): State<SharedApi>,
    Json(params): Json<PartIdParams>,
) -> axum::response::Response {
    let result: Result<PixelDiff, ApiError> = api.endStroke(params);
    intoResponse(result)
}

async fn handleGetFlatten(
    State(api): State<SharedApi>,
    Query(params): Query<PartIdParams>,
) -> axum::response::Response {
    let result: Result<LoadPartResult, ApiError> = api.getFlatten(params);
    intoResponse(result)
}

async fn handleAssembly(
    State(api): State<SharedApi>,
    Query(params): Query<AssemblyParams>,
) -> axum::response::Response {
    let result: Result<AssemblyResult, ApiError> = api.getAssemblyTable(params);
    intoResponse(result)
}

async fn handleSavePart(
    State(api): State<SharedApi>,
    Json(params): Json<SavePartParams>,
) -> axum::response::Response {
    let result: Result<(), ApiError> = api.savePart(params);
    intoResponse(result)
}

async fn handleAddLayer(
    State(api): State<SharedApi>,
    Json(params): Json<AddLayerParams>,
) -> axum::response::Response {
    let result: Result<LayersSnapshot, ApiError> = api.addLayer(params);
    intoResponse(result)
}

async fn handleRemoveLayer(
    State(api): State<SharedApi>,
    Json(params): Json<RemoveLayerParams>,
) -> axum::response::Response {
    let result: Result<LayersSnapshot, ApiError> = api.removeLayer(params);
    intoResponse(result)
}

async fn handleSetLayerVisibility(
    State(api): State<SharedApi>,
    Json(params): Json<LayerVisibilityParams>,
) -> axum::response::Response {
    let result: Result<LayersSnapshot, ApiError> = api.setLayerVisibility(params);
    intoResponse(result)
}

async fn handleSetLayerOpacity(
    State(api): State<SharedApi>,
    Json(params): Json<LayerOpacityParams>,
) -> axum::response::Response {
    let result: Result<LayersSnapshot, ApiError> = api.setLayerOpacity(params);
    intoResponse(result)
}

async fn handleReorderLayers(
    State(api): State<SharedApi>,
    Json(params): Json<ReorderLayersParams>,
) -> axum::response::Response {
    let result: Result<LayersSnapshot, ApiError> = api.reorderLayers(params);
    intoResponse(result)
}

async fn handleSetActiveLayer(
    State(api): State<SharedApi>,
    Json(params): Json<SetActiveLayerParams>,
) -> axum::response::Response {
    let result: Result<LayersSnapshot, ApiError> = api.setActiveLayer(params);
    intoResponse(result)
}

async fn handleGetLayers(
    State(api): State<SharedApi>,
    Query(params): Query<PartIdParams>,
) -> axum::response::Response {
    let result: Result<LayersSnapshot, ApiError> = api.getLayers(params);
    intoResponse(result)
}

async fn handleComposite(
    State(api): State<SharedApi>,
    Json(params): Json<CompositeParams>,
) -> axum::response::Response {
    let result: Result<CompositeResult, ApiError> = api.getCompositeImage(params);
    intoResponse(result)
}

async fn handleGetWorkspace(
    State(api): State<SharedApi>,
    Query(params): Query<WorkspacePathParams>,
) -> axum::response::Response {
    let result: Result<WorkspaceResult, ApiError> = api.getWorkspace(params);
    intoResponse(result)
}

async fn handleSaveWorkspace(
    State(api): State<SharedApi>,
    Json(params): Json<SaveWorkspaceParams>,
) -> axum::response::Response {
    let result: Result<(), ApiError> = api.saveWorkspace(params);
    intoResponse(result)
}

async fn handleResetLayout(State(api): State<SharedApi>) -> axum::response::Response {
    let result: Result<WorkspaceResult, ApiError> = api.resetLayout();
    intoResponse(result)
}

async fn handleExportSkinPack(
    State(api): State<SharedApi>,
    Json(params): Json<ExportSkinPackParams>,
) -> axum::response::Response {
    let result: Result<ExportSkinPackResult, ApiError> = api.exportSkinPack(params);
    intoResponse(result)
}

async fn handleImportSkinPack(
    State(api): State<SharedApi>,
    Json(params): Json<ImportSkinPackParams>,
) -> axum::response::Response {
    let result: Result<crate::skinLoader::ImportResult, ApiError> = api.importSkinPack(params);
    intoResponse(result)
}

async fn handleSetAssemblyOverride(
    State(api): State<SharedApi>,
    Json(params): Json<SetAssemblyOverrideParams>,
) -> axum::response::Response {
    let result: Result<(), ApiError> = api.setAssemblyOverride(params);
    intoResponse(result)
}

async fn handleLoadWingsConfig(
    State(api): State<SharedApi>,
    Json(params): Json<WingsConfigPathParams>,
) -> axum::response::Response {
    let result: Result<WingsConfig, ApiError> = api.loadWingsConfig(params);
    intoResponse(result)
}

async fn handleSaveWingsConfig(
    State(api): State<SharedApi>,
    Json(params): Json<SaveWingsConfigParams>,
) -> axum::response::Response {
    let result: Result<(), ApiError> = api.saveWingsConfig(params);
    intoResponse(result)
}
