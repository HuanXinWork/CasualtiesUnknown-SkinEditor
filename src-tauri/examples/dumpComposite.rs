// 临时工具：把 huanxin 皮肤的合成预览输出为 PNG，便于核对翼位置。
// 运行：cargo run --example dumpComposite --manifest-path src-tauri/Cargo.toml
#![allow(non_snake_case)]

use std::path::PathBuf;

use skin_preview_editor::apiLayer::{ApiLayer, CompositeParams, CoreApi};
use skin_preview_editor::assemblyTable::Orientation;

fn main() {
    let exeDir = std::env::current_exe()
        .expect("current_exe")
        .parent()
        .expect("parent")
        .to_path_buf();
    // examples 编 binary 放到 target/debug/examples/，data 在 src-tauri/target/release/data
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
    let _ = exeDir;
}

