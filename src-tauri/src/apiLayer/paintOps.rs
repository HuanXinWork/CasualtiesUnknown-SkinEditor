// 单图层绘画笔触、填充、渐变与按笔聚合撤销/重做实现。

use std::collections::HashMap;
use std::sync::Mutex;

use crate::historyManager::{self, HistoryEntry, PixelDiff};
use crate::imageOps;

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
                session.history.push(HistoryEntry {
                    layerId,
                    diff: diff.clone(),
                    timestamp: nowMillis(),
                });
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
                session.history.push(HistoryEntry {
                    layerId,
                    diff: diff.clone(),
                    timestamp: nowMillis(),
                });
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
        session.history.push(HistoryEntry {
            layerId,
            diff: diff.clone(),
            timestamp: nowMillis(),
        });
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
        session.history.push(HistoryEntry {
            layerId,
            diff: diff.clone(),
            timestamp: nowMillis(),
        });
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
    let width = session.state.width;
    if let Some(idx) = session
        .state
        .layers
        .iter()
        .position(|l| l.id == entry.layerId)
    {
        historyManager::applyBefore(&mut session.state.layers[idx].pixels, width, &entry.diff);
        session.activeLayerIndex = idx;
    }
    Ok(entry.diff)
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
    let width = session.state.width;
    if let Some(idx) = session
        .state
        .layers
        .iter()
        .position(|l| l.id == entry.layerId)
    {
        historyManager::applyAfter(&mut session.state.layers[idx].pixels, width, &entry.diff);
        session.activeLayerIndex = idx;
    }
    Ok(entry.diff)
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
