// 图层合并、画笔/橡皮/渐变操作、PNG 编解码。
#![allow(non_snake_case)]

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::apiLayer::ApiError;
use crate::historyManager::PixelDiff;

/// 单个图层，pixels 为 RGBA 扁平 buffer。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Layer {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub opacity: u8,
    pub pixels: Vec<u8>,
    /// 未落地的预览变换；仅运行时态，不写入 sidecar。
    #[serde(skip)]
    pub transform: Option<LayerTransform>,
}

/// 图层预览变换：绕画布中心的翻转 / 缩放 / 旋转。
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
        !self.flipX && !self.flipY
            && (self.scaleX - 1.0).abs() < 1e-4
            && (self.scaleY - 1.0).abs() < 1e-4
            && self.rotationDeg.abs() < 1e-4
    }
}

/// 单个部件的可编辑状态（多图层）。
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PartEditState {
    pub partName: String,
    pub width: u32,
    pub height: u32,
    pub layers: Vec<Layer>,
}

/// 对图层像素做绕画布中心的 flip/scale/rotate（反向采样，最近邻，画布尺寸不变）。
/// transform 为 None 或 identity 时原样返回，避免无谓拷贝采样误差。
pub fn transformLayerPixels(pixels: &[u8], width: u32, height: u32, transform: &LayerTransform) -> Vec<u8> {
    if transform.isIdentity() {
        return pixels.to_vec();
    }
    let w = width as i32;
    let h = height as i32;
    let mut out = vec![0u8; pixels.len()];
    let cx = (width as f32) / 2.0;
    let cy = (height as f32) / 2.0;
    let rad = -transform.rotationDeg.to_radians();
    let cosR = rad.cos();
    let sinR = rad.sin();
    let sx = if transform.scaleX.abs() < 1e-4 { 1e-4 } else { transform.scaleX };
    let sy = if transform.scaleY.abs() < 1e-4 { 1e-4 } else { transform.scaleY };
    for dy in 0..h {
        for dx in 0..w {
            let rx = (dx as f32 + 0.5) - cx;
            let ry = (dy as f32 + 0.5) - cy;
            // 反向旋转
            let urx = rx * cosR + ry * sinR;
            let ury = -rx * sinR + ry * cosR;
            // 反向缩放
            let mut sxf = urx / sx;
            let mut syf = ury / sy;
            // 反向翻转
            if transform.flipX { sxf = -sxf; }
            if transform.flipY { syf = -syf; }
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

/// `visible == false` 或 `opacity == 0` 的图层跳过。
/// 混合公式为非预乘 source-over：outA = saE + da*(1-saE)，outRGB 按 outA 加权。
pub fn flatten(state: &PartEditState) -> Vec<u8> {
    let pixelCount = (state.width as usize) * (state.height as usize);
    let mut out = vec![0u8; pixelCount * 4];
    for layer in &state.layers {
        if !layer.visible || layer.opacity == 0 {
            continue;
        }
        if layer.pixels.len() != out.len() {
            continue;
        }
        let transformed = match &layer.transform {
            Some(tf) if !tf.isIdentity() => Some(transformLayerPixels(&layer.pixels, state.width, state.height, tf)),
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


/// 计算笔刷落点的有效裁剪矩形 (x0, y0, x1, y1) 半开区间，完全越界返回 None。
fn brushRect(width: u32, height: u32, cx: i32, cy: i32, size: u8) -> Option<(u32, u32, u32, u32)> {
    let s = size.clamp(1, 32) as i32;
    let half = s / 2;
    let x0 = cx - half;
    let y0 = cy - half;
    let x1 = x0 + s;
    let y1 = y0 + s;
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
        let rowStart = ((y * width) + x0) as usize * 4;
        let rowEnd = rowStart + rectW * 4;
        out.extend_from_slice(&pixels[rowStart..rowEnd]);
    }
    out
}

fn emptyDiff() -> PixelDiff {
    PixelDiff { x: 0, y: 0, width: 0, height: 0, before: vec![], after: vec![] }
}

/// 在 RGBA buffer 上画一个方形笔刷，brushSize 自动夹到 1~32，越界裁剪。
/// 返回受影响最小矩形的 PixelDiff。
pub fn applyBrush(
    pixels: &mut Vec<u8>,
    width: u32,
    height: u32,
    cx: i32,
    cy: i32,
    brushSize: u8,
    color: [u8; 4],
) -> PixelDiff {
    let rect = match brushRect(width, height, cx, cy, brushSize) {
        Some(r) => r,
        None => return emptyDiff(),
    };
    let (x0, y0, x1, y1) = rect;
    let before = copyRect(pixels, width, x0, y0, x1, y1);
    for y in y0..y1 {
        for x in x0..x1 {
            let idx = ((y * width + x) as usize) * 4;
            pixels[idx] = color[0];
            pixels[idx + 1] = color[1];
            pixels[idx + 2] = color[2];
            pixels[idx + 3] = color[3];
        }
    }
    let after = copyRect(pixels, width, x0, y0, x1, y1);
    PixelDiff { x: x0, y: y0, width: x1 - x0, height: y1 - y0, before, after }
}

/// 把命中像素的 alpha 置 0，RGB 不变。
pub fn applyEraser(
    pixels: &mut Vec<u8>,
    width: u32,
    height: u32,
    cx: i32,
    cy: i32,
    brushSize: u8,
) -> PixelDiff {
    let rect = match brushRect(width, height, cx, cy, brushSize) {
        Some(r) => r,
        None => return emptyDiff(),
    };
    let (x0, y0, x1, y1) = rect;
    let before = copyRect(pixels, width, x0, y0, x1, y1);
    for y in y0..y1 {
        for x in x0..x1 {
            let idx = ((y * width + x) as usize) * 4 + 3;
            pixels[idx] = 0;
        }
    }
    let after = copyRect(pixels, width, x0, y0, x1, y1);
    PixelDiff { x: x0, y: y0, width: x1 - x0, height: y1 - y0, before, after }
}


/// 从 (cx,cy) 起对颜色与起点在容差内相近的 4 连通区域覆盖为 color。
/// tolerance 为各通道（含 alpha）最大允许差；起点已是 color 时无操作。
/// 返回受影响像素包围盒的 PixelDiff。
pub fn applyFill(
    pixels: &mut Vec<u8>,
    width: u32,
    height: u32,
    cx: i32,
    cy: i32,
    color: [u8; 4],
    tolerance: u8,
) -> PixelDiff {
    if width == 0 || height == 0 || cx < 0 || cy < 0 || cx >= width as i32 || cy >= height as i32 {
        return emptyDiff();
    }
    let w = width as usize;
    let h = height as usize;
    let startOff = (cy as usize * w + cx as usize) * 4;
    let target = [
        pixels[startOff],
        pixels[startOff + 1],
        pixels[startOff + 2],
        pixels[startOff + 3],
    ];
    if target == color {
        return emptyDiff();
    }
    let tol = tolerance as i32;
    let matches = |off: usize| -> bool {
        (pixels[off] as i32 - target[0] as i32).abs() <= tol
            && (pixels[off + 1] as i32 - target[1] as i32).abs() <= tol
            && (pixels[off + 2] as i32 - target[2] as i32).abs() <= tol
            && (pixels[off + 3] as i32 - target[3] as i32).abs() <= tol
    };
    let mut visited = vec![false; w * h];
    let mut stack: Vec<(usize, usize)> = vec![(cx as usize, cy as usize)];
    let mut filled: Vec<usize> = Vec::new();
    let (mut minX, mut minY, mut maxX, mut maxY) = (w, h, 0usize, 0usize);
    while let Some((x, y)) = stack.pop() {
        let pi = y * w + x;
        if visited[pi] {
            continue;
        }
        visited[pi] = true;
        if !matches(pi * 4) {
            continue;
        }
        filled.push(pi);
        if x < minX { minX = x; }
        if x > maxX { maxX = x; }
        if y < minY { minY = y; }
        if y > maxY { maxY = y; }
        if x > 0 { stack.push((x - 1, y)); }
        if x + 1 < w { stack.push((x + 1, y)); }
        if y > 0 { stack.push((x, y - 1)); }
        if y + 1 < h { stack.push((x, y + 1)); }
    }
    if filled.is_empty() {
        return emptyDiff();
    }
    let (x0, y0) = (minX as u32, minY as u32);
    let (x1, y1) = (maxX as u32 + 1, maxY as u32 + 1);
    let before = copyRect(pixels, width, x0, y0, x1, y1);
    for pi in filled {
        let off = pi * 4;
        pixels[off] = color[0];
        pixels[off + 1] = color[1];
        pixels[off + 2] = color[2];
        pixels[off + 3] = color[3];
    }
    let after = copyRect(pixels, width, x0, y0, x1, y1);
    PixelDiff { x: x0, y: y0, width: x1 - x0, height: y1 - y0, before, after }
}


/// 在 coverage（整图，0~255 表示笔画在该像素的最大覆盖率）上叠加一个羽化圆，
/// 半径 = brushSize/2，边缘 1px 线性羽化；逐像素取 max。返回受影响像素的包围盒 rect。
/// hardness 0~255：硬度越高羽化带越窄。越界裁剪，无更新返回 None。
pub fn stampSoftCoverage(
    coverage: &mut [u8],
    width: u32,
    height: u32,
    cx: i32,
    cy: i32,
    brushSize: u8,
    hardness: u8,
) -> Option<(u32, u32, u32, u32)> {
    if width == 0 || height == 0 {
        return None;
    }
    let radius = (brushSize.clamp(1, 32) as f32) / 2.0;
    if radius <= 0.0 {
        return None;
    }
    // 硬核半径：hardness 越大越接近实心圆；至少留 0.5px 羽化带。
    let inner = (radius * (hardness as f32 / 255.0)).min(radius - 0.5).max(0.0);
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
            let t = if dist <= inner { 1.0 } else { 1.0 - (dist - inner) / feather };
            let cov = (t.clamp(0.0, 1.0) * 255.0).round() as u8;
            if cov == 0 {
                continue;
            }
            let idx = (y as u32 * width + x as u32) as usize;
            if cov > coverage[idx] {
                coverage[idx] = cov;
                touched = true;
                let ux = x as u32;
                let uy = y as u32;
                if ux < bx0 { bx0 = ux; }
                if uy < by0 { by0 = uy; }
                if ux + 1 > bx1 { bx1 = ux + 1; }
                if uy + 1 > by1 { by1 = uy + 1; }
            }
        }
    }
    if touched { Some((bx0, by0, bx1, by1)) } else { None }
}

/// 按 coverage 把 color 以非预乘 source-over 合成到 baseline 上，写入 out（与 baseline 同尺寸）。
/// 仅处理 rect 内像素；coverage 作为 color 的 alpha 系数（与 color.a 相乘）。
pub fn compositeSoftStroke(
    out: &mut [u8],
    baseline: &[u8],
    coverage: &[u8],
    width: u32,
    rect: (u32, u32, u32, u32),
    color: [u8; 4],
) {
    let (x0, y0, x1, y1) = rect;
    for y in y0..y1 {
        for x in x0..x1 {
            let pi = (y * width + x) as usize;
            let cov = coverage[pi] as u32;
            let base = pi * 4;
            if cov == 0 {
                out[base..base + 4].copy_from_slice(&baseline[base..base + 4]);
                continue;
            }
            let srcA = (color[3] as u32 * cov + 127) / 255;
            let dr = baseline[base] as u32;
            let dg = baseline[base + 1] as u32;
            let db = baseline[base + 2] as u32;
            let da = baseline[base + 3] as u32;
            if srcA == 0 {
                out[base..base + 4].copy_from_slice(&baseline[base..base + 4]);
                continue;
            }
            let dstFactor = (da * (255 - srcA) + 127) / 255;
            let outA = srcA + dstFactor;
            if outA == 0 {
                out[base] = 0;
                out[base + 1] = 0;
                out[base + 2] = 0;
                out[base + 3] = 0;
                continue;
            }
            let half = outA / 2;
            out[base] = (((color[0] as u32 * srcA + dr * dstFactor) + half) / outA).min(255) as u8;
            out[base + 1] = (((color[1] as u32 * srcA + dg * dstFactor) + half) / outA).min(255) as u8;
            out[base + 2] = (((color[2] as u32 * srcA + db * dstFactor) + half) / outA).min(255) as u8;
            out[base + 3] = outA.min(255) as u8;
        }
    }
}


/// 把 src 以非预乘 source-over 方式贴到 canvas 的 (dstX, dstY)。
/// flipX=true 时水平镜像 src 列。越界像素裁剪不 panic。
pub fn blitWithFlip(
    canvas: &mut [u8],
    canvasW: u32,
    canvasH: u32,
    src: &[u8],
    srcW: u32,
    srcH: u32,
    dstX: i32,
    dstY: i32,
    flipX: bool,
) {
    for sy in 0..srcH {
        for sx in 0..srcW {
            let dx = dstX + if flipX { (srcW - 1 - sx) as i32 } else { sx as i32 };
            let dy = dstY + sy as i32;
            if dx < 0 || dy < 0 || dx >= canvasW as i32 || dy >= canvasH as i32 {
                continue;
            }
            let sBase = ((sy * srcW + sx) as usize) * 4;
            let sa = src[sBase + 3] as u32;
            if sa == 0 {
                continue;
            }
            let sr = src[sBase] as u32;
            let sg = src[sBase + 1] as u32;
            let sb = src[sBase + 2] as u32;
            let dBase = ((dy as u32 * canvasW + dx as u32) as usize) * 4;
            let dr = canvas[dBase] as u32;
            let dg = canvas[dBase + 1] as u32;
            let db = canvas[dBase + 2] as u32;
            let da = canvas[dBase + 3] as u32;
            let dstFactor = (da * (255 - sa) + 127) / 255;
            let outA = sa + dstFactor;
            if outA == 0 {
                continue;
            }
            let half = outA / 2;
            canvas[dBase] = (((sr * sa + dr * dstFactor) + half) / outA).min(255) as u8;
            canvas[dBase + 1] = (((sg * sa + dg * dstFactor) + half) / outA).min(255) as u8;
            canvas[dBase + 2] = (((sb * sa + db * dstFactor) + half) / outA).min(255) as u8;
            canvas[dBase + 3] = outA.min(255) as u8;
        }
    }
}


/// 把 src 绕自身中心旋转 rotationDeg（度，逆时针为正，与 Unity transform.localEulerAngles.z 一致），
/// 再以非预乘 source-over 贴到 canvas，使 src 旋转后中心对齐到 (centerX, centerY)。
/// flipX=true 时先水平镜像（在旋转之前对源采样列翻转）。最近邻采样保留像素风。
/// 越界像素裁剪不 panic；rotationDeg=0 且 flipX=false 时性能与 blitWithFlip 相当。
pub fn blitWithRotation(
    canvas: &mut [u8],
    canvasW: u32,
    canvasH: u32,
    src: &[u8],
    srcW: u32,
    srcH: u32,
    centerX: i32,
    centerY: i32,
    rotationDeg: f32,
    flipX: bool,
) {
    if srcW == 0 || srcH == 0 {
        return;
    }
    // Unity rotZ：屏幕坐标系下绕 +Z（指向观察者）逆时针为正。
    // 我们的画布 Y 向下，所以等价的 2D 旋转矩阵需要取 sin 取负。
    let rad = -(rotationDeg.to_radians());
    let cosR = rad.cos();
    let sinR = rad.sin();
    let halfSrcW = srcW as f32 / 2.0;
    let halfSrcH = srcH as f32 / 2.0;
    // 计算旋转后 bbox，圈定要扫描的目标区域。
    let corners = [
        (-halfSrcW, -halfSrcH),
        ( halfSrcW, -halfSrcH),
        (-halfSrcW,  halfSrcH),
        ( halfSrcW,  halfSrcH),
    ];
    let mut minDx = f32::INFINITY;
    let mut maxDx = f32::NEG_INFINITY;
    let mut minDy = f32::INFINITY;
    let mut maxDy = f32::NEG_INFINITY;
    for (cx, cy) in corners {
        let dx = cx * cosR - cy * sinR;
        let dy = cx * sinR + cy * cosR;
        if dx < minDx { minDx = dx; }
        if dx > maxDx { maxDx = dx; }
        if dy < minDy { minDy = dy; }
        if dy > maxDy { maxDy = dy; }
    }
    let dxStart = (centerX as f32 + minDx).floor() as i32;
    let dyStart = (centerY as f32 + minDy).floor() as i32;
    let dxEnd = (centerX as f32 + maxDx).ceil() as i32;
    let dyEnd = (centerY as f32 + maxDy).ceil() as i32;
    // 反向旋转矩阵（采样源像素时用）。
    let invCos = cosR;
    let invSin = -sinR;
    for dy in dyStart..=dyEnd {
        if dy < 0 || dy >= canvasH as i32 { continue; }
        let ry = (dy - centerY) as f32;
        for dx in dxStart..=dxEnd {
            if dx < 0 || dx >= canvasW as i32 { continue; }
            let rx = (dx - centerX) as f32;
            // (rx, ry) → src 空间（原点为 src 中心）
            let srcXF = rx * invCos - ry * invSin + halfSrcW;
            let srcYF = rx * invSin + ry * invCos + halfSrcH;
            // 最近邻
            let mut sx = srcXF.floor() as i32;
            let sy = srcYF.floor() as i32;
            if sx < 0 || sy < 0 || sx >= srcW as i32 || sy >= srcH as i32 { continue; }
            if flipX { sx = (srcW as i32) - 1 - sx; }
            let sBase = ((sy as u32 * srcW + sx as u32) as usize) * 4;
            let sa = src[sBase + 3] as u32;
            if sa == 0 { continue; }
            let sr = src[sBase] as u32;
            let sg = src[sBase + 1] as u32;
            let sb = src[sBase + 2] as u32;
            let dBase = ((dy as u32 * canvasW + dx as u32) as usize) * 4;
            let dr = canvas[dBase] as u32;
            let dg = canvas[dBase + 1] as u32;
            let db = canvas[dBase + 2] as u32;
            let da = canvas[dBase + 3] as u32;
            let dstFactor = (da * (255 - sa) + 127) / 255;
            let outA = sa + dstFactor;
            if outA == 0 { continue; }
            let half = outA / 2;
            canvas[dBase] = (((sr * sa + dr * dstFactor) + half) / outA).min(255) as u8;
            canvas[dBase + 1] = (((sg * sa + dg * dstFactor) + half) / outA).min(255) as u8;
            canvas[dBase + 2] = (((sb * sa + db * dstFactor) + half) / outA).min(255) as u8;
            canvas[dBase + 3] = outA.min(255) as u8;
        }
    }
}


/// 等比/任意比例缩放 RGBA buffer（最近邻插值）。
/// 用于"修改分辨率"按倍数放大：原图整张内容跟随像素块按 newW/oldW 与 newH/oldH 拉伸，
/// 不引入透明边、不做平滑，保留像素风边缘。
pub fn scaleNearest(pixels: &[u8], oldW: u32, oldH: u32, newW: u32, newH: u32) -> Vec<u8> {
    let mut out = vec![0u8; (newW as usize) * (newH as usize) * 4];
    if oldW == 0 || oldH == 0 || newW == 0 || newH == 0 {
        return out;
    }
    if pixels.len() != (oldW as usize) * (oldH as usize) * 4 {
        return out;
    }
    for ny in 0..newH {
        // 用整数等价表达 (ny * oldH) / newH，避免浮点积累误差。
        let sy = ((ny as u64) * (oldH as u64) / (newH as u64)) as u32;
        for nx in 0..newW {
            let sx = ((nx as u64) * (oldW as u64) / (newW as u64)) as u32;
            let srcOff = ((sy * oldW + sx) as usize) * 4;
            let dstOff = ((ny * newW + nx) as usize) * 4;
            out[dstOff..dstOff + 4].copy_from_slice(&pixels[srcOff..srcOff + 4]);
        }
    }
    out
}

/// 解码 PNG 为 RGBA 扁平 buffer。
pub fn loadPng(path: &Path) -> Result<(u32, u32, Vec<u8>), ApiError> {
    let reader = image::ImageReader::open(path).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("open {} failed: {}", path.display(), e),
    })?;
    let img = reader.decode().map_err(|e| ApiError {
        code: "decode_failed".into(),
        message: format!("decode {} failed: {}", path.display(), e),
    })?;
    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    Ok((w, h, rgba.into_raw()))
}

/// 把 RGBA buffer 写为 PNG，严格沿用入参 path 文件名，不追加后缀。
pub fn savePng(path: &Path, width: u32, height: u32, pixels: &[u8]) -> Result<(), ApiError> {
    let buf = image::RgbaImage::from_raw(width, height, pixels.to_vec()).ok_or_else(|| ApiError {
        code: "encode_failed".into(),
        message: format!("buffer length {} mismatches {}x{}", pixels.len(), width, height),
    })?;
    buf.save_with_format(path, image::ImageFormat::Png).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("write {} failed: {}", path.display(), e),
    })
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

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
                .join(format!("spe_imageOps_{}_{}_{}", std::process::id(), nanos, seq));
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

    fn mkLayer(id: &str, visible: bool, opacity: u8, pixels: Vec<u8>) -> Layer {
        Layer { id: id.into(), name: id.into(), visible, opacity, pixels, transform: None }
    }

    #[test]
    fn flattenEmptyLayersIsTransparent() {
        let state = PartEditState {
            partName: "p".into(),
            width: 2,
            height: 2,
            layers: vec![],
        };
        let out = flatten(&state);
        assert_eq!(out, vec![0u8; 16]);
    }

    #[test]
    fn flattenSkipsInvisibleLayer() {
        let bottom = mkLayer("b", false, 255, vec![255, 0, 0, 255]);
        let top = mkLayer("t", true, 255, vec![0, 255, 0, 255]);
        let state = PartEditState {
            partName: "p".into(),
            width: 1,
            height: 1,
            layers: vec![bottom, top],
        };
        let out = flatten(&state);
        assert_eq!(out, vec![0, 255, 0, 255]);
    }

    #[test]
    fn flattenAlphaCompositionMatches() {
        // 底层不透明红色，顶层 50% alpha 蓝色：outA≈255，outR≈127，outB≈128。
        let bottom = mkLayer("b", true, 255, vec![255, 0, 0, 255]);
        let top = mkLayer("t", true, 255, vec![0, 0, 255, 128]);
        let state = PartEditState {
            partName: "p".into(),
            width: 1,
            height: 1,
            layers: vec![bottom, top],
        };
        let out = flatten(&state);
        assert_eq!(out[3], 255);
        assert!((out[0] as i32 - 127).abs() <= 2, "R={}", out[0]);
        assert_eq!(out[1], 0);
        assert!((out[2] as i32 - 128).abs() <= 2, "B={}", out[2]);
    }

    #[test]
    fn flattenIdempotent() {
        // flatten 结果当作单一不透明图层再 flatten，应等于自身。
        let l1 = mkLayer("a", true, 200, vec![10, 20, 30, 200, 40, 50, 60, 100]);
        let l2 = mkLayer("b", true, 255, vec![70, 80, 90, 128, 100, 110, 120, 255]);
        let state = PartEditState {
            partName: "p".into(),
            width: 2,
            height: 1,
            layers: vec![l1, l2],
        };
        let first = flatten(&state);
        let single = PartEditState {
            partName: "p".into(),
            width: 2,
            height: 1,
            layers: vec![mkLayer("flat", true, 255, first.clone())],
        };
        let second = flatten(&single);
        assert_eq!(first, second);
    }

    #[test]
    fn applyBrushClampsBrushSize() {
        let mut pixels = vec![0u8; 4 * 4 * 4];
        let diff0 = applyBrush(&mut pixels, 4, 4, 2, 2, 0, [255, 0, 0, 255]);
        assert_eq!(diff0.width, 1);
        assert_eq!(diff0.height, 1);

        let mut pixels2 = vec![0u8; 64 * 64 * 4];
        let diff = applyBrush(&mut pixels2, 64, 64, 32, 32, 255, [0, 0, 0, 255]);
        assert_eq!(diff.width, 32);
        assert_eq!(diff.height, 32);
    }

    #[test]
    fn applyBrushReturnsTightDiff() {
        let mut pixels = vec![0u8; 4 * 4 * 4];
        let diff = applyBrush(&mut pixels, 4, 4, 1, 1, 1, [10, 20, 30, 255]);
        assert_eq!((diff.x, diff.y, diff.width, diff.height), (1, 1, 1, 1));
        assert_eq!(diff.before, vec![0, 0, 0, 0]);
        assert_eq!(diff.after, vec![10, 20, 30, 255]);
    }

    #[test]
    fn applyEraserSetsAlphaZero() {
        let mut pixels = vec![100, 150, 200, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        let diff = applyEraser(&mut pixels, 2, 2, 0, 0, 1);
        assert_eq!((diff.x, diff.y, diff.width, diff.height), (0, 0, 1, 1));
        assert_eq!(&pixels[0..4], &[100, 150, 200, 0]);
    }

    #[test]
    fn savePngPreservesFilename() {
        let tmp = TempDir::new();
        let target = tmp.path().join("eyeFront0.png");
        let pixels = vec![10, 20, 30, 255];
        savePng(&target, 1, 1, &pixels).expect("save");
        assert!(target.exists());
        assert_eq!(target.file_name().unwrap().to_string_lossy(), "eyeFront0.png");
        let entries: Vec<_> = fs::read_dir(tmp.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert_eq!(entries, vec!["eyeFront0.png".to_string()]);
    }

    #[test]
    fn scaleNearestDoublesByPixelBlock() {
        // 2×2 → 4×4，每个原像素映射到 2×2 块。
        let pixels: Vec<u8> = vec![
            255, 0, 0, 255,   0, 255, 0, 255,
            0, 0, 255, 255,   200, 200, 200, 255,
        ];
        let out = scaleNearest(&pixels, 2, 2, 4, 4);
        assert_eq!(out.len(), 4 * 4 * 4);
        // (0,0) 与 (1,0) 都映射到 src(0,0) 红
        assert_eq!(&out[0..4], &[255, 0, 0, 255]);
        assert_eq!(&out[4..8], &[255, 0, 0, 255]);
        // (2,0) 与 (3,0) 都映射到 src(1,0) 绿
        assert_eq!(&out[8..12], &[0, 255, 0, 255]);
        assert_eq!(&out[12..16], &[0, 255, 0, 255]);
        // (0,2) 蓝、(2,2) 灰
        let off02 = (2 * 4 + 0) * 4;
        assert_eq!(&out[off02..off02 + 4], &[0, 0, 255, 255]);
        let off22 = (2 * 4 + 2) * 4;
        assert_eq!(&out[off22..off22 + 4], &[200, 200, 200, 255]);
    }

    #[test]
    fn scaleNearestShrinksByDownsample() {
        // 4×4 → 2×2 应得 src(0,0) src(2,0) src(0,2) src(2,2)
        let mut pixels = vec![0u8; 4 * 4 * 4];
        for &(x, y, c) in &[(0u32, 0u32, 11u8), (2, 0, 22), (0, 2, 33), (2, 2, 44)] {
            let off = ((y * 4 + x) as usize) * 4;
            pixels[off] = c;
            pixels[off + 1] = c;
            pixels[off + 2] = c;
            pixels[off + 3] = 255;
        }
        let out = scaleNearest(&pixels, 4, 4, 2, 2);
        assert_eq!(&out[0..4], &[11, 11, 11, 255]);
        assert_eq!(&out[4..8], &[22, 22, 22, 255]);
        assert_eq!(&out[8..12], &[33, 33, 33, 255]);
        assert_eq!(&out[12..16], &[44, 44, 44, 255]);
    }

    #[test]
    fn loadPngRoundTrip() {
        let tmp = TempDir::new();
        let target = tmp.path().join("rt.png");
        let pixels: Vec<u8> = vec![
            255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 64, 200, 200, 200, 0,
        ];
        savePng(&target, 2, 2, &pixels).expect("save");
        let (w, h, back) = loadPng(&target).expect("load");
        assert_eq!((w, h), (2, 2));
        assert_eq!(back, pixels);
    }

    #[test]
    fn blitWithFlipFullyInsideCanvas() {
        let mut canvas = vec![0u8; 4 * 4 * 4];
        let src: Vec<u8> = vec![
            10, 20, 30, 255, 40, 50, 60, 255,
            70, 80, 90, 255, 100, 110, 120, 255,
        ];
        blitWithFlip(&mut canvas, 4, 4, &src, 2, 2, 1, 1, false);
        let at = |x: u32, y: u32| {
            let i = ((y * 4 + x) as usize) * 4;
            [canvas[i], canvas[i + 1], canvas[i + 2], canvas[i + 3]]
        };
        assert_eq!(at(1, 1), [10, 20, 30, 255]);
        assert_eq!(at(2, 1), [40, 50, 60, 255]);
        assert_eq!(at(1, 2), [70, 80, 90, 255]);
        assert_eq!(at(2, 2), [100, 110, 120, 255]);
        assert_eq!(at(0, 0), [0, 0, 0, 0]);
        assert_eq!(at(3, 3), [0, 0, 0, 0]);
    }

    #[test]
    fn blitWithFlipMirrorsHorizontally() {
        let mut canvas = vec![0u8; 5 * 1 * 4];
        let src: Vec<u8> = vec![
            255, 0, 0, 255,
            0, 255, 0, 255,
            0, 0, 255, 255,
        ];
        blitWithFlip(&mut canvas, 5, 1, &src, 3, 1, 1, 0, true);
        let at = |x: u32| {
            let i = (x as usize) * 4;
            [canvas[i], canvas[i + 1], canvas[i + 2], canvas[i + 3]]
        };
        assert_eq!(at(0), [0, 0, 0, 0]);
        assert_eq!(at(1), [0, 0, 255, 255]);
        assert_eq!(at(2), [0, 255, 0, 255]);
        assert_eq!(at(3), [255, 0, 0, 255]);
        assert_eq!(at(4), [0, 0, 0, 0]);
    }

    #[test]
    fn blitWithFlipClipsAtCanvasEdge() {
        let mut canvas = vec![0u8; 4 * 4 * 4];
        let src: Vec<u8> = vec![
            1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255,
            4, 0, 0, 255, 5, 0, 0, 255, 6, 0, 0, 255,
            7, 0, 0, 255, 8, 0, 0, 255, 9, 0, 0, 255,
        ];
        blitWithFlip(&mut canvas, 4, 4, &src, 3, 3, -1, -1, false);
        let at = |x: u32, y: u32| {
            let i = ((y * 4 + x) as usize) * 4;
            [canvas[i], canvas[i + 1], canvas[i + 2], canvas[i + 3]]
        };
        assert_eq!(at(0, 0), [5, 0, 0, 255]);
        assert_eq!(at(1, 0), [6, 0, 0, 255]);
        assert_eq!(at(0, 1), [8, 0, 0, 255]);
        assert_eq!(at(1, 1), [9, 0, 0, 255]);
        assert_eq!(at(2, 0), [0, 0, 0, 0]);
        assert_eq!(at(0, 2), [0, 0, 0, 0]);
        assert_eq!(at(3, 3), [0, 0, 0, 0]);
    }

    #[test]
    fn blitWithFlipAlphaBlends() {
        let mut canvas: Vec<u8> = vec![255, 0, 0, 255];
        let src: Vec<u8> = vec![0, 0, 255, 128];
        blitWithFlip(&mut canvas, 1, 1, &src, 1, 1, 0, 0, false);
        assert_eq!(canvas[3], 255);
        assert!((canvas[0] as i32 - 127).abs() <= 2, "R={}", canvas[0]);
        assert_eq!(canvas[1], 0);
        assert!((canvas[2] as i32 - 128).abs() <= 2, "B={}", canvas[2]);
    }
}


/// 沿向量 (x0,y0)→(x1,y1) 画线性渐变（主色 → 透明），与现有像素 source-over 合成。
/// 投影 t∈[0,1]，区间外饱和；起止点重合时退化为纯色覆盖。
/// 返回的 PixelDiff 区域固定为整张图，简化 undo 语义。
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
    if width == 0 || height == 0 {
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
            let base = ((y * width + x) as usize) * 4;
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
    PixelDiff { x: 0, y: 0, width, height, before, after }
}

#[cfg(test)]
mod gradientTests {
    use super::*;

    #[test]
    fn appliesFullGradientHorizontally() {
        let mut px = vec![0u8; 16];
        let diff = applyGradient(&mut px, 4, 1, 0, 0, 3, 0, [255, 0, 0, 255]);
        assert_eq!(px[3], 255);
        assert_eq!(px[0], 255);
        assert_eq!(px[15], 0);
        assert_eq!(diff.width, 4);
        assert_eq!(diff.height, 1);
    }

    #[test]
    fn samePointFallsBackToSolidFill() {
        let mut px = vec![0u8; 16];
        applyGradient(&mut px, 4, 1, 1, 0, 1, 0, [10, 20, 30, 200]);
        for x in 0..4u32 {
            let i = (x as usize) * 4;
            assert_eq!(px[i + 3], 200);
            assert_eq!(px[i], 10);
        }
    }
}

#[cfg(test)]
mod fillTests {
    use super::*;

    #[test]
    fn fillsConnectedRegionOnly() {
        // 2×2：左列与右列不同色，从 (0,0) 填只覆盖左列连通块。
        let mut px = vec![
            0, 0, 0, 255,   255, 255, 255, 255,
            0, 0, 0, 255,   255, 255, 255, 255,
        ];
        let diff = applyFill(&mut px, 2, 2, 0, 0, [1, 2, 3, 255], 0);
        assert_eq!((diff.x, diff.y, diff.width, diff.height), (0, 0, 1, 2));
        assert_eq!(&px[0..4], &[1, 2, 3, 255]);
        assert_eq!(&px[8..12], &[1, 2, 3, 255]);
        assert_eq!(&px[4..8], &[255, 255, 255, 255]);
    }

    #[test]
    fn noopWhenStartAlreadyTargetColor() {
        let mut px = vec![1, 2, 3, 255];
        let diff = applyFill(&mut px, 1, 1, 0, 0, [1, 2, 3, 255], 0);
        assert_eq!((diff.width, diff.height), (0, 0));
    }

    #[test]
    fn toleranceExpandsMatch() {
        // 两像素差 5，tolerance=8 时一并填充。
        let mut px = vec![100, 100, 100, 255, 105, 105, 105, 255];
        let diff = applyFill(&mut px, 2, 1, 0, 0, [0, 0, 0, 255], 8);
        assert_eq!((diff.width, diff.height), (2, 1));
        assert_eq!(&px[0..4], &[0, 0, 0, 255]);
        assert_eq!(&px[4..8], &[0, 0, 0, 255]);
    }
}

#[cfg(test)]
mod softBrushTests {
    use super::*;

    #[test]
    fn coverageCenterFullEdgeFades() {
        // 5×5 画布，半径 ~2 的软笔落在中心，中心覆盖 255，最外圈应小于中心。
        let mut cov = vec![0u8; 25];
        let rect = stampSoftCoverage(&mut cov, 5, 5, 2, 2, 5, 0).expect("touched");
        assert_eq!(cov[2 * 5 + 2], 255);
        let (x0, y0, x1, y1) = rect;
        assert!(x0 <= 2 && y0 <= 2 && x1 >= 3 && y1 >= 3);
    }

    #[test]
    fn coverageTakesMaxNotSum() {
        // 同点两次落笔，覆盖率不累加，仍是单次的值。
        let mut cov = vec![0u8; 25];
        stampSoftCoverage(&mut cov, 5, 5, 2, 2, 5, 128);
        let once = cov[2 * 5 + 2];
        stampSoftCoverage(&mut cov, 5, 5, 2, 2, 5, 128);
        assert_eq!(cov[2 * 5 + 2], once);
    }

    #[test]
    fn compositeAppliesCoverageAsAlpha() {
        // baseline 全透明，coverage 满 + 不透明红 → 输出不透明红。
        let baseline = vec![0u8; 4];
        let mut out = vec![0u8; 4];
        let cov = vec![255u8; 1];
        compositeSoftStroke(&mut out, &baseline, &cov, 1, (0, 0, 1, 1), [255, 0, 0, 255]);
        assert_eq!(out, vec![255, 0, 0, 255]);
    }

    #[test]
    fn compositeHalfCoverageHalfAlpha() {
        let baseline = vec![0u8; 4];
        let mut out = vec![0u8; 4];
        let cov = vec![128u8; 1];
        compositeSoftStroke(&mut out, &baseline, &cov, 1, (0, 0, 1, 1), [0, 0, 255, 255]);
        assert!((out[3] as i32 - 128).abs() <= 2, "A={}", out[3]);
    }
}

#[cfg(test)]
mod transformTests {
    use super::*;

    fn tf(flipX: bool, flipY: bool, sx: f32, sy: f32, rot: f32) -> LayerTransform {
        LayerTransform { flipX, flipY, scaleX: sx, scaleY: sy, rotationDeg: rot }
    }

    #[test]
    fn identityReturnsSame() {
        let px = vec![1, 2, 3, 255, 4, 5, 6, 255];
        let out = transformLayerPixels(&px, 2, 1, &tf(false, false, 1.0, 1.0, 0.0));
        assert_eq!(out, px);
    }

    #[test]
    fn flipXSwapsColumns() {
        // 2×1：左[1] 右[2]，水平翻转后应交换。
        let px = vec![1, 0, 0, 255, 2, 0, 0, 255];
        let out = transformLayerPixels(&px, 2, 1, &tf(true, false, 1.0, 1.0, 0.0));
        assert_eq!(&out[0..4], &[2, 0, 0, 255]);
        assert_eq!(&out[4..8], &[1, 0, 0, 255]);
    }

    #[test]
    fn flipYSwapsRows() {
        let px = vec![1, 0, 0, 255, 2, 0, 0, 255];
        let out = transformLayerPixels(&px, 1, 2, &tf(false, true, 1.0, 1.0, 0.0));
        assert_eq!(&out[0..4], &[2, 0, 0, 255]);
        assert_eq!(&out[4..8], &[1, 0, 0, 255]);
    }
}
