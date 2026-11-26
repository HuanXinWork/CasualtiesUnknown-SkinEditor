// 基于矩形 RGBA 差异块与整画布裁扩快照的撤销/重做双栈（上限 50 步，超出按 FIFO 淘汰）。
#![allow(non_snake_case)]

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ZonesSnapshot {
    pub beforeWidth: u32,
    pub beforeHeight: u32,
    pub beforeIds: Vec<u8>,
    pub afterWidth: u32,
    pub afterHeight: u32,
    pub afterIds: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BaseSizeChange {
    pub key: String,
    /// 变更前 `baseSizes.json` 中该精确键的记录；`None` 表示变更前无记录，撤销时移除该键。
    pub before: Option<(u32, u32)>,
    pub after: (u32, u32),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CanvasResizeSnapshot {
    pub beforeWidth: u32,
    pub beforeHeight: u32,
    pub beforeLayers: Vec<(String, Vec<u8>)>,
    pub afterWidth: u32,
    pub afterHeight: u32,
    pub afterLayers: Vec<(String, Vec<u8>)>,
    pub offsetX: i32,
    pub offsetY: i32,
    pub zones: Option<ZonesSnapshot>,
    pub baseSize: Option<BaseSizeChange>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum HistoryPayload {
    Pixel {
        layerId: String,
        diff: PixelDiff,
    },
    CanvasResize(CanvasResizeSnapshot),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub payload: HistoryPayload,
    pub timestamp: i64,
}

impl HistoryEntry {
    pub fn pixel(layerId: String, diff: PixelDiff, timestamp: i64) -> Self {
        Self {
            payload: HistoryPayload::Pixel { layerId, diff },
            timestamp,
        }
    }

    pub fn canvasResize(snapshot: CanvasResizeSnapshot, timestamp: i64) -> Self {
        Self {
            payload: HistoryPayload::CanvasResize(snapshot),
            timestamp,
        }
    }

    pub fn asPixel(&self) -> Option<(&str, &PixelDiff)> {
        match &self.payload {
            HistoryPayload::Pixel { layerId, diff } => Some((layerId.as_str(), diff)),
            HistoryPayload::CanvasResize(_) => None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PixelDiff {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub before: Vec<u8>,
    pub after: Vec<u8>,
    /// 仅在撤销/重做整画布裁扩时返回，向后兼容既有单图层局部 diff JSON 结构。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvasWidth: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub canvasHeight: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resized: Option<bool>,
}

impl PixelDiff {
    pub fn new(x: u32, y: u32, width: u32, height: u32, before: Vec<u8>, after: Vec<u8>) -> Self {
        Self {
            x,
            y,
            width,
            height,
            before,
            after,
            canvasWidth: None,
            canvasHeight: None,
            resized: None,
        }
    }

    pub fn resized(width: u32, height: u32) -> Self {
        Self {
            x: 0,
            y: 0,
            width,
            height,
            before: Vec::new(),
            after: Vec::new(),
            canvasWidth: Some(width),
            canvasHeight: Some(height),
            resized: Some(true),
        }
    }
}

const MAX_UNDO: usize = 50;

#[derive(Debug, Default)]
pub struct HistoryStack {
    undoStack: VecDeque<HistoryEntry>,
    redoStack: Vec<HistoryEntry>,
}

impl HistoryStack {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, entry: HistoryEntry) {
        self.redoStack.clear();
        self.undoStack.push_back(entry);
        while self.undoStack.len() > MAX_UNDO {
            self.undoStack.pop_front();
        }
    }

    pub fn undo(&mut self) -> Option<HistoryEntry> {
        let entry = self.undoStack.pop_back()?;
        self.redoStack.push(entry.clone());
        Some(entry)
    }

    pub fn redo(&mut self) -> Option<HistoryEntry> {
        let entry = self.redoStack.pop()?;
        self.undoStack.push_back(entry.clone());
        Some(entry)
    }

    pub fn undoLen(&self) -> usize {
        self.undoStack.len()
    }

    pub fn redoLen(&self) -> usize {
        self.redoStack.len()
    }

    /// 删除图层时清理关联的像素条目并裁剪画布快照中的已删图层，避免撤销时引用不存在的图层。
    pub fn dropEntriesForLayer(&mut self, layerId: &str) {
        let scrub = |entry: &mut HistoryEntry| -> bool {
            match &mut entry.payload {
                HistoryPayload::Pixel { layerId: lid, .. } => lid != layerId,
                HistoryPayload::CanvasResize(snap) => {
                    snap.beforeLayers.retain(|(id, _)| id != layerId);
                    snap.afterLayers.retain(|(id, _)| id != layerId);
                    true
                }
            }
        };
        self.undoStack.retain_mut(scrub);
        self.redoStack.retain_mut(scrub);
    }

    pub fn clear(&mut self) {
        self.undoStack.clear();
        self.redoStack.clear();
    }
}

fn applyRect(pixels: &mut [u8], width: u32, diff: &PixelDiff, src: &[u8]) {
    if diff.width == 0 || diff.height == 0 || width == 0 {
        return;
    }
    let Some(endX) = diff.x.checked_add(diff.width) else {
        return;
    };
    if endX > width {
        return;
    }
    let Some(rowBytes) = (diff.width as usize).checked_mul(4) else {
        return;
    };
    let Some(expectedSrc) = rowBytes.checked_mul(diff.height as usize) else {
        return;
    };
    if src.len() < expectedSrc {
        return;
    }
    let stride = (width as usize).saturating_mul(4);
    for row in 0..diff.height {
        let Some(absRow) = diff.y.checked_add(row) else {
            return;
        };
        let Some(rowOffset) = (absRow as usize).checked_mul(stride) else {
            return;
        };
        let Some(dstStart) = rowOffset.checked_add((diff.x as usize).saturating_mul(4)) else {
            return;
        };
        let Some(dstEnd) = dstStart.checked_add(rowBytes) else {
            return;
        };
        if dstEnd > pixels.len() {
            return;
        }
        let srcStart = (row as usize) * rowBytes;
        pixels[dstStart..dstEnd].copy_from_slice(&src[srcStart..srcStart + rowBytes]);
    }
}

pub fn applyBefore(pixels: &mut [u8], width: u32, diff: &PixelDiff) {
    applyRect(pixels, width, diff, &diff.before);
}

pub fn applyAfter(pixels: &mut [u8], width: u32, diff: &PixelDiff) {
    applyRect(pixels, width, diff, &diff.after);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mkEntry(layerId: &str, ts: i64, diff: PixelDiff) -> HistoryEntry {
        HistoryEntry::pixel(layerId.into(), diff, ts)
    }

    fn emptyDiff() -> PixelDiff {
        PixelDiff::new(0, 0, 0, 0, vec![], vec![])
    }

    fn pixelDiff1x1(x: u32, y: u32, before: [u8; 4], after: [u8; 4]) -> PixelDiff {
        PixelDiff::new(x, y, 1, 1, before.to_vec(), after.to_vec())
    }

    #[test]
    fn pushClearsRedoStack() {
        let mut h = HistoryStack::new();
        h.push(mkEntry("A", 1, emptyDiff()));
        h.undo();
        assert_eq!(h.redoLen(), 1);
        h.push(mkEntry("B", 2, emptyDiff()));
        assert_eq!(h.redoLen(), 0);
        assert_eq!(h.undoLen(), 1);
    }

    #[test]
    fn undoMovesEntryToRedoStack() {
        let mut h = HistoryStack::new();
        h.push(mkEntry("A", 1, emptyDiff()));
        h.push(mkEntry("B", 2, emptyDiff()));
        let popped = h.undo().expect("undo returns entry");
        assert_eq!(popped.asPixel().map(|(id, _)| id), Some("B"));
        assert_eq!(h.undoLen(), 1);
        assert_eq!(h.redoLen(), 1);
    }

    #[test]
    fn redoReversesUndo() {
        let mut h = HistoryStack::new();
        h.push(mkEntry("A", 1, emptyDiff()));
        h.push(mkEntry("B", 2, emptyDiff()));
        h.undo();
        let r = h.redo().expect("redo returns entry");
        assert_eq!(r.asPixel().map(|(id, _)| id), Some("B"));
        assert_eq!(h.undoLen(), 2);
        assert_eq!(h.redoLen(), 0);
    }

    #[test]
    fn pushBeyondLimitDropsOldest() {
        let mut h = HistoryStack::new();
        for i in 0..51 {
            h.push(mkEntry(&format!("L{}", i), i as i64, emptyDiff()));
        }
        assert_eq!(h.undoLen(), 50);
        let top = h.undo().expect("undo top");
        assert_eq!(top.asPixel().map(|(id, _)| id), Some("L50"));
        let mut last = top;
        while let Some(e) = h.undo() {
            last = e;
        }
        assert_eq!(last.asPixel().map(|(id, _)| id), Some("L1"));
    }

    #[test]
    fn applyBeforeRestoresPixels() {
        let mut pixels = vec![
            10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160,
        ];
        let snapshot = pixels.clone();
        let diff = pixelDiff1x1(1, 0, [50, 60, 70, 80], [200, 210, 220, 230]);
        applyAfter(&mut pixels, 2, &diff);
        assert_eq!(&pixels[4..8], &[200, 210, 220, 230]);
        applyBefore(&mut pixels, 2, &diff);
        assert_eq!(pixels, snapshot);
    }

    #[test]
    fn emptyOrOutOfBoundsDiffIsNoop() {
        let mut pixels = vec![1, 2, 3, 4];
        let snapshot = pixels.clone();
        applyBefore(&mut pixels, 1, &emptyDiff());
        applyAfter(&mut pixels, 1, &emptyDiff());
        let bad = pixelDiff1x1(5, 5, [0; 4], [9; 4]);
        applyAfter(&mut pixels, 1, &bad);
        assert_eq!(pixels, snapshot);
    }

    #[test]
    fn undoSymmetric() {
        let mut pixels = vec![0u8; 5 * 4];
        let initial = pixels.clone();
        let mut h = HistoryStack::new();
        for i in 0..5u32 {
            let before = [0, 0, 0, 0];
            let after = [(i + 1) as u8, 0, 0, 255];
            let diff = pixelDiff1x1(i, 0, before, after);
            applyAfter(&mut pixels, 5, &diff);
            h.push(mkEntry("L", i as i64, diff));
        }
        while let Some(e) = h.undo() {
            let (_, diff) = e.asPixel().expect("pixel entry");
            applyBefore(&mut pixels, 5, diff);
        }
        assert_eq!(pixels, initial);
        assert_eq!(h.undoLen(), 0);
        assert_eq!(h.redoLen(), 5);
    }

    #[test]
    fn pixelDiffSerializationOmitsOptionalResizeFieldsByDefault() {
        let regular = emptyDiff();
        let v = serde_json::to_value(&regular).unwrap();
        assert!(v.get("resized").is_none());
        assert!(v.get("canvasWidth").is_none());
        assert!(v.get("canvasHeight").is_none());

        let resized = PixelDiff::resized(32, 24);
        let rv = serde_json::to_value(&resized).unwrap();
        assert_eq!(rv.get("resized"), Some(&serde_json::json!(true)));
        assert_eq!(rv.get("canvasWidth"), Some(&serde_json::json!(32)));
        assert_eq!(rv.get("canvasHeight"), Some(&serde_json::json!(24)));
    }
}
