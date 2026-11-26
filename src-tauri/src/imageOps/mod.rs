// RGBA8 图层像素合成与绘制工具（硬笔刷/柔笔刷/橡皮/油漆桶/渐变/图层变换）。
#![allow(non_snake_case)]

mod blit;
#[cfg(test)]
mod tests;

pub use blit::*;

use serde::{Deserialize, Serialize};

use crate::historyManager::PixelDiff;

pub const MAX_PART_DIM: u32 = 4096;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub opacity: u8,
    pub pixels: Vec<u8>,
    /// 未烘焙的实时预览变换，不写入 sidecar。
    #[serde(skip)]
    pub transform: Option<LayerTransform>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct LayerTransform {
    pub flipX: bool,
    pub flipY: bool,
    pub scaleX: f32,
    pub scaleY: f32,
    pub rotationDeg: f32,
}

impl LayerTransform {
    pub fn isIdentity(&self) -> bool {
        !self.flipX
            && !self.flipY
            && (self.scaleX - 1.0).abs() < 1e-4
            && (self.scaleY - 1.0).abs() < 1e-4
            && self.rotationDeg.abs() < 1e-4
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartEditState {
    pub partName: String,
    pub width: u32,
    pub height: u32,
    pub layers: Vec<Layer>,
}

pub(super) fn rgbaByteLen(width: u32, height: u32) -> Option<usize> {
    (width as usize)
        .checked_mul(height as usize)?
        .checked_mul(4)
}

/// 绕画布中心反向采样应用翻转、缩放与旋转（最近邻，画布尺寸不变）。
pub fn transformLayerPixels(
    pixels: &[u8],
    width: u32,
    height: u32,
    transform: &LayerTransform,
) -> Vec<u8> {
    let Some(expectedLen) = rgbaByteLen(width, height) else {
        return Vec::new();
    };
    if width == 0 || height == 0 || pixels.len() != expectedLen || transform.isIdentity() {
        return pixels.to_vec();
    }
    let w = width as i32;
    let h = height as i32;
    let mut out = vec![0u8; expectedLen];
    let cx = (width as f32) / 2.0;
    let cy = (height as f32) / 2.0;
    let rad = -transform.rotationDeg.to_radians();
    let cosR = rad.cos();
    let sinR = rad.sin();
    let sx = if transform.scaleX.abs() < 1e-4 {
        1e-4
    } else {
        transform.scaleX
    };
    let sy = if transform.scaleY.abs() < 1e-4 {
        1e-4
    } else {
        transform.scaleY
    };
    for dy in 0..h {
        for dx in 0..w {
            let rx = (dx as f32 + 0.5) - cx;
            let ry = (dy as f32 + 0.5) - cy;
            let urx = rx * cosR + ry * sinR;
            let ury = -rx * sinR + ry * cosR;
            let mut sxf = urx / sx;
            let mut syf = ury / sy;
            if transform.flipX {
                sxf = -sxf;
            }
            if transform.flipY {
                syf = -syf;
            }
            let srcX = (sxf + cx).floor() as i32;
            let srcY = (syf + cy).floor() as i32;
            if srcX < 0 || srcY < 0 || srcX >= w || srcY >= h {
                continue;
            }
            let s = ((srcY * w + srcX) as usize) * 4;
            let d = ((dy * w + dx) as usize) * 4;
            out[d..d + 4].copy_from_slice(&pixels[s..s + 4]);
        }
    }
    out
}

/// 按非预乘（straight-alpha）source-over 顺序合并所有可见图层（含未烘焙实时变换，供画布与合成预览使用）。
pub fn flatten(state: &PartEditState) -> Vec<u8> {
    flattenInternal(state, true)
}

/// 合并所有可见已提交图层像素（忽略未确认烘焙的临时 `LayerTransform`，供落盘保存使用）。
pub fn flattenPersisted(state: &PartEditState) -> Vec<u8> {
    flattenInternal(state, false)
}

fn flattenInternal(state: &PartEditState, includePreviewTransform: bool) -> Vec<u8> {
    let Some(totalBytes) = rgbaByteLen(state.width, state.height) else {
        return Vec::new();
    };
    let pixelCount = totalBytes / 4;
    let mut out = vec![0u8; totalBytes];
    for layer in &state.layers {
        if !layer.visible || layer.opacity == 0 || layer.pixels.len() != out.len() {
            continue;
        }
        let transformed = match &layer.transform {
            Some(tf) if includePreviewTransform && !tf.isIdentity() => Some(transformLayerPixels(
                &layer.pixels,
                state.width,
                state.height,
                tf,
            )),
            _ => None,
        };
        let src = transformed.as_deref().unwrap_or(&layer.pixels);
        for i in 0..pixelCount {
            let base = i * 4;
            let sr = src[base] as u32;
            let sg = src[base + 1] as u32;
            let sb = src[base + 2] as u32;
            let sa = src[base + 3] as u32;
            let saE = (sa * layer.opacity as u32 + 127) / 255;
            if saE == 0 {
                continue;
            }
            let dr = out[base] as u32;
            let dg = out[base + 1] as u32;
            let db = out[base + 2] as u32;
            let da = out[base + 3] as u32;
            let dstFactor = (da * (255 - saE) + 127) / 255;
            let outA = saE + dstFactor;
            if outA == 0 {
                continue;
            }
            let half = outA / 2;
            out[base] = (((sr * saE + dr * dstFactor) + half) / outA).min(255) as u8;
            out[base + 1] = (((sg * saE + dg * dstFactor) + half) / outA).min(255) as u8;
            out[base + 2] = (((sb * saE + db * dstFactor) + half) / outA).min(255) as u8;
            out[base + 3] = outA.min(255) as u8;
        }
    }
    out
}

fn brushRect(width: u32, height: u32, cx: i32, cy: i32, size: u8) -> Option<(u32, u32, u32, u32)> {
    let s = size.clamp(1, 32) as i32;
    let half = s / 2;
    let x0 = cx.saturating_sub(half);
    let y0 = cy.saturating_sub(half);
    let x1 = x0.saturating_add(s);
    let y1 = y0.saturating_add(s);
    let cx0 = x0.max(0).min(width as i32);
    let cy0 = y0.max(0).min(height as i32);
    let cx1 = x1.max(0).min(width as i32);
    let cy1 = y1.max(0).min(height as i32);
    if cx0 >= cx1 || cy0 >= cy1 {
        return None;
    }
    Some((cx0 as u32, cy0 as u32, cx1 as u32, cy1 as u32))
}

fn copyRect(pixels: &[u8], width: u32, x0: u32, y0: u32, x1: u32, y1: u32) -> Vec<u8> {
    let rectW = (x1 - x0) as usize;
    let rectH = (y1 - y0) as usize;
    let mut out = Vec::with_capacity(rectW * rectH * 4);
    for y in y0..y1 {
        let rowStart = ((y as usize) * (width as usize) + (x0 as usize)) * 4;
        let rowEnd = rowStart + rectW * 4;
        out.extend_from_slice(&pixels[rowStart..rowEnd]);
    }
    out
}

fn emptyDiff() -> PixelDiff {
    PixelDiff::new(0, 0, 0, 0, vec![], vec![])
}

pub fn applyBrush(
    pixels: &mut Vec<u8>,
    width: u32,
    height: u32,
    cx: i32,
    cy: i32,
    brushSize: u8,
    color: [u8; 4],
) -> PixelDiff {
    let Some(expected) = rgbaByteLen(width, height) else {
        return emptyDiff();
    };
    if pixels.len() < expected {
        return emptyDiff();
    }
    let Some((x0, y0, x1, y1)) = brushRect(width, height, cx, cy, brushSize) else {
        return emptyDiff();
    };
    let before = copyRect(pixels, width, x0, y0, x1, y1);
    for y in y0..y1 {
        for x in x0..x1 {
            let idx = ((y as usize) * (width as usize) + (x as usize)) * 4;
            pixels[idx..idx + 4].copy_from_slice(&color);
        }
    }
    let after = copyRect(pixels, width, x0, y0, x1, y1);
    PixelDiff::new(x0, y0, x1 - x0, y1 - y0, before, after)
}

pub fn applyEraser(
    pixels: &mut Vec<u8>,
    width: u32,
    height: u32,
    cx: i32,
    cy: i32,
    brushSize: u8,
) -> PixelDiff {
    let Some(expected) = rgbaByteLen(width, height) else {
        return emptyDiff();
    };
    if pixels.len() < expected {
        return emptyDiff();
    }
    let Some((x0, y0, x1, y1)) = brushRect(width, height, cx, cy, brushSize) else {
        return emptyDiff();
    };
    let before = copyRect(pixels, width, x0, y0, x1, y1);
    for y in y0..y1 {
        for x in x0..x1 {
            let idx = ((y as usize) * (width as usize) + (x as usize)) * 4 + 3;
            pixels[idx] = 0;
        }
    }
    let after = copyRect(pixels, width, x0, y0, x1, y1);
    PixelDiff::new(x0, y0, x1 - x0, y1 - y0, before, after)
}

/// 4 连通泛洪填充；完全透明像素（`alpha == 0`）忽略底色 RGB 差异以保证橡皮擦除区与原生透明区连通。
pub fn applyFill(
    pixels: &mut Vec<u8>,
    width: u32,
    height: u32,
    cx: i32,
    cy: i32,
    color: [u8; 4],
    tolerance: u8,
) -> PixelDiff {
    let Some(expected) = rgbaByteLen(width, height) else {
        return emptyDiff();
    };
    if width == 0
        || height == 0
        || pixels.len() < expected
        || cx < 0
        || cy < 0
        || cx >= width as i32
        || cy >= height as i32
    {
        return emptyDiff();
    }
    let w = width as usize;
    let h = height as usize;
    let startPi = (cy as usize) * w + (cx as usize);
    let startOff = startPi * 4;
    let target = [
        pixels[startOff],
        pixels[startOff + 1],
        pixels[startOff + 2],
        pixels[startOff + 3],
    ];
    if target == color || (target[3] == 0 && color[3] == 0) {
        return emptyDiff();
    }
    let tol = tolerance as i32;
    let matches = |off: usize| -> bool {
        if target[3] == 0 && pixels[off + 3] == 0 {
            return true;
        }
        (pixels[off] as i32 - target[0] as i32).abs() <= tol
            && (pixels[off + 1] as i32 - target[1] as i32).abs() <= tol
            && (pixels[off + 2] as i32 - target[2] as i32).abs() <= tol
            && (pixels[off + 3] as i32 - target[3] as i32).abs() <= tol
    };
    let mut visited = vec![false; w * h];
    visited[startPi] = true;
    let mut stack: Vec<(usize, usize)> = vec![(cx as usize, cy as usize)];
    let mut filled: Vec<usize> = Vec::new();
    let (mut minX, mut minY, mut maxX, mut maxY) = (w, h, 0usize, 0usize);
    while let Some((x, y)) = stack.pop() {
        let pi = y * w + x;
        if !matches(pi * 4) {
            continue;
        }
        filled.push(pi);
        if x < minX {
            minX = x;
        }
        if x > maxX {
            maxX = x;
        }
        if y < minY {
            minY = y;
        }
        if y > maxY {
            maxY = y;
        }
        let neighbors = [
            x.checked_sub(1).map(|nx| (nx, y)),
            (x + 1 < w).then_some((x + 1, y)),
            y.checked_sub(1).map(|ny| (x, ny)),
            (y + 1 < h).then_some((x, y + 1)),
        ];
        for nb in neighbors.into_iter().flatten() {
            let ni = nb.1 * w + nb.0;
            if !visited[ni] {
                visited[ni] = true;
                stack.push(nb);
            }
        }
    }
    if filled.is_empty() {
        return emptyDiff();
    }
    let (x0, y0) = (minX as u32, minY as u32);
    let (x1, y1) = (maxX as u32 + 1, maxY as u32 + 1);
    let before = copyRect(pixels, width, x0, y0, x1, y1);
    for pi in filled {
        let off = pi * 4;
        pixels[off..off + 4].copy_from_slice(&color);
    }
    let after = copyRect(pixels, width, x0, y0, x1, y1);
    PixelDiff::new(x0, y0, x1 - x0, y1 - y0, before, after)
}

/// 在单笔 `coverage` 缓冲区（`0..=255`）上取最大值叠加羽化圆，防止同笔内反复扫过变深。
pub fn stampSoftCoverage(
    coverage: &mut [u8],
    width: u32,
    height: u32,
    cx: i32,
    cy: i32,
    brushSize: u8,
    hardness: u8,
) -> Option<(u32, u32, u32, u32)> {
    let total = (width as usize).checked_mul(height as usize)?;
    if width == 0 || height == 0 || coverage.len() < total {
        return None;
    }
    let radius = (brushSize.clamp(1, 32) as f32) / 2.0;
    if radius <= 0.0 {
        return None;
    }
    let inner = (radius * (hardness as f32 / 255.0))
        .min(radius - 0.5)
        .max(0.0);
    let feather = (radius - inner).max(0.5);
    let x0 = ((cx as f32 - radius).floor() as i32).max(0);
    let y0 = ((cy as f32 - radius).floor() as i32).max(0);
    let x1 = ((cx as f32 + radius).ceil() as i32).min(width as i32 - 1);
    let y1 = ((cy as f32 + radius).ceil() as i32).min(height as i32 - 1);
    if x1 < x0 || y1 < y0 {
        return None;
    }
    let cxf = cx as f32 + 0.5;
    let cyf = cy as f32 + 0.5;
    let (mut bx0, mut by0, mut bx1, mut by1) = (width, height, 0u32, 0u32);
    let mut touched = false;
    for y in y0..=y1 {
        for x in x0..=x1 {
            let dx = (x as f32 + 0.5) - cxf;
            let dy = (y as f32 + 0.5) - cyf;
            let dist = (dx * dx + dy * dy).sqrt();
            if dist > radius {
                continue;
            }
            let t = if dist <= inner {
                1.0
            } else {
                1.0 - (dist - inner) / feather
            };
            let cov = (t.clamp(0.0, 1.0) * 255.0).round() as u8;
            if cov == 0 {
                continue;
            }
            let idx = (y as usize) * (width as usize) + (x as usize);
            if cov > coverage[idx] {
                coverage[idx] = cov;
                touched = true;
                let ux = x as u32;
                let uy = y as u32;
                if ux < bx0 {
                    bx0 = ux;
                }
                if uy < by0 {
                    by0 = uy;
                }
                if ux + 1 > bx1 {
                    bx1 = ux + 1;
                }
                if uy + 1 > by1 {
                    by1 = uy + 1;
                }
            }
        }
    }
    if touched {
        Some((bx0, by0, bx1, by1))
    } else {
        None
    }
}

/// 将单笔 `coverage` 按 straight-alpha source-over 合成到 `baseline` 指定矩形区域。
pub fn compositeSoftStroke(
    out: &mut [u8],
    baseline: &[u8],
    coverage: &[u8],
    width: u32,
    rect: (u32, u32, u32, u32),
    color: [u8; 4],
) {
    let (x0, y0, x1, y1) = rect;
    if x0 >= x1 || y0 >= y1 || x1 > width {
        return;
    }
    for y in y0..y1 {
        for x in x0..x1 {
            let pi = (y as usize) * (width as usize) + (x as usize);
            let base = pi * 4;
            if pi >= coverage.len() || base + 4 > out.len() || base + 4 > baseline.len() {
                return;
            }
            let cov = coverage[pi] as u32;
            if cov == 0 {
                out[base..base + 4].copy_from_slice(&baseline[base..base + 4]);
                continue;
            }
            let srcA = (color[3] as u32 * cov + 127) / 255;
            if srcA == 0 {
                out[base..base + 4].copy_from_slice(&baseline[base..base + 4]);
                continue;
            }
            let dr = baseline[base] as u32;
            let dg = baseline[base + 1] as u32;
            let db = baseline[base + 2] as u32;
            let da = baseline[base + 3] as u32;
            let dstFactor = (da * (255 - srcA) + 127) / 255;
            let outA = srcA + dstFactor;
            if outA == 0 {
                out[base..base + 4].fill(0);
                continue;
            }
            let half = outA / 2;
            out[base] = (((color[0] as u32 * srcA + dr * dstFactor) + half) / outA).min(255) as u8;
            out[base + 1] =
                (((color[1] as u32 * srcA + dg * dstFactor) + half) / outA).min(255) as u8;
            out[base + 2] =
                (((color[2] as u32 * srcA + db * dstFactor) + half) / outA).min(255) as u8;
            out[base + 3] = outA.min(255) as u8;
        }
    }
}

/// 沿 `(x0, y0) -> (x1, y1)` 绘制当前色到透明的线性渐变并按 straight-alpha source-over 混合。
pub fn applyGradient(
    pixels: &mut Vec<u8>,
    width: u32,
    height: u32,
    x0: i32,
    y0: i32,
    x1: i32,
    y1: i32,
    color: [u8; 4],
) -> PixelDiff {
    let Some(expected) = rgbaByteLen(width, height) else {
        return emptyDiff();
    };
    if width == 0 || height == 0 || pixels.len() < expected {
        return emptyDiff();
    }
    let dx = (x1 - x0) as f32;
    let dy = (y1 - y0) as f32;
    let lenSq = dx * dx + dy * dy;
    let useFallback = lenSq < 1e-3;
    let before = copyRect(pixels, width, 0, 0, width, height);
    let baseAlpha = color[3] as f32;
    for y in 0..height {
        for x in 0..width {
            let t = if useFallback {
                0.0
            } else {
                let px = (x as f32) - (x0 as f32);
                let py = (y as f32) - (y0 as f32);
                ((px * dx + py * dy) / lenSq).clamp(0.0, 1.0)
            };
            let srcA = (baseAlpha * (1.0 - t)).round().clamp(0.0, 255.0) as u32;
            if srcA == 0 {
                continue;
            }
            let base = ((y as usize) * (width as usize) + (x as usize)) * 4;
            let dr = pixels[base] as u32;
            let dg = pixels[base + 1] as u32;
            let db = pixels[base + 2] as u32;
            let da = pixels[base + 3] as u32;
            let sr = color[0] as u32;
            let sg = color[1] as u32;
            let sb = color[2] as u32;
            let dstFactor = (da * (255 - srcA) + 127) / 255;
            let outA = srcA + dstFactor;
            if outA == 0 {
                continue;
            }
            let half = outA / 2;
            pixels[base] = (((sr * srcA + dr * dstFactor) + half) / outA).min(255) as u8;
            pixels[base + 1] = (((sg * srcA + dg * dstFactor) + half) / outA).min(255) as u8;
            pixels[base + 2] = (((sb * srcA + db * dstFactor) + half) / outA).min(255) as u8;
            pixels[base + 3] = outA.min(255) as u8;
        }
    }
    let after = copyRect(pixels, width, 0, 0, width, height);
    PixelDiff::new(0, 0, width, height, before, after)
}
