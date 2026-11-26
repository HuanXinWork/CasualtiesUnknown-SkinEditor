// 贴图拷贝、旋转缩放与 PNG 文件读写。

use std::io::Cursor;
use std::path::Path;

use crate::apiLayer::ApiError;
use crate::dataPaths;

use super::rgbaByteLen;

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
    let (Some(canvasLen), Some(srcLen)) = (rgbaByteLen(canvasW, canvasH), rgbaByteLen(srcW, srcH))
    else {
        return;
    };
    if canvas.len() < canvasLen || src.len() < srcLen {
        return;
    }
    for sy in 0..srcH {
        for sx in 0..srcW {
            let dx = dstX + if flipX { (srcW - 1 - sx) as i32 } else { sx as i32 };
            let dy = dstY + sy as i32;
            if dx < 0 || dy < 0 || dx >= canvasW as i32 || dy >= canvasH as i32 {
                continue;
            }
            let sBase = ((sy as usize) * (srcW as usize) + (sx as usize)) * 4;
            let sa = src[sBase + 3] as u32;
            if sa == 0 {
                continue;
            }
            let sr = src[sBase] as u32;
            let sg = src[sBase + 1] as u32;
            let sb = src[sBase + 2] as u32;
            let dBase = ((dy as usize) * (canvasW as usize) + (dx as usize)) * 4;
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

/// 绕源图几何中心旋转（逆时针为正，对齐 Unity `localEulerAngles.z`）并以最近邻贴到目标画布。
/// 锚点按源宽高奇偶对齐像素中心或网格线，确保 0° 与整数放置对齐、90°/180°/270° 旋转无 1px 偏心。
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
    let (Some(canvasLen), Some(srcLen)) = (rgbaByteLen(canvasW, canvasH), rgbaByteLen(srcW, srcH))
    else {
        return;
    };
    if srcW == 0 || srcH == 0 || canvas.len() < canvasLen || src.len() < srcLen {
        return;
    }
    let rad = -(rotationDeg.to_radians());
    let cosR = rad.cos();
    let sinR = rad.sin();
    let halfSrcW = srcW as f32 * 0.5;
    let halfSrcH = srcH as f32 * 0.5;
    let anchorX = centerX as f32 + if srcW % 2 == 1 { 0.5 } else { 0.0 };
    let anchorY = centerY as f32 + if srcH % 2 == 1 { 0.5 } else { 0.0 };

    let corners = [
        (-halfSrcW, -halfSrcH),
        (halfSrcW, -halfSrcH),
        (-halfSrcW, halfSrcH),
        (halfSrcW, halfSrcH),
    ];
    let mut minDx = f32::INFINITY;
    let mut maxDx = f32::NEG_INFINITY;
    let mut minDy = f32::INFINITY;
    let mut maxDy = f32::NEG_INFINITY;
    for (cx, cy) in corners {
        let dx = cx * cosR - cy * sinR;
        let dy = cx * sinR + cy * cosR;
        if dx < minDx {
            minDx = dx;
        }
        if dx > maxDx {
            maxDx = dx;
        }
        if dy < minDy {
            minDy = dy;
        }
        if dy > maxDy {
            maxDy = dy;
        }
    }
    let dxStart = (anchorX + minDx - 0.5).floor() as i32;
    let dyStart = (anchorY + minDy - 0.5).floor() as i32;
    let dxEnd = (anchorX + maxDx + 0.5).ceil() as i32;
    let dyEnd = (anchorY + maxDy + 0.5).ceil() as i32;

    let invCos = cosR;
    let invSin = -sinR;
    for dy in dyStart..=dyEnd {
        if dy < 0 || dy >= canvasH as i32 {
            continue;
        }
        let ry = (dy as f32 + 0.5) - anchorY;
        for dx in dxStart..=dxEnd {
            if dx < 0 || dx >= canvasW as i32 {
                continue;
            }
            let rx = (dx as f32 + 0.5) - anchorX;
            let srcXF = rx * invCos - ry * invSin + halfSrcW;
            let srcYF = rx * invSin + ry * invCos + halfSrcH;
            let mut sx = srcXF.floor() as i32;
            let sy = srcYF.floor() as i32;
            if sx < 0 || sy < 0 || sx >= srcW as i32 || sy >= srcH as i32 {
                continue;
            }
            if flipX {
                sx = (srcW as i32) - 1 - sx;
            }
            let sBase = ((sy as usize) * (srcW as usize) + (sx as usize)) * 4;
            let sa = src[sBase + 3] as u32;
            if sa == 0 {
                continue;
            }
            let sr = src[sBase] as u32;
            let sg = src[sBase + 1] as u32;
            let sb = src[sBase + 2] as u32;
            let dBase = ((dy as usize) * (canvasW as usize) + (dx as usize)) * 4;
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

/// 最近邻缩放 RGBA8 缓冲区，保留像素风硬边缘。
pub fn scaleNearest(pixels: &[u8], oldW: u32, oldH: u32, newW: u32, newH: u32) -> Vec<u8> {
    let Some(outLen) = rgbaByteLen(newW, newH) else {
        return Vec::new();
    };
    let mut out = vec![0u8; outLen];
    if oldW == 0 || oldH == 0 || newW == 0 || newH == 0 {
        return out;
    }
    let Some(inLen) = rgbaByteLen(oldW, oldH) else {
        return out;
    };
    if pixels.len() != inLen {
        return out;
    }
    for ny in 0..newH {
        let sy = ((ny as u64) * (oldH as u64) / (newH as u64)) as u32;
        for nx in 0..newW {
            let sx = ((nx as u64) * (oldW as u64) / (newW as u64)) as u32;
            let srcOff = ((sy as usize) * (oldW as usize) + (sx as usize)) * 4;
            let dstOff = ((ny as usize) * (newW as usize) + (nx as usize)) * 4;
            out[dstOff..dstOff + 4].copy_from_slice(&pixels[srcOff..srcOff + 4]);
        }
    }
    out
}

/// 纯几何画布裁切/扩展：按像素偏移原样搬运 RGBA8 像素，越界裁切、空白补全透明，不做像素插值。
pub fn resizeCanvasRgba(
    pixels: &[u8],
    oldW: u32,
    oldH: u32,
    newW: u32,
    newH: u32,
    offsetX: i32,
    offsetY: i32,
) -> Vec<u8> {
    let Some(outLen) = rgbaByteLen(newW, newH) else {
        return Vec::new();
    };
    let mut out = vec![0u8; outLen];
    if oldW == 0 || oldH == 0 || newW == 0 || newH == 0 {
        return out;
    }
    let Some(inLen) = rgbaByteLen(oldW, oldH) else {
        return out;
    };
    if pixels.len() != inLen {
        return out;
    }
    let ox = offsetX as i64;
    let oy = offsetY as i64;
    let xStart = 0i64.max(-ox);
    let xEnd = (oldW as i64).min(newW as i64 - ox);
    let yStart = 0i64.max(-oy);
    let yEnd = (oldH as i64).min(newH as i64 - oy);
    if xStart >= xEnd || yStart >= yEnd {
        return out;
    }
    let rowBytes = ((xEnd - xStart) as usize) * 4;
    for sy in yStart..yEnd {
        let dy = (sy + oy) as usize;
        let dx = (xStart + ox) as usize;
        let srcOff = ((sy as usize) * (oldW as usize) + (xStart as usize)) * 4;
        let dstOff = (dy * (newW as usize) + dx) * 4;
        out[dstOff..dstOff + rowBytes].copy_from_slice(&pixels[srcOff..srcOff + rowBytes]);
    }
    out
}

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

/// 编码 PNG 并原子替换目标文件，保持原文件名不变。
pub fn savePng(path: &Path, width: u32, height: u32, pixels: &[u8]) -> Result<(), ApiError> {
    let buf = image::RgbaImage::from_raw(width, height, pixels.to_vec()).ok_or_else(|| ApiError {
        code: "encode_failed".into(),
        message: format!(
            "buffer length {} mismatches {}x{}",
            pixels.len(),
            width,
            height
        ),
    })?;
    let mut encoded = Vec::new();
    image::DynamicImage::ImageRgba8(buf)
        .write_to(&mut Cursor::new(&mut encoded), image::ImageFormat::Png)
        .map_err(|e| ApiError {
            code: "encode_failed".into(),
            message: format!("encode {} failed: {}", path.display(), e),
        })?;
    dataPaths::atomicWrite(path, &encoded).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("write {} failed: {}", path.display(), e),
    })
}
