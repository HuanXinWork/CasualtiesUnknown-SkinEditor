// undo / redo 双栈，存矩形像素 diff。最大深度 50 步，FIFO 丢弃最老条目。
#![allow(non_snake_case)]

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub layerId: String,
    pub diff: PixelDiff,
    pub timestamp: i64,
}

/// 矩形像素 diff：before/after 都是 width*height*4 字节的 RGBA 副本。
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

/// undo / redo 双栈的纯内存实现。调用方负责把 diff 应用到像素 buffer。
#[derive(Debug, Default)]
pub struct HistoryStack {
    undoStack: VecDeque<HistoryEntry>,
    redoStack: Vec<HistoryEntry>,
}

impl HistoryStack {
    pub fn new() -> Self {
        Self::default()
    }

    /// 压入新条目并清空 redo 栈。超过 MAX_UNDO 时按 FIFO 丢弃最早条目。
    pub fn push(&mut self, entry: HistoryEntry) {
        self.redoStack.clear();
        self.undoStack.push_back(entry);
        while self.undoStack.len() > MAX_UNDO {
            self.undoStack.pop_front();
        }
    }

    /// 弹出 undo 栈最新条目搬到 redo 栈，返回该条目。调用方按 before 还原像素。
    pub fn undo(&mut self) -> Option<HistoryEntry> {
        let entry = self.undoStack.pop_back()?;
        self.redoStack.push(entry.clone());
        Some(entry)
    }

    /// 弹出 redo 栈最新条目搬回 undo 栈，返回该条目。调用方按 after 重做像素。
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

    /// 删图层时调用，丢弃所有指向该图层的 undo/redo 条目，
    /// 防止悬挂条目在 undo/redo 时找不到目标图层。
    pub fn dropEntriesForLayer(&mut self, layerId: &str) {
        self.undoStack.retain(|e| e.layerId != layerId);
        self.redoStack.retain(|e| e.layerId != layerId);
    }
}

fn applyRect(pixels: &mut [u8], width: u32, diff: &PixelDiff, src: &[u8]) {
    if diff.width == 0 || diff.height == 0 {
        return;
    }
    let rectW = diff.width as usize;
    let rowBytes = rectW * 4;
    for row in 0..diff.height {
        let dstStart = (((diff.y + row) * width) + diff.x) as usize * 4;
        let srcStart = (row as usize) * rowBytes;
        let dstEnd = dstStart + rowBytes;
        let srcEnd = srcStart + rowBytes;
        pixels[dstStart..dstEnd].copy_from_slice(&src[srcStart..srcEnd]);
    }
}

/// 把 diff.before 写回 pixels 在 (x,y,width,height) 矩形位置，用于 undo。
pub fn applyBefore(pixels: &mut [u8], width: u32, diff: &PixelDiff) {
    applyRect(pixels, width, diff, &diff.before);
}

/// 把 diff.after 写回 pixels 在 (x,y,width,height) 矩形位置，用于 redo。
pub fn applyAfter(pixels: &mut [u8], width: u32, diff: &PixelDiff) {
    applyRect(pixels, width, diff, &diff.after);
}


#[cfg(test)]
mod tests {
    use super::*;

    fn mkEntry(layerId: &str, ts: i64, diff: PixelDiff) -> HistoryEntry {
        HistoryEntry { layerId: layerId.into(), diff, timestamp: ts }
    }

    fn emptyDiff() -> PixelDiff {
        PixelDiff { x: 0, y: 0, width: 0, height: 0, before: vec![], after: vec![] }
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
            10, 20, 30, 40,   50, 60, 70, 80,
            90, 100, 110, 120, 130, 140, 150, 160,
        ];
        let snapshot = pixels.clone();
        let diff = pixelDiff1x1(1, 0, [50, 60, 70, 80], [200, 210, 220, 230]);
        applyAfter(&mut pixels, 2, &diff);
        assert_eq!(&pixels[4..8], &[200, 210, 220, 230]);
        applyBefore(&mut pixels, 2, &diff);
        assert_eq!(pixels, snapshot);
    }

    #[test]
    fn emptyDiffIsNoop() {
        let mut pixels = vec![1, 2, 3, 4];
        let snapshot = pixels.clone();
        let diff = emptyDiff();
        applyBefore(&mut pixels, 1, &diff);
        applyAfter(&mut pixels, 1, &diff);
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
