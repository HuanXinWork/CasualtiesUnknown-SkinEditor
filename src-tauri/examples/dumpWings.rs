// 临时工具：把 huanxin 4 张翼 PNG 按 WingScript 角度拼成"收敛"与"展开"两张预览。
// 上翼以翼根 (cx,cy) 为旋转中心；下翼贴在上翼旋转后的"翼尖"位置，并用与上翼相同的旋转角，
// 让下翼自然延续成完整翼形。
// 运行：cargo run --example dumpWings --manifest-path src-tauri/Cargo.toml
#![allow(non_snake_case)]

use skin_preview_editor::imageOps;

const CANVAS_W: u32 = 96;
const CANVAS_H: u32 = 96;

fn loadRgba(path: &std::path::Path) -> (Vec<u8>, u32, u32) {
    let img = image::open(path).expect("open png").to_rgba8();
    let (w, h) = img.dimensions();
    (img.into_raw(), w, h)
}

// 与 imageOps::blitWithRotation 内部约定保持一致：rad = -rotDeg。
// 对画布坐标系 (y 朝下) 的向量做"逆时针 rotDeg 度（屏幕坐标系语义）"旋转。
fn rotateVec(dx: f32, dy: f32, rotDeg: f32) -> (f32, f32) {
    let rad = -rotDeg.to_radians();
    let c = rad.cos();
    let s = rad.sin();
    (dx * c - dy * s, dx * s + dy * c)
}

struct WingPiece<'a> {
    pixels: &'a [u8],
    w: u32,
    h: u32,
    cx: i32,
    cy: i32,
    rotDeg: f32,
}

fn drawComposite(pieces: &[WingPiece]) -> Vec<u8> {
    let mut canvas = vec![0u8; (CANVAS_W * CANVAS_H * 4) as usize];
    for p in pieces {
        imageOps::blitWithRotation(
            &mut canvas,
            CANVAS_W,
            CANVAS_H,
            p.pixels,
            p.w,
            p.h,
            p.cx,
            p.cy,
            p.rotDeg,
            false,
        );
    }
    canvas
}

fn savePng(canvas: &[u8], path: &std::path::Path) {
    image::save_buffer(path, canvas, CANVAS_W, CANVAS_H, image::ColorType::Rgba8)
        .expect("save png");
    println!(
        "[dump] wrote {} ({}x{})",
        path.display(),
        CANVAS_W,
        CANVAS_H
    );
}

fn main() {
    let projectRoot = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("project root")
        .to_path_buf();
    let wingsDir = projectRoot.join("skin").join("huanxin").join("Wings");
    println!("[dump] wingsDir = {}", wingsDir.display());

    let (ulPx, ulW, ulH) = loadRgba(&wingsDir.join("wingUL.png"));
    let (urPx, urW, urH) = loadRgba(&wingsDir.join("wingUR.png"));
    let (dlPx, dlW, dlH) = loadRgba(&wingsDir.join("wingDL.png"));
    let (drPx, drW, drH) = loadRgba(&wingsDir.join("wingDR.png"));

    // 上翼翼根锚到画布中心
    let cx = (CANVAS_W as i32) / 2;
    let cy = (CANVAS_H as i32) / 2;

    // WingScript 角度（body.isRight=true 面右）：rest 18° / max 110°；左翼取负、右翼取正。
    let rest = 18.0f32;
    let max = 110.0f32;

    let outDir = projectRoot.join("agentdocs").join("wingDebug");
    std::fs::create_dir_all(&outDir).expect("mkdir");

    // 给定上翼旋转角，算下翼应该贴在 (cx,cy) 加 rotate((0, halfH), rotUpper) 的位置。
    // halfH 取上翼 PNG 半高——PNG 内部约定翼根在中心、翼尖朝下到 PNG 底边，
    // 所以 (0, halfH) 就是 PNG 内"翼尖相对翼根"的向量。
    let halfHL = (ulH as f32) / 2.0;
    let halfHR = (urH as f32) / 2.0;

    let composeAt = |rotL: f32, rotR: f32| -> Vec<WingPiece> {
        let (offLx, offLy) = rotateVec(0.0, halfHL * 0.74, rotL);
        let (offRx, offRy) = rotateVec(0.0, halfHR * 0.74, rotR);
        let downLcx = (cx as f32 + offLx).round() as i32;
        let downLcy = (cy as f32 + offLy).round() as i32;
        let downRcx = (cx as f32 + offRx).round() as i32;
        let downRcy = (cy as f32 + offRy).round() as i32;
        vec![
            WingPiece {
                pixels: &ulPx,
                w: ulW,
                h: ulH,
                cx,
                cy,
                rotDeg: rotL,
            },
            WingPiece {
                pixels: &dlPx,
                w: dlW,
                h: dlH,
                cx: downLcx,
                cy: downLcy,
                rotDeg: rotL,
            },
            WingPiece {
                pixels: &urPx,
                w: urW,
                h: urH,
                cx,
                cy,
                rotDeg: rotR,
            },
            WingPiece {
                pixels: &drPx,
                w: drW,
                h: drH,
                cx: downRcx,
                cy: downRcy,
                rotDeg: rotR,
            },
        ]
    };

    let collapsed = drawComposite(&composeAt(-rest, rest));
    savePng(&collapsed, &outDir.join("huanxin_wings_collapsed.png"));

    let spread = drawComposite(&composeAt(-max, max));
    savePng(&spread, &outDir.join("huanxin_wings_spread.png"));
}
