// 基于矩形 RGBA 差异块的撤销/重做双栈（上限 50 步，超出按 FIFO 淘汰）。
#![allow(non_snake_case)]

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub layerId: String,
    pub diff: PixelDiff,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PixelDiff {
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
    pub before: Vec<u8>,
    pub after: Vec<u8>,
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

    /// 删除图层时清理关联条目，避免撤销时引用已不存在的图层。
    pub fn dropEntriesForLayer(&mut self, layerId: &str) {
        self.undoStack.retain(|e| e.layerId != layerId);
        self.redoStack.retain(|e| e.layerId != layerId);
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
        HistoryEntry {
            layerId: layerId.into(),
            diff,
            timestamp: ts,
        }
    }

    fn emptyDiff() -> PixelDiff {
        PixelDiff {
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            before: vec![],
            after: vec![],
        }
    }

    fn pixelDiff1x1(x: u32, y: u32, before: [u8; 4], after: [u8; 4]) -> PixelDiff {
        PixelDiff {
            x,
            y,
            width: 1,
            height: 1,
            before: before.to_vec(),
            after: after.to_vec(),
        }
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
        assert_eq!(popped.layerId, "B");
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
        assert_eq!(r.layerId, "B");
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
        assert_eq!(top.layerId, "L50");
        let mut last = top;
        while let Some(e) = h.undo() {
            last = e;
        }
        assert_eq!(last.layerId, "L1");
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
            applyBefore(&mut pixels, 5, &e.diff);
        }
        assert_eq!(pixels, initial);
        assert_eq!(h.undoLen(), 0);
        assert_eq!(h.redoLen(), 5);
    }
}
