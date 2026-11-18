// 桌面端（Tauri）与 Web 端（Axum HTTP）共享的业务层请求/响应类型及 `ApiLayer` trait。

use serde::{Deserialize, Serialize};

use crate::accessories;
use crate::assemblyTable::{
    AssemblyPosition, AssemblySource, AssemblyTable, HeadVariant, Orientation,
};
use crate::blood;
use crate::historyManager::PixelDiff;
use crate::imageOps;
use crate::skinLoader::{ImportResult, PartCategory, Stage};
use crate::windowManager::{ThemeConfig, WorkspaceLayout, WorkspaceSource};
use crate::zones;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SoftBrushParams {
    pub partId: String,
    pub cx: i32,
    pub cy: i32,
    pub brushSize: u8,
    pub hardness: u8,
    pub color: [u8; 4],
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePartFromTemplateParams {
    pub skinRoot: String,
    pub skinName: String,
    pub category: PartCategory,
    pub partName: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyPartParams {
    pub skinRoot: String,
    pub skinName: String,
    pub category: PartCategory,
    pub sourcePartName: String,
    pub targetPartName: String,
    #[serde(default)]
    pub overwrite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeletePartParams {
    pub skinRoot: String,
    pub skinName: String,
    pub category: PartCategory,
    pub partName: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CopyLayerToPartParams {
    pub sourcePartId: String,
    pub sourceLayerId: String,
    pub targetPartId: String,
}

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

/// 静态装配预览入参；`expressionIndex` 取值 `0..=7`，`isRight=true` 优先读取 `R_` 前缀贴图。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompositeParams {
    pub skinRoot: String,
    pub skinName: String,
    pub orientation: Orientation,
    pub expressionIndex: u8,
    pub headVariant: Option<HeadVariant>,
    #[serde(default)]
    pub timeSec: f32,
    #[serde(default)]
    pub isRight: bool,
}

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

/// 预览视口拖拽部件时的内存位置覆盖（不写回磁盘）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetAssemblyOverrideParams {
    pub partName: String,
    pub category: PartCategory,
    pub position: AssemblyPosition,
    pub rotation: Option<f32>,
    pub flipX: Option<bool>,
    pub zOrder: Option<i32>,
}

#[derive(Debug, Clone)]
pub struct AssemblyOverride {
    pub position: AssemblyPosition,
    pub rotation: Option<f32>,
    pub flipX: Option<bool>,
    pub zOrder: Option<i32>,
}

/// 单皮肤翅膀装配覆盖（`<skin>/wings.json`）；下翼偏移相对上翼根与末端计算。
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspacePathParams {
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceResult {
    pub layout: WorkspaceLayout,
    pub theme: ThemeConfig,
    pub source: WorkspaceSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveWorkspaceParams {
    pub path: String,
    pub layout: WorkspaceLayout,
    pub theme: ThemeConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSkinPackParams {
    pub skinRoot: String,
    pub zipPath: String,
    #[serde(default)]
    pub layout: Option<String>,
    #[serde(default)]
    pub includeBlood: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportSkinPackResult {
    pub fileCount: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportSkinPackParams {
    pub skinRoot: String,
    pub zipPath: String,
    pub overwrite: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SetAccessoryEnabledParams {
    pub skinRoot: String,
    pub skinName: String,
    pub id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveAccessoryConfigParams {
    pub skinRoot: String,
    pub skinName: String,
    pub entry: accessories::AccessoryEntry,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BloodConfigPathParams {
    pub skinRoot: String,
    pub skinName: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaveBloodConfigParams {
    pub skinRoot: String,
    pub skinName: String,
    pub config: blood::BloodConfig,
}

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
    pub ids: Vec<u8>,
    pub config: zones::ZonesConfig,
}

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

pub trait ApiLayer: Send + Sync + 'static {
    fn listSkins(&self, params: SkinsParams) -> Result<Vec<String>, ApiError>;
    fn listParts(&self, params: PartsParams) -> Result<Stage, ApiError>;
    fn loadPartImage(&self, params: LoadPartParams) -> Result<LoadPartResult, ApiError>;
    fn discardPart(&self, params: PartIdParams) -> Result<(), ApiError>;
    fn listMotionCaptures(
        &self,
        params: MotionCaptureListParams,
    ) -> Result<Vec<MotionCaptureMeta>, ApiError>;
    fn loadMotionCapture(&self, path: String) -> Result<MotionCaptureResult, ApiError>;
    fn getMotionCompositeImage(
        &self,
        params: MotionCompositeParams,
    ) -> Result<MotionCompositeResult, ApiError>;
    fn applyBrush(&self, params: BrushParams) -> Result<PixelDiff, ApiError>;
    fn applyEraser(&self, params: EraserParams) -> Result<PixelDiff, ApiError>;
    fn applyGradient(&self, params: GradientParams) -> Result<PixelDiff, ApiError>;
    fn applyFill(&self, params: FillParams) -> Result<PixelDiff, ApiError>;
    fn applySoftBrush(&self, params: SoftBrushParams) -> Result<PixelDiff, ApiError>;
    fn beginStroke(&self, params: PartIdParams) -> Result<(), ApiError>;
    fn endStroke(&self, params: PartIdParams) -> Result<PixelDiff, ApiError>;
    fn undo(&self, params: PartIdParams) -> Result<PixelDiff, ApiError>;
    fn redo(&self, params: PartIdParams) -> Result<PixelDiff, ApiError>;
    fn getFlatten(&self, params: PartIdParams) -> Result<LoadPartResult, ApiError>;
    fn getAssemblyTable(&self, params: AssemblyParams) -> Result<AssemblyResult, ApiError>;
    fn savePart(&self, params: SavePartParams) -> Result<(), ApiError>;
    fn resizePart(&self, params: ResizePartParams) -> Result<ResizePartResult, ApiError>;
    fn getBaseSize(&self, params: GetBaseSizeParams) -> Result<GetBaseSizeResult, ApiError>;
    fn createSidePart(&self, params: CreateSidePartParams)
        -> Result<CreateSidePartResult, ApiError>;
    fn createOrientationPart(
        &self,
        params: CreateOrientationPartParams,
    ) -> Result<CreateOrientationPartResult, ApiError>;
    fn createPart(&self, params: CreatePartParams) -> Result<CreatePartResult, ApiError>;
    fn createPartFromTemplate(
        &self,
        params: CreatePartFromTemplateParams,
    ) -> Result<CreatePartResult, ApiError>;
    fn copyPart(&self, params: CopyPartParams) -> Result<CreatePartResult, ApiError>;
    fn deletePart(&self, params: DeletePartParams) -> Result<(), ApiError>;
    fn copyLayerToPart(&self, params: CopyLayerToPartParams) -> Result<LayersSnapshot, ApiError>;
    fn setLayerTransform(&self, params: SetLayerTransformParams) -> Result<(), ApiError>;
    fn bakeLayerTransform(&self, params: RemoveLayerParams) -> Result<PixelDiff, ApiError>;
    fn addLayer(&self, params: AddLayerParams) -> Result<LayersSnapshot, ApiError>;
    fn removeLayer(&self, params: RemoveLayerParams) -> Result<LayersSnapshot, ApiError>;
    fn setLayerVisibility(
        &self,
        params: LayerVisibilityParams,
    ) -> Result<LayersSnapshot, ApiError>;
    fn setLayerOpacity(&self, params: LayerOpacityParams) -> Result<LayersSnapshot, ApiError>;
    fn reorderLayers(&self, params: ReorderLayersParams) -> Result<LayersSnapshot, ApiError>;
    fn setActiveLayer(&self, params: SetActiveLayerParams) -> Result<LayersSnapshot, ApiError>;
    fn getLayers(&self, params: PartIdParams) -> Result<LayersSnapshot, ApiError>;
    fn getCompositeImage(&self, params: CompositeParams) -> Result<CompositeResult, ApiError>;
    fn getWorkspace(&self, params: WorkspacePathParams) -> Result<WorkspaceResult, ApiError>;
    fn saveWorkspace(&self, params: SaveWorkspaceParams) -> Result<(), ApiError>;
    fn resetLayout(&self) -> Result<WorkspaceResult, ApiError>;
    fn exportSkinPack(
        &self,
        params: ExportSkinPackParams,
    ) -> Result<ExportSkinPackResult, ApiError>;
    fn importSkinPack(&self, params: ImportSkinPackParams) -> Result<ImportResult, ApiError>;
    fn setAssemblyOverride(&self, params: SetAssemblyOverrideParams) -> Result<(), ApiError>;
    fn loadWingsConfig(&self, params: WingsConfigPathParams) -> Result<WingsConfig, ApiError>;
    fn saveWingsConfig(&self, params: SaveWingsConfigParams) -> Result<(), ApiError>;
    fn setAccessoryEnabled(&self, params: SetAccessoryEnabledParams) -> Result<(), ApiError>;
    fn saveAccessoryConfig(&self, params: SaveAccessoryConfigParams) -> Result<(), ApiError>;
    fn loadBloodConfig(
        &self,
        params: BloodConfigPathParams,
    ) -> Result<blood::BloodConfig, ApiError>;
    fn saveBloodConfig(&self, params: SaveBloodConfigParams) -> Result<(), ApiError>;
    fn loadZones(&self, params: LoadZonesParams) -> Result<LoadZonesResult, ApiError>;
    fn saveZones(&self, params: SaveZonesParams) -> Result<(), ApiError>;
}
