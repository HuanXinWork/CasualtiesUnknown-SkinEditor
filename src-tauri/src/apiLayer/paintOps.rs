// 单图层绘画笔触、填充、渐变与按笔聚合撤销/重做实现。

use std::collections::HashMap;
use std::sync::Mutex;

use crate::baseSizes;
use crate::historyManager::{self, CanvasResizeSnapshot, HistoryEntry, HistoryPayload, PixelDiff};
use crate::imageOps;
use crate::zones;

use super::types::{
    ApiError, BrushParams, EraserParams, FillParams, GradientParams, PartIdParams, SoftBrushParams,
};
use super::{emptyPixelDiff, lockSessions, noActiveLayer, notLoaded, nowMillis, PartSession};

pub(crate) struct ActiveStroke {
    layerId: String,
    baseline: Vec<u8>,
    accRect: Option<(u32, u32, u32, u32)>,
    softCoverage: Option<Vec<u8>>,
}

pub(super) fn applyBrush(
    sessions: &Mutex<HashMap<String, PartSession>>,
    params: BrushParams,
) -> Result<PixelDiff, ApiError> {
    let mut sessions = lockSessions(sessions)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    let (width, height) = (session.state.width, session.state.height);
    let activeIdx = session.activeLayerIndex;
    let layer = session
        .state
        .layers
        .get_mut(activeIdx)
        .ok_or_else(noActiveLayer)?;
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
    match session.activeStroke.as_mut() {
        Some(stroke) if stroke.layerId == layerId => mergeStrokeRect(stroke, &diff),
        _ => {
            if diff.width != 0 && diff.height != 0 {
                session
                    .history
                    .push(HistoryEntry::pixel(layerId, diff.clone(), nowMillis()));
            }
        }
    }
    Ok(diff)
}

pub(super) fn applyEraser(
    sessions: &Mutex<HashMap<String, PartSession>>,
    params: EraserParams,
) -> Result<PixelDiff, ApiError> {
    let mut sessions = lockSessions(sessions)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    let (width, height) = (session.state.width, session.state.height);
    let activeIdx = session.activeLayerIndex;
    let layer = session
        .state
        .layers
        .get_mut(activeIdx)
        .ok_or_else(noActiveLayer)?;
    let layerId = layer.id.clone();
    let diff = imageOps::applyEraser(
        &mut layer.pixels,
        width,
        height,
        params.cx,
        params.cy,
        params.brushSize,
    );
    match session.activeStroke.as_mut() {
        Some(stroke) if stroke.layerId == layerId => mergeStrokeRect(stroke, &diff),
        _ => {
            if diff.width != 0 && diff.height != 0 {
                session
                    .history
                    .push(HistoryEntry::pixel(layerId, diff.clone(), nowMillis()));
            }
        }
    }
    Ok(diff)
}

pub(super) fn applyGradient(
    sessions: &Mutex<HashMap<String, PartSession>>,
    params: GradientParams,
) -> Result<PixelDiff, ApiError> {
    let mut sessions = lockSessions(sessions)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    finalizePendingStroke(session);
    let (width, height) = (session.state.width, session.state.height);
    let activeIdx = session.activeLayerIndex;
    let layer = session
        .state
        .layers
        .get_mut(activeIdx)
        .ok_or_else(noActiveLayer)?;
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
    if diff.width != 0 && diff.height != 0 {
        session
            .history
            .push(HistoryEntry::pixel(layerId, diff.clone(), nowMillis()));
    }
    Ok(diff)
}

pub(super) fn applyFill(
    sessions: &Mutex<HashMap<String, PartSession>>,
    params: FillParams,
) -> Result<PixelDiff, ApiError> {
    let mut sessions = lockSessions(sessions)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    finalizePendingStroke(session);
    let (width, height) = (session.state.width, session.state.height);
    let activeIdx = session.activeLayerIndex;
    let layer = session
        .state
        .layers
        .get_mut(activeIdx)
        .ok_or_else(noActiveLayer)?;
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
        session
            .history
            .push(HistoryEntry::pixel(layerId, diff.clone(), nowMillis()));
    }
    Ok(diff)
}

pub(super) fn applySoftBrush(
    sessions: &Mutex<HashMap<String, PartSession>>,
    params: SoftBrushParams,
) -> Result<PixelDiff, ApiError> {
    let mut sessions = lockSessions(sessions)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    let (width, height) = (session.state.width, session.state.height);
    let activeIdx = session.activeLayerIndex;
    let layer = session
        .state
        .layers
        .get(activeIdx)
        .ok_or_else(noActiveLayer)?;
    let layerId = layer.id.clone();
    let pixelLen = layer.pixels.len();

    let baseline: Vec<u8> = match session.activeStroke.as_ref() {
        Some(s) if s.layerId == layerId => s.baseline.clone(),
        _ => session.state.layers[activeIdx].pixels.clone(),
    };
    let mut coverage: Vec<u8> = match session.activeStroke.as_mut() {
        Some(s) if s.layerId == layerId => s
            .softCoverage
            .take()
            .unwrap_or_else(|| vec![0u8; pixelLen / 4]),
        _ => vec![0u8; pixelLen / 4],
    };
    let Some(rect) = imageOps::stampSoftCoverage(
        &mut coverage,
        width,
        height,
        params.cx,
        params.cy,
        params.brushSize,
        params.hardness,
    ) else {
        if let Some(s) = session.activeStroke.as_mut() {
            if s.layerId == layerId {
                s.softCoverage = Some(coverage);
            }
        }
        return Ok(emptyPixelDiff());
    };
    let layerMut = &mut session.state.layers[activeIdx];
    let before = copyRectFromBuffer(&layerMut.pixels, width, rect.0, rect.1, rect.2, rect.3);
    imageOps::compositeSoftStroke(
        &mut layerMut.pixels,
        &baseline,
        &coverage,
        width,
        rect,
        params.color,
    );
    let after = copyRectFromBuffer(&layerMut.pixels, width, rect.0, rect.1, rect.2, rect.3);
    let diff = PixelDiff::new(rect.0, rect.1, rect.2 - rect.0, rect.3 - rect.1, before, after);
    match session.activeStroke.as_mut() {
        Some(s) if s.layerId == layerId => {
            s.softCoverage = Some(coverage);
            mergeStrokeRect(s, &diff);
        }
        _ => {
            session
                .history
                .push(HistoryEntry::pixel(layerId, diff.clone(), nowMillis()));
        }
    }
    Ok(diff)
}

pub(super) fn beginStroke(
    sessions: &Mutex<HashMap<String, PartSession>>,
    params: PartIdParams,
) -> Result<(), ApiError> {
    let mut sessions = lockSessions(sessions)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    if session.activeStroke.is_some() {
        return Ok(());
    }
    let activeIdx = session.activeLayerIndex;
    let layer = session
        .state
        .layers
        .get(activeIdx)
        .ok_or_else(noActiveLayer)?;
    session.activeStroke = Some(ActiveStroke {
        layerId: layer.id.clone(),
        baseline: layer.pixels.clone(),
        accRect: None,
        softCoverage: None,
    });
    Ok(())
}

pub(super) fn endStroke(
    sessions: &Mutex<HashMap<String, PartSession>>,
    params: PartIdParams,
) -> Result<PixelDiff, ApiError> {
    let mut sessions = lockSessions(sessions)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    Ok(finalizePendingStroke(session).unwrap_or_else(emptyPixelDiff))
}

pub(super) fn undo(
    sessions: &Mutex<HashMap<String, PartSession>>,
    params: PartIdParams,
) -> Result<PixelDiff, ApiError> {
    let mut sessions = lockSessions(sessions)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    finalizePendingStroke(session);
    let entry = session.history.undo().ok_or_else(|| ApiError {
        code: "nothing_to_undo".into(),
        message: format!("undo stack empty for {}", params.partId),
    })?;
    match entry.payload {
        HistoryPayload::Pixel { layerId, diff } => {
            let width = session.state.width;
            if let Some(idx) = session.state.layers.iter().position(|l| l.id == layerId) {
                historyManager::applyBefore(&mut session.state.layers[idx].pixels, width, &diff);
                session.activeLayerIndex = idx;
            }
            Ok(diff)
        }
        HistoryPayload::CanvasResize(snap) => {
            match applyCanvasResizeSnapshot(session, &snap, true) {
                Ok(diff) => Ok(diff),
                Err(e) => {
                    let _ = session.history.redo();
                    Err(e)
                }
            }
        }
    }
}

pub(super) fn redo(
    sessions: &Mutex<HashMap<String, PartSession>>,
    params: PartIdParams,
) -> Result<PixelDiff, ApiError> {
    let mut sessions = lockSessions(sessions)?;
    let session = sessions
        .get_mut(&params.partId)
        .ok_or_else(|| notLoaded(&params.partId))?;
    finalizePendingStroke(session);
    let entry = session.history.redo().ok_or_else(|| ApiError {
        code: "nothing_to_redo".into(),
        message: format!("redo stack empty for {}", params.partId),
    })?;
    match entry.payload {
        HistoryPayload::Pixel { layerId, diff } => {
            let width = session.state.width;
            if let Some(idx) = session.state.layers.iter().position(|l| l.id == layerId) {
                historyManager::applyAfter(&mut session.state.layers[idx].pixels, width, &diff);
                session.activeLayerIndex = idx;
            }
            Ok(diff)
        }
        HistoryPayload::CanvasResize(snap) => {
            match applyCanvasResizeSnapshot(session, &snap, false) {
                Ok(diff) => Ok(diff),
                Err(e) => {
                    let _ = session.history.undo();
                    Err(e)
                }
            }
        }
    }
}

fn applyCanvasResizeSnapshot(
    session: &mut PartSession,
    snap: &CanvasResizeSnapshot,
    isUndo: bool,
) -> Result<PixelDiff, ApiError> {
    let (targetW, targetH, targetLayers, fallbackOff) = if isUndo {
        (
            snap.beforeWidth,
            snap.beforeHeight,
            &snap.beforeLayers,
            (-snap.offsetX, -snap.offsetY),
        )
    } else {
        (
            snap.afterWidth,
            snap.afterHeight,
            &snap.afterLayers,
            (snap.offsetX, snap.offsetY),
        )
    };

    // 先落盘 zones 与 baseSizes，IO 失败时便于调用方把历史栈回退到原位。
    if let Some(z) = &snap.zones {
        let maskFile = session
            .skinDir
            .join(session.categoryDir)
            .join(format!("{}.zones.png", session.partName));
        if isUndo {
            zones::saveMask(&maskFile, z.beforeWidth, z.beforeHeight, &z.beforeIds)?;
        } else {
            zones::saveMask(&maskFile, z.afterWidth, z.afterHeight, &z.afterIds)?;
        }
    }
    if let Some(bs) = &snap.baseSize {
        if isUndo {
            match bs.before {
                Some((bw, bh)) => baseSizes::upsert(&session.skinDir, &bs.key, bw, bh)?,
                None => baseSizes::remove(&session.skinDir, &bs.key)?,
            }
        } else {
            baseSizes::upsert(&session.skinDir, &bs.key, bs.after.0, bs.after.1)?;
        }
    }

    let curW = session.state.width;
    let curH = session.state.height;
    let layerMap: HashMap<&str, &[u8]> = targetLayers
        .iter()
        .map(|(id, px)| (id.as_str(), px.as_slice()))
        .collect();
    for layer in &mut session.state.layers {
        layer.transform = None;
        if let Some(px) = layerMap.get(layer.id.as_str()) {
            layer.pixels = px.to_vec();
        } else {
            // 裁扩之后才新建的图层不在快照内，按对应偏移裁扩以维持全部图层尺寸一致的不变量。
            layer.pixels = imageOps::resizeCanvasRgba(
                &layer.pixels,
                curW,
                curH,
                targetW,
                targetH,
                fallbackOff.0,
                fallbackOff.1,
            );
        }
    }
    session.state.width = targetW;
    session.state.height = targetH;
    Ok(PixelDiff::resized(targetW, targetH))
}

pub(super) fn finalizePendingStroke(session: &mut PartSession) -> Option<PixelDiff> {
    let stroke = session.activeStroke.take()?;
    let (x0, y0, x1, y1) = stroke.accRect?;
    let width = session.state.width;
    let layerIdx = session
        .state
        .layers
        .iter()
        .position(|l| l.id == stroke.layerId)?;
    let before = copyRectFromBuffer(&stroke.baseline, width, x0, y0, x1, y1);
    let after = copyRectFromBuffer(
        &session.state.layers[layerIdx].pixels,
        width,
        x0,
        y0,
        x1,
        y1,
    );
    let diff = PixelDiff::new(x0, y0, x1 - x0, y1 - y0, before, after);
    session
        .history
        .push(HistoryEntry::pixel(stroke.layerId, diff.clone(), nowMillis()));
    Some(diff)
}

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

fn copyRectFromBuffer(
    buf: &[u8],
    width: u32,
    x0: u32,
    y0: u32,
    x1: u32,
    y1: u32,
) -> Vec<u8> {
    let rectW = (x1 - x0) as usize;
    let rectH = (y1 - y0) as usize;
    let mut out = Vec::with_capacity(rectW * rectH * 4);
    for row in 0..rectH {
        let srcStart = (((y0 as usize) + row) * (width as usize) + (x0 as usize)) * 4;
        let srcEnd = srcStart + rectW * 4;
        if srcEnd <= buf.len() {
            out.extend_from_slice(&buf[srcStart..srcEnd]);
        }
    }
    out
}
