// 导出指定皮肤合成预览 PNG 的本地调试示例。
#![allow(non_snake_case)]

use skin_preview_editor::apiLayer::{ApiLayer, CompositeParams, CoreApi};
use skin_preview_editor::assemblyTable::Orientation;

fn main() {
    let projectRoot = std::env::current_dir().expect("cwd");
    let skinRoot = projectRoot
        .join("src-tauri")
        .join("target")
        .join("release")
        .join("data")
        .join("skin");
    println!("[dump] skinRoot = {}", skinRoot.display());

    let api = CoreApi::default();
    let r = api
        .getCompositeImage(CompositeParams {
            skinRoot: skinRoot.to_string_lossy().to_string(),
            skinName: "huanxin".to_string(),
            orientation: Orientation::Front,
            expressionIndex: 0,
            headVariant: None,
            timeSec: 0.0,
            isRight: false,
        })
        .expect("composite ok");

    let outDir = projectRoot.join("agentdocs").join("wingDebug");
    std::fs::create_dir_all(&outDir).expect("mkdir");
    let outPath = outDir.join("huanxin_composite.png");
    image::save_buffer(
        &outPath,
        &r.pixels,
        r.width,
        r.height,
        image::ColorType::Rgba8,
    )
    .expect("save png");
    println!("[dump] wrote {} ({}x{})", outPath.display(), r.width, r.height);
}
