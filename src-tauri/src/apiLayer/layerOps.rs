// 图层增删、显隐、不透明度、重排、跨部件复制与预览变换烘焙。

use std::collections::HashMap;
use std::sync::Mutex;

use crate::historyManager::{HistoryEntry, PixelDiff};
use crate::imageOps::{self, Layer};

use super::types::{
    AddLayerParams, ApiError, CopyLayerToPartParams, LayerMeta, LayerOpacityParams,
    LayerVisibilityParams, LayersSnapshot, PartIdParams, RemoveLayerParams, ReorderLayersParams,
    SetActiveLayerParams, SetLayerTransformParams,
};
use super::{
    emptyPixelDiff, finalizePendingStroke, lockSessions, notLoaded, nowMillis, PartSession,
    MAX_LAYERS,
};

pub(super) fn copyLayerToPart(
    sessionsMutex: &Mutex<HashMap<String, PartSession>>,
    params: CopyLayerToPartParams,
) -> Result<LayersSnapshot, ApiError> {
    let mut sessions = lockSessions(sessionsMutex)?;
    let src = sessions
        .get(&params.sourcePartId)
        .ok_or_else(|| notLoaded(&params.sourcePartId))?;
    let srcLayer = src
        .state
        .layers
        .iter()
        .find(|l| l.id == params.sourceLayerId)
        .ok_or_else(|| ApiError {
            code: "no_layer".into(),
            message: format!("source layer {} not found", params.sourceLayerId),
        })?;
    let srcName = srcLayer.name.clone();
    let (srcW, srcH) = (src.state.width, src.state.height);
    let srcPixels = srcLayer.pixels.clone();

    let target = sessions
        .get_mut(&params.targetPartId)
        .ok_or_else(|| notLoaded(&params.targetPartId))?;
    finalizePendingStroke(target);
    if target.state.layers.len() >= MAX_LAYERS {
        return Err(ApiError {
            code: "layer_limit".into(),
            message: format!("target part already has {} layers", MAX_LAYERS),
        });
    }
    let (dstW, dstH) = (target.state.width, target.state.height);
    let pixels = if srcW == dstW && srcH == dstH {
        srcPixels
    } else {
        let mut buf = vec![0u8; (dstW as usize) * (dstH as usize) * 4];
        let copyW = srcW.min(dstW);
        let copyH = srcH.min(dstH);
        for y in 0..copyH {
            let srcRow = ((y as usize) * (srcW as usize)) * 4;
            let dstRow = ((y as usize) * (dstW as usize)) * 4;
            let len = (copyW as usize) * 4;
            buf[dstRow..dstRow + len].copy_from_slice(&srcPixels[srcRow..srcRow + len]);
        }
        buf
    };
    let newId = target.allocLayerId();
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

pub(super) fn setLayerTransform(
    sessionsMutex: &Mutex<HashMap<String, PartSession>>,
    params: SetLayerTransformParams,
) -> Result<(), ApiError> {
    let mut sessions = lockSessions(sessionsMutex)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    let layer = session
        .state
        .layers
        .iter_mut()
        .find(|l| l.id == params.layerId)
        .ok_or_else(|| ApiError {
            code: "no_layer".into(),
            message: format!("layer {} not found", params.layerId),
        })?;
    layer.transform = params.transform.filter(|t| !t.isIdentity());
    Ok(())
}

pub(super) fn bakeLayerTransform(
    sessionsMutex: &Mutex<HashMap<String, PartSession>>,
    params: RemoveLayerParams,
) -> Result<PixelDiff, ApiError> {
    let mut sessions = lockSessions(sessionsMutex)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    finalizePendingStroke(session);
    let (width, height) = (session.state.width, session.state.height);
    let layer = session
        .state
        .layers
        .iter_mut()
        .find(|l| l.id == params.layerId)
        .ok_or_else(|| ApiError {
            code: "no_layer".into(),
            message: format!("layer {} not found", params.layerId),
        })?;
    let Some(transform) = layer.transform.take().filter(|t| !t.isIdentity()) else {
        return Ok(emptyPixelDiff());
    };
    let before = layer.pixels.clone();
    let after = imageOps::transformLayerPixels(&before, width, height, &transform);
    layer.pixels = after.clone();
    let layerId = layer.id.clone();
    let diff = PixelDiff::new(0, 0, width, height, before, after);
    session
        .history
        .push(HistoryEntry::pixel(layerId, diff.clone(), nowMillis()));
    Ok(diff)
}

pub(super) fn addLayer(
    sessionsMutex: &Mutex<HashMap<String, PartSession>>,
    params: AddLayerParams,
) -> Result<LayersSnapshot, ApiError> {
    let mut sessions = lockSessions(sessionsMutex)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    finalizePendingStroke(session);
    if session.state.layers.len() >= MAX_LAYERS {
        return Err(ApiError {
            code: "layer_limit_reached".into(),
            message: format!("max {} layers per part", MAX_LAYERS),
        });
    }
    let pixelLen = (session.state.width as usize) * (session.state.height as usize) * 4;
    let id = session.allocLayerId();
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

pub(super) fn removeLayer(
    sessionsMutex: &Mutex<HashMap<String, PartSession>>,
    params: RemoveLayerParams,
) -> Result<LayersSnapshot, ApiError> {
    let mut sessions = lockSessions(sessionsMutex)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    finalizePendingStroke(session);
    if session.state.layers.len() <= 1 {
        return Err(ApiError {
            code: "cannot_remove_last_layer".into(),
            message: "at least one layer must remain".into(),
        });
    }
    let idx = findLayerIndex(&session.state.layers, &params.layerId)?;
    session.state.layers.remove(idx);
    session.history.dropEntriesForLayer(&params.layerId);
    if session.activeLayerIndex >= session.state.layers.len() {
        session.activeLayerIndex = session.state.layers.len() - 1;
    } else if idx <= session.activeLayerIndex && session.activeLayerIndex > 0 {
        session.activeLayerIndex -= 1;
    }
    Ok(snapshot(session))
}

pub(super) fn setLayerVisibility(
    sessionsMutex: &Mutex<HashMap<String, PartSession>>,
    params: LayerVisibilityParams,
) -> Result<LayersSnapshot, ApiError> {
    let mut sessions = lockSessions(sessionsMutex)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    let idx = findLayerIndex(&session.state.layers, &params.layerId)?;
    session.state.layers[idx].visible = params.visible;
    Ok(snapshot(session))
}

pub(super) fn setLayerOpacity(
    sessionsMutex: &Mutex<HashMap<String, PartSession>>,
    params: LayerOpacityParams,
) -> Result<LayersSnapshot, ApiError> {
    let mut sessions = lockSessions(sessionsMutex)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    let idx = findLayerIndex(&session.state.layers, &params.layerId)?;
    session.state.layers[idx].opacity = params.opacity;
    Ok(snapshot(session))
}

pub(super) fn reorderLayers(
    sessionsMutex: &Mutex<HashMap<String, PartSession>>,
    params: ReorderLayersParams,
) -> Result<LayersSnapshot, ApiError> {
    let mut sessions = lockSessions(sessionsMutex)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    finalizePendingStroke(session);
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
    let mut taken: Vec<Option<Layer>> = session.state.layers.drain(..).map(Some).collect();
    session.state.layers = indices
        .into_iter()
        .map(|i| taken[i].take().expect("validated above"))
        .collect();
    if let Some(activeId) = activeId {
        if let Some(p) = session.state.layers.iter().position(|l| l.id == activeId) {
            session.activeLayerIndex = p;
        }
    }
    Ok(snapshot(session))
}

pub(super) fn setActiveLayer(
    sessionsMutex: &Mutex<HashMap<String, PartSession>>,
    params: SetActiveLayerParams,
) -> Result<LayersSnapshot, ApiError> {
    let mut sessions = lockSessions(sessionsMutex)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    finalizePendingStroke(session);
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

pub(super) fn getLayers(
    sessionsMutex: &Mutex<HashMap<String, PartSession>>,
    params: PartIdParams,
) -> Result<LayersSnapshot, ApiError> {
    let sessions = lockSessions(sessionsMutex)?;
    let session = sessions
        .get(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    Ok(snapshot(session))
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
    layers
        .iter()
        .position(|l| l.id == layerId)
        .ok_or_else(|| ApiError {
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
