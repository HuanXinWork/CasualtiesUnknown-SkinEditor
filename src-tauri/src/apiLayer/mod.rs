// 桌面（Tauri commands）与 HTTP（Axum handlers）共用的业务接口抽象层。
// 暴露所有运行时调用并统一入参出参，让两种形态的适配层只承担参数解码、错误转换与响应序列化。
#![allow(non_snake_case)]

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::assemblyTable::{
    self, AssemblyEntry, AssemblyPosition, AssemblySource, AssemblyTable, AssemblyVariants, HeadVariant, Orientation,
};
use crate::historyManager::{self, HistoryEntry, HistoryStack, PixelDiff};
use crate::imageOps::{self, Layer, PartEditState};
use crate::layerSidecar;
use crate::skinLoader::{self, ImportResult, PartCategory, Stage};
use crate::windowManager::{self, ThemeConfig, WorkspaceLayout, WorkspaceSource};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

/// 皮肤枚举入参，对应 `skinLoader::listSkins`。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkinsParams {
    pub skinRoot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartsParams {
    pub skinRoot: String,
    pub skinName: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadPartParams {
    pub skinRoot: String,
    pub skinName: String,
    pub category: PartCategory,
    pub partName: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadPartResult {
    pub partId: String,
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrushParams {
    pub partId: String,
    pub cx: i32,
    pub cy: i32,
    pub brushSize: u8,
    pub color: [u8; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EraserParams {
    pub partId: String,
    pub cx: i32,
    pub cy: i32,
    pub brushSize: u8,
}

/// 线性渐变入参。在当前 active 图层上沿 (x0,y0)→(x1,y1) 画主色到透明的渐变。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GradientParams {
    pub partId: String,
    pub x0: i32,
    pub y0: i32,
    pub x1: i32,
    pub y1: i32,
    pub color: [u8; 4],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartIdParams {
    pub partId: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssemblyParams {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AssemblyResult {
    pub table: AssemblyTable,
    pub source: AssemblySource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavePartParams {
    pub partId: String,
    pub targetPath: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddLayerParams {
    pub partId: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RemoveLayerParams {
    pub partId: String,
    pub layerId: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerVisibilityParams {
    pub partId: String,
    pub layerId: String,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerOpacityParams {
    pub partId: String,
    pub layerId: String,
    pub opacity: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReorderLayersParams {
    pub partId: String,
    pub order: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetActiveLayerParams {
    pub partId: String,
    pub layerIndex: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerMeta {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub opacity: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayersSnapshot {
    pub layers: Vec<LayerMeta>,
    pub activeLayerIndex: usize,
}

/// 合成预览入参。expressionIndex 越界（>6）等价于不匹配任一表情变体。
/// headVariant 用于头部状态选择；None 视为默认头。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompositeParams {
    pub skinRoot: String,
    pub skinName: String,
    pub orientation: Orientation,
    pub expressionIndex: u8,
    pub headVariant: Option<HeadVariant>,
}

/// 合成预览出参。pixels 长度 = COMPOSITE_W * COMPOSITE_H * 4。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompositeResult {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionCaptureListParams {
    pub captureRoot: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionCaptureMeta {
    pub path: String,
    pub fileName: String,
    pub frameCount: usize,
    pub durationSeconds: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionCaptureLimb {
    pub name: String,
    pub limbNum: i32,
    pub px: f32,
    pub py: f32,
    pub pz: f32,
    pub rotZ: f32,
    pub scaleX: f32,
    pub scaleY: f32,
    pub sortingOrder: i32,
    pub visible: bool,
    pub bcx: f32,
    pub bcy: f32,
    pub spriteName: String,
    pub pivotU: f32,
    pub pivotV: f32,
    pub spriteW: f32,
    pub spriteH: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionCaptureFrame {
    pub t: f32,
    pub isRight: bool,
    pub expression: i32,
    pub limbs: Vec<MotionCaptureLimb>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionCaptureFile {
    pub version: i32,
    pub modVersion: String,
    pub startedAtUnixMs: i64,
    pub playerName: String,
    pub frameCount: usize,
    pub frames: Vec<MotionCaptureFrame>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionCaptureResult {
    pub path: String,
    pub fileName: String,
    pub version: i32,
    pub modVersion: String,
    pub startedAtUnixMs: i64,
    pub playerName: String,
    pub frameCount: usize,
    pub durationSeconds: f32,
    pub frames: Vec<MotionCaptureFrame>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionCompositeParams {
    pub skinRoot: String,
    pub skinName: String,
    pub capturePath: String,
    pub frameIndex: usize,
    pub expressionIndex: u8,
    pub headVariant: Option<HeadVariant>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MotionCompositeResult {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
    pub frame: MotionCaptureFrame,
}

/// 装配位置覆盖入参。前端拖动选中部件时调此命令实时改位置；
/// 仅在内存中持有，不写 assembly.json。
/// rotation / flipX / zOrder 为可选 —— 调试面板按需调一项即可，未给的字段保留装配表默认值。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetAssemblyOverrideParams {
    pub partName: String,
    pub category: PartCategory,
    pub position: AssemblyPosition,
    pub rotation: Option<f32>,
    pub flipX: Option<bool>,
    pub zOrder: Option<i32>,
}

/// 完整的运行时 override 数据。position 必有；其它字段 None 时回落 entry 默认。
#[derive(Debug, Clone)]
pub struct AssemblyOverride {
    pub position: AssemblyPosition,
    pub rotation: Option<f32>,
    pub flipX: Option<bool>,
    pub zOrder: Option<i32>,
}

/// 单皮肤的翼装配配置（持久化到 <skin>/wings.json）。供编辑器预览与 SkinSync mod 共用。
/// 4 张翼独立 (x, y, rotation, zOrder)。下翼 (x,y) 是相对上翼根的偏移，下翼 rotation 是相对上翼末端的偏移。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WingPieceConfig {
    pub x: i32,
    pub y: i32,
    pub rotation: f32,
    pub zOrder: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WingsConfig {
    pub wingUL: WingPieceConfig,
    pub wingDL: WingPieceConfig,
    pub wingUR: WingPieceConfig,
    pub wingDR: WingPieceConfig,
}

/// 加载 / 保存翼配置入参。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WingsConfigPathParams {
    pub skinRoot: String,
    pub skinName: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveWingsConfigParams {
    pub skinRoot: String,
    pub skinName: String,
    pub config: WingsConfig,
}

/// workspace.json 路径入参。两形态都以路径明文传入，避免后端依赖系统目录探测。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspacePathParams {
    pub path: String,
}

/// getWorkspace / resetLayout 出参。source 标记 layout 来自磁盘还是回退默认。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceResult {
    pub layout: WorkspaceLayout,
    pub theme: ThemeConfig,
    pub source: WorkspaceSource,
}

/// saveWorkspace 入参。layout / theme 直接复用 windowManager 的结构体。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveWorkspaceParams {
    pub path: String,
    pub layout: WorkspaceLayout,
    pub theme: ThemeConfig,
}

/// 导出皮肤包入参。zipPath 为目标 zip 完整路径。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSkinPackParams {
    pub skinRoot: String,
    pub zipPath: String,
}

/// 导出皮肤包出参，返回打包文件总数。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSkinPackResult {
    pub fileCount: usize,
}

/// 导入皮肤包入参。overwrite=false 时已存在的同名文件跳过。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportSkinPackParams {
    pub skinRoot: String,
    pub zipPath: String,
    pub overwrite: bool,
}

/// 单部件最大图层数。
const MAX_LAYERS: usize = 8;

/// 合成预览画布固定尺寸。
const COMPOSITE_W: u32 = 100;
const COMPOSITE_H: u32 = 100;

pub trait ApiLayer: Send + Sync + 'static {
    fn listSkins(&self, params: SkinsParams) -> Result<Vec<String>, ApiError>;
    fn listParts(&self, params: PartsParams) -> Result<Stage, ApiError>;
    fn loadPartImage(&self, params: LoadPartParams) -> Result<LoadPartResult, ApiError>;
    fn listMotionCaptures(&self, params: MotionCaptureListParams) -> Result<Vec<MotionCaptureMeta>, ApiError>;
    fn loadMotionCapture(&self, path: String) -> Result<MotionCaptureResult, ApiError>;
    fn getMotionCompositeImage(&self, params: MotionCompositeParams) -> Result<MotionCompositeResult, ApiError>;
    fn applyBrush(&self, params: BrushParams) -> Result<PixelDiff, ApiError>;
    fn applyEraser(&self, params: EraserParams) -> Result<PixelDiff, ApiError>;
    fn applyGradient(&self, params: GradientParams) -> Result<PixelDiff, ApiError>;
    /// 一次 mousedown..mouseup 之间的 brush/eraser 调用合并为一条历史。
    /// endStroke 返回该笔画的整体 PixelDiff，空笔画 width=0/height=0。
    fn beginStroke(&self, params: PartIdParams) -> Result<(), ApiError>;
    fn endStroke(&self, params: PartIdParams) -> Result<PixelDiff, ApiError>;
    fn undo(&self, params: PartIdParams) -> Result<PixelDiff, ApiError>;
    fn redo(&self, params: PartIdParams) -> Result<PixelDiff, ApiError>;
    /// 当前部件 active 图层的全图扁平像素，前端在 brush/eraser/gradient/undo/redo 后
    /// 用它刷新画布显示合并视图。
    fn getFlatten(&self, params: PartIdParams) -> Result<LoadPartResult, ApiError>;
    fn getAssemblyTable(&self, params: AssemblyParams) -> Result<AssemblyResult, ApiError>;
    fn savePart(&self, params: SavePartParams) -> Result<(), ApiError>;
    fn addLayer(&self, params: AddLayerParams) -> Result<LayersSnapshot, ApiError>;
    fn removeLayer(&self, params: RemoveLayerParams) -> Result<LayersSnapshot, ApiError>;
    fn setLayerVisibility(&self, params: LayerVisibilityParams) -> Result<LayersSnapshot, ApiError>;
    fn setLayerOpacity(&self, params: LayerOpacityParams) -> Result<LayersSnapshot, ApiError>;
    fn reorderLayers(&self, params: ReorderLayersParams) -> Result<LayersSnapshot, ApiError>;
    fn setActiveLayer(&self, params: SetActiveLayerParams) -> Result<LayersSnapshot, ApiError>;
    fn getLayers(&self, params: PartIdParams) -> Result<LayersSnapshot, ApiError>;
    fn getCompositeImage(&self, params: CompositeParams) -> Result<CompositeResult, ApiError>;
    fn getWorkspace(&self, params: WorkspacePathParams) -> Result<WorkspaceResult, ApiError>;
    fn saveWorkspace(&self, params: SaveWorkspaceParams) -> Result<(), ApiError>;
    fn resetLayout(&self) -> Result<WorkspaceResult, ApiError>;
    fn exportSkinPack(&self, params: ExportSkinPackParams) -> Result<ExportSkinPackResult, ApiError>;
    fn importSkinPack(&self, params: ImportSkinPackParams) -> Result<ImportResult, ApiError>;
    fn setAssemblyOverride(&self, params: SetAssemblyOverrideParams) -> Result<(), ApiError>;
    fn loadWingsConfig(&self, params: WingsConfigPathParams) -> Result<WingsConfig, ApiError>;
    fn saveWingsConfig(&self, params: SaveWingsConfigParams) -> Result<(), ApiError>;
}

struct PartSession {
    state: PartEditState,
    history: HistoryStack,
    activeLayerIndex: usize,
    /// 当前正在进行的笔画累计 rect。mousedown 后存在，mouseup 后清空。
    /// 笔画进行期间每次 brush/eraser 修改像素但不入栈，把 rect 累计进 accRect；
    /// endStroke 时按 accRect 切出一条 PixelDiff 入栈，让一笔等于一步撤销。
    /// None 表示没有进行中的笔画（与现有按 brush 接口的行为兼容：未 begin
    /// 直接 apply 仍走"逐像素入栈"的旧路径）。
    activeStroke: Option<ActiveStroke>,
}

struct ActiveStroke {
    layerId: String,
    /// 笔画开始前 active 图层完整像素克隆，作为 PixelDiff.before 的来源。
    baseline: Vec<u8>,
    /// 累计影响矩形 [x0, y0, x1, y1)；首次写入时初始化。
    accRect: Option<(u32, u32, u32, u32)>,
}

pub struct CoreApi {
    sessions: Mutex<HashMap<String, PartSession>>,
    /// 装配位置运行时覆盖。Key = (partName, category)。
    /// getCompositeImage 优先用 override 替换 entry.position 等字段；不持久化。
    assemblyOverrides: Mutex<HashMap<(String, PartCategory), AssemblyOverride>>,
}

impl CoreApi {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            assemblyOverrides: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for CoreApi {
    fn default() -> Self {
        Self::new()
    }
}

impl ApiLayer for CoreApi {
    fn listSkins(&self, params: SkinsParams) -> Result<Vec<String>, ApiError> {
        Ok(skinLoader::listSkins(&PathBuf::from(params.skinRoot)))
    }

    fn listMotionCaptures(&self, params: MotionCaptureListParams) -> Result<Vec<MotionCaptureMeta>, ApiError> {
        let root = PathBuf::from(params.captureRoot);
        let entries = std::fs::read_dir(&root).map_err(|e| ApiError {
            code: "capture_root_failed".into(),
            message: format!("read_dir {} failed: {}", root.display(), e),
        })?;
        let mut out = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|e| ApiError {
                code: "capture_root_failed".into(),
                message: format!("read_dir {} failed: {}", root.display(), e),
            })?;
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()).map(|s| s.eq_ignore_ascii_case("json")) != Some(true) {
                continue;
            }
            let capture = readMotionCapture(&path)?;
            out.push(MotionCaptureMeta {
                path: path.to_string_lossy().into_owned(),
                fileName: path.file_name().and_then(|s| s.to_str()).unwrap_or_default().to_string(),
                frameCount: capture.frameCount,
                durationSeconds: capture.frames.last().map(|f| f.t).unwrap_or(0.0),
            });
        }
        out.sort_by(|a, b| a.fileName.cmp(&b.fileName));
        Ok(out)
    }

    fn loadMotionCapture(&self, path: String) -> Result<MotionCaptureResult, ApiError> {
        let pathBuf = PathBuf::from(&path);
        let capture = readMotionCapture(&pathBuf)?;
        Ok(MotionCaptureResult {
            path,
            fileName: pathBuf.file_name().and_then(|s| s.to_str()).unwrap_or_default().to_string(),
            version: capture.version,
            modVersion: capture.modVersion.clone(),
            startedAtUnixMs: capture.startedAtUnixMs,
            playerName: capture.playerName.clone(),
            frameCount: capture.frameCount,
            durationSeconds: capture.frames.last().map(|f| f.t).unwrap_or(0.0),
            frames: capture.frames,
        })
    }

    fn getMotionCompositeImage(&self, params: MotionCompositeParams) -> Result<MotionCompositeResult, ApiError> {
        let capture = readMotionCapture(&PathBuf::from(&params.capturePath))?;
        let frame = capture.frames.get(params.frameIndex).cloned().ok_or_else(|| ApiError {
            code: "frame_out_of_range".into(),
            message: format!("frame {} out of range (len {})", params.frameIndex, capture.frames.len()),
        })?;
        let mut canvas = vec![0u8; (COMPOSITE_W * COMPOSITE_H * 4) as usize];
        let skinDir = PathBuf::from(&params.skinRoot).join(&params.skinName);
        let mut entries = buildMotionCompositeEntries(&frame, params.expressionIndex, &params.headVariant);
        entries.sort_by_key(|e| e.zOrder);
        let sessions = lockSessions(&self.sessions)?;
        for entry in entries {
            let key = partIdKey(&params.skinName, entry.category, &entry.partName);
            let (partW, partH, pixels) = if let Some(session) = sessions.get(&key) {
                (
                    session.state.width,
                    session.state.height,
                    imageOps::flatten(&session.state),
                )
            } else {
                let pngPath = skinDir
                    .join(categoryDir(entry.category))
                    .join(format!("{}.png", entry.partName));
                match skinLoader::decodePart(&pngPath) {
                    Ok(d) => (d.width, d.height, d.pixels),
                    Err(_) => continue,
                }
            };
            let centerX = (COMPOSITE_W as i32) / 2 + entry.position.x;
            let centerY = (COMPOSITE_H as i32) / 2 + entry.position.y;
            imageOps::blitWithRotation(
                &mut canvas,
                COMPOSITE_W,
                COMPOSITE_H,
                &pixels,
                partW,
                partH,
                centerX,
                centerY,
                entry.rotation,
                false,
            );
        }
        Ok(MotionCompositeResult {
            width: COMPOSITE_W,
            height: COMPOSITE_H,
            pixels: canvas,
            frame,
        })
    }

    fn listParts(&self, params: PartsParams) -> Result<Stage, ApiError> {
        // 先用 listSkins 校验皮肤目录存在；不存在报 skin_not_found。
        // 存在则 scanSkin 返回 body/head 部件清单。
        let root = PathBuf::from(&params.skinRoot);
        if !skinLoader::listSkins(&root).contains(&params.skinName) {
            return Err(ApiError {
                code: "skin_not_found".into(),
                message: format!("skin {} not found", params.skinName),
            });
        }
        Ok(skinLoader::scanSkin(&root, &params.skinName))
    }

    fn loadPartImage(&self, params: LoadPartParams) -> Result<LoadPartResult, ApiError> {
        let skinDir = PathBuf::from(&params.skinRoot).join(&params.skinName);
        let catDirName = categoryDir(params.category);
        // 优先尝试 sidecar（含完整图层信息）。命中则跳过 PNG 解码。
        let (state, activeIndex, returnedPixels) = if let Some((sideState, sideActive)) =
            layerSidecar::loadIfPresent(&skinDir, catDirName, &params.partName)
        {
            // 用合并扁平像素作为返回（与旧路径一致：前端拿到一张图）。
            let pixels = imageOps::flatten(&sideState);
            (sideState, sideActive, pixels)
        } else {
            // 回落：把磁盘上的合成 PNG 当作单层 layer0。
            let pngPath = skinDir.join(catDirName).join(format!("{}.png", params.partName));
            let decoded = skinLoader::decodePart(&pngPath)?;
            let layer = Layer {
                id: "layer0".into(),
                name: "layer0".into(),
                visible: true,
                opacity: 255,
                pixels: decoded.pixels.clone(),
            };
            let st = PartEditState {
                partName: params.partName.clone(),
                width: decoded.width,
                height: decoded.height,
                layers: vec![layer],
            };
            (st, 0usize, decoded.pixels)
        };
        let partId = partIdKey(&params.skinName, params.category, &params.partName);
        let session = PartSession {
            state: state.clone(),
            history: HistoryStack::new(),
            activeLayerIndex: activeIndex,
            activeStroke: None,
        };
        let mut sessions = lockSessions(&self.sessions)?;
        sessions.insert(partId.clone(), session);
        Ok(LoadPartResult {
            partId,
            width: state.width,
            height: state.height,
            pixels: returnedPixels,
        })
    }

    fn applyBrush(&self, params: BrushParams) -> Result<PixelDiff, ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get_mut(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        let (width, height) = (session.state.width, session.state.height);
        let activeIdx = session.activeLayerIndex;
        let layer = session.state.layers.get_mut(activeIdx).ok_or_else(|| ApiError {
            code: "no_layer".into(),
            message: "session has no active layer".into(),
        })?;
        let layerId = layer.id.clone();
        let diff = imageOps::applyBrush(
            &mut layer.pixels,
            width,
            height,
            params.cx,
            params.cy,
            params.brushSize,
            params.color,
        );
        // 笔画进行中只累计影响矩形，不入栈；endStroke 时统一 push。
        if let Some(stroke) = session.activeStroke.as_mut() {
            mergeStrokeRect(stroke, &diff);
        } else {
            session.history.push(HistoryEntry {
                layerId,
                diff: diff.clone(),
                timestamp: nowMillis(),
            });
        }
        Ok(diff)
    }

    fn applyEraser(&self, params: EraserParams) -> Result<PixelDiff, ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get_mut(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        let (width, height) = (session.state.width, session.state.height);
        let activeIdx = session.activeLayerIndex;
        let layer = session.state.layers.get_mut(activeIdx).ok_or_else(|| ApiError {
            code: "no_layer".into(),
            message: "session has no active layer".into(),
        })?;
        let layerId = layer.id.clone();
        let diff = imageOps::applyEraser(
            &mut layer.pixels,
            width,
            height,
            params.cx,
            params.cy,
            params.brushSize,
        );
        // 与 applyBrush 同范式：笔画进行中不入栈。
        if let Some(stroke) = session.activeStroke.as_mut() {
            mergeStrokeRect(stroke, &diff);
        } else {
            session.history.push(HistoryEntry {
                layerId,
                diff: diff.clone(),
                timestamp: nowMillis(),
            });
        }
        Ok(diff)
    }

    fn applyGradient(&self, params: GradientParams) -> Result<PixelDiff, ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get_mut(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        let (width, height) = (session.state.width, session.state.height);
        let activeIdx = session.activeLayerIndex;
        let layer = session.state.layers.get_mut(activeIdx).ok_or_else(|| ApiError {
            code: "no_layer".into(),
            message: "session has no active layer".into(),
        })?;
        let layerId = layer.id.clone();
        let diff = imageOps::applyGradient(
            &mut layer.pixels,
            width,
            height,
            params.x0,
            params.y0,
            params.x1,
            params.y1,
            params.color,
        );
        session.history.push(HistoryEntry {
            layerId,
            diff: diff.clone(),
            timestamp: nowMillis(),
        });
        Ok(diff)
    }

    fn beginStroke(&self, params: PartIdParams) -> Result<(), ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get_mut(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        // 重复 begin（异常情况）忽略：保留旧 baseline 不丢弃在途变化。
        if session.activeStroke.is_some() {
            return Ok(());
        }
        let activeIdx = session.activeLayerIndex;
        let layer = session.state.layers.get(activeIdx).ok_or_else(|| ApiError {
            code: "no_layer".into(),
            message: "session has no active layer".into(),
        })?;
        session.activeStroke = Some(ActiveStroke {
            layerId: layer.id.clone(),
            baseline: layer.pixels.clone(),
            accRect: None,
        });
        Ok(())
    }

    fn endStroke(&self, params: PartIdParams) -> Result<PixelDiff, ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get_mut(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        let stroke = match session.activeStroke.take() {
            Some(s) => s,
            None => return Ok(emptyPixelDiff()),
        };
        let rect = match stroke.accRect {
            Some(r) => r,
            // 笔画未触达任何像素（点击但没动）：什么都不入栈，返回空 diff。
            None => return Ok(emptyPixelDiff()),
        };
        let width = session.state.width;
        // 找回笔画开始时所在图层；图层若被删除则放弃入栈，避免悬挂。
        let layerIdx = match session.state.layers.iter().position(|l| l.id == stroke.layerId) {
            Some(i) => i,
            None => return Ok(emptyPixelDiff()),
        };
        let (x0, y0, x1, y1) = rect;
        let before = copyRectFromBuffer(&stroke.baseline, width, x0, y0, x1, y1);
        let after = copyRectFromBuffer(&session.state.layers[layerIdx].pixels, width, x0, y0, x1, y1);
        let diff = PixelDiff {
            x: x0,
            y: y0,
            width: x1 - x0,
            height: y1 - y0,
            before,
            after,
        };
        session.history.push(HistoryEntry {
            layerId: stroke.layerId,
            diff: diff.clone(),
            timestamp: nowMillis(),
        });
        Ok(diff)
    }

    fn undo(&self, params: PartIdParams) -> Result<PixelDiff, ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get_mut(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        let entry = session.history.undo().ok_or_else(|| ApiError {
            code: "nothing_to_undo".into(),
            message: format!("undo stack empty for {}", params.partId),
        })?;
        let width = session.state.width;
        // 按 entry.layerId 定位图层：撤销作用于产生该 diff 的图层，自动把
        // activeLayerIndex 切到该图层。图层已被删除则跳过 diff 不报错。
        if let Some(idx) = session.state.layers.iter().position(|l| l.id == entry.layerId) {
            historyManager::applyBefore(&mut session.state.layers[idx].pixels, width, &entry.diff);
            session.activeLayerIndex = idx;
        }
        Ok(entry.diff)
    }

    fn redo(&self, params: PartIdParams) -> Result<PixelDiff, ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get_mut(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        let entry = session.history.redo().ok_or_else(|| ApiError {
            code: "nothing_to_redo".into(),
            message: format!("redo stack empty for {}", params.partId),
        })?;
        let width = session.state.width;
        // 与 undo 对称：按 entry.layerId 找图层，自动切 active。
        if let Some(idx) = session.state.layers.iter().position(|l| l.id == entry.layerId) {
            historyManager::applyAfter(&mut session.state.layers[idx].pixels, width, &entry.diff);
            session.activeLayerIndex = idx;
        }
        Ok(entry.diff)
    }

    fn getFlatten(&self, params: PartIdParams) -> Result<LoadPartResult, ApiError> {
        let sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        let pixels = imageOps::flatten(&session.state);
        Ok(LoadPartResult {
            partId: params.partId,
            width: session.state.width,
            height: session.state.height,
            pixels,
        })
    }

    fn getAssemblyTable(&self, params: AssemblyParams) -> Result<AssemblyResult, ApiError> {
        let (table, source) = assemblyTable::loadAssembly(&PathBuf::from(params.path));
        Ok(AssemblyResult { table, source })
    }

    fn savePart(&self, params: SavePartParams) -> Result<(), ApiError> {
        let sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        // 1) 合成扁平 PNG 写到 targetPath（给游戏 / 其它工具读，目录布局不变）。
        let pixels = imageOps::flatten(&session.state);
        let target = PathBuf::from(&params.targetPath);
        imageOps::savePng(&target, session.state.width, session.state.height, &pixels)?;
        // 同时把可编辑图层与元数据写到 sidecar `<skinDir>/layers/<Cat>/<part>/`，
        // 供下次 loadPartImage 还原图层结构。skinDir / category / partName 从 targetPath 反推。
        let partNameOpt = target.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string());
        let categoryOpt = target.parent().and_then(|p| p.file_name()).and_then(|s| s.to_str()).map(|s| s.to_string());
        let skinDirOpt = target.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf());
        if let (Some(skinDir), Some(catDir), Some(partName)) = (skinDirOpt, categoryOpt, partNameOpt) {
            // sidecar 写失败仅 log，不阻塞合成 PNG 落盘——后者是用户可见的产物。
            if let Err(e) = layerSidecar::save(&skinDir, &catDir, &partName, &session.state, session.activeLayerIndex) {
                eprintln!("[savePart] sidecar 写盘失败：{}", e.message);
            }
        }
        Ok(())
    }

    fn addLayer(&self, params: AddLayerParams) -> Result<LayersSnapshot, ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get_mut(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        if session.state.layers.len() >= MAX_LAYERS {
            return Err(ApiError {
                code: "layer_limit_reached".into(),
                message: format!("max {} layers per part", MAX_LAYERS),
            });
        }
        let pixelLen = (session.state.width as usize) * (session.state.height as usize) * 4;
        let id = format!("layer{}", session.state.layers.len());
        session.state.layers.push(Layer {
            id: id.clone(),
            name: id,
            visible: true,
            opacity: 255,
            pixels: vec![0u8; pixelLen],
        });
        Ok(snapshot(session))
    }

    fn removeLayer(&self, params: RemoveLayerParams) -> Result<LayersSnapshot, ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get_mut(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        if session.state.layers.len() <= 1 {
            return Err(ApiError {
                code: "cannot_remove_last_layer".into(),
                message: "at least one layer must remain".into(),
            });
        }
        let idx = findLayerIndex(&session.state.layers, &params.layerId)?;
        session.state.layers.remove(idx);
        // 清掉已删图层在历史栈中的所有条目，避免后续 undo/redo 引用悬挂图层。
        session.history.dropEntriesForLayer(&params.layerId);
        if session.activeLayerIndex >= session.state.layers.len() {
            session.activeLayerIndex = session.state.layers.len() - 1;
        } else if idx <= session.activeLayerIndex && session.activeLayerIndex > 0 {
            session.activeLayerIndex -= 1;
        }
        Ok(snapshot(session))
    }

    fn setLayerVisibility(&self, params: LayerVisibilityParams) -> Result<LayersSnapshot, ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get_mut(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        let idx = findLayerIndex(&session.state.layers, &params.layerId)?;
        session.state.layers[idx].visible = params.visible;
        Ok(snapshot(session))
    }

    fn setLayerOpacity(&self, params: LayerOpacityParams) -> Result<LayersSnapshot, ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get_mut(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        let idx = findLayerIndex(&session.state.layers, &params.layerId)?;
        session.state.layers[idx].opacity = params.opacity;
        Ok(snapshot(session))
    }

    fn reorderLayers(&self, params: ReorderLayersParams) -> Result<LayersSnapshot, ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get_mut(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        if params.order.len() != session.state.layers.len() {
            return Err(invalidOrder());
        }
        let mut indices: Vec<usize> = Vec::with_capacity(params.order.len());
        for id in &params.order {
            let pos = session
                .state
                .layers
                .iter()
                .position(|l| &l.id == id)
                .ok_or_else(invalidOrder)?;
            if indices.contains(&pos) {
                return Err(invalidOrder());
            }
            indices.push(pos);
        }
        let activeId = session
            .state
            .layers
            .get(session.activeLayerIndex)
            .map(|l| l.id.clone());
        let mut taken: Vec<Option<Layer>> =
            session.state.layers.drain(..).map(Some).collect();
        let reordered: Vec<Layer> = indices
            .into_iter()
            .map(|i| taken[i].take().expect("validated above"))
            .collect();
        session.state.layers = reordered;
        if let Some(activeId) = activeId {
            if let Some(p) = session.state.layers.iter().position(|l| l.id == activeId) {
                session.activeLayerIndex = p;
            }
        }
        Ok(snapshot(session))
    }

    fn setActiveLayer(&self, params: SetActiveLayerParams) -> Result<LayersSnapshot, ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get_mut(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        if params.layerIndex >= session.state.layers.len() {
            return Err(ApiError {
                code: "invalid_layer_index".into(),
                message: format!(
                    "index {} out of range (len {})",
                    params.layerIndex,
                    session.state.layers.len()
                ),
            });
        }
        session.activeLayerIndex = params.layerIndex;
        Ok(snapshot(session))
    }

    fn getLayers(&self, params: PartIdParams) -> Result<LayersSnapshot, ApiError> {
        let sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        Ok(snapshot(session))
    }

    fn getCompositeImage(&self, params: CompositeParams) -> Result<CompositeResult, ApiError> {
        let assemblyPath = PathBuf::from(&params.skinRoot).join("assembly.json");
        let (table, _source) = assemblyTable::loadAssembly(&assemblyPath);
        // 单皮肤的 wings.json 是 assembly 的局部覆盖：4 张翼的 (x,y,rotation,zOrder)
        // 由该文件给出，文件不存在时回落到装配表默认值。
        let wingsConfig = self
            .loadWingsConfig(WingsConfigPathParams {
                skinRoot: params.skinRoot.clone(),
                skinName: params.skinName.clone(),
            })
            .ok();
        // 先拿到 overrides，按 override.zOrder（若有）参与排序，让 zOrder 调试也能实时生效。
        let overrides = self.assemblyOverrides.lock().map_err(|_| ApiError {
            code: "lock_poisoned".into(),
            message: "assemblyOverrides lock poisoned".into(),
        })?;
        let mut entries: Vec<&AssemblyEntry> = table
            .parts
            .iter()
            .filter(|e| variantMatches(&e.variants, &params.orientation, params.expressionIndex, &params.headVariant))
            .collect();

        let mut canvas = vec![0u8; (COMPOSITE_W * COMPOSITE_H * 4) as usize];
        let sessions = lockSessions(&self.sessions)?;

        // 取翼配置字段：override 优先 → wings.json → entry 默认。
        let wingPiece = |name: &str| -> Option<&WingPieceConfig> {
            wingsConfig.as_ref().and_then(|c| match name {
                "wingUL" => Some(&c.wingUL),
                "wingDL" => Some(&c.wingDL),
                "wingUR" => Some(&c.wingUR),
                "wingDR" => Some(&c.wingDR),
                _ => None,
            })
        };
        // 取最终装配字段：override 字段优先；wings.json 次之；entry 自身字段最后。
        let resolveWingPos = |entry: &AssemblyEntry, ovr: Option<&AssemblyOverride>| -> AssemblyPosition {
            if let Some(o) = ovr {
                return o.position.clone();
            }
            if let Some(p) = wingPiece(&entry.partName) {
                return AssemblyPosition { x: p.x, y: p.y };
            }
            entry.position.clone()
        };
        let resolveWingRot = |entry: &AssemblyEntry, ovr: Option<&AssemblyOverride>| -> f32 {
            if let Some(o) = ovr {
                if let Some(r) = o.rotation { return r; }
            }
            if let Some(p) = wingPiece(&entry.partName) {
                return p.rotation;
            }
            entry.rotation
        };
        let resolveWingZ = |entry: &AssemblyEntry, ovr: Option<&AssemblyOverride>| -> i32 {
            if let Some(o) = ovr {
                if let Some(z) = o.zOrder { return z; }
            }
            if let Some(p) = wingPiece(&entry.partName) {
                return p.zOrder;
            }
            entry.zOrder
        };

        // sort 走"翼分类 → resolveWingZ；其它分类 → override.zOrder.fallback(entry)"
        entries.sort_by_key(|e| {
            let ovr = overrides.get(&(e.partName.clone(), e.category));
            if e.category == PartCategory::Wings {
                resolveWingZ(e, ovr)
            } else {
                ovr.and_then(|o| o.zOrder).unwrap_or(e.zOrder)
            }
        });

        // 先扫一遍上翼，记下它们的 (根 pos, rotation, halfH)，让下翼绕上翼根旋转。
        // 父子关节模型：下翼世界位置 = 上翼根 + rotateVec((pos.x, halfH + pos.y), upperRot)；
        // 下翼世界旋转 = 上翼旋转 + 下翼自身相对偏移。
        // halfH 取上翼 PNG 半高（PNG 内部翼根在中心、翼尖朝下到底边，所以默认下翼相对上翼根 (0, halfH)）。
        let upperWingPose = |upperName: &str| -> Option<(AssemblyPosition, f32, f32)> {
            let entry = entries.iter().find(|e| e.partName == upperName && e.category == PartCategory::Wings)?;
            let ovr = overrides.get(&(entry.partName.clone(), entry.category));
            let pos = resolveWingPos(entry, ovr);
            let rotation = resolveWingRot(entry, ovr);
            let key = partIdKey(&params.skinName, entry.category, &entry.partName);
            let halfH = if let Some(session) = sessions.get(&key) {
                session.state.height as f32 / 2.0
            } else {
                let pngPath = PathBuf::from(&params.skinRoot)
                    .join(&params.skinName)
                    .join(categoryDir(entry.category))
                    .join(format!("{}.png", entry.partName));
                skinLoader::decodePart(&pngPath).map(|d| d.height as f32 / 2.0).unwrap_or(16.0)
            };
            Some((pos, rotation, halfH))
        };
        let lowerLAnchor = upperWingPose("wingUL");
        let lowerRAnchor = upperWingPose("wingUR");

        for entry in entries {
            let key = partIdKey(&params.skinName, entry.category, &entry.partName);
            let (partW, partH, pixels) = if let Some(session) = sessions.get(&key) {
                (
                    session.state.width,
                    session.state.height,
                    imageOps::flatten(&session.state),
                )
            } else {
                let pngPath = PathBuf::from(&params.skinRoot)
                    .join(&params.skinName)
                    .join(categoryDir(entry.category))
                    .join(format!("{}.png", entry.partName));
                match skinLoader::decodePart(&pngPath) {
                    Ok(d) => (d.width, d.height, d.pixels),
                    Err(_) => continue,
                }
            };
            // override 优先；否则用装配表 entry 自身字段；翼分类还要叠 wings.json。
            let ovr = overrides.get(&(entry.partName.clone(), entry.category));
            let mut pos;
            let mut rotation;
            let flipX;
            if entry.category == PartCategory::Wings {
                pos = resolveWingPos(entry, ovr);
                rotation = resolveWingRot(entry, ovr);
                flipX = ovr.and_then(|o| o.flipX).unwrap_or(entry.flipX);
            } else {
                pos = ovr.map(|o| o.position).unwrap_or(entry.position.clone());
                rotation = ovr.and_then(|o| o.rotation).unwrap_or(entry.rotation);
                flipX = ovr.and_then(|o| o.flipX).unwrap_or(entry.flipX);
            }
            // 下翼链式（父子关节）：以上翼根为旋转中心，下翼局部偏移 (pos.x, halfH + pos.y) 绕上翼旋转。
            // rotation 累加上翼旋转，让下翼姿态跟随上翼。用户在 wingDebugPanel 调下翼 (x,y,rotation) 全是相对偏移。
            if entry.category == PartCategory::Wings {
                let anchor = if entry.partName == "wingDL" {
                    lowerLAnchor.as_ref()
                } else if entry.partName == "wingDR" {
                    lowerRAnchor.as_ref()
                } else {
                    None
                };
                if let Some((rootPos, rootRot, halfH)) = anchor {
                    let localX = pos.x as f32;
                    let localY = halfH + pos.y as f32;
                    // 与 imageOps::blitWithRotation 内部约定一致：rad = -rotDeg。
                    let rad = -rootRot.to_radians();
                    let c = rad.cos();
                    let s = rad.sin();
                    let dx = localX * c - localY * s;
                    let dy = localX * s + localY * c;
                    pos = AssemblyPosition {
                        x: rootPos.x + dx.round() as i32,
                        y: rootPos.y + dy.round() as i32,
                    };
                    rotation = rootRot + rotation;
                }
            }
            // mod 用 `Sprite.Create(rect=整图, pivot=(0.5,0.5), pixelsPerUnit=8)` 创建 sprite，
            // 因此 sprite 视觉中心 = PNG 几何中心。预览以 (50+pos.x, 50+pos.y) 为中心
            // 绕 sprite 中心旋转 rotation 度（与 Unity rotZ 一致）。
            let centerX = (COMPOSITE_W as i32) / 2 + pos.x;
            let centerY = (COMPOSITE_H as i32) / 2 + pos.y;
            imageOps::blitWithRotation(
                &mut canvas, COMPOSITE_W, COMPOSITE_H, &pixels, partW, partH,
                centerX, centerY, rotation, flipX,
            );
        }
        Ok(CompositeResult { width: COMPOSITE_W, height: COMPOSITE_H, pixels: canvas })
    }

    fn getWorkspace(&self, params: WorkspacePathParams) -> Result<WorkspaceResult, ApiError> {
        let (layout, theme, source) = windowManager::loadWorkspace(&PathBuf::from(params.path));
        Ok(WorkspaceResult { layout, theme, source })
    }

    fn saveWorkspace(&self, params: SaveWorkspaceParams) -> Result<(), ApiError> {
        windowManager::saveWorkspace(&PathBuf::from(params.path), &params.layout, &params.theme)
    }

    fn resetLayout(&self) -> Result<WorkspaceResult, ApiError> {
        Ok(WorkspaceResult {
            layout: windowManager::defaultWorkspace(),
            theme: windowManager::defaultTheme(),
            source: WorkspaceSource::Fallback,
        })
    }

    fn exportSkinPack(
        &self,
        params: ExportSkinPackParams,
    ) -> Result<ExportSkinPackResult, ApiError> {
        let n = skinLoader::exportSkinPack(
            &PathBuf::from(params.skinRoot),
            &PathBuf::from(params.zipPath),
        )?;
        Ok(ExportSkinPackResult { fileCount: n })
    }

    fn importSkinPack(&self, params: ImportSkinPackParams) -> Result<ImportResult, ApiError> {
        skinLoader::importSkinPack(
            &PathBuf::from(params.zipPath),
            &PathBuf::from(params.skinRoot),
            params.overwrite,
        )
    }

    fn setAssemblyOverride(&self, params: SetAssemblyOverrideParams) -> Result<(), ApiError> {
        let mut overrides = self.assemblyOverrides.lock().map_err(|_| ApiError {
            code: "lock_poisoned".into(),
            message: "assemblyOverrides lock poisoned".into(),
        })?;
        overrides.insert(
            (params.partName, params.category),
            AssemblyOverride {
                position: params.position,
                rotation: params.rotation,
                flipX: params.flipX,
                zOrder: params.zOrder,
            },
        );
        Ok(())
    }

    fn loadWingsConfig(&self, params: WingsConfigPathParams) -> Result<WingsConfig, ApiError> {
        let path = wingsConfigPath(&params.skinRoot, &params.skinName);
        if !path.exists() {
            return Ok(defaultWingsConfig());
        }
        let bytes = std::fs::read(&path).map_err(|e| ApiError {
            code: "io".into(),
            message: format!("read {}: {}", path.display(), e),
        })?;
        serde_json::from_slice::<WingsConfig>(&bytes).map_err(|e| ApiError {
            code: "json".into(),
            message: format!("parse {}: {}", path.display(), e),
        })
    }

    fn saveWingsConfig(&self, params: SaveWingsConfigParams) -> Result<(), ApiError> {
        let path = wingsConfigPath(&params.skinRoot, &params.skinName);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| ApiError {
                code: "io".into(),
                message: format!("mkdir {}: {}", parent.display(), e),
            })?;
        }
        let bytes = serde_json::to_vec_pretty(&params.config).map_err(|e| ApiError {
            code: "json".into(),
            message: format!("serialize: {}", e),
        })?;
        std::fs::write(&path, bytes).map_err(|e| ApiError {
            code: "io".into(),
            message: format!("write {}: {}", path.display(), e),
        })
    }
}

fn wingsConfigPath(skinRoot: &str, skinName: &str) -> PathBuf {
    PathBuf::from(skinRoot).join(skinName).join("wings.json")
}

fn defaultWingsConfig() -> WingsConfig {
    // 与 assemblyTable defaultAssembly() 内 wing 条目一致
    WingsConfig {
        wingUL: WingPieceConfig { x: -2, y: -8, rotation: 314.0, zOrder: 5 },
        wingDL: WingPieceConfig { x: -1, y: -10, rotation: 0.0, zOrder: 4 },
        wingUR: WingPieceConfig { x: -2, y: -9, rotation: 318.0, zOrder: 5 },
        wingDR: WingPieceConfig { x: 0, y: -12, rotation: 0.0, zOrder: 4 },
    }
}

/// 按装配表 variants 规则过滤合成条目。
/// variants==None 总是合成；指定的字段任一不匹配即跳过。
/// variants.headVariant=None 视为不限定；params.headVariant=None 等价 Default。
fn variantMatches(
    variants: &Option<AssemblyVariants>,
    orientation: &Orientation,
    expressionIndex: u8,
    headVariant: &Option<HeadVariant>,
) -> bool {
    let v = match variants {
        Some(v) => v,
        None => return true,
    };
    if let Some(o) = &v.orientation {
        if o != orientation {
            return false;
        }
    }
    if let Some(idx) = v.expressionIndex {
        if idx != expressionIndex {
            return false;
        }
    }
    if let Some(hv) = &v.headVariant {
        // 用户没传 headVariant 时按 Default 解释。
        let effective = headVariant.clone().unwrap_or(HeadVariant::Default);
        if hv != &effective {
            return false;
        }
    }
    true
}

fn partIdKey(skinName: &str, category: PartCategory, partName: &str) -> String {
    format!("{}::{}::{}", skinName, categoryDir(category), partName)
}

/// 把 imageOps 返回的 PixelDiff 影响矩形并入正在进行的笔画累计 rect。
/// 空 diff（width=0/height=0）跳过，避免污染累计区。
fn mergeStrokeRect(stroke: &mut ActiveStroke, diff: &PixelDiff) {
    if diff.width == 0 || diff.height == 0 {
        return;
    }
    let nx0 = diff.x;
    let ny0 = diff.y;
    let nx1 = diff.x + diff.width;
    let ny1 = diff.y + diff.height;
    stroke.accRect = Some(match stroke.accRect {
        Some((x0, y0, x1, y1)) => (x0.min(nx0), y0.min(ny0), x1.max(nx1), y1.max(ny1)),
        None => (nx0, ny0, nx1, ny1),
    });
}

/// 从 RGBA 扁平 buffer 截一个矩形子块（4 字节/像素，行主序）。
fn copyRectFromBuffer(buf: &[u8], width: u32, x0: u32, y0: u32, x1: u32, y1: u32) -> Vec<u8> {
    let rectW = (x1 - x0) as usize;
    let rectH = (y1 - y0) as usize;
    let mut out = Vec::with_capacity(rectW * rectH * 4);
    for row in 0..rectH {
        let srcStart = (((y0 as usize) + row) * (width as usize) + (x0 as usize)) * 4;
        let srcEnd = srcStart + rectW * 4;
        out.extend_from_slice(&buf[srcStart..srcEnd]);
    }
    out
}

/// 空笔画 / 异常路径返回的占位 PixelDiff，前端不会贴回画布。
fn emptyPixelDiff() -> PixelDiff {
    PixelDiff {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        before: vec![],
        after: vec![],
    }
}

fn categoryDir(category: PartCategory) -> &'static str {
    match category {
        PartCategory::Body => "Body",
        PartCategory::Head => "Head",
        PartCategory::Wings => "Wings",
    }
}

fn notLoaded(partId: &str) -> ApiError {
    ApiError {
        code: "not_loaded".into(),
        message: format!("part {} not loaded", partId),
    }
}

fn lockSessions<'a>(
    sessions: &'a Mutex<HashMap<String, PartSession>>,
) -> Result<std::sync::MutexGuard<'a, HashMap<String, PartSession>>, ApiError> {
    sessions.lock().map_err(|_| ApiError {
        code: "lock_poisoned".into(),
        message: "session map lock poisoned".into(),
    })
}

fn nowMillis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn snapshot(session: &PartSession) -> LayersSnapshot {
    LayersSnapshot {
        layers: session
            .state
            .layers
            .iter()
            .map(|l| LayerMeta {
                id: l.id.clone(),
                name: l.name.clone(),
                visible: l.visible,
                opacity: l.opacity,
            })
            .collect(),
        activeLayerIndex: session.activeLayerIndex,
    }
}

fn findLayerIndex(layers: &[Layer], layerId: &str) -> Result<usize, ApiError> {
    layers.iter().position(|l| l.id == layerId).ok_or_else(|| ApiError {
        code: "layer_not_found".into(),
        message: format!("layer {} not found", layerId),
    })
}

fn invalidOrder() -> ApiError {
    ApiError {
        code: "invalid_order".into(),
        message: "order must be a permutation of existing layer ids".into(),
    }
}

fn readMotionCapture(path: &PathBuf) -> Result<MotionCaptureFile, ApiError> {
    let bytes = std::fs::read(path).map_err(|e| ApiError {
        code: "capture_not_found".into(),
        message: format!("read {} failed: {}", path.display(), e),
    })?;
    serde_json::from_slice::<MotionCaptureFile>(&bytes).map_err(|e| ApiError {
        code: "capture_parse_failed".into(),
        message: format!("parse {} failed: {}", path.display(), e),
    })
}

fn motionEyePartName(expression: i32) -> &'static str {
    match expression {
        1 => "experimentEyeHalfClosed",
        2 => "experimentEyeClosed",
        3 => "experimentEyeScared",
        4 => "experimentEyePanic",
        5 => "experimentEyeSad",
        6 => "experimentEyeHappy",
        _ => "experimentEyeOpen",
    }
}

fn motionHeadPartName(head_variant: &Option<HeadVariant>, captured: &str) -> String {
    match head_variant.clone().unwrap_or(HeadVariant::Default) {
        HeadVariant::Default => {
            if captured.is_empty() {
                "experimentHeadBack".to_string()
            } else {
                captured.to_string()
            }
        }
        HeadVariant::MouthHalf => "experimentHeadBackMouthMini".to_string(),
        HeadVariant::Mouth => "experimentHeadBackMouth".to_string(),
        HeadVariant::Disfigured1 => "experimentHeadDisfigured1".to_string(),
        HeadVariant::Disfigured2 => "experimentHeadDisfigured2".to_string(),
        HeadVariant::Disfigured3 => "experimentHeadDisfigured3".to_string(),
        HeadVariant::Disfigured1Healed => "experimentHeadDisfigured1Healed".to_string(),
        HeadVariant::Disfigured2Healed => "experimentHeadDisfigured2Healed".to_string(),
        HeadVariant::Disfigured3Healed => "experimentHeadDisfigured3Healed".to_string(),
    }
}

fn motionBodyPartName(limbName: &str) -> Option<&'static str> {
    match limbName {
        "UpTorso" => Some("experimentUpTorso"),
        "DownTorso" => Some("experimentDownTorso"),
        "UpArmF" | "UpArmB" => Some("experimentUpArm"),
        "DownArmF" | "DownArmB" => Some("experimentDownArm"),
        "HandF" => Some("experimentHandF"),
        "HandB" => Some("experimentHandB"),
        "ThighF" | "ThighB" => Some("experimentThigh"),
        "CrusF" | "CrusB" => Some("experimentCrus"),
        "FootF" | "FootB" => Some("experimentFoot"),
        "Tail" | "experimentTail" => Some("experimentTail"),
        _ => None,
    }
}

fn motionCompositePosition(limb: &MotionCaptureLimb) -> AssemblyPosition {
    // Tail / Wings 是 body 子节点下的非 limb 物体（挂在 Tail tf / HwWings 容器），
    // 它们的 px/py 是相对自己 parent 的局部坐标——用 bcx/bcy（已转回 body 局部）才能落到正确画布位。
    let isAttached = limb.name == "Tail"
        || limb.name == "experimentTail"
        || limb.name == "wingUL"
        || limb.name == "wingUR"
        || limb.name == "wingDL"
        || limb.name == "wingDR";
    let (x, y) = if isAttached {
        (limb.bcx, limb.bcy)
    } else {
        (limb.px, limb.py)
    };
    AssemblyPosition {
        x: (x * 8.0).round() as i32,
        y: (-y * 8.0).round() as i32,
    }
}

fn buildMotionCompositeEntries(
    frame: &MotionCaptureFrame,
    expression_index: u8,
    head_variant: &Option<HeadVariant>,
) -> Vec<AssemblyEntry> {
    let mut out = Vec::new();
    let mut headPose: Option<(AssemblyPosition, f32)> = None;
    for limb in &frame.limbs {
        if !limb.visible {
            continue;
        }
        if limb.name == "Head" {
            let pos = motionCompositePosition(limb);
            let partName = motionHeadPartName(head_variant, &limb.spriteName);
            headPose = Some((pos, limb.rotZ));
            out.push(AssemblyEntry {
                partName,
                category: PartCategory::Head,
                position: pos,
                zOrder: limb.sortingOrder,
                flipX: false,
                rotation: limb.rotZ,
                variants: None,
            });
            continue;
        }
        // 翅膀：motionRecorder 抓取的 4 张翼名 wingUL/wingUR/wingDL/wingDR，partName 与 PNG 同名直接渲染。
        if matches!(limb.name.as_str(), "wingUL" | "wingUR" | "wingDL" | "wingDR") {
            out.push(AssemblyEntry {
                partName: limb.name.clone(),
                category: PartCategory::Wings,
                position: motionCompositePosition(limb),
                zOrder: limb.sortingOrder,
                flipX: false,
                rotation: limb.rotZ,
                variants: None,
            });
            continue;
        }
        let Some(partName) = motionBodyPartName(&limb.name) else {
            continue;
        };
        out.push(AssemblyEntry {
            partName: partName.to_string(),
            category: PartCategory::Body,
            position: motionCompositePosition(limb),
            zOrder: limb.sortingOrder,
            flipX: false,
            rotation: limb.rotZ,
            variants: None,
        });
    }
    if let Some((pos, rot)) = headPose {
        out.push(AssemblyEntry {
            partName: motionEyePartName(i32::from(expression_index)).to_string(),
            category: PartCategory::Head,
            position: pos,
            zOrder: 53,
            flipX: false,
            rotation: rot,
            variants: None,
        });
    }
    // 兼容旧捕捉：没有 Tail sample 时仍回退到静态尾巴。
    let hasTail = frame
        .limbs
        .iter()
        .any(|limb| limb.name == "Tail" || limb.name == "experimentTail");
    if !hasTail {
        if let Some(tail) = defaultAssemblyTailEntry() {
            out.push(tail);
        }
    }
    out
}

fn defaultAssemblyTailEntry() -> Option<AssemblyEntry> {
    assemblyTable::defaultAssembly()
        .parts
        .into_iter()
        .find(|e| e.category == PartCategory::Body && e.partName == "experimentTail")
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            static SEQ: AtomicU64 = AtomicU64::new(0);
            let seq = SEQ.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0);
            let path = std::env::temp_dir()
                .join(format!("spe_apiLayer_{}_{}_{}", std::process::id(), nanos, seq));
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

    fn writeTinyPng(path: &Path, color: [u8; 4]) {
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

        let undoDiff = api.undo(PartIdParams { partId: loaded.partId.clone() }).expect("undo");
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
    fn getAssemblyFallbackOnMissingFile() {
        let tmp = TempDir::new();
        let api = CoreApi::new();
        let missing = tmp.path().join("nope.json");
        let result = api
            .getAssemblyTable(AssemblyParams { path: missing.to_string_lossy().into_owned() })
            .expect("getAssembly");
        assert_eq!(result.source, AssemblySource::Fallback);
        assert!(!result.table.parts.is_empty());
    }

    #[test]
    fn savePartWritesFlatPng() {
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

        let target = tmp.path().join("out.png");
        api.savePart(SavePartParams {
            partId: loaded.partId,
            targetPath: target.to_string_lossy().into_owned(),
        })
        .expect("savePart");

        let (w, h, pixels) = imageOps::loadPng(&target).expect("reload");
        assert_eq!((w, h), (1, 1));
        assert_eq!(pixels, vec![11, 22, 33, 255]);
    }

    #[test]
    fn motionCompositeUsesBoundsCenterForTail() {
        let frame = MotionCaptureFrame {
            t: 0.0,
            isRight: false,
            expression: 0,
            limbs: vec![MotionCaptureLimb {
                name: "Tail".into(),
                limbNum: -1,
                px: 0.0,
                py: -0.353,
                pz: 0.0,
                rotZ: 18.0,
                scaleX: 1.0,
                scaleY: 1.0,
                sortingOrder: 0,
                visible: true,
                bcx: 0.25,
                bcy: -0.5,
                spriteName: "experimentTail".into(),
                pivotU: 0.5,
                pivotV: 0.5,
                spriteW: 56.0,
                spriteH: 20.0,
            }],
        };

        let entries = buildMotionCompositeEntries(&frame, 0, &None);
        let tail = entries
            .iter()
            .find(|entry| entry.partName == "experimentTail")
            .expect("tail entry");

        assert_eq!(tail.position.x, 2);
        assert_eq!(tail.position.y, 4);
        assert_eq!(tail.rotation, 18.0);
    }

    #[test]
    fn motionCompositeAllowsExpressionAndHeadOverrides() {
        let frame = MotionCaptureFrame {
            t: 0.0,
            isRight: false,
            expression: 6,
            limbs: vec![MotionCaptureLimb {
                name: "Head".into(),
                limbNum: 0,
                px: 1.0,
                py: 2.0,
                pz: 0.0,
                rotZ: 347.0,
                scaleX: 1.0,
                scaleY: 1.0,
                sortingOrder: 50,
                visible: true,
                bcx: 1.0,
                bcy: 2.0,
                spriteName: "experimentHeadBack".into(),
                pivotU: 0.5,
                pivotV: 0.5,
                spriteW: 30.0,
                spriteH: 26.0,
            }],
        };

        let entries = buildMotionCompositeEntries(&frame, 0, &Some(HeadVariant::Mouth));
        assert!(entries.iter().any(|entry| entry.partName == "experimentHeadBackMouth"));
        assert!(entries.iter().any(|entry| entry.partName == "experimentEyeOpen"));
        assert!(!entries.iter().any(|entry| entry.partName == "experimentEyeHappy"));
    }

    #[test]
    fn motionCompositeUsesUnsavedSessionPixels() {
        let tmp = TempDir::new();
        let bodyDir = tmp.path().join("st1").join("Body");
        fs::create_dir_all(&bodyDir).unwrap();
        writeTinyPng(&bodyDir.join("experimentUpTorso.png"), [255, 0, 0, 255]);

        let capturePath = tmp.path().join("motion.json");
        let capture = MotionCaptureFile {
            version: 3,
            modVersion: "1.0.0".into(),
            startedAtUnixMs: 0,
            playerName: "Body".into(),
            frameCount: 1,
            frames: vec![MotionCaptureFrame {
                t: 0.0,
                isRight: false,
                expression: 0,
                limbs: vec![MotionCaptureLimb {
                    name: "UpTorso".into(),
                    limbNum: 1,
                    px: 0.0,
                    py: 0.0,
                    pz: 0.0,
                    rotZ: 0.0,
                    scaleX: 1.0,
                    scaleY: 1.0,
                    sortingOrder: 20,
                    visible: true,
                    bcx: 0.0,
                    bcy: 0.0,
                    spriteName: "experimentUpTorso".into(),
                    pivotU: 0.5,
                    pivotV: 0.5,
                    spriteW: 1.0,
                    spriteH: 1.0,
                }],
            }],
        };
        fs::write(&capturePath, serde_json::to_vec(&capture).unwrap()).unwrap();

        let api = CoreApi::new();
        let loaded = api
            .loadPartImage(LoadPartParams {
                skinRoot: tmp.path().to_string_lossy().into_owned(),
                skinName: "st1".into(),
                category: PartCategory::Body,
                partName: "experimentUpTorso".into(),
            })
            .expect("load part");
        api.applyBrush(BrushParams {
            partId: loaded.partId,
            cx: 0,
            cy: 0,
            brushSize: 1,
            color: [0, 0, 255, 255],
        })
        .expect("paint unsaved");

        let result = api
            .getMotionCompositeImage(MotionCompositeParams {
                skinRoot: tmp.path().to_string_lossy().into_owned(),
                skinName: "st1".into(),
                capturePath: capturePath.to_string_lossy().into_owned(),
                frameIndex: 0,
                expressionIndex: 0,
                headVariant: None,
            })
            .expect("motion composite");

        let i = ((50 * result.width + 50) as usize) * 4;
        assert_eq!(&result.pixels[i..i + 4], &[0, 0, 255, 255]);
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
    fn addLayerAppendsAndCapsAt8() {
        let (_tmp, api, partId) = loadedApi();
        // load 后已有 1 层，再 add 7 次到 8 层
        for _ in 0..7 {
            api.addLayer(AddLayerParams { partId: partId.clone() }).expect("add");
        }
        let snap = api.getLayers(PartIdParams { partId: partId.clone() }).expect("get");
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
            .removeLayer(RemoveLayerParams { partId, layerId: "layer0".into() })
            .expect_err("remove last should fail");
        assert_eq!(err.code, "cannot_remove_last_layer");
    }

    #[test]
    fn reorderLayersValidatesOrder() {
        let (_tmp, api, partId) = loadedApi();
        api.addLayer(AddLayerParams { partId: partId.clone() }).expect("add");
        // 错误的 id 集合
        let err = api
            .reorderLayers(ReorderLayersParams {
                partId: partId.clone(),
                order: vec!["layer0".into(), "ghost".into()],
            })
            .expect_err("bad order");
        assert_eq!(err.code, "invalid_order");
        // 正确翻转
        let snap = api
            .reorderLayers(ReorderLayersParams {
                partId,
                order: vec!["layer1".into(), "layer0".into()],
            })
            .expect("ok");
        assert_eq!(snap.layers.iter().map(|l| l.id.clone()).collect::<Vec<_>>(),
                   vec!["layer1".to_string(), "layer0".to_string()]);
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
        api.addLayer(AddLayerParams { partId: partId.clone() }).expect("add");
        // 切到新增的 layer1
        api.setActiveLayer(SetActiveLayerParams { partId: partId.clone(), layerIndex: 1 })
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

    // ---- 17c: getCompositeImage 集成测试 ----
    use crate::assemblyTable::AssemblyPosition;

    fn writeAssembly(path: &Path, parts: Vec<AssemblyEntry>) {
        let bytes = serde_json::to_vec(&AssemblyTable { parts }).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fn writeRowPng(path: &Path, colors: &[[u8; 4]]) {
        let w = colors.len() as u32;
        let mut buf = image::RgbaImage::new(w, 1);
        for (x, c) in colors.iter().enumerate() {
            buf.put_pixel(x as u32, 0, image::Rgba(*c));
        }
        buf.save(path).unwrap();
    }

    fn pixelAt(result: &CompositeResult, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * result.width + x) as usize) * 4;
        [result.pixels[i], result.pixels[i + 1], result.pixels[i + 2], result.pixels[i + 3]]
    }

    fn bodyEntry(
        name: &str,
        zOrder: i32,
        flipX: bool,
        variants: Option<AssemblyVariants>,
    ) -> AssemblyEntry {
        AssemblyEntry {
            partName: name.into(),
            category: PartCategory::Body,
            position: AssemblyPosition { x: 0, y: 0 },
            zOrder,
            flipX,
            rotation: 0.0,
            variants,
        }
    }

    fn compositeOf(api: &CoreApi, root: &Path, orientation: Orientation) -> CompositeResult {
        api.getCompositeImage(CompositeParams {
            skinRoot: root.to_string_lossy().into_owned(),
            skinName: "st1".into(),
            orientation,
            expressionIndex: 0,
            headVariant: None,
        })
        .expect("composite")
    }

    #[test]
    fn compositeReturnsHundredByHundredCanvas() {
        let tmp = TempDir::new();
        let bodyDir = tmp.path().join("st1").join("Body");
        fs::create_dir_all(&bodyDir).unwrap();
        writeTinyPng(&bodyDir.join("head.png"), [255, 0, 0, 255]);
        writeAssembly(
            &tmp.path().join("assembly.json"),
            vec![bodyEntry("head", 100, false, None)],
        );
        let api = CoreApi::new();
        let result = compositeOf(&api, tmp.path(), Orientation::Front);
        assert_eq!(result.width, 100);
        assert_eq!(result.height, 100);
        assert_eq!(result.pixels.len(), 40_000);
        // 1×1 部件 dstX/dstY = 50 + 0 - 0 = 50 → 中心着色
        assert_eq!(pixelAt(&result, 50, 50), [255, 0, 0, 255]);
        assert_eq!(pixelAt(&result, 0, 0), [0, 0, 0, 0]);
    }

    #[test]
    fn compositeRespectsZOrder() {
        let tmp = TempDir::new();
        let bodyDir = tmp.path().join("st1").join("Body");
        fs::create_dir_all(&bodyDir).unwrap();
        writeTinyPng(&bodyDir.join("bottom.png"), [255, 0, 0, 255]);
        writeTinyPng(&bodyDir.join("top.png"), [0, 0, 255, 255]);
        writeAssembly(
            &tmp.path().join("assembly.json"),
            vec![
                bodyEntry("bottom", 10, false, None),
                bodyEntry("top", 100, false, None),
            ],
        );
        let api = CoreApi::new();
        let result = compositeOf(&api, tmp.path(), Orientation::Front);
        // top (zOrder=100) 后绘制 → 蓝色覆盖红色
        assert_eq!(pixelAt(&result, 50, 50), [0, 0, 255, 255]);
    }

    #[test]
    fn compositeFlipsXWhenRequested() {
        let tmp = TempDir::new();
        let bodyDir = tmp.path().join("st1").join("Body");
        fs::create_dir_all(&bodyDir).unwrap();
        writeRowPng(
            &bodyDir.join("row.png"),
            &[[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]],
        );
        writeAssembly(
            &tmp.path().join("assembly.json"),
            vec![bodyEntry("row", 100, true, None)],
        );
        let api = CoreApi::new();
        let result = compositeOf(&api, tmp.path(), Orientation::Front);
        // 3×1 部件 dstX = 50 - 3/2 = 49；flipX=true 翻转后顺序 B G R
        assert_eq!(pixelAt(&result, 49, 50), [0, 0, 255, 255]);
        assert_eq!(pixelAt(&result, 50, 50), [0, 255, 0, 255]);
        assert_eq!(pixelAt(&result, 51, 50), [255, 0, 0, 255]);
    }

    #[test]
    fn compositeFiltersByVariants() {
        let tmp = TempDir::new();
        let bodyDir = tmp.path().join("st1").join("Body");
        fs::create_dir_all(&bodyDir).unwrap();
        writeTinyPng(&bodyDir.join("a.png"), [255, 0, 0, 255]);
        writeTinyPng(&bodyDir.join("b.png"), [0, 0, 255, 255]);
        writeAssembly(
            &tmp.path().join("assembly.json"),
            vec![
                bodyEntry(
                    "a",
                    100,
                    false,
                    Some(AssemblyVariants {
                        orientation: Some(Orientation::Front),
                        expressionIndex: None,
                        headVariant: None,
                    }),
                ),
                bodyEntry(
                    "b",
                    100,
                    false,
                    Some(AssemblyVariants {
                        orientation: Some(Orientation::Back),
                        expressionIndex: None,
                        headVariant: None,
                    }),
                ),
            ],
        );
        let api = CoreApi::new();
        let front = compositeOf(&api, tmp.path(), Orientation::Front);
        assert_eq!(pixelAt(&front, 50, 50), [255, 0, 0, 255]);
        let back = compositeOf(&api, tmp.path(), Orientation::Back);
        assert_eq!(pixelAt(&back, 50, 50), [0, 0, 255, 255]);
    }

    #[test]
    fn compositePrefersSessionPixelsOverDisk() {
        let tmp = TempDir::new();
        let bodyDir = tmp.path().join("st1").join("Body");
        fs::create_dir_all(&bodyDir).unwrap();
        writeTinyPng(&bodyDir.join("head.png"), [255, 0, 0, 255]);
        writeAssembly(
            &tmp.path().join("assembly.json"),
            vec![bodyEntry("head", 100, false, None)],
        );
        let api = CoreApi::new();
        let loaded = api
            .loadPartImage(LoadPartParams {
                skinRoot: tmp.path().to_string_lossy().into_owned(),
                skinName: "st1".into(),
                category: PartCategory::Body,
                partName: "head".into(),
            })
            .expect("load");
        api.applyBrush(BrushParams {
            partId: loaded.partId,
            cx: 0,
            cy: 0,
            brushSize: 1,
            color: [0, 0, 255, 255],
        })
        .expect("brush");
        let result = compositeOf(&api, tmp.path(), Orientation::Front);
        // session 像素已被刷为蓝色，磁盘仍是红色 → 应取 session 的蓝
        assert_eq!(pixelAt(&result, 50, 50), [0, 0, 255, 255]);
    }

    // ---- 21b: getWorkspace / saveWorkspace / resetLayout 集成测试 ----
    use crate::windowManager::PanelSize;

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
        layout.panels[0].size = PanelSize { width: 300, height: 700 };
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

    // ---- last-write-wins 写入语义 ----
    /// 连续两次 savePart 沿用同一目标路径，磁盘内容反映最后一次写入；
    /// 文件名严格沿用入参。当前实现通过 sessions Mutex 串行化 + 文件原子覆盖天然成立，本测试是回归保护。
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
        layout.panels[0].size = PanelSize { width: 300, height: 700 };
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
        assert_eq!(std::fs::read(&path).unwrap(), snapshotBytes,
            "resetLayout 不应写文件");
        let reloaded = api
            .getWorkspace(WorkspacePathParams {
                path: path.to_string_lossy().into_owned(),
            })
            .expect("reload");
        assert_eq!(reloaded.source, WorkspaceSource::File);
        assert_eq!(reloaded.layout.panels[0].size.width, 300);
    }
}
