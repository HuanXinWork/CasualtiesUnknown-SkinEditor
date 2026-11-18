// 桌面壳（Tauri）与 HTTP 服务（Axum）共用的核心业务逻辑层。
#![allow(non_snake_case)]

mod composite;
mod layerOps;
mod motionComposite;
mod paintOps;
mod partManage;
mod types;
mod zoneRender;

#[cfg(test)]
mod compositeTests;
#[cfg(test)]
mod tests;

pub use types::*;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::accessories;
use crate::assemblyTable;
use crate::blood;
use crate::dataPaths;
use crate::historyManager::{HistoryStack, PixelDiff};
use crate::imageOps::{self, Layer, PartEditState};
use crate::layerSidecar;
use crate::skinLoader::{self, ImportResult, PartCategory, Stage};
use crate::windowManager::{self, WorkspaceSource};
use crate::zones;

use paintOps::{finalizePendingStroke, ActiveStroke};

pub(super) const MAX_LAYERS: usize = 8;

pub(crate) struct PartSession {
    pub(crate) state: PartEditState,
    pub(crate) history: HistoryStack,
    pub(crate) activeLayerIndex: usize,
    pub(crate) activeStroke: Option<ActiveStroke>,
    pub(crate) skinDir: PathBuf,
    pub(crate) categoryDir: &'static str,
    pub(crate) partName: String,
    pub(crate) nextLayerSeq: u64,
}

impl PartSession {
    fn new(
        state: PartEditState,
        activeLayerIndex: usize,
        skinDir: PathBuf,
        categoryDir: &'static str,
        partName: String,
    ) -> Self {
        let nextLayerSeq = computeInitialLayerSeq(&state.layers);
        Self {
            state,
            history: HistoryStack::new(),
            activeLayerIndex,
            activeStroke: None,
            skinDir,
            categoryDir,
            partName,
            nextLayerSeq,
        }
    }

    pub(super) fn allocLayerId(&mut self) -> String {
        loop {
            let seq = self.nextLayerSeq;
            self.nextLayerSeq = self.nextLayerSeq.saturating_add(1);
            let candidate = format!("layer{}", seq);
            if !self.state.layers.iter().any(|l| l.id == candidate) {
                return candidate;
            }
        }
    }

    pub(super) fn canonicalPngPath(&self) -> PathBuf {
        self.skinDir
            .join(self.categoryDir)
            .join(format!("{}.png", self.partName))
    }
}

fn computeInitialLayerSeq(layers: &[Layer]) -> u64 {
    let mut next = layers.len() as u64;
    for l in layers {
        if let Some(num) = l.id.strip_prefix("layer").and_then(|s| s.parse::<u64>().ok()) {
            if num >= next {
                next = num.saturating_add(1);
            }
        }
    }
    next
}

pub struct CoreApi {
    pub(crate) sessions: Mutex<HashMap<String, PartSession>>,
    pub(crate) assemblyOverrides: Mutex<HashMap<(String, PartCategory), AssemblyOverride>>,
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
        let root = dataPaths::resolveSkinRoot(&params.skinRoot);
        std::fs::create_dir_all(&root).map_err(|e| ApiError {
            code: "io_failed".into(),
            message: format!("create skin root {} failed: {}", root.display(), e),
        })?;
        let _ = crate::ensureEmbeddedDefaultSkin(&root);
        Ok(skinLoader::listSkins(&root))
    }

    fn listMotionCaptures(
        &self,
        params: MotionCaptureListParams,
    ) -> Result<Vec<MotionCaptureMeta>, ApiError> {
        motionComposite::listMotionCaptures(params)
    }

    fn loadMotionCapture(&self, path: String) -> Result<MotionCaptureResult, ApiError> {
        motionComposite::loadMotionCapture(path)
    }

    fn getMotionCompositeImage(
        &self,
        params: MotionCompositeParams,
    ) -> Result<MotionCompositeResult, ApiError> {
        validateSegment("skinName", &params.skinName)?;
        let capturePath = dataPaths::resolvePath(&params.capturePath);
        let capture = motionComposite::readMotionCapture(&capturePath)?;
        let sessions = lockSessions(&self.sessions)?;
        motionComposite::renderMotionComposite(&params, &capture, &sessions)
    }

    fn listParts(&self, params: PartsParams) -> Result<Stage, ApiError> {
        validateSegment("skinName", &params.skinName)?;
        let root = dataPaths::resolveSkinRoot(&params.skinRoot);
        if !skinLoader::listSkins(&root).contains(&params.skinName) {
            return Err(ApiError {
                code: "skin_not_found".into(),
                message: format!("skin {} not found", params.skinName),
            });
        }
        Ok(skinLoader::scanSkin(&root, &params.skinName))
    }

    fn loadPartImage(&self, params: LoadPartParams) -> Result<LoadPartResult, ApiError> {
        validateSegment("skinName", &params.skinName)?;
        validateSegment("partName", &params.partName)?;
        let skinRoot = dataPaths::resolveSkinRoot(&params.skinRoot);
        let skinDir = skinRoot.join(&params.skinName);
        let catDirName = categoryDir(params.category);
        let (state, activeIndex, returnedPixels) =
            if let Some((sideState, sideActive)) =
                layerSidecar::loadIfPresent(&skinDir, catDirName, &params.partName)
            {
                let pixels = imageOps::flatten(&sideState);
                (sideState, sideActive, pixels)
            } else {
                let pngPath = skinDir
                    .join(catDirName)
                    .join(format!("{}.png", params.partName));
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
        let width = state.width;
        let height = state.height;
        let session = PartSession::new(state, activeIndex, skinDir, catDirName, params.partName);
        let mut sessions = lockSessions(&self.sessions)?;
        sessions.insert(partId.clone(), session);
        Ok(LoadPartResult {
            partId,
            width,
            height,
            pixels: returnedPixels,
        })
    }

    fn discardPart(&self, params: PartIdParams) -> Result<(), ApiError> {
        let mut sessions = lockSessions(&self.sessions)?;
        sessions.remove(&params.partId);
        Ok(())
    }

    fn applyBrush(&self, params: BrushParams) -> Result<PixelDiff, ApiError> {
        paintOps::applyBrush(&self.sessions, params)
    }

    fn applyEraser(&self, params: EraserParams) -> Result<PixelDiff, ApiError> {
        paintOps::applyEraser(&self.sessions, params)
    }

    fn applyGradient(&self, params: GradientParams) -> Result<PixelDiff, ApiError> {
        paintOps::applyGradient(&self.sessions, params)
    }

    fn applyFill(&self, params: FillParams) -> Result<PixelDiff, ApiError> {
        paintOps::applyFill(&self.sessions, params)
    }

    fn applySoftBrush(&self, params: SoftBrushParams) -> Result<PixelDiff, ApiError> {
        paintOps::applySoftBrush(&self.sessions, params)
    }

    fn beginStroke(&self, params: PartIdParams) -> Result<(), ApiError> {
        paintOps::beginStroke(&self.sessions, params)
    }

    fn endStroke(&self, params: PartIdParams) -> Result<PixelDiff, ApiError> {
        paintOps::endStroke(&self.sessions, params)
    }

    fn undo(&self, params: PartIdParams) -> Result<PixelDiff, ApiError> {
        paintOps::undo(&self.sessions, params)
    }

    fn redo(&self, params: PartIdParams) -> Result<PixelDiff, ApiError> {
        paintOps::redo(&self.sessions, params)
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
        let path = dataPaths::resolvePath(&params.path);
        let (table, source) = assemblyTable::loadAssembly(&path);
        Ok(AssemblyResult { table, source })
    }

    fn savePart(&self, params: SavePartParams) -> Result<(), ApiError> {
        let sessions = lockSessions(&self.sessions)?;
        let session = sessions
            .get(&params.partId)
            .ok_or_else(|| notLoaded(&params.partId))?;
        let pixels = imageOps::flattenPersisted(&session.state);
        let target = dataPaths::resolvePath(&params.targetPath);
        imageOps::savePng(&target, session.state.width, session.state.height, &pixels)?;

        if target == session.canonicalPngPath() {
            if let Err(e) = layerSidecar::save(
                &session.skinDir,
                session.categoryDir,
                &session.partName,
                &session.state,
                session.activeLayerIndex,
            ) {
                eprintln!("[savePart] sidecar 写盘失败：{}", e.message);
            }
        }
        Ok(())
    }

    fn resizePart(&self, params: ResizePartParams) -> Result<ResizePartResult, ApiError> {
        partManage::resizePart(&self.sessions, params)
    }

    fn getBaseSize(&self, params: GetBaseSizeParams) -> Result<GetBaseSizeResult, ApiError> {
        partManage::getBaseSize(params)
    }

    fn createSidePart(
        &self,
        params: CreateSidePartParams,
    ) -> Result<CreateSidePartResult, ApiError> {
        partManage::createSidePart(params)
    }

    fn createOrientationPart(
        &self,
        params: CreateOrientationPartParams,
    ) -> Result<CreateOrientationPartResult, ApiError> {
        partManage::createOrientationPart(params)
    }

    fn createPart(&self, params: CreatePartParams) -> Result<CreatePartResult, ApiError> {
        partManage::createPart(params)
    }

    fn createPartFromTemplate(
        &self,
        params: CreatePartFromTemplateParams,
    ) -> Result<CreatePartResult, ApiError> {
        partManage::createPartFromTemplate(params)
    }

    fn copyPart(&self, params: CopyPartParams) -> Result<CreatePartResult, ApiError> {
        partManage::copyPart(&self.sessions, params)
    }

    fn deletePart(&self, params: DeletePartParams) -> Result<(), ApiError> {
        partManage::deletePart(&self.sessions, params)
    }

    fn copyLayerToPart(&self, params: CopyLayerToPartParams) -> Result<LayersSnapshot, ApiError> {
        layerOps::copyLayerToPart(&self.sessions, params)
    }

    fn setLayerTransform(&self, params: SetLayerTransformParams) -> Result<(), ApiError> {
        layerOps::setLayerTransform(&self.sessions, params)
    }

    fn bakeLayerTransform(&self, params: RemoveLayerParams) -> Result<PixelDiff, ApiError> {
        layerOps::bakeLayerTransform(&self.sessions, params)
    }

    fn addLayer(&self, params: AddLayerParams) -> Result<LayersSnapshot, ApiError> {
        layerOps::addLayer(&self.sessions, params)
    }

    fn removeLayer(&self, params: RemoveLayerParams) -> Result<LayersSnapshot, ApiError> {
        layerOps::removeLayer(&self.sessions, params)
    }

    fn setLayerVisibility(
        &self,
        params: LayerVisibilityParams,
    ) -> Result<LayersSnapshot, ApiError> {
        layerOps::setLayerVisibility(&self.sessions, params)
    }

    fn setLayerOpacity(&self, params: LayerOpacityParams) -> Result<LayersSnapshot, ApiError> {
        layerOps::setLayerOpacity(&self.sessions, params)
    }

    fn reorderLayers(&self, params: ReorderLayersParams) -> Result<LayersSnapshot, ApiError> {
        layerOps::reorderLayers(&self.sessions, params)
    }

    fn setActiveLayer(&self, params: SetActiveLayerParams) -> Result<LayersSnapshot, ApiError> {
        layerOps::setActiveLayer(&self.sessions, params)
    }

    fn getLayers(&self, params: PartIdParams) -> Result<LayersSnapshot, ApiError> {
        layerOps::getLayers(&self.sessions, params)
    }

    fn getCompositeImage(&self, params: CompositeParams) -> Result<CompositeResult, ApiError> {
        validateSegment("skinName", &params.skinName)?;
        let wingsConfig = self
            .loadWingsConfig(WingsConfigPathParams {
                skinRoot: params.skinRoot.clone(),
                skinName: params.skinName.clone(),
            })
            .ok();
        let overrides = self
            .assemblyOverrides
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let sessions = lockSessions(&self.sessions)?;
        composite::renderComposite(&params, wingsConfig.as_ref(), &overrides, &sessions)
    }

    fn getWorkspace(&self, params: WorkspacePathParams) -> Result<WorkspaceResult, ApiError> {
        let path = dataPaths::resolvePath(&params.path);
        let (layout, theme, source) = windowManager::loadWorkspace(&path);
        Ok(WorkspaceResult {
            layout,
            theme,
            source,
        })
    }

    fn saveWorkspace(&self, params: SaveWorkspaceParams) -> Result<(), ApiError> {
        let path = dataPaths::resolvePath(&params.path);
        windowManager::saveWorkspace(&path, &params.layout, &params.theme)
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
        let layout =
            skinLoader::ExportLayout::fromStr(params.layout.as_deref().unwrap_or("categorized"));
        let includeBlood = params.includeBlood.unwrap_or(false);
        let skinDir = dataPaths::resolvePath(&params.skinRoot);
        let zipPath = dataPaths::resolvePath(&params.zipPath);
        let n = skinLoader::exportSkinPack(&skinDir, &zipPath, layout, includeBlood)?;
        Ok(ExportSkinPackResult { fileCount: n })
    }

    fn importSkinPack(&self, params: ImportSkinPackParams) -> Result<ImportResult, ApiError> {
        let zipPath = dataPaths::resolvePath(&params.zipPath);
        let skinDir = dataPaths::resolvePath(&params.skinRoot);
        skinLoader::importSkinPack(&zipPath, &skinDir, params.overwrite)
    }

    fn setAssemblyOverride(&self, params: SetAssemblyOverrideParams) -> Result<(), ApiError> {
        let mut overrides = self
            .assemblyOverrides
            .lock()
            .unwrap_or_else(|e| e.into_inner());
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
        validateSegment("skinName", &params.skinName)?;
        let path = wingsConfigPath(&params.skinRoot, &params.skinName);
        if !path.exists() {
            return Ok(defaultWingsConfig());
        }
        let bytes = std::fs::read(&path).map_err(|e| ApiError {
            code: "io_failed".into(),
            message: format!("read {}: {}", path.display(), e),
        })?;
        Ok(serde_json::from_slice::<WingsConfig>(&bytes).unwrap_or_else(|_| defaultWingsConfig()))
    }

    fn saveWingsConfig(&self, params: SaveWingsConfigParams) -> Result<(), ApiError> {
        validateSegment("skinName", &params.skinName)?;
        let path = wingsConfigPath(&params.skinRoot, &params.skinName);
        let bytes = serde_json::to_vec_pretty(&params.config).map_err(|e| ApiError {
            code: "encode_failed".into(),
            message: format!("serialize wings.json: {}", e),
        })?;
        dataPaths::atomicWrite(&path, &bytes).map_err(|e| ApiError {
            code: "io_failed".into(),
            message: format!("write {}: {}", path.display(), e),
        })
    }

    fn setAccessoryEnabled(&self, params: SetAccessoryEnabledParams) -> Result<(), ApiError> {
        validateSegment("skinName", &params.skinName)?;
        let skinRoot = dataPaths::resolveSkinRoot(&params.skinRoot);
        let path = accessories::accessoriesPath(&skinRoot, &params.skinName);
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
        validateSegment("skinName", &params.skinName)?;
        let skinRoot = dataPaths::resolveSkinRoot(&params.skinRoot);
        let path = accessories::accessoriesPath(&skinRoot, &params.skinName);
        let mut list = accessories::loadAccessories(&path);
        if let Some(idx) = list.iter().position(|e| e.id == params.entry.id) {
            list[idx] = params.entry;
        } else {
            list.push(params.entry);
        }
        accessories::saveAccessories(&path, &list)
    }

    fn loadBloodConfig(
        &self,
        params: BloodConfigPathParams,
    ) -> Result<blood::BloodConfig, ApiError> {
        validateSegment("skinName", &params.skinName)?;
        let skinRoot = dataPaths::resolveSkinRoot(&params.skinRoot);
        let path = blood::bloodConfigPath(&skinRoot, &params.skinName);
        Ok(blood::loadBloodConfig(&path))
    }

    fn saveBloodConfig(&self, params: SaveBloodConfigParams) -> Result<(), ApiError> {
        validateSegment("skinName", &params.skinName)?;
        let skinRoot = dataPaths::resolveSkinRoot(&params.skinRoot);
        let path = blood::bloodConfigPath(&skinRoot, &params.skinName);
        blood::saveBloodConfig(&path, &params.config)
    }

    fn loadZones(&self, params: LoadZonesParams) -> Result<LoadZonesResult, ApiError> {
        validateSegment("skinName", &params.skinName)?;
        validateSegment("partName", &params.partName)?;
        let root = dataPaths::resolveSkinRoot(&params.skinRoot);
        let catDir = categoryDir(params.category);
        let maskFile = zones::maskPath(&root, &params.skinName, catDir, &params.partName);
        let configFile = zones::configPath(&root, &params.skinName, catDir, &params.partName);
        let (width, height, ids) = match zones::loadMask(&maskFile) {
            Some(t) => t,
            None => {
                let partId = partIdKey(&params.skinName, params.category, &params.partName);
                let dimsFromSession = lockSessions(&self.sessions)
                    .ok()
                    .and_then(|s| s.get(&partId).map(|ps| (ps.state.width, ps.state.height)));
                let (w, h) = dimsFromSession.unwrap_or_else(|| {
                    let partPng = root
                        .join(&params.skinName)
                        .join(catDir)
                        .join(format!("{}.png", params.partName));
                    skinLoader::decodePart(&partPng)
                        .map(|d| (d.width, d.height))
                        .unwrap_or((0, 0))
                });
                let total = (w as usize).checked_mul(h as usize).unwrap_or(0);
                (w, h, vec![0u8; total])
            }
        };
        let config = zones::loadConfig(&configFile);
        Ok(LoadZonesResult {
            width,
            height,
            ids,
            config,
        })
    }

    fn saveZones(&self, params: SaveZonesParams) -> Result<(), ApiError> {
        validateSegment("skinName", &params.skinName)?;
        validateSegment("partName", &params.partName)?;
        let root = dataPaths::resolveSkinRoot(&params.skinRoot);
        let catDir = categoryDir(params.category);
        let maskFile = zones::maskPath(&root, &params.skinName, catDir, &params.partName);
        let configFile = zones::configPath(&root, &params.skinName, catDir, &params.partName);
        zones::saveMask(&maskFile, params.width, params.height, &params.ids)?;
        zones::saveConfig(&configFile, &params.config)
    }
}

pub(super) fn validateSegment<'a>(field: &str, value: &'a str) -> Result<&'a str, ApiError> {
    if !dataPaths::isValidSingleSegment(value) {
        return Err(ApiError {
            code: "invalid_name".into(),
            message: format!("invalid {}: {}", field, value),
        });
    }
    Ok(value)
}

fn wingsConfigPath(skinRoot: &str, skinName: &str) -> PathBuf {
    dataPaths::resolveSkinRoot(skinRoot)
        .join(skinName)
        .join("wings.json")
}

fn defaultWingsConfig() -> WingsConfig {
    WingsConfig {
        wingUL: WingPieceConfig {
            x: -2,
            y: -8,
            rotation: 314.0,
            zOrder: 5,
        },
        wingDL: WingPieceConfig {
            x: -1,
            y: -10,
            rotation: 0.0,
            zOrder: 4,
        },
        wingUR: WingPieceConfig {
            x: -2,
            y: -9,
            rotation: 318.0,
            zOrder: 5,
        },
        wingDR: WingPieceConfig {
            x: 0,
            y: -12,
            rotation: 0.0,
            zOrder: 4,
        },
    }
}

pub(crate) fn partIdKey(skinName: &str, category: PartCategory, partName: &str) -> String {
    format!("{}::{}::{}", skinName, categoryDir(category), partName)
}

pub(super) fn emptyPixelDiff() -> PixelDiff {
    PixelDiff {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        before: vec![],
        after: vec![],
    }
}

pub(crate) fn categoryDir(category: PartCategory) -> &'static str {
    match category {
        PartCategory::Body => "Body",
        PartCategory::Head => "Head",
        PartCategory::Wings => "Wings",
        PartCategory::Accessories => "Accessories",
        PartCategory::Blood => "Blood",
    }
}

pub(crate) fn categoryFromDir(d: &str) -> PartCategory {
    match d {
        "Body" => PartCategory::Body,
        "Head" => PartCategory::Head,
        "Wings" => PartCategory::Wings,
        "Blood" => PartCategory::Blood,
        _ => PartCategory::Accessories,
    }
}

pub(super) fn notLoaded(partId: &str) -> ApiError {
    ApiError {
        code: "not_loaded".into(),
        message: format!("part {} not loaded", partId),
    }
}

pub(super) fn noActiveLayer() -> ApiError {
    ApiError {
        code: "no_layer".into(),
        message: "session has no active layer".into(),
    }
}

pub(super) fn lockSessions(
    sessions: &Mutex<HashMap<String, PartSession>>,
) -> Result<std::sync::MutexGuard<'_, HashMap<String, PartSession>>, ApiError> {
    Ok(sessions.lock().unwrap_or_else(|e| e.into_inner()))
}

pub(super) fn nowMillis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
