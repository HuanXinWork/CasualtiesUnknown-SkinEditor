// 把 PartEditState（含全部图层）持久化到 `<skinDir>/layers/<Cat>/<part>/`。
// 与扁平合成 PNG 互补：合成 PNG 给游戏与外部工具读取，sidecar 只服务编辑器自身还原图层结构。
//
// 目录布局：
//   <skinDir>/layers/<Cat>/<partName>/
//     manifest.json    元数据（版本、activeLayerIndex、layers[i] 的 id/name/visible/opacity/file）
//     layer0.png       每层独立 RGBA PNG，按 manifest.layers[i].file 引用
//     layer1.png
//     ...
#![allow(non_snake_case)]

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::apiLayer::ApiError;
use crate::imageOps::{self, Layer, PartEditState};

pub const SIDECAR_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerEntry {
    pub id: String,
    pub name: String,
    pub visible: bool,
    pub opacity: u8,
    /// 相对 manifest 的图层 PNG 文件名，例如 "layer0.png"。
    pub file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SidecarManifest {
    pub version: u32,
    pub width: u32,
    pub height: u32,
    pub activeLayerIndex: usize,
    pub layers: Vec<LayerEntry>,
}

pub fn sidecarDir(skinDir: &Path, categoryDir: &str, partName: &str) -> PathBuf {
    skinDir.join("layers").join(categoryDir).join(partName)
}

/// 写入图层 PNG + manifest.json。已有目录原地覆盖；
/// 旧 layerN.png 索引超出当前层数的会被删除，避免污染下次加载。
pub fn save(skinDir: &Path, categoryDir: &str, partName: &str, state: &PartEditState, activeIndex: usize) -> Result<(), ApiError> {
    let dir = sidecarDir(skinDir, categoryDir, partName);
    fs::create_dir_all(&dir).map_err(|e| ioErr("mkdir", &dir, e))?;

    let mut entries: Vec<LayerEntry> = Vec::with_capacity(state.layers.len());
    for (i, layer) in state.layers.iter().enumerate() {
        let file = format!("layer{}.png", i);
        imageOps::savePng(&dir.join(&file), state.width, state.height, &layer.pixels)?;
        entries.push(LayerEntry {
            id: layer.id.clone(),
            name: layer.name.clone(),
            visible: layer.visible,
            opacity: layer.opacity,
            file,
        });
    }

    if let Ok(rd) = fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let name = entry.file_name();
            let s = name.to_string_lossy();
            if let Some(rest) = s.strip_prefix("layer") {
                if let Some(numStr) = rest.strip_suffix(".png") {
                    if let Ok(idx) = numStr.parse::<usize>() {
                        if idx >= state.layers.len() {
                            let _ = fs::remove_file(entry.path());
                        }
                    }
                }
            }
        }
    }

    let manifest = SidecarManifest {
        version: SIDECAR_VERSION,
        width: state.width,
        height: state.height,
        activeLayerIndex: activeIndex,
        layers: entries,
    };
    let bytes = serde_json::to_vec_pretty(&manifest).map_err(|e| ApiError {
        code: "encode_failed".into(),
        message: format!("serialize layer manifest failed: {}", e),
    })?;
    fs::write(dir.join("manifest.json"), bytes).map_err(|e| ioErr("write manifest", &dir, e))?;
    Ok(())
}

/// 读 sidecar 还原 PartEditState。manifest 不存在、解析失败、版本不匹配
/// 或像素尺寸不一致都返回 None，让上层回落到读单层 PNG 的旧路径。
pub fn loadIfPresent(skinDir: &Path, categoryDir: &str, partName: &str) -> Option<(PartEditState, usize)> {
    let dir = sidecarDir(skinDir, categoryDir, partName);
    let manifestPath = dir.join("manifest.json");
    let bytes = fs::read(&manifestPath).ok()?;
    let manifest: SidecarManifest = serde_json::from_slice(&bytes).ok()?;
    if manifest.version != SIDECAR_VERSION {
        return None;
    }
    let mut layers: Vec<Layer> = Vec::with_capacity(manifest.layers.len());
    for entry in &manifest.layers {
        let pngPath = dir.join(&entry.file);
        let decoded = match imageOps::loadPng(&pngPath) {
            Ok(t) => t,
            Err(_) => return None,
        };
        let (w, h, pixels) = decoded;
        if w != manifest.width || h != manifest.height {
            return None;
        }
        layers.push(Layer {
            id: entry.id.clone(),
            name: entry.name.clone(),
            visible: entry.visible,
            opacity: entry.opacity,
            pixels,
            transform: None,
        });
    }
    if layers.is_empty() {
        return None;
    }
    let activeIndex = manifest.activeLayerIndex.min(layers.len().saturating_sub(1));
    let state = PartEditState {
        partName: partName.to_string(),
        width: manifest.width,
        height: manifest.height,
        layers,
    };
    Some((state, activeIndex))
}

fn ioErr(action: &str, path: &Path, e: std::io::Error) -> ApiError {
    ApiError {
        code: "io_failed".into(),
        message: format!("{} {} failed: {}", action, path.display(), e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            static SEQ: AtomicU64 = AtomicU64::new(0);
            let seq = SEQ.fetch_add(1, Ordering::Relaxed);
            let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
            let p = std::env::temp_dir().join(format!("spe_sidecar_{}_{}_{}", std::process::id(), nanos, seq));
            fs::create_dir_all(&p).unwrap();
            TempDir(p)
        }
        fn path(&self) -> &Path { &self.0 }
    }
    impl Drop for TempDir { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

    fn mkLayer(id: &str, opacity: u8, w: u32, h: u32, fill: [u8; 4]) -> Layer {
        let mut px = Vec::with_capacity((w * h * 4) as usize);
        for _ in 0..(w * h) { px.extend_from_slice(&fill); }
        Layer { id: id.into(), name: id.into(), visible: true, opacity, pixels: px, transform: None }
    }

    #[test]
    fn saveAndLoadRoundTrip() {
        let tmp = TempDir::new();
        let state = PartEditState {
            partName: "experimentUpTorso".into(),
            width: 2,
            height: 2,
            layers: vec![
                mkLayer("layer0", 255, 2, 2, [10, 20, 30, 255]),
                mkLayer("layer1", 128, 2, 2, [40, 50, 60, 200]),
            ],
        };
        save(tmp.path(), "Body", "experimentUpTorso", &state, 1).expect("save");
        let manifest = sidecarDir(tmp.path(), "Body", "experimentUpTorso").join("manifest.json");
        assert!(manifest.is_file());

        let (loaded, active) = loadIfPresent(tmp.path(), "Body", "experimentUpTorso").expect("load");
        assert_eq!(active, 1);
        assert_eq!(loaded.width, 2);
        assert_eq!(loaded.layers.len(), 2);
        assert_eq!(loaded.layers[0].id, "layer0");
        assert_eq!(loaded.layers[1].opacity, 128);
        assert_eq!(loaded.layers[0].pixels[0], 10);
    }

    #[test]
    fn loadMissingReturnsNone() {
        let tmp = TempDir::new();
        assert!(loadIfPresent(tmp.path(), "Body", "ghost").is_none());
    }

    #[test]
    fn saveTrimsExtraStaleLayerFiles() {
        let tmp = TempDir::new();
        let dir = sidecarDir(tmp.path(), "Body", "p");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("layer5.png"), b"stale").unwrap();
        let state = PartEditState {
            partName: "p".into(),
            width: 1,
            height: 1,
            layers: vec![mkLayer("layer0", 255, 1, 1, [0, 0, 0, 0])],
        };
        save(tmp.path(), "Body", "p", &state, 0).expect("save");
        assert!(!dir.join("layer5.png").exists());
        assert!(dir.join("layer0.png").is_file());
    }
}
