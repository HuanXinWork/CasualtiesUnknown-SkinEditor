// 桌面（Tauri commands）与 HTTP（Axum handlers）共用的业务接口抽象层。
// 暴露所有运行时调用并统一入参出参，让两种形态的适配层只承担参数解码、错误转换与响应序列化。
#![allow(non_snake_case)]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::assemblyTable::{
    self, AssemblyEntry, AssemblyPosition, AssemblySource, AssemblyTable, AssemblyVariants, HeadVariant, Orientation,
};
use crate::historyManager::{self, HistoryEntry, HistoryStack, PixelDiff};
use crate::imageOps::{self, Layer, PartEditState};
use crate::layerSidecar;
use crate::baseSizes;
use crate::accessories;
use crate::zones;
use crate::blood;
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

/// 柔和笔刷入参。羽化圆，hardness 0~255 控制硬度；笔画内同点取最大覆盖率不叠浓。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoftBrushParams {
    pub partId: String,
    pub cx: i32,
    pub cy: i32,
    pub brushSize: u8,
    pub hardness: u8,
    pub color: [u8; 4],
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

/// 油漆桶入参。从 (cx,cy) 起在当前 active 图层填充容差内的 4 连通区域。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FillParams {
    pub partId: String,
    pub cx: i32,
    pub cy: i32,
    pub color: [u8; 4],
    pub tolerance: u8,
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

/// 修改部件分辨率：以图中心为锚扩展或缩小所有图层。落盘由本接口直接覆盖磁盘 PNG。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResizePartParams {
    pub partId: String,
    pub width: u32,
    pub height: u32,
    pub targetPath: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResizePartResult {
    pub partId: String,
    pub width: u32,
    pub height: u32,
}

/// 查询单个部件在当前皮肤 baseSizes.json 中登记的标准尺寸；自定义部件 / 缺该文件返回 found = false。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetBaseSizeParams {
    pub skinRoot: String,
    pub skinName: String,
    pub category: PartCategory,
    pub partName: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GetBaseSizeResult {
    pub found: bool,
    pub width: u32,
    pub height: u32,
}

/// 创建当前部件的前侧 / 后侧独立副本：把 `<skin>/<Cat>/<name>.png` 复制为 `<skin>/<Cat>/<name>{F|B}.png`。
/// 仅"前后共享 sprite"白名单部件允许（HandF/HandB 已是独立 PNG，跳过）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSidePartParams {
    pub skinRoot: String,
    pub skinName: String,
    pub category: PartCategory,
    pub partName: String,
    pub side: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSidePartResult {
    pub sidePartName: String,
}

/// 朝右专用 PNG 创建入参：把 `<partName>.png` 复制为 `R_<partName>.png`，朝右朝向时优先采用。
/// 白名单 = 所有翻转得来的部件（除 Wings 外）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateOrientationPartParams {
    pub skinRoot: String,
    pub skinName: String,
    pub category: PartCategory,
    pub partName: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateOrientationPartResult {
    pub orientationPartName: String,
}

/// 新建标准部件入参：在分类目录写一张纯黑占位 PNG 并登记 baseSizes。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePartParams {
    pub skinRoot: String,
    pub skinName: String,
    pub category: PartCategory,
    pub fileName: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePartResult {
    pub partName: String,
}

/// 从内置 exp 模板皮肤复制部件 PNG 入参：用于 Accessories / Blood 等"按模板创建"分类。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePartFromTemplateParams {
    pub skinRoot: String,
    pub skinName: String,
    pub category: PartCategory,
    pub partName: String,
}

/// 复制部件入参：把源部件（含图层）复制为同皮肤同类别下的新部件名。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyPartParams {
    pub skinRoot: String,
    pub skinName: String,
    pub category: PartCategory,
    pub sourcePartName: String,
    pub targetPartName: String,
    /// 目标已存在时是否覆盖；false 时目标存在报 part_exists。
    #[serde(default)]
    pub overwrite: bool,
}

/// 删除部件入参：移除 PNG + sidecar + baseSizes 项 + 卸载内存 session。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletePartParams {
    pub skinRoot: String,
    pub skinName: String,
    pub category: PartCategory,
    pub partName: String,
}

/// 跨部件复制图层入参：把源部件某图层像素作为新图层加入目标部件（两者均需已加载）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyLayerToPartParams {
    pub sourcePartId: String,
    pub sourceLayerId: String,
    pub targetPartId: String,
}

/// 设置图层预览变换入参；transform 为 null 时清除预览。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetLayerTransformParams {
    pub partId: String,
    pub layerId: String,
    pub transform: Option<imageOps::LayerTransform>,
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
    /// 播放时刻（秒）。前端按 RAF 循环递增；用于驱动粒子 / 帧动画。缺省 0 表示静态首帧。
    #[serde(default)]
    pub timeSec: f32,
    /// 角色朝向：true=朝右，渲染时 sprite 优先选 R_ 前缀版本；false=朝左走无前缀。
    #[serde(default)]
    pub isRight: bool,
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
    /// 播放时刻（秒），与 CompositeParams.timeSec 同义；驱动粒子 / 帧动画。
    #[serde(default)]
    pub timeSec: f32,
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

/// 导出皮肤包入参。zipPath 为目标 zip 完整路径；layout=flat/categorized；includeBlood 控制是否含血液配置。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSkinPackParams {
    pub skinRoot: String,
    pub zipPath: String,
    #[serde(default)]
    pub layout: Option<String>,
    #[serde(default)]
    pub includeBlood: Option<bool>,
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

/// 切换某皮肤里指定 id 配件的 enabled。配件不存在时报 accessory_not_found。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetAccessoryEnabledParams {
    pub skinRoot: String,
    pub skinName: String,
    pub id: String,
    pub enabled: bool,
}

/// 写整条配件配置。entry.id 不存在则追加；存在则原位替换。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveAccessoryConfigParams {
    pub skinRoot: String,
    pub skinName: String,
    pub entry: accessories::AccessoryEntry,
}

/// 读 per-skin blood.json。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BloodConfigPathParams {
    pub skinRoot: String,
    pub skinName: String,
}

/// 整体覆写 blood.json。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveBloodConfigParams {
    pub skinRoot: String,
    pub skinName: String,
    pub config: blood::BloodConfig,
}

/// 加载部件区块（mask + config）。mask 缺失返回空 ids，config 缺失返回空 zones。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadZonesParams {
    pub skinRoot: String,
    pub skinName: String,
    pub category: PartCategory,
    pub partName: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoadZonesResult {
    pub width: u32,
    pub height: u32,
    /// length = width * height；0 表示无区块。
    pub ids: Vec<u8>,
    pub config: zones::ZonesConfig,
}

/// 写整张 mask + 整份 config。前端在内存里增量改完整张上传，简化后端无需差量。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveZonesParams {
    pub skinRoot: String,
    pub skinName: String,
    pub category: PartCategory,
    pub partName: String,
    pub width: u32,
    pub height: u32,
    pub ids: Vec<u8>,
    pub config: zones::ZonesConfig,
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
    fn applyFill(&self, params: FillParams) -> Result<PixelDiff, ApiError>;
    fn applySoftBrush(&self, params: SoftBrushParams) -> Result<PixelDiff, ApiError>;
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
    fn resizePart(&self, params: ResizePartParams) -> Result<ResizePartResult, ApiError>;
    fn getBaseSize(&self, params: GetBaseSizeParams) -> Result<GetBaseSizeResult, ApiError>;
    fn createSidePart(&self, params: CreateSidePartParams) -> Result<CreateSidePartResult, ApiError>;
    fn createOrientationPart(&self, params: CreateOrientationPartParams) -> Result<CreateOrientationPartResult, ApiError>;
    fn createPart(&self, params: CreatePartParams) -> Result<CreatePartResult, ApiError>;
    fn createPartFromTemplate(&self, params: CreatePartFromTemplateParams) -> Result<CreatePartResult, ApiError>;
    fn copyPart(&self, params: CopyPartParams) -> Result<CreatePartResult, ApiError>;
    fn deletePart(&self, params: DeletePartParams) -> Result<(), ApiError>;
    fn copyLayerToPart(&self, params: CopyLayerToPartParams) -> Result<LayersSnapshot, ApiError>;
    fn setLayerTransform(&self, params: SetLayerTransformParams) -> Result<(), ApiError>;
    fn bakeLayerTransform(&self, params: RemoveLayerParams) -> Result<PixelDiff, ApiError>;
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
    fn setAccessoryEnabled(&self, params: SetAccessoryEnabledParams) -> Result<(), ApiError>;
    fn saveAccessoryConfig(&self, params: SaveAccessoryConfigParams) -> Result<(), ApiError>;

    fn loadBloodConfig(&self, params: BloodConfigPathParams) -> Result<blood::BloodConfig, ApiError>;
    fn saveBloodConfig(&self, params: SaveBloodConfigParams) -> Result<(), ApiError>;
    fn loadZones(&self, params: LoadZonesParams) -> Result<LoadZonesResult, ApiError>;
    fn saveZones(&self, params: SaveZonesParams) -> Result<(), ApiError>;
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
    /// 软笔刷笔画覆盖率缓冲（整图，0~255）；仅软笔刷使用，懒初始化。
    softCoverage: Option<Vec<u8>>,
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
        let root = crate::dataPaths::resolveSkinRoot(&params.skinRoot);
        if let Err(e) = std::fs::create_dir_all(&root) {
            return Err(ApiError {
                code: "io_failed".into(),
                message: format!("create skin root {} failed: {}", root.display(), e),
            });
        }
        let _ = crate::ensureEmbeddedDefaultSkin(&root);
        Ok(skinLoader::listSkins(&root))
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
        let baseSizesMap = baseSizes::load(&skinDir);
        let mut entries = buildMotionCompositeEntries(&frame, params.expressionIndex, &params.headVariant);
        // 启用中的配件作为虚拟 entries 并入主排序：
        // 父锚 = frame.limbs 里同名 limb（动画驱动的实时位姿），sortingOrder 与 base 同轴比较，避免"配件总在最前"。
        let accList = accessories::loadAccessories(&accessories::accessoriesPath(
            &PathBuf::from(&params.skinRoot),
            &params.skinName,
        ));
        let mut accVirtuals: Vec<(AssemblyEntry, Option<char>)> = Vec::new();
        for a in accList.iter().filter(|a| a.enabled) {
            let parent = match frame.limbs.iter().find(|l| l.visible && l.name == a.limb) {
                Some(p) => p,
                None => continue,
            };
            accVirtuals.push((AssemblyEntry {
                partName: format!("__acc:{}", a.id),
                category: PartCategory::Accessories,
                position: motionCompositePosition(parent),
                zOrder: parent.sortingOrder + a.z,
                flipX: false,
                rotation: parent.rotZ + a.rot,
                variants: None,
            }, None));
            if let Some(secs) = &a.secondaryLimbs {
                for (idx, sec) in secs.iter().enumerate() {
                    let secParent = match frame.limbs.iter().find(|l| l.visible && l.name == sec.limb) {
                        Some(p) => p,
                        None => continue,
                    };
                    accVirtuals.push((AssemblyEntry {
                        partName: format!("__acc:{}#{}", a.id, idx),
                        category: PartCategory::Accessories,
                        position: motionCompositePosition(secParent),
                        zOrder: secParent.sortingOrder + sec.z,
                        flipX: false,
                        rotation: secParent.rotZ + sec.rot,
                        variants: None,
                    }, None));
                }
            }
        }
        for v in accVirtuals { entries.push(v); }
        let accById: std::collections::HashMap<&str, &accessories::AccessoryEntry> =
            accList.iter().filter(|a| a.enabled).map(|a| (a.id.as_str(), a)).collect();
        entries.sort_by_key(|(e, _)| e.zOrder);
        let sessions = lockSessions(&self.sessions)?;
        for (entry, sideHint) in entries {
            // 配件分支：sprite 名解码自 partName 前缀，再用 acc.offX/offY 微调。
            if entry.category == PartCategory::Accessories {
                let raw = entry.partName.strip_prefix("__acc:").unwrap_or("");
                let (id, secIdx) = match raw.split_once('#') {
                    Some((id, idx)) => (id, idx.parse::<usize>().ok()),
                    None => (raw, None),
                };
                let acc = match accById.get(id) { Some(a) => *a, None => continue };
                let (spriteName, offX, offY) = if let Some(idx) = secIdx {
                    let sec = match acc.secondaryLimbs.as_ref().and_then(|v| v.get(idx)) {
                        Some(s) => s, None => continue,
                    };
                    (sec.sprite.as_str(), sec.offX, sec.offY)
                } else {
                    (acc.sprite.as_str(), acc.offX, acc.offY)
                };
                let picked = pickPartPixels(
                    &sessions,
                    &skinDir,
                    &params.skinName,
                    PartCategory::Accessories,
                    spriteName,
                    None,
                    frame.isRight,
                );
                let (partW, partH, pixels) = match picked { Some(t) => t, None => continue };
                let parentRad = -(entry.rotation - acc.rot).to_radians();
                let c = parentRad.cos();
                let s = parentRad.sin();
                let dx = (offX as f32) * c - (offY as f32) * s;
                let dy = (offX as f32) * s + (offY as f32) * c;
                let centerX = (COMPOSITE_W as i32) / 2 + entry.position.x + dx.round() as i32;
                let centerY = (COMPOSITE_H as i32) / 2 + entry.position.y + dy.round() as i32;
                imageOps::blitWithRotation(
                    &mut canvas, COMPOSITE_W, COMPOSITE_H, &pixels, partW, partH,
                    centerX, centerY, entry.rotation, false,
                );
                continue;
            }
            // entry.partName 是 base 名；sideHint 来自 frame.limbs[*].name 末尾 F/B（HandF/HandB/Tail/wing 不参与）。
            // 用户为前后共享部件单独画 sided PNG 时，sided 优先；缺失退回共享 base。
            let basePart: &str = &entry.partName;
            let sidedName = sideHint.and_then(|c| sidedCandidateName(basePart, c));
            let picked = pickPartPixels(
                &sessions,
                &skinDir,
                &params.skinName,
                entry.category,
                basePart,
                sidedName.as_deref(),
                frame.isRight,
            );
            let (partW, partH, pixels) = match picked {
                Some(t) => t,
                None => continue,
            };
            // 按 baseSizes 标准尺寸缩回；sidedName 优先查表，缺失退回 basePart。
            let renderedName: &str = sidedName.as_deref().unwrap_or(basePart);
            let (partW, partH, pixels) = applyBaseSizeFit(&baseSizesMap, entry.category, renderedName, basePart, partW, partH, pixels);
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
            renderZoneLightsForPart(
                &mut canvas, COMPOSITE_W, COMPOSITE_H,
                &PathBuf::from(&params.skinRoot), &params.skinName,
                categoryDir(entry.category), renderedName, basePart,
                partW, partH, centerX, centerY, entry.rotation, false,
                params.timeSec,
            );
            renderZoneEffectsForPart(
                &mut canvas, COMPOSITE_W, COMPOSITE_H,
                &PathBuf::from(&params.skinRoot), &params.skinName,
                categoryDir(entry.category), renderedName, basePart,
                partW, partH, centerX, centerY, entry.rotation, false,
                params.timeSec, &sessions,
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
                transform: None,
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

    fn applyFill(&self, params: FillParams) -> Result<PixelDiff, ApiError> {
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
        let diff = imageOps::applyFill(
            &mut layer.pixels,
            width,
            height,
            params.cx,
            params.cy,
            params.color,
            params.tolerance,
        );
        if diff.width != 0 && diff.height != 0 {
            session.history.push(HistoryEntry {
                layerId,
                diff: diff.clone(),
                timestamp: nowMillis(),
            });
        }
        Ok(diff)
    }

    fn applySoftBrush(&self, params: SoftBrushParams) -> Result<PixelDiff, ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get_mut(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        let (width, height) = (session.state.width, session.state.height);
        let activeIdx = session.activeLayerIndex;
        let layer = session.state.layers.get(activeIdx).ok_or_else(|| ApiError {
            code: "no_layer".into(),
            message: "session has no active layer".into(),
        })?;
        let layerId = layer.id.clone();
        let pixelLen = layer.pixels.len();
        // 无进行中的笔画时退化为单次合成（baseline = 当前图层），不做笔画内防叠浓。
        let baseline: Vec<u8> = match session.activeStroke.as_ref() {
            Some(s) if s.layerId == layerId => s.baseline.clone(),
            _ => session.state.layers[activeIdx].pixels.clone(),
        };
        let mut coverage: Vec<u8> = match session.activeStroke.as_mut() {
            Some(s) if s.layerId == layerId => {
                s.softCoverage.take().unwrap_or_else(|| vec![0u8; pixelLen / 4])
            }
            _ => vec![0u8; pixelLen / 4],
        };
        let rect = match imageOps::stampSoftCoverage(
            &mut coverage, width, height, params.cx, params.cy, params.brushSize, params.hardness,
        ) {
            Some(r) => r,
            None => {
                if let Some(s) = session.activeStroke.as_mut() {
                    if s.layerId == layerId { s.softCoverage = Some(coverage); }
                }
                return Ok(emptyPixelDiff());
            }
        };
        let layerMut = &mut session.state.layers[activeIdx];
        let before = copyRectFromBuffer(&layerMut.pixels, width, rect.0, rect.1, rect.2, rect.3);
        imageOps::compositeSoftStroke(&mut layerMut.pixels, &baseline, &coverage, width, rect, params.color);
        let after = copyRectFromBuffer(&layerMut.pixels, width, rect.0, rect.1, rect.2, rect.3);
        let diff = PixelDiff {
            x: rect.0,
            y: rect.1,
            width: rect.2 - rect.0,
            height: rect.3 - rect.1,
            before,
            after,
        };
        match session.activeStroke.as_mut() {
            Some(s) if s.layerId == layerId => {
                s.softCoverage = Some(coverage);
                mergeStrokeRect(s, &diff);
            }
            _ => {
                session.history.push(HistoryEntry {
                    layerId,
                    diff: diff.clone(),
                    timestamp: nowMillis(),
                });
            }
        }
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
            softCoverage: None,
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

    fn resizePart(&self, params: ResizePartParams) -> Result<ResizePartResult, ApiError> {
        if params.width == 0 || params.height == 0 {
            return Err(ApiError {
                code: "invalid_size".into(),
                message: format!("size must be positive: {}x{}", params.width, params.height),
            });
        }
        const MAX_SIDE: u32 = 4096;
        if params.width > MAX_SIDE || params.height > MAX_SIDE {
            return Err(ApiError {
                code: "size_too_large".into(),
                message: format!("size exceeds {}: {}x{}", MAX_SIDE, params.width, params.height),
            });
        }
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get_mut(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        let oldW = session.state.width;
        let oldH = session.state.height;
        if oldW == params.width && oldH == params.height {
            return Ok(ResizePartResult { partId: params.partId, width: oldW, height: oldH });
        }
        // 所有图层逐一按目标尺寸最近邻缩放：原内容跟随像素块拉伸，零透明边。
        for layer in &mut session.state.layers {
            layer.pixels = imageOps::scaleNearest(&layer.pixels, oldW, oldH, params.width, params.height);
        }
        session.state.width = params.width;
        session.state.height = params.height;
        session.history.clear();
        session.activeStroke = None;
        // 立即落盘合成 PNG，让磁盘 PNG 与新分辨率同步。sidecar 也一并写。
        let pixels = imageOps::flatten(&session.state);
        let target = PathBuf::from(&params.targetPath);
        imageOps::savePng(&target, params.width, params.height, &pixels)?;
        let partNameOpt = target.file_stem().and_then(|s| s.to_str()).map(|s| s.to_string());
        let categoryOpt = target.parent().and_then(|p| p.file_name()).and_then(|s| s.to_str()).map(|s| s.to_string());
        let skinDirOpt = target.parent().and_then(|p| p.parent()).map(|p| p.to_path_buf());
        if let (Some(skinDir), Some(catDir), Some(partName)) = (skinDirOpt.clone(), categoryOpt.clone(), partNameOpt.clone()) {
            if let Err(e) = layerSidecar::save(&skinDir, &catDir, &partName, &session.state, session.activeLayerIndex) {
                eprintln!("[resizePart] sidecar 写盘失败：{}", e.message);
            }
        }
        let _ = (skinDirOpt, categoryOpt, partNameOpt);
        Ok(ResizePartResult { partId: params.partId, width: params.width, height: params.height })
    }

    fn getBaseSize(&self, params: GetBaseSizeParams) -> Result<GetBaseSizeResult, ApiError> {
        let skinDir = PathBuf::from(&params.skinRoot).join(&params.skinName);
        let map = baseSizes::load(&skinDir);
        let catDir = categoryDir(params.category);
        let primary = baseSizes::keyFor(catDir, &params.partName);
        let hit = map.get(&primary).or_else(|| {
            let stripped = baseSizes::stripSideSuffixForLookup(&params.partName);
            if stripped == params.partName { return None; }
            map.get(&baseSizes::keyFor(catDir, stripped))
        });
        match hit {
            Some((w, h)) => Ok(GetBaseSizeResult { found: true, width: w, height: h }),
            None => Ok(GetBaseSizeResult { found: false, width: 0, height: 0 }),
        }
    }

    fn createSidePart(&self, params: CreateSidePartParams) -> Result<CreateSidePartResult, ApiError> {
        if params.side != "F" && params.side != "B" {
            return Err(ApiError {
                code: "invalid_side".into(),
                message: format!("side must be \"F\" or \"B\", got: {}", params.side),
            });
        }
        if !isSideSplittablePartName(&params.partName) {
            return Err(ApiError {
                code: "not_splittable".into(),
                message: format!("part {} is not in side-split whitelist", params.partName),
            });
        }
        if endsWithSideSuffix(&params.partName) {
            return Err(ApiError {
                code: "already_sided".into(),
                message: format!("part {} already has a side suffix", params.partName),
            });
        }
        let skinDir = PathBuf::from(&params.skinRoot).join(&params.skinName);
        let catDir = skinDir.join(categoryDir(params.category));
        let src = catDir.join(format!("{}.png", params.partName));
        if !src.exists() {
            return Err(ApiError {
                code: "source_missing".into(),
                message: format!("source PNG not found: {}", src.display()),
            });
        }
        let sideName = format!("{}{}", params.partName, params.side);
        let dst = catDir.join(format!("{}.png", sideName));
        if dst.exists() {
            return Err(ApiError {
                code: "side_part_exists".into(),
                message: format!("side PNG already exists: {}", dst.display()),
            });
        }
        std::fs::copy(&src, &dst).map_err(|e| ApiError {
            code: "io_failed".into(),
            message: format!("copy {} -> {} failed: {}", src.display(), dst.display(), e),
        })?;
        Ok(CreateSidePartResult { sidePartName: sideName })
    }

    fn createOrientationPart(&self, params: CreateOrientationPartParams) -> Result<CreateOrientationPartResult, ApiError> {
        if params.partName.starts_with("R_") {
            return Err(ApiError {
                code: "already_oriented".into(),
                message: format!("part {} already has R_ prefix", params.partName),
            });
        }
        if !isOrientationSplittablePart(&params.partName, params.category) {
            return Err(ApiError {
                code: "not_orientation_splittable".into(),
                message: format!("part {} is not orientation-splittable", params.partName),
            });
        }
        let skinDir = PathBuf::from(&params.skinRoot).join(&params.skinName);
        let catDir = skinDir.join(categoryDir(params.category));
        let src = catDir.join(format!("{}.png", params.partName));
        if !src.exists() {
            return Err(ApiError {
                code: "source_missing".into(),
                message: format!("source PNG not found: {}", src.display()),
            });
        }
        let orientName = format!("R_{}", params.partName);
        let dst = catDir.join(format!("{}.png", orientName));
        if dst.exists() {
            return Err(ApiError {
                code: "orientation_part_exists".into(),
                message: format!("R_ PNG already exists: {}", dst.display()),
            });
        }
        std::fs::copy(&src, &dst).map_err(|e| ApiError {
            code: "io_failed".into(),
            message: format!("copy {} -> {} failed: {}", src.display(), dst.display(), e),
        })?;
        Ok(CreateOrientationPartResult { orientationPartName: orientName })
    }

    fn createPart(&self, params: CreatePartParams) -> Result<CreatePartResult, ApiError> {
        let name = params.fileName.trim();
        if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
            return Err(ApiError {
                code: "invalid_name".into(),
                message: format!("invalid part fileName: {}", params.fileName),
            });
        }
        if params.width == 0 || params.height == 0 || params.width > 1024 || params.height > 1024 {
            return Err(ApiError {
                code: "invalid_size".into(),
                message: format!("invalid size {}x{}", params.width, params.height),
            });
        }
        let catDirName = categoryDir(params.category);
        let catDir = PathBuf::from(&params.skinRoot).join(&params.skinName).join(catDirName);
        std::fs::create_dir_all(&catDir).map_err(|e| ApiError {
            code: "io_failed".into(),
            message: format!("mkdir {} failed: {}", catDir.display(), e),
        })?;
        let dst = catDir.join(format!("{}.png", name));
        if dst.exists() {
            return Err(ApiError {
                code: "part_exists".into(),
                message: format!("part PNG already exists: {}", dst.display()),
            });
        }
        let pixelCount = (params.width * params.height) as usize;
        let mut pixels = vec![0u8; pixelCount * 4];
        for i in 0..pixelCount {
            pixels[i * 4 + 3] = 255;
        }
        imageOps::savePng(&dst, params.width, params.height, &pixels)?;
        let skinDir = PathBuf::from(&params.skinRoot).join(&params.skinName);
        let _ = baseSizes::upsert(&skinDir, &baseSizes::keyFor(catDirName, name), params.width, params.height);
        Ok(CreatePartResult { partName: name.to_string() })
    }

    fn createPartFromTemplate(&self, params: CreatePartFromTemplateParams) -> Result<CreatePartResult, ApiError> {
        let name = params.partName.trim();
        if name.is_empty() || name.contains('/') || name.contains('\\') || name.contains("..") {
            return Err(ApiError {
                code: "invalid_name".into(),
                message: format!("invalid partName: {}", params.partName),
            });
        }
        let catDirName = categoryDir(params.category);
        let rel = format!("{}/{}.png", catDirName, name);
        let bytes = crate::embeddedTemplateBytes(&rel).ok_or_else(|| ApiError {
            code: "template_not_found".into(),
            message: format!("no embedded template at {}", rel),
        })?;
        let catDir = PathBuf::from(&params.skinRoot).join(&params.skinName).join(catDirName);
        std::fs::create_dir_all(&catDir).map_err(|e| ApiError {
            code: "io_failed".into(),
            message: format!("mkdir {} failed: {}", catDir.display(), e),
        })?;
        let dst = catDir.join(format!("{}.png", name));
        if dst.exists() {
            return Err(ApiError {
                code: "part_exists".into(),
                message: format!("part PNG already exists: {}", dst.display()),
            });
        }
        std::fs::write(&dst, &bytes).map_err(|e| ApiError {
            code: "io_failed".into(),
            message: format!("write {} failed: {}", dst.display(), e),
        })?;
        let (w, h, _) = imageOps::loadPng(&dst)?;
        let skinDir = PathBuf::from(&params.skinRoot).join(&params.skinName);
        let _ = baseSizes::upsert(&skinDir, &baseSizes::keyFor(catDirName, name), w, h);
        if matches!(params.category, PartCategory::Accessories) {
            let _ = appendAccessoryEntryFromTemplate(&skinDir, name);
        }
        Ok(CreatePartResult { partName: name.to_string() })
    }

    fn copyPart(&self, params: CopyPartParams) -> Result<CreatePartResult, ApiError> {
        let target = params.targetPartName.trim();
        if target.is_empty() || target.contains('/') || target.contains('\\') || target.contains("..") {
            return Err(ApiError {
                code: "invalid_name".into(),
                message: format!("invalid target part name: {}", params.targetPartName),
            });
        }
        let catDirName = categoryDir(params.category);
        let skinDir = PathBuf::from(&params.skinRoot).join(&params.skinName);
        let catDir = skinDir.join(catDirName);
        let dstPng = catDir.join(format!("{}.png", target));
        if dstPng.exists() && !params.overwrite {
            return Err(ApiError {
                code: "part_exists".into(),
                message: format!("target part already exists: {}", dstPng.display()),
            });
        }
        // 源优先取内存 session（含未保存改动），否则从磁盘读；覆盖时卸载目标已加载 session。
        let srcPartId = partIdKey(&params.skinName, params.category, &params.sourcePartName);
        let dstPartId = partIdKey(&params.skinName, params.category, target);
        let state = {
            let mut sessions = lockSessions(&self.sessions)?;
            let st = if let Some(s) = sessions.get(&srcPartId) {
                s.state.clone()
            } else {
                loadStateFromDisk(&skinDir, catDirName, &params.sourcePartName)?
            };
            sessions.remove(&dstPartId);
            st
        };
        let flat = imageOps::flatten(&state);
        imageOps::savePng(&dstPng, state.width, state.height, &flat)?;
        layerSidecar::save(&skinDir, catDirName, target, &state, 0)?;
        let _ = baseSizes::upsert(&skinDir, &baseSizes::keyFor(catDirName, target), state.width, state.height);
        Ok(CreatePartResult { partName: target.to_string() })
    }

    fn deletePart(&self, params: DeletePartParams) -> Result<(), ApiError> {
        let catDirName = categoryDir(params.category);
        let skinDir = PathBuf::from(&params.skinRoot).join(&params.skinName);
        let png = skinDir.join(catDirName).join(format!("{}.png", params.partName));
        if png.exists() {
            std::fs::remove_file(&png).map_err(|e| ApiError {
                code: "io_failed".into(),
                message: format!("remove {} failed: {}", png.display(), e),
            })?;
        }
        let sideDir = layerSidecar::sidecarDir(&skinDir, catDirName, &params.partName);
        if sideDir.exists() {
            let _ = std::fs::remove_dir_all(&sideDir);
        }
        let _ = baseSizes::remove(&skinDir, &baseSizes::keyFor(catDirName, &params.partName));
        let partId = partIdKey(&params.skinName, params.category, &params.partName);
        let mut sessions = lockSessions(&self.sessions)?;
        sessions.remove(&partId);
        Ok(())
    }

    fn copyLayerToPart(&self, params: CopyLayerToPartParams) -> Result<LayersSnapshot, ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let src = sessions.get(&params.sourcePartId).ok_or_else(|| notLoaded(&params.sourcePartId))?;
        let srcLayer = src.state.layers.iter().find(|l| l.id == params.sourceLayerId).ok_or_else(|| ApiError {
            code: "no_layer".into(),
            message: format!("source layer {} not found", params.sourceLayerId),
        })?;
        let srcName = srcLayer.name.clone();
        let (srcW, srcH) = (src.state.width, src.state.height);
        let srcPixels = srcLayer.pixels.clone();
        let target = sessions.get_mut(&params.targetPartId).ok_or_else(|| notLoaded(&params.targetPartId))?;
        if target.state.layers.len() >= 8 {
            return Err(ApiError {
                code: "layer_limit".into(),
                message: "target part already has 8 layers".into(),
            });
        }
        let (dstW, dstH) = (target.state.width, target.state.height);
        // 尺寸不一致时按左上对齐裁剪/留空，避免缓冲长度不匹配。
        let pixels = if srcW == dstW && srcH == dstH {
            srcPixels
        } else {
            let mut buf = vec![0u8; (dstW as usize) * (dstH as usize) * 4];
            let copyW = srcW.min(dstW);
            let copyH = srcH.min(dstH);
            for y in 0..copyH {
                let srcRow = (y * srcW) as usize * 4;
                let dstRow = (y * dstW) as usize * 4;
                let len = (copyW as usize) * 4;
                buf[dstRow..dstRow + len].copy_from_slice(&srcPixels[srcRow..srcRow + len]);
            }
            buf
        };
        let newId = format!("layer{}", nowMillis());
        target.state.layers.push(Layer {
            id: newId,
            name: srcName,
            visible: true,
            opacity: 255,
            pixels,
            transform: None,
        });
        target.activeLayerIndex = target.state.layers.len() - 1;
        Ok(snapshot(target))
    }

    fn setLayerTransform(&self, params: SetLayerTransformParams) -> Result<(), ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions.get_mut(&params.partId).ok_or_else(|| notLoaded(&params.partId))?;
        let layer = session.state.layers.iter_mut().find(|l| l.id == params.layerId).ok_or_else(|| ApiError {
            code: "no_layer".into(),
            message: format!("layer {} not found", params.layerId),
        })?;
        layer.transform = params.transform.filter(|t| !t.isIdentity());
        Ok(())
    }

    fn bakeLayerTransform(&self, params: RemoveLayerParams) -> Result<PixelDiff, ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        let session = sessions.get_mut(&params.partId).ok_or_else(|| notLoaded(&params.partId))?;
        let width = session.state.width;
        let height = session.state.height;
        let layer = session.state.layers.iter_mut().find(|l| l.id == params.layerId).ok_or_else(|| ApiError {
            code: "no_layer".into(),
            message: format!("layer {} not found", params.layerId),
        })?;
        let transform = match layer.transform.take() {
            Some(t) if !t.isIdentity() => t,
            _ => return Ok(emptyPixelDiff()),
        };
        let before = layer.pixels.clone();
        let after = imageOps::transformLayerPixels(&before, width, height, &transform);
        layer.pixels = after.clone();
        let layerId = layer.id.clone();
        let diff = PixelDiff { x: 0, y: 0, width, height, before, after };
        session.history.push(HistoryEntry {
            layerId,
            diff: diff.clone(),
            timestamp: nowMillis(),
        });
        Ok(diff)
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
            transform: None,
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
        let skinDir = PathBuf::from(&params.skinRoot).join(&params.skinName);
        let baseSizesMap = baseSizes::load(&skinDir);
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

        // 翼上翼姿态在 entries 排序前查找——只需要 wing entry 存在性，不依赖排序。
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

        // 把启用中的配件作为虚拟 entries 并入主排序列表：partName 用 `__acc:<id>` 前缀作为运行时标记，
        // category=Accessories 让主循环走 sided=None 取磁盘 / session 的 PNG；
        // position 直接复制父 entry（与游戏 Body.WearWearable 把 item 设为 limb 子节点 + localPosition=Vector3.zero 等价）；
        // zOrder = 父 entry zOrder + acc.z（与 mod 端 limbSr.sortingOrder + entry.zOrder 一致）。
        // offX/offY/acc.rot 仅作运行时微调，渲染时再叠。
        let accList = accessories::loadAccessories(&accessories::accessoriesPath(
            &PathBuf::from(&params.skinRoot),
            &params.skinName,
        ));
        // 拷贝出虚拟 entries 暂存，避免在主 entries（&AssemblyEntry 借用）上做生命周期复杂处理。
        let mut accVirtuals: Vec<AssemblyEntry> = Vec::new();
        for a in accList.iter().filter(|a| a.enabled) {
            let parent = match accessoryParentEntry(&table, &a.limb) { Some(p) => p, None => continue };
            accVirtuals.push(AssemblyEntry {
                partName: format!("__acc:{}", a.id),
                category: PartCategory::Accessories,
                position: parent.position,
                zOrder: parent.zOrder + a.z,
                flipX: parent.flipX,
                rotation: parent.rotation + a.rot,
                variants: None,
            });
            // 副件：每个 secondaryLimb 独立查父 entry，与主件并列加入排序列表。
            // partName 用 `__acc:<id>#<limb>` 区分主副，渲染时按 # 解析回 sec 配置。
            if let Some(secs) = &a.secondaryLimbs {
                for (idx, sec) in secs.iter().enumerate() {
                    let secParent = match accessoryParentEntry(&table, &sec.limb) { Some(p) => p, None => continue };
                    accVirtuals.push(AssemblyEntry {
                        partName: format!("__acc:{}#{}", a.id, idx),
                        category: PartCategory::Accessories,
                        position: secParent.position,
                        zOrder: secParent.zOrder + sec.z,
                        flipX: secParent.flipX,
                        rotation: secParent.rotation + sec.rot,
                        variants: None,
                    });
                }
            }
        }
        // 将虚拟 entries 与原 entries 合并；entries 此时是 Vec<&AssemblyEntry>，把 accVirtuals 也按引用接入。
        for v in &accVirtuals { entries.push(v); }

        // 重新排序：base 走原有逻辑；配件用 entry.zOrder（已含父 zOrder 偏移），与 base 同轴比较。
        entries.sort_by_key(|e| {
            let ovr = overrides.get(&(e.partName.clone(), e.category));
            if e.category == PartCategory::Wings {
                resolveWingZ(e, ovr)
            } else {
                ovr.and_then(|o| o.zOrder).unwrap_or(e.zOrder)
            }
        });

        // 用 partName 前缀回查 acc 配置，得到 offX/offY 微调（acc.rot 已并入 entry.rotation）。
        let accById: std::collections::HashMap<&str, &accessories::AccessoryEntry> =
            accList.iter().filter(|a| a.enabled).map(|a| (a.id.as_str(), a)).collect();

        for entry in entries {
            // 配件分支：按 entry.position（已是父 limb 像素位置）+ acc.offX/offY 偏移渲染。
            if entry.category == PartCategory::Accessories {
                let raw = entry.partName.strip_prefix("__acc:").unwrap_or("");
                // 支持主件 `id` 与副件 `id#index` 两种命名。
                let (id, secIdx) = match raw.split_once('#') {
                    Some((id, idx)) => (id, idx.parse::<usize>().ok()),
                    None => (raw, None),
                };
                let acc = match accById.get(id) { Some(a) => *a, None => continue };
                let (spriteName, offX, offY) = if let Some(idx) = secIdx {
                    let sec = match acc.secondaryLimbs.as_ref().and_then(|v| v.get(idx)) {
                        Some(s) => s, None => continue,
                    };
                    (sec.sprite.as_str(), sec.offX, sec.offY)
                } else {
                    (acc.sprite.as_str(), acc.offX, acc.offY)
                };
                let picked = pickPartPixels(
                    &sessions,
                    &PathBuf::from(&params.skinRoot).join(&params.skinName),
                    &params.skinName,
                    PartCategory::Accessories,
                    spriteName,
                    None,
                    params.isRight,
                );
                let (partW, partH, pixels) = match picked { Some(t) => t, None => continue };
                // offX/offY 在父 limb 局部像素轴上；用父 rotation 把它旋到世界，与 mod 端 transform.localPosition 跟着父级旋转一致。
                let parentRad = -(entry.rotation - 0.0).to_radians();
                let c = parentRad.cos();
                let s = parentRad.sin();
                let dx = (offX as f32) * c - (offY as f32) * s;
                let dy = (offX as f32) * s + (offY as f32) * c;
                let centerX = (COMPOSITE_W as i32) / 2 + entry.position.x + dx.round() as i32;
                let centerY = (COMPOSITE_H as i32) / 2 + entry.position.y + dy.round() as i32;
                imageOps::blitWithRotation(
                    &mut canvas, COMPOSITE_W, COMPOSITE_H, &pixels, partW, partH,
                    centerX, centerY, entry.rotation, entry.flipX,
                );
                continue;
            }
            // assembly entry.partName 是 base 名；同 base 在 entries 里出现两次（前后两 limb），
            // 按 entry.zOrder 符号决定取 F / B sided 候选：F 大 / B 小（与 defaultAssembly 注释一致）。
            let basePart: &str = &entry.partName;
            let sidedName = sidedCandidateName(basePart, if entry.zOrder >= 0 { 'F' } else { 'B' });
            let picked = pickPartPixels(
                &sessions,
                &PathBuf::from(&params.skinRoot).join(&params.skinName),
                &params.skinName,
                entry.category,
                basePart,
                sidedName.as_deref(),
                params.isRight,
            );
            let (partW, partH, pixels) = match picked {
                Some(t) => t,
                None => continue,
            };
            // 按 baseSizes 标准尺寸缩回；F/B sided 副本走 fallback 命中 base。
            let renderedName: &str = sidedName.as_deref().unwrap_or(basePart);
            let (partW, partH, pixels) = applyBaseSizeFit(&baseSizesMap, entry.category, renderedName, basePart, partW, partH, pixels);
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
            // 区块发光：按 part 的 zones.png/json 在合成画布上叠径向光。
            renderZoneLightsForPart(
                &mut canvas, COMPOSITE_W, COMPOSITE_H,
                &PathBuf::from(&params.skinRoot), &params.skinName,
                categoryDir(entry.category), renderedName, basePart,
                partW, partH, centerX, centerY, rotation, flipX,
                params.timeSec,
            );
            renderZoneEffectsForPart(
                &mut canvas, COMPOSITE_W, COMPOSITE_H,
                &PathBuf::from(&params.skinRoot), &params.skinName,
                categoryDir(entry.category), renderedName, basePart,
                partW, partH, centerX, centerY, rotation, flipX,
                params.timeSec, &sessions,
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
        let layout = skinLoader::ExportLayout::fromStr(params.layout.as_deref().unwrap_or("topLevel"));
        let includeBlood = params.includeBlood.unwrap_or(false);
        let n = skinLoader::exportSkinPack(
            &PathBuf::from(params.skinRoot),
            &PathBuf::from(params.zipPath),
            layout,
            includeBlood,
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

    fn setAccessoryEnabled(&self, params: SetAccessoryEnabledParams) -> Result<(), ApiError> {
        let path = accessories::accessoriesPath(
            &PathBuf::from(&params.skinRoot),
            &params.skinName,
        );
        let mut list = accessories::loadAccessories(&path);
        if !accessories::setEnabledById(&mut list, &params.id, params.enabled) {
            return Err(ApiError {
                code: "accessory_not_found".into(),
                message: format!("accessory id '{}' not in {}", params.id, path.display()),
            });
        }
        accessories::saveAccessories(&path, &list)
    }

    fn saveAccessoryConfig(&self, params: SaveAccessoryConfigParams) -> Result<(), ApiError> {
        let path = accessories::accessoriesPath(
            &PathBuf::from(&params.skinRoot),
            &params.skinName,
        );
        let mut list = accessories::loadAccessories(&path);
        if let Some(idx) = list.iter().position(|e| e.id == params.entry.id) {
            list[idx] = params.entry;
        } else {
            list.push(params.entry);
        }
        accessories::saveAccessories(&path, &list)
    }

    fn loadBloodConfig(&self, params: BloodConfigPathParams) -> Result<blood::BloodConfig, ApiError> {
        let path = blood::bloodConfigPath(&PathBuf::from(&params.skinRoot), &params.skinName);
        Ok(blood::loadBloodConfig(&path))
    }

    fn saveBloodConfig(&self, params: SaveBloodConfigParams) -> Result<(), ApiError> {
        let path = blood::bloodConfigPath(&PathBuf::from(&params.skinRoot), &params.skinName);
        blood::saveBloodConfig(&path, &params.config)
    }

    fn loadZones(&self, params: LoadZonesParams) -> Result<LoadZonesResult, ApiError> {
        let root = PathBuf::from(&params.skinRoot);
        let catDir = categoryDir(params.category);
        let maskFile = zones::maskPath(&root, &params.skinName, catDir, &params.partName);
        let configFile = zones::configPath(&root, &params.skinName, catDir, &params.partName);
        let (width, height, ids) = match zones::loadMask(&maskFile) {
            Some(t) => t,
            None => {
                // mask 不存在：返回 part 实际尺寸的全 0 ids，便于前端"开新区块"无负担。
                let partPng = root
                    .join(&params.skinName)
                    .join(catDir)
                    .join(format!("{}.png", &params.partName));
                let dims = skinLoader::decodePart(&partPng)
                    .map(|d| (d.width, d.height))
                    .unwrap_or((0, 0));
                (dims.0, dims.1, vec![0u8; (dims.0 * dims.1) as usize])
            }
        };
        let config = zones::loadConfig(&configFile);
        Ok(LoadZonesResult { width, height, ids, config })
    }

    fn saveZones(&self, params: SaveZonesParams) -> Result<(), ApiError> {
        let root = PathBuf::from(&params.skinRoot);
        let catDir = categoryDir(params.category);
        let maskFile = zones::maskPath(&root, &params.skinName, catDir, &params.partName);
        let configFile = zones::configPath(&root, &params.skinName, catDir, &params.partName);
        zones::saveMask(&maskFile, params.width, params.height, &params.ids)?;
        zones::saveConfig(&configFile, &params.config)
    }
}

/// 把指定 part 的所有 zone light 叠到 canvas 上：mask 中心转世界像素位置 +
/// outerRadius 配置（Unity 单位）× PIXELS_PER_UNIT(=8) 作衰减半径。
/// part 没有 zones 文件时静默 no-op；sided 名找不到时回退到 base 名（用户可能在 base part 上画的 mask）。
fn renderZoneLightsForPart(
    canvas: &mut [u8],
    canvasW: u32,
    canvasH: u32,
    skinRoot: &Path,
    skinName: &str,
    categoryDir: &str,
    renderedName: &str,
    basePart: &str,
    partW: u32,
    partH: u32,
    centerX: i32,
    centerY: i32,
    rotationDeg: f32,
    flipX: bool,
    timeSec: f32,
) {
    let (maskFile, configFile) = {
        let m = zones::maskPath(skinRoot, skinName, categoryDir, renderedName);
        let c = zones::configPath(skinRoot, skinName, categoryDir, renderedName);
        if m.exists() {
            (m, c)
        } else if renderedName != basePart {
            (
                zones::maskPath(skinRoot, skinName, categoryDir, basePart),
                zones::configPath(skinRoot, skinName, categoryDir, basePart),
            )
        } else {
            return;
        }
    };
    let (mw, mh, ids) = match zones::loadMask(&maskFile) {
        Some(t) => t,
        None => return,
    };
    let cfg = zones::loadConfig(&configFile);
    if cfg.zones.is_empty() { return; }
    if mw == 0 || mh == 0 { return; }
    let geom = zones::computeGeometry(mw, mh, &ids);
    if geom.is_empty() { return; }
    // mask 像素坐标 → part 局部坐标（pivot 中心）→ 旋转 → 加 part 世界中心。
    // 当 mask 与渲染尺寸不一致（例如 baseSizes 常量表缩回），按比例换算 mask→part 像素。
    let scaleX = partW as f32 / mw as f32;
    let scaleY = partH as f32 / mh as f32;
    let rad = -rotationDeg.to_radians();
    let cosT = rad.cos();
    let sinT = rad.sin();
    let halfW = partW as f32 * 0.5;
    let halfH = partH as f32 * 0.5;
    for z in &cfg.zones {
        let light = match &z.light { Some(l) => l, None => continue };
        let entry = match geom.iter().find(|g| g.0 == z.id) { Some(g) => g, None => continue };
        let lx = entry.1 * scaleX - halfW;
        // mask 像素 y 轴向下；与画布 y 一致，无需翻转。
        let ly = entry.2 * scaleY - halfH;
        let fx = if flipX { -lx } else { lx };
        let wx = centerX as f32 + fx * cosT - ly * sinT;
        let wy = centerY as f32 + fx * sinT + ly * cosT;
        // Light2D outerRadius / innerRadius 单位是 Unity（1 unit = 8 像素）。
        let outerPx = light.outerRadius * 8.0;
        let innerPx = light.innerRadius * 8.0;
        // 呼吸：强度按时间正弦在 [intensity*(1-amp), intensity*(1+amp)] 摆动。
        let intensity = if light.breathing {
            let phase = (timeSec * light.breathSpeed * std::f32::consts::TAU).sin();
            (light.intensity * (1.0 + phase * light.breathAmplitude)).max(0.0)
        } else {
            light.intensity
        };
        // 方向角：light.direction 度，按 part 旋转 + flip 同步。
        let dirRad = -light.direction.to_radians();
        let baseDx = dirRad.cos();
        let baseDy = -dirRad.sin();
        let dxFlipped = if flipX { -baseDx } else { baseDx };
        let dirX = dxFlipped * cosT - baseDy * sinT;
        let dirY = dxFlipped * sinT + baseDy * cosT;
        blendZoneLight(
            canvas, canvasW, canvasH,
            wx, wy, outerPx, innerPx, light.color, light.color2, intensity,
            &light.mode, dirX, dirY, light.spread, light.falloffPower,
        );
    }
}
/// 计算径向光：dist∈[inner,outer] 用 smoothstep 反向 + 衰减幂；颜色按 t 在 color1↔color2 之间渐变。
/// directional / scatter 在径向衰减基础上额外加角度 cone 限制。
fn blendZoneLight(
    canvas: &mut [u8],
    canvasW: u32,
    canvasH: u32,
    centerX: f32,
    centerY: f32,
    outer: f32,
    inner: f32,
    color: [u8; 4],
    color2: Option<[u8; 4]>,
    intensity: f32,
    mode: &str,
    dirX: f32,
    dirY: f32,
    spreadDeg: f32,
    falloffPower: f32,
) {
    if outer <= 0.0 || intensity <= 0.0 { return; }
    let lo = inner.clamp(0.0, outer);
    let outerSq = outer * outer;
    let x0 = (centerX - outer).floor().max(0.0) as i32;
    let y0 = (centerY - outer).floor().max(0.0) as i32;
    let x1 = (centerX + outer).ceil().min((canvasW - 1) as f32) as i32;
    let y1 = (centerY + outer).ceil().min((canvasH - 1) as f32) as i32;
    let r1 = color[0] as f32;
    let g1 = color[1] as f32;
    let b1 = color[2] as f32;
    let (r2, g2, b2) = match color2 {
        Some(c) => (c[0] as f32, c[1] as f32, c[2] as f32),
        None => (r1, g1, b1),
    };
    let alphaScale = color[3] as f32 / 255.0;
    let halfCos = ((spreadDeg.clamp(0.0, 360.0) * 0.5).to_radians()).cos();
    let isDirectional = mode == "directional" || mode == "scatter";
    let pow = falloffPower.max(0.1);
    for y in y0..=y1 {
        let dy = y as f32 - centerY;
        for x in x0..=x1 {
            let dx = x as f32 - centerX;
            let d2 = dx * dx + dy * dy;
            if d2 > outerSq { continue; }
            let d = d2.sqrt();
            let baseT = if d <= lo { 1.0 } else { 1.0 - (d - lo) / (outer - lo).max(0.001) };
            let mut t = baseT.powf(pow);
            // 渐变插值因子：dist=lo → 0（用 color1）；dist=outer → 1（用 color2）。
            let mix = if d <= lo { 0.0 } else { ((d - lo) / (outer - lo).max(0.001)).clamp(0.0, 1.0) };
            if isDirectional {
                if d > 0.001 {
                    let nx = dx / d;
                    let ny = dy / d;
                    let dot = nx * dirX + ny * dirY;
                    if dot < halfCos { continue; }
                    if mode == "directional" {
                        // cone 内部按 cos 平滑过渡，越靠中线越亮。
                        let cone = ((dot - halfCos) / (1.0 - halfCos).max(0.001)).clamp(0.0, 1.0);
                        t *= cone;
                    } else {
                        // scatter：cone 边沿等亮，模拟散射光束。
                        t *= 0.7 + 0.3 * ((dot - halfCos) / (1.0 - halfCos).max(0.001)).clamp(0.0, 1.0);
                    }
                }
            }
            let a = (intensity * t * alphaScale).clamp(0.0, 1.0);
            if a <= 0.0 { continue; }
            let cr = r1 * (1.0 - mix) + r2 * mix;
            let cg = g1 * (1.0 - mix) + g2 * mix;
            let cb = b1 * (1.0 - mix) + b2 * mix;
            let idx = ((y as u32) * canvasW + (x as u32)) as usize * 4;
            // 加光：在画布原色基础上叠加 a*color，clamp 到 255。
            let dstR = canvas[idx] as f32 + cr * a;
            let dstG = canvas[idx + 1] as f32 + cg * a;
            let dstB = canvas[idx + 2] as f32 + cb * a;
            let dstA = canvas[idx + 3] as f32 + 255.0 * a;
            canvas[idx] = dstR.min(255.0) as u8;
            canvas[idx + 1] = dstG.min(255.0) as u8;
            canvas[idx + 2] = dstB.min(255.0) as u8;
            canvas[idx + 3] = dstA.min(255.0) as u8;
        }
    }
}

/// 多模式粒子渲染：
/// - gravity：默认重力（startColor → 透明，沿初始角度漂移 + 重力下坠）
/// - star：星空闪烁（位置不变，alpha 按 sin(2π·age/life·blink) 闪烁）
/// - fire：火焰（向上飘 + age 末段收缩 + 起始热色 → 末段冷色）
/// - water：水流（向下流 + 横向小幅摆动）
/// - orbit：环绕中心（粒子绕中心旋转，半径按 age 略增）
/// 所有模式都支持 startColor/endColor 渐变 + endSizeScale 大小渐变 + fadeCurve alpha 曲线。
fn renderZoneParticles(
    canvas: &mut [u8],
    canvasW: u32,
    canvasH: u32,
    centerX: f32,
    centerY: f32,
    cfg: &accessories::ParticleConfig,
    timeSec: f32,
    seed: u32,
) {
    if cfg.rate <= 0.0 || cfg.lifetime <= 0.0 { return; }
    let active = ((cfg.rate * cfg.lifetime).ceil() as i32).clamp(1, 512);
    let sizePx = (cfg.startSize * 8.0).max(0.5);
    let shapeRadiusPx = if cfg.shapeRadius > 0.0 { cfg.shapeRadius * 8.0 } else { 4.0 };
    let mode = cfg.mode.as_str();
    let speedPxPerSec = if cfg.speed > 0.0 {
        cfg.speed * 8.0
    } else {
        match mode {
            "fire" => 28.0,
            "water" => 36.0,
            "orbit" => 18.0,
            "star" => 0.0,
            _ => 12.0,
        }
    };
    let gravityPxPerSec2 = cfg.gravity * 80.0;
    let dirCenterRad = -cfg.direction.to_radians();
    let halfSpread = (cfg.spread.clamp(0.0, 360.0) * 0.5).to_radians();
    let endColor = cfg.endColor.unwrap_or([
        cfg.startColor[0],
        cfg.startColor[1],
        cfg.startColor[2],
        0,
    ]);
    let endScale = cfg.endSizeScale.max(0.01);

    for i in 0..active {
        let h = hashU32(seed.wrapping_add(i as u32));
        let phase = ((h & 0xFFFF) as f32) / 65536.0;
        let birth = phase * cfg.lifetime + (i as f32) / cfg.rate.max(0.0001);
        let age = (timeSec - birth).rem_euclid(cfg.lifetime);
        if age < 0.0 || age > cfg.lifetime { continue; }
        let lifeT = (age / cfg.lifetime).clamp(0.0, 1.0);
        let baseAlpha = match cfg.fadeCurve.as_str() {
            "constant" => 1.0,
            "easeOut" => (1.0 - lifeT).powf(0.5),
            "blink" => (1.0 - lifeT) * (((lifeT * 6.0 * std::f32::consts::PI).sin() + 1.0) * 0.5),
            _ => 1.0 - lifeT,
        };
        let alpha = baseAlpha.clamp(0.0, 1.0) * (cfg.startColor[3] as f32 / 255.0);
        if alpha <= 0.005 { continue; }
        // 角度：以 direction 为中心，按 spread 散开。
        let spreadFrac = ((h >> 16) as f32) / 65536.0 * 2.0 - 1.0;
        let angle = dirCenterRad + spreadFrac * halfSpread;
        let r0 = ((h ^ 0xA5A5_A5A5) & 0xFFFF) as f32 / 65536.0 * shapeRadiusPx;
        let (px, py) = match mode {
            "star" => {
                let twinkle = ((age * 6.28 * 2.0 + (h & 0xFF) as f32 * 0.1).sin() * 0.5 + 0.5) * 1.5;
                (
                    centerX + angle.cos() * r0,
                    centerY + angle.sin() * r0 - twinkle * 0.0,
                )
            }
            "fire" => {
                // 向上飘（angle 已经按 direction，默认 90°=向上）+ 横向小幅摇摆。
                let sway = (age * 4.0 + (h & 0xFF) as f32 * 0.3).sin() * 2.0;
                let dy = -speedPxPerSec * age - 0.5 * gravityPxPerSec2 * age * age;
                (centerX + angle.cos() * r0 + sway, centerY + angle.sin() * r0 + dy)
            }
            "water" => {
                // 向下流（默认 direction 270°=向下）+ 重力加速。
                let sway = (age * 3.0 + (h & 0xFF) as f32 * 0.2).sin() * 1.5;
                let dx = angle.cos() * speedPxPerSec * age;
                let dy = angle.sin() * speedPxPerSec * age + 0.5 * gravityPxPerSec2 * age * age;
                (centerX + r0 + dx + sway, centerY + dy)
            }
            "orbit" => {
                let omega = if cfg.speed > 0.0 { cfg.speed } else { 2.0 };
                let theta = angle + omega * age;
                let r = r0 + speedPxPerSec * age * 0.05;
                (centerX + theta.cos() * r, centerY + theta.sin() * r)
            }
            _ => {
                // gravity 默认。
                let vx = angle.cos() * speedPxPerSec;
                let vy = -angle.sin() * speedPxPerSec;
                (
                    centerX + r0 * angle.cos() + vx * age,
                    centerY + r0 * (-angle.sin()) + vy * age + 0.5 * gravityPxPerSec2 * age * age,
                )
            }
        };
        // 颜色 / 大小渐变。
        let r = cfg.startColor[0] as f32 * (1.0 - lifeT) + endColor[0] as f32 * lifeT;
        let g = cfg.startColor[1] as f32 * (1.0 - lifeT) + endColor[1] as f32 * lifeT;
        let b = cfg.startColor[2] as f32 * (1.0 - lifeT) + endColor[2] as f32 * lifeT;
        let curSize = sizePx * (1.0 + (endScale - 1.0) * lifeT);
        let halfSize = curSize * 0.5;
        let x0 = (px - halfSize).floor().max(0.0) as i32;
        let y0 = (py - halfSize).floor().max(0.0) as i32;
        let x1 = (px + halfSize).ceil().min((canvasW - 1) as f32) as i32;
        let y1 = (py + halfSize).ceil().min((canvasH - 1) as f32) as i32;
        if x1 < x0 || y1 < y0 { continue; }
        for y in y0..=y1 {
            for x in x0..=x1 {
                let idx = ((y as u32) * canvasW + (x as u32)) as usize * 4;
                let inv = 1.0 - alpha;
                canvas[idx] = (canvas[idx] as f32 * inv + r * alpha) as u8;
                canvas[idx + 1] = (canvas[idx + 1] as f32 * inv + g * alpha) as u8;
                canvas[idx + 2] = (canvas[idx + 2] as f32 * inv + b * alpha) as u8;
                canvas[idx + 3] = (canvas[idx + 3] as f32).max(alpha * 255.0) as u8;
            }
        }
    }
}

/// xorshift32 哈希——稳定输出，不依赖 std::hash。
fn hashU32(mut x: u32) -> u32 {
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    x.wrapping_add(0x9e37_79b9)
}

/// 把指定 part 的所有 zone particle / animation 叠到 canvas 上。
fn renderZoneEffectsForPart(
    canvas: &mut [u8],
    canvasW: u32,
    canvasH: u32,
    skinRoot: &Path,
    skinName: &str,
    categoryDir: &str,
    renderedName: &str,
    basePart: &str,
    partW: u32,
    partH: u32,
    centerX: i32,
    centerY: i32,
    rotationDeg: f32,
    flipX: bool,
    timeSec: f32,
    sessions: &std::sync::MutexGuard<'_, std::collections::HashMap<String, PartSession>>,
) {
    let (maskFile, configFile) = {
        let m = zones::maskPath(skinRoot, skinName, categoryDir, renderedName);
        let c = zones::configPath(skinRoot, skinName, categoryDir, renderedName);
        if m.exists() {
            (m, c)
        } else if renderedName != basePart {
            (
                zones::maskPath(skinRoot, skinName, categoryDir, basePart),
                zones::configPath(skinRoot, skinName, categoryDir, basePart),
            )
        } else {
            return;
        }
    };
    let (mw, mh, ids) = match zones::loadMask(&maskFile) {
        Some(t) => t,
        None => return,
    };
    let cfg = zones::loadConfig(&configFile);
    if cfg.zones.is_empty() { return; }
    if mw == 0 || mh == 0 { return; }
    let geom = zones::computeGeometry(mw, mh, &ids);
    if geom.is_empty() { return; }
    let scaleX = partW as f32 / mw as f32;
    let scaleY = partH as f32 / mh as f32;
    let rad = -rotationDeg.to_radians();
    let cosT = rad.cos();
    let sinT = rad.sin();
    let halfW = partW as f32 * 0.5;
    let halfH = partH as f32 * 0.5;
    for z in &cfg.zones {
        let entry = match geom.iter().find(|g| g.0 == z.id) { Some(g) => g, None => continue };
        let lx = entry.1 * scaleX - halfW;
        let ly = entry.2 * scaleY - halfH;
        let fx = if flipX { -lx } else { lx };
        let wx = centerX as f32 + fx * cosT - ly * sinT;
        let wy = centerY as f32 + fx * sinT + ly * cosT;
        if let Some(p) = &z.particle {
            // seed 含 partName + zoneId，让不同区块粒子分布独立。
            let mut seed = z.id as u32;
            for b in renderedName.as_bytes() { seed = seed.wrapping_mul(31).wrapping_add(*b as u32); }
            renderZoneParticles(canvas, canvasW, canvasH, wx, wy, p, timeSec, seed);
        }
        if let Some(a) = &z.animation {
            renderZoneAnimation(canvas, canvasW, canvasH, wx, wy, a, timeSec, skinRoot, skinName, sessions);
        }
    }
}

/// 帧动画：按 timeSec 与 fps 选当前帧，用 sprite 名查找对应 PNG（Body / Head / Wings / Accessories 任一目录），
/// 缩到与 startSize 相关的尺寸贴到 (cx, cy)。
fn renderZoneAnimation(
    canvas: &mut [u8],
    canvasW: u32,
    canvasH: u32,
    centerX: f32,
    centerY: f32,
    cfg: &accessories::AnimationConfig,
    timeSec: f32,
    skinRoot: &Path,
    skinName: &str,
    sessions: &std::sync::MutexGuard<'_, std::collections::HashMap<String, PartSession>>,
) {
    if cfg.frames.is_empty() || cfg.fps <= 0.0 { return; }
    let total = cfg.frames.len() as f32;
    let phase = if cfg.loop_ {
        (timeSec * cfg.fps).rem_euclid(total)
    } else {
        (timeSec * cfg.fps).min(total - 1.0).max(0.0)
    };
    let idx = phase.floor() as usize;
    let frameName = match cfg.frames.get(idx) { Some(s) => s.as_str(), None => return };
    // 在四类目录下找文件。
    let categories = ["Body", "Head", "Wings", "Accessories"];
    let mut pixels: Option<(u32, u32, Vec<u8>)> = None;
    for cat in &categories {
        let key = partIdKey(skinName, categoryFromDir(cat), frameName);
        if let Some(s) = sessions.get(&key) {
            pixels = Some((s.state.width, s.state.height, imageOps::flatten(&s.state)));
            break;
        }
        let png = skinRoot.join(skinName).join(cat).join(format!("{}.png", frameName));
        if png.exists() {
            if let Ok(d) = skinLoader::decodePart(&png) {
                pixels = Some((d.width, d.height, d.pixels));
                break;
            }
        }
    }
    let (w, h, buf) = match pixels { Some(t) => t, None => return };
    imageOps::blitWithRotation(
        canvas, canvasW, canvasH, &buf, w, h,
        centerX as i32, centerY as i32, 0.0, false,
    );
}

fn categoryFromDir(d: &str) -> PartCategory {
    match d {
        "Body" => PartCategory::Body,
        "Head" => PartCategory::Head,
        "Wings" => PartCategory::Wings,
        _ => PartCategory::Accessories,
    }
}

fn wingsConfigPath(skinRoot: &str, skinName: &str) -> PathBuf {
    PathBuf::from(skinRoot).join(skinName).join("wings.json")
}

/// 把配件的 limb 名映射到装配表中的"父 entry"——配件在合成层按父 entry 的位置 / 旋转 / zOrder 叠加。
/// F/B 共享 base 的肢体（UpArm/DownArm/Thigh/Crus/Foot/HandF）按 side 选 zOrder 符号正确的那条；
/// HandF 独立、ThighB/CrusF/FootF 等带显式后缀；Head 走 Default headVariant 那条。
fn accessoryParentEntry<'a>(
    table: &'a assemblyTable::AssemblyTable,
    limb: &str,
) -> Option<&'a AssemblyEntry> {
    let (base, sideSign): (&str, Option<i32>) = match limb {
        "Head" => return table.parts.iter().find(|e| {
            e.partName == "experimentHeadBack"
                && matches!(e.variants.as_ref().and_then(|v| v.headVariant.as_ref()), Some(HeadVariant::Default))
        }),
        "UpTorso" => ("experimentUpTorso", None),
        "DownTorso" => ("experimentDownTorso", None),
        "HandF" => ("experimentHandF", None),
        "HandB" => ("experimentHandB", None),
        "UpArmF" => ("experimentUpArm", Some(1)),
        "UpArmB" => ("experimentUpArm", Some(-1)),
        "DownArmF" => ("experimentDownArm", Some(1)),
        "DownArmB" => ("experimentDownArm", Some(-1)),
        "ThighF" => ("experimentThigh", Some(1)),
        "ThighB" => ("experimentThigh", Some(-1)),
        "CrusF" => ("experimentCrus", Some(1)),
        "CrusB" => ("experimentCrus", Some(-1)),
        "FootF" => ("experimentFoot", Some(1)),
        "FootB" => ("experimentFoot", Some(-1)),
        _ => (limb, None),
    };
    table.parts.iter().find(|e| {
        if e.partName != base { return false; }
        match sideSign {
            None => true,
            Some(1) => e.zOrder >= 0,
            Some(-1) => e.zOrder < 0,
            _ => true,
        }
    })
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

/// 从磁盘读部件为 PartEditState：sidecar 优先，否则把合成 PNG 当单层。
fn loadStateFromDisk(skinDir: &Path, catDirName: &str, partName: &str) -> Result<PartEditState, ApiError> {
    if let Some((state, _)) = layerSidecar::loadIfPresent(skinDir, catDirName, partName) {
        return Ok(state);
    }
    let png = skinDir.join(catDirName).join(format!("{}.png", partName));
    let decoded = skinLoader::decodePart(&png)?;
    Ok(PartEditState {
        partName: partName.to_string(),
        width: decoded.width,
        height: decoded.height,
        layers: vec![Layer {
            id: "layer0".into(),
            name: "layer0".into(),
            visible: true,
            opacity: 255,
            pixels: decoded.pixels,
            transform: None,
        }],
    })
}

/// 用户为前后共享部件单独画 sided PNG 时，合成层据此查 `<base><side>` 候选名。
/// 仅"前后共享 sprite"5 类支持：UpArm / DownArm / Thigh / Crus / Foot；其它部件返回 None 直接用 base。
fn sidedCandidateName(basePart: &str, side: char) -> Option<String> {
    if side != 'F' && side != 'B' { return None; }
    match basePart {
        "experimentUpArm" | "experimentDownArm"
        | "experimentThigh" | "experimentCrus" | "experimentFoot" => {
            Some(format!("{}{}", basePart, side))
        }
        _ => None,
    }
}

/// 合成层取部件像素：朝右时优先 R_ 前缀；sided 优先（session → 磁盘），缺失退回 base（session → 磁盘）。
/// 同时是 motion 与 assembly 两条路径共享的 sprite 加载逻辑，保持渲染前的取值一致。
fn pickPartPixels(
    sessions: &std::sync::MutexGuard<'_, std::collections::HashMap<String, PartSession>>,
    skinDir: &Path,
    skinName: &str,
    category: PartCategory,
    basePart: &str,
    sided: Option<&str>,
    isRight: bool,
) -> Option<(u32, u32, Vec<u8>)> {
    let mut candidates: Vec<String> = Vec::with_capacity(4);
    if isRight {
        if let Some(s) = sided { candidates.push(format!("R_{}", s)); }
        candidates.push(format!("R_{}", basePart));
    }
    if let Some(s) = sided { candidates.push(s.to_string()); }
    candidates.push(basePart.to_string());

    for name in &candidates {
        let key = partIdKey(skinName, category, name);
        if let Some(session) = sessions.get(&key) {
            return Some((session.state.width, session.state.height, imageOps::flatten(&session.state)));
        }
        let png = skinDir.join(categoryDir(category)).join(format!("{}.png", name));
        if png.exists() {
            if let Ok(d) = skinLoader::decodePart(&png) {
                return Some((d.width, d.height, d.pixels));
            }
        }
    }
    None
}

/// 按 baseSizes 标准尺寸 nearest-neighbor 缩回；未登记或尺寸已一致直接返回原 buffer。
fn applyBaseSizeFit(
    map: &baseSizes::BaseSizes,
    category: PartCategory,
    primaryName: &str,
    fallbackName: &str,
    w: u32,
    h: u32,
    pixels: Vec<u8>,
) -> (u32, u32, Vec<u8>) {
    let catDir = categoryDir(category);
    let primaryKey = baseSizes::keyFor(catDir, primaryName);
    let target = map.get(&primaryKey).or_else(|| {
        if primaryName != fallbackName {
            map.get(&baseSizes::keyFor(catDir, fallbackName))
        } else {
            None
        }
    });
    match target {
        Some((bw, bh)) if bw != w || bh != h => {
            let scaled = imageOps::scaleNearest(&pixels, w, h, bw, bh);
            (bw, bh, scaled)
        }
        _ => (w, h, pixels),
    }
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

/// 从内置 exp 模板的 accessories.json 取 id=accessoryId 的 entry，追加到目标皮肤；
/// 已有同 id 跳过，模板缺该 id 跳过。失败仅打印不阻断。
fn appendAccessoryEntryFromTemplate(skinDir: &Path, accessoryId: &str) -> Result<(), ApiError> {
    let templateBytes = match crate::embeddedTemplateBytes("accessories.json") {
        Some(b) => b,
        None => return Ok(()),
    };
    let templateList: Vec<accessories::AccessoryEntry> =
        serde_json::from_slice(&templateBytes).unwrap_or_default();
    let entry = match templateList.into_iter().find(|e| e.id == accessoryId) {
        Some(e) => e,
        None => return Ok(()),
    };
    let path = accessories::accessoriesPath(
        skinDir.parent().unwrap_or(Path::new("")),
        skinDir.file_name().and_then(|s| s.to_str()).unwrap_or(""),
    );
    let mut list = accessories::loadAccessories(&path);
    if list.iter().any(|e| e.id == accessoryId) {
        return Ok(());
    }
    list.push(entry);
    accessories::saveAccessories(&path, &list)
}

fn categoryDir(category: PartCategory) -> &'static str {
    match category {
        PartCategory::Body => "Body",
        PartCategory::Head => "Head",
        PartCategory::Wings => "Wings",
        PartCategory::Accessories => "Accessories",
        PartCategory::Blood => "Blood",
    }
}

/// 判断 part 名是否在"前后共享 sprite"白名单——这些部件可以拆出 F/B 独立副本。
/// HandF/HandB 已是各自独立的磁盘 PNG，不在此列表内（自身就是 sided）。
fn isSideSplittablePartName(partName: &str) -> bool {
    const SHARED_SUFFIXES: &[&str] = &[
        "UpTorso", "DownTorso", "Head", "UpArm", "DownArm",
        "Thigh", "Crus", "Foot", "Tail",
    ];
    SHARED_SUFFIXES.iter().any(|s| partName.ends_with(s))
}

/// 判断 part 名末尾是否已有 F / B 后缀，用于拒绝在 sided 名字上再拆分。
fn endsWithSideSuffix(partName: &str) -> bool {
    partName.ends_with('F') || partName.ends_with('B')
}

/// 判断 part 是否允许创建 R_ 朝右版：所有 Body / Head 部件都允许；Wings 除外（已展开身体两侧）；Blood 不参与渲染合成。
fn isOrientationSplittablePart(partName: &str, category: PartCategory) -> bool {
    if partName.is_empty() { return false; }
    if partName.starts_with("R_") { return false; }
    matches!(category, PartCategory::Body | PartCategory::Head)
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

/// 返回 Body 类 limb 在磁盘上的共享 base sprite 名。前后侧共享同一图。
/// sided（experimentFootF / experimentFootB 等）由合成层 `sidedCandidate` 在 zOrder/limb 名维度上推断，
/// 与本函数解耦，避免污染 AssemblyEntry / motion 既有契约。
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
) -> Vec<(AssemblyEntry, Option<char>)> {
    let mut out: Vec<(AssemblyEntry, Option<char>)> = Vec::new();
    let mut headPose: Option<(AssemblyPosition, f32)> = None;
    for limb in &frame.limbs {
        if !limb.visible {
            continue;
        }
        // 末尾 F/B 字符提示当前 limb 是前侧还是后侧；其它命名（Head / Tail / wing*）返回 None。
        let sideHint: Option<char> = limb.name.chars().last().filter(|c| *c == 'F' || *c == 'B');
        if limb.name == "Head" {
            let pos = motionCompositePosition(limb);
            let partName = motionHeadPartName(head_variant, &limb.spriteName);
            headPose = Some((pos, limb.rotZ));
            out.push((AssemblyEntry {
                partName,
                category: PartCategory::Head,
                position: pos,
                zOrder: limb.sortingOrder,
                flipX: false,
                rotation: limb.rotZ,
                variants: None,
            }, None));
            continue;
        }
        // 翅膀：motionRecorder 抓取的 4 张翼名 wingUL/wingUR/wingDL/wingDR，partName 与 PNG 同名直接渲染。
        if matches!(limb.name.as_str(), "wingUL" | "wingUR" | "wingDL" | "wingDR") {
            out.push((AssemblyEntry {
                partName: limb.name.clone(),
                category: PartCategory::Wings,
                position: motionCompositePosition(limb),
                zOrder: limb.sortingOrder,
                flipX: false,
                rotation: limb.rotZ,
                variants: None,
            }, None));
            continue;
        }
        let Some(partName) = motionBodyPartName(&limb.name) else {
            continue;
        };
        out.push((AssemblyEntry {
            partName: partName.to_string(),
            category: PartCategory::Body,
            position: motionCompositePosition(limb),
            zOrder: limb.sortingOrder,
            flipX: false,
            rotation: limb.rotZ,
            variants: None,
        }, sideHint));
    }
    if let Some((pos, rot)) = headPose {
        out.push((AssemblyEntry {
            partName: motionEyePartName(i32::from(expression_index)).to_string(),
            category: PartCategory::Head,
            position: pos,
            zOrder: 53,
            flipX: false,
            rotation: rot,
            variants: None,
        }, None));
    }
    // 兼容旧捕捉：没有 Tail sample 时仍回退到静态尾巴。
    let hasTail = frame
        .limbs
        .iter()
        .any(|limb| limb.name == "Tail" || limb.name == "experimentTail");
    if !hasTail {
        if let Some(tail) = defaultAssemblyTailEntry() {
            out.push((tail, None));
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
    fn createPartCreatesMissingCategoryDirectory() {
        let tmp = TempDir::new();
        fs::create_dir_all(tmp.path().join("st1")).unwrap();
        let api = CoreApi::new();

        let result = api
            .createPart(CreatePartParams {
                skinRoot: tmp.path().to_string_lossy().into_owned(),
                skinName: "st1".into(),
                category: PartCategory::Wings,
                fileName: "wingUL".into(),
                width: 32,
                height: 32,
            })
            .expect("create part");

        assert_eq!(result.partName, "wingUL");
        assert!(tmp.path().join("st1").join("Wings").join("wingUL.png").is_file());
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
            .find(|(entry, _)| entry.partName == "experimentTail")
            .map(|(entry, _)| entry)
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
        assert!(entries.iter().any(|(entry, _)| entry.partName == "experimentHeadBackMouth"));
        assert!(entries.iter().any(|(entry, _)| entry.partName == "experimentEyeOpen"));
        assert!(!entries.iter().any(|(entry, _)| entry.partName == "experimentEyeHappy"));
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
                timeSec: 0.0,
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
    fn copyPartCreatesPngAndSidecar() {
        let (tmp, api, partId) = loadedApi();
        api.applyBrush(BrushParams {
            partId: partId.clone(),
            cx: 0,
            cy: 0,
            brushSize: 1,
            color: [9, 8, 7, 255],
        }).expect("brush");
        let res = api.copyPart(CopyPartParams {
            skinRoot: tmp.path().to_string_lossy().into_owned(),
            skinName: "st1".into(),
            category: PartCategory::Body,
            sourcePartName: "p".into(),
            targetPartName: "pCopy".into(),
            overwrite: false,
        }).expect("copyPart");
        assert_eq!(res.partName, "pCopy");
        let png = tmp.path().join("st1").join("Body").join("pCopy.png");
        assert!(png.is_file());
        let (_, _, pixels) = imageOps::loadPng(&png).expect("reload");
        assert_eq!(pixels, vec![9, 8, 7, 255]);
        let err = api.copyPart(CopyPartParams {
            skinRoot: tmp.path().to_string_lossy().into_owned(),
            skinName: "st1".into(),
            category: PartCategory::Body,
            sourcePartName: "p".into(),
            targetPartName: "pCopy".into(),
            overwrite: false,
        }).expect_err("dup should fail");
        assert_eq!(err.code, "part_exists");
        api.copyPart(CopyPartParams {
            skinRoot: tmp.path().to_string_lossy().into_owned(),
            skinName: "st1".into(),
            category: PartCategory::Body,
            sourcePartName: "p".into(),
            targetPartName: "pCopy".into(),
            overwrite: true,
        }).expect("overwrite should succeed");
    }

    #[test]
    fn deletePartRemovesPng() {
        let (tmp, api, _partId) = loadedApi();
        let png = tmp.path().join("st1").join("Body").join("p.png");
        assert!(png.is_file());
        api.deletePart(DeletePartParams {
            skinRoot: tmp.path().to_string_lossy().into_owned(),
            skinName: "st1".into(),
            category: PartCategory::Body,
            partName: "p".into(),
        }).expect("deletePart");
        assert!(!png.exists());
    }

    #[test]
    fn copyLayerToPartAppendsLayer() {
        let tmp = TempDir::new();
        let bodyDir = tmp.path().join("st1").join("Body");
        fs::create_dir_all(&bodyDir).unwrap();
        writeTinyPng(&bodyDir.join("a.png"), [1, 2, 3, 255]);
        writeTinyPng(&bodyDir.join("b.png"), [0, 0, 0, 0]);
        let api = CoreApi::new();
        let srcRoot = tmp.path().to_string_lossy().into_owned();
        let src = api.loadPartImage(LoadPartParams {
            skinRoot: srcRoot.clone(), skinName: "st1".into(),
            category: PartCategory::Body, partName: "a".into(),
        }).expect("load a");
        let dst = api.loadPartImage(LoadPartParams {
            skinRoot: srcRoot, skinName: "st1".into(),
            category: PartCategory::Body, partName: "b".into(),
        }).expect("load b");
        let snap = api.copyLayerToPart(CopyLayerToPartParams {
            sourcePartId: src.partId,
            sourceLayerId: "layer0".into(),
            targetPartId: dst.partId.clone(),
        }).expect("copyLayer");
        assert_eq!(snap.layers.len(), 2);
        let sessions = api.sessions.lock().unwrap();
        let session = sessions.get(&dst.partId).expect("session");
        assert_eq!(session.state.layers[1].pixels, vec![1, 2, 3, 255]);
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
            timeSec: 0.0,
            isRight: false,
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
