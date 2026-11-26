use super::*;
use std::fs;
use std::path::{Path, PathBuf};
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
        let path = std::env::temp_dir().join(format!(
            "spe_imageOps_{}_{}_{}",
            std::process::id(),
            nanos,
            seq
        ));
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
    Layer {
        id: id.into(),
        name: id.into(),
        visible,
        opacity,
        pixels,
        transform: None,
    }
}

#[test]
fn flattenEmptyLayersIsTransparent() {
    let state = PartEditState {
        partName: "p".into(),
        width: 2,
        height: 2,
        layers: vec![],
    };
    assert_eq!(flatten(&state), vec![0u8; 16]);
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
    assert_eq!(flatten(&state), vec![0, 255, 0, 255]);
}

#[test]
fn flattenAlphaCompositionMatches() {
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
    assert_eq!(first, flatten(&single));
}

#[test]
fn applyBrushClampsBrushSize() {
    let mut pixels = vec![0u8; 4 * 4 * 4];
    let diff0 = applyBrush(&mut pixels, 4, 4, 2, 2, 0, [255, 0, 0, 255]);
    assert_eq!((diff0.width, diff0.height), (1, 1));

    let mut pixels2 = vec![0u8; 64 * 64 * 4];
    let diff = applyBrush(&mut pixels2, 64, 64, 32, 32, 255, [0, 0, 0, 255]);
    assert_eq!((diff.width, diff.height), (32, 32));
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
    let pixels: Vec<u8> = vec![
        255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 200, 200, 200, 255,
    ];
    let out = scaleNearest(&pixels, 2, 2, 4, 4);
    assert_eq!(out.len(), 4 * 4 * 4);
    assert_eq!(&out[0..4], &[255, 0, 0, 255]);
    assert_eq!(&out[4..8], &[255, 0, 0, 255]);
    assert_eq!(&out[8..12], &[0, 255, 0, 255]);
    assert_eq!(&out[12..16], &[0, 255, 0, 255]);
    let off02 = (2 * 4) * 4;
    assert_eq!(&out[off02..off02 + 4], &[0, 0, 255, 255]);
    let off22 = (2 * 4 + 2) * 4;
    assert_eq!(&out[off22..off22 + 4], &[200, 200, 200, 255]);
}

#[test]
fn scaleNearestShrinksByDownsample() {
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
        10, 20, 30, 255, 40, 50, 60, 255, 70, 80, 90, 255, 100, 110, 120, 255,
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
    let mut canvas = vec![0u8; 5 * 4];
    let src: Vec<u8> = vec![255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255];
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
        1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255, 5, 0, 0, 255, 6, 0, 0, 255,
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

#[test]
fn blitWithRotationZeroDegMatchesSkinSync() {
    // 偶数尺寸 2x2：0° 时 (dx - centerX) + 1.0 精确落在 [centerX - 1, centerX]。
    let evenSrc: Vec<u8> = vec![
        10, 0, 0, 255, 20, 0, 0, 255,
        30, 0, 0, 255, 40, 0, 0, 255,
    ];
    let mut cEven = vec![0u8; 4 * 4 * 4];
    blitWithRotation(&mut cEven, 4, 4, &evenSrc, 2, 2, 2, 2, 0.0, false);
    let at4 = |buf: &[u8], x: u32, y: u32| buf[((y * 4 + x) as usize) * 4];
    assert_eq!(
        (at4(&cEven, 1, 1), at4(&cEven, 2, 1), at4(&cEven, 1, 2), at4(&cEven, 2, 2)),
        (10, 20, 30, 40)
    );
    assert_eq!(at4(&cEven, 0, 1), 0);
    assert_eq!(at4(&cEven, 3, 2), 0);

    // 奇数尺寸 3x3：0° 时 (dx - centerX) + 1.5 精确落在 [centerX - 1, centerX + 1]。
    let mut oddSrc = vec![0u8; 3 * 3 * 4];
    for idx in 0..9u8 {
        let base = (idx as usize) * 4;
        oddSrc[base..base + 4].copy_from_slice(&[idx + 1, 0, 0, 255]);
    }
    let mut cOdd = vec![0u8; 5 * 5 * 4];
    blitWithRotation(&mut cOdd, 5, 5, &oddSrc, 3, 3, 2, 2, 0.0, true);
    let at5 = |buf: &[u8], x: u32, y: u32| buf[((y * 5 + x) as usize) * 4];
    assert_eq!((at5(&cOdd, 1, 1), at5(&cOdd, 2, 1), at5(&cOdd, 3, 1)), (3, 2, 1));
    assert_eq!((at5(&cOdd, 1, 2), at5(&cOdd, 2, 2), at5(&cOdd, 3, 2)), (6, 5, 4));
    assert_eq!((at5(&cOdd, 1, 3), at5(&cOdd, 2, 3), at5(&cOdd, 3, 3)), (9, 8, 7));
    assert_eq!(at5(&cOdd, 0, 2), 0);
    assert_eq!(at5(&cOdd, 4, 2), 0);
}

#[test]
fn blitWithRotationMatchesV107SkinSyncFormula() {
    // 对照 v1.0.7 与游戏端 SkinSync SkinPreviewRenderer.BlitWithRotation 的逐像素采样公式，
    // 防止再次引入 +0.5px 相位偏移导致斜角像素艺术（如 347° 头部耳尖）缺角。
    fn referenceSkinSyncBlit(
        canvasW: u32,
        canvasH: u32,
        src: &[u8],
        srcW: u32,
        srcH: u32,
        centerX: i32,
        centerY: i32,
        rotationDeg: f32,
        flipX: bool,
    ) -> Vec<u8> {
        let mut out = vec![0u8; (canvasW * canvasH * 4) as usize];
        let rad = -(rotationDeg.to_radians());
        let cosR = rad.cos();
        let sinR = rad.sin();
        let halfW = srcW as f32 * 0.5;
        let halfH = srcH as f32 * 0.5;
        let invCos = cosR;
        let invSin = -sinR;
        for dy in 0..canvasH as i32 {
            let ry = (dy - centerY) as f32;
            for dx in 0..canvasW as i32 {
                let rx = (dx - centerX) as f32;
                let mut sx = (rx * invCos - ry * invSin + halfW).floor() as i32;
                let sy = (rx * invSin + ry * invCos + halfH).floor() as i32;
                if sx < 0 || sy < 0 || sx >= srcW as i32 || sy >= srcH as i32 {
                    continue;
                }
                if flipX {
                    sx = srcW as i32 - 1 - sx;
                }
                let sBase = ((sy as usize) * (srcW as usize) + (sx as usize)) * 4;
                if src[sBase + 3] == 0 {
                    continue;
                }
                let dBase = ((dy as usize) * (canvasW as usize) + (dx as usize)) * 4;
                out[dBase..dBase + 4].copy_from_slice(&src[sBase..sBase + 4]);
            }
        }
        out
    }

    let (cw, ch) = (100u32, 100u32);
    let (sw, sh) = (28u32, 16u32);
    let mut head = vec![0u8; (sw * sh * 4) as usize];
    for sy in 0..sh {
        for sx in 0..sw {
            // 在耳尖四角与轮廓位置铺设唯一颜色标记，确保任一像素采样相位偏移都会被捕获。
            if sy == 0 || sy == sh - 1 || sx == 0 || sx == sw - 1 || (sx + sy) % 5 == 0 {
                let i = ((sy * sw + sx) * 4) as usize;
                head[i..i + 4].copy_from_slice(&[(sx * 9) as u8, (sy * 15) as u8, 200, 255]);
            }
        }
    }

    for &(angle, flipX) in &[(347.0f32, false), (347.0f32, true), (180.0f32, false), (23.5f32, false)] {
        let mut actual = vec![0u8; (cw * ch * 4) as usize];
        blitWithRotation(&mut actual, cw, ch, &head, sw, sh, 60, 31, angle, flipX);
        let expected = referenceSkinSyncBlit(cw, ch, &head, sw, sh, 60, 31, angle, flipX);
        assert_eq!(
            actual, expected,
            "blitWithRotation diverged from v1.0.7/SkinSync formula at angle={angle}, flipX={flipX}"
        );
    }
}

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

#[test]
fn fillsConnectedRegionOnly() {
    let mut px = vec![
        0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255,
    ];
    let diff = applyFill(&mut px, 2, 2, 0, 0, [1, 2, 3, 255], 0);
    assert_eq!((diff.x, diff.y, diff.width, diff.height), (0, 0, 1, 2));
    assert_eq!(&px[0..4], &[1, 2, 3, 255]);
    assert_eq!(&px[8..12], &[1, 2, 3, 255]);
    assert_eq!(&px[4..8], &[255, 255, 255, 255]);
}

#[test]
fn fillsAcrossErasedTransparentPixels() {
    let mut px = vec![0, 0, 0, 0, 120, 80, 40, 0];
    let diff = applyFill(&mut px, 2, 1, 0, 0, [9, 8, 7, 255], 0);
    assert_eq!((diff.width, diff.height), (2, 1));
    assert_eq!(&px[0..4], &[9, 8, 7, 255]);
    assert_eq!(&px[4..8], &[9, 8, 7, 255]);
}

#[test]
fn noopWhenStartAlreadyTargetColor() {
    let mut px = vec![1, 2, 3, 255];
    let diff = applyFill(&mut px, 1, 1, 0, 0, [1, 2, 3, 255], 0);
    assert_eq!((diff.width, diff.height), (0, 0));
}

#[test]
fn toleranceExpandsMatch() {
    let mut px = vec![100, 100, 100, 255, 105, 105, 105, 255];
    let diff = applyFill(&mut px, 2, 1, 0, 0, [0, 0, 0, 255], 8);
    assert_eq!((diff.width, diff.height), (2, 1));
    assert_eq!(&px[0..4], &[0, 0, 0, 255]);
    assert_eq!(&px[4..8], &[0, 0, 0, 255]);
}

#[test]
fn coverageCenterFullEdgeFades() {
    let mut cov = vec![0u8; 25];
    let rect = stampSoftCoverage(&mut cov, 5, 5, 2, 2, 5, 0).expect("touched");
    assert_eq!(cov[2 * 5 + 2], 255);
    let (x0, y0, x1, y1) = rect;
    assert!(x0 <= 2 && y0 <= 2 && x1 >= 3 && y1 >= 3);
}

#[test]
fn coverageTakesMaxNotSum() {
    let mut cov = vec![0u8; 25];
    stampSoftCoverage(&mut cov, 5, 5, 2, 2, 5, 128);
    let once = cov[2 * 5 + 2];
    stampSoftCoverage(&mut cov, 5, 5, 2, 2, 5, 128);
    assert_eq!(cov[2 * 5 + 2], once);
}

#[test]
fn compositeAppliesCoverageAsAlpha() {
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

fn tf(flipX: bool, flipY: bool, sx: f32, sy: f32, rot: f32) -> LayerTransform {
    LayerTransform {
        flipX,
        flipY,
        scaleX: sx,
        scaleY: sy,
        rotationDeg: rot,
    }
}

#[test]
fn identityReturnsSame() {
    let px = vec![1, 2, 3, 255, 4, 5, 6, 255];
    let out = transformLayerPixels(&px, 2, 1, &tf(false, false, 1.0, 1.0, 0.0));
    assert_eq!(out, px);
}

#[test]
fn flipXSwapsColumns() {
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

#[test]
fn resizeCanvasRgbaExpandsCropsAndOffsetsWithoutInterpolation() {
    // 2x2: (0,0)=R1, (1,0)=R2, (0,1)=R3, (1,1)=R4
    let src = vec![
        1, 0, 0, 255, 2, 0, 0, 255, //
        3, 0, 0, 255, 4, 0, 0, 255, //
    ];
    // 扩展到 4x3，偏移 (1, 1)
    let exp = resizeCanvasRgba(&src, 2, 2, 4, 3, 1, 1);
    assert_eq!(exp.len(), 4 * 3 * 4);
    let pxAt = |buf: &[u8], w: u32, x: u32, y: u32| -> [u8; 4] {
        let i = ((y * w + x) * 4) as usize;
        [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]
    };
    assert_eq!(pxAt(&exp, 4, 0, 0), [0, 0, 0, 0]);
    assert_eq!(pxAt(&exp, 4, 1, 1), [1, 0, 0, 255]);
    assert_eq!(pxAt(&exp, 4, 2, 1), [2, 0, 0, 255]);
    assert_eq!(pxAt(&exp, 4, 1, 2), [3, 0, 0, 255]);
    assert_eq!(pxAt(&exp, 4, 2, 2), [4, 0, 0, 255]);
    assert_eq!(pxAt(&exp, 4, 3, 2), [0, 0, 0, 0]);

    // 裁切到 2x1，偏移 (-1, -1)：仅旧 (1,1) 落在 (0,0)，其余透明
    let crop = resizeCanvasRgba(&src, 2, 2, 2, 1, -1, -1);
    assert_eq!(pxAt(&crop, 2, 0, 0), [4, 0, 0, 255]);
    assert_eq!(pxAt(&crop, 2, 1, 0), [0, 0, 0, 0]);
}

#[test]
fn blitWithRotationHeadAndEye347StrictlyAligned() {
    // 验证 experimentHeadBack (28x16) 与 experimentEyeOpen (26x12) 同在 (60, 31) 旋转 347° 时
    // 居中对应的像素在目标画布上逐像素重合，不存在 1px 中心错位。
    let (cw, ch) = (100u32, 100u32);
    let mut head = vec![0u8; (28 * 16 * 4) as usize];
    let mut eye = vec![0u8; (26 * 12 * 4) as usize];
    let eyeSamples = [(5u32, 3u32), (12, 6), (20, 9)];
    for &(ex, ey) in &eyeSamples {
        let ei = ((ey * 26 + ex) * 4) as usize;
        eye[ei..ei + 4].copy_from_slice(&[255, 0, 0, 255]);
        let hx = ex + (28 - 26) / 2;
        let hy = ey + (16 - 12) / 2;
        let hi = ((hy * 28 + hx) * 4) as usize;
        head[hi..hi + 4].copy_from_slice(&[255, 0, 0, 255]);
    }

    let mut headCanvas = vec![0u8; (cw * ch * 4) as usize];
    let mut eyeCanvas = vec![0u8; (cw * ch * 4) as usize];
    blitWithRotation(&mut headCanvas, cw, ch, &head, 28, 16, 60, 31, 347.0, false);
    blitWithRotation(&mut eyeCanvas, cw, ch, &eye, 26, 12, 60, 31, 347.0, false);

    assert_eq!(headCanvas, eyeCanvas);
    assert!(headCanvas.chunks_exact(4).any(|p| p[3] == 255));
}
