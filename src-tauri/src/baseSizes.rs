// 单皮肤"部件原始尺寸"持久化：用户首次 resize 某 part 时记下 resize 之前的 (W,H)；
// 合成预览据此把放大后的 PNG 缩回原始尺寸渲染，未记录的 part 维持磁盘实尺。
#![allow(non_snake_case)]

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::apiLayer::ApiError;

const FILE_NAME: &str = "baseSizes.json";

/// `<skinName>/baseSizes.json` 的全部内容。
/// key 是 `<Category>/<partName>`，value 是 (width, height)。
/// 用 String key 而非 enum，便于跨 Category 合并到一份 JSON。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct BaseSizes {
    pub entries: HashMap<String, [u32; 2]>,
}

impl BaseSizes {
    pub fn get(&self, key: &str) -> Option<(u32, u32)> {
        self.entries.get(key).map(|v| (v[0], v[1]))
    }
    pub fn put(&mut self, key: String, w: u32, h: u32) {
        self.entries.insert(key, [w, h]);
    }
}

fn filePath(skinDir: &Path) -> PathBuf {
    skinDir.join(FILE_NAME)
}

/// 文件不存在或解析失败时返回空 `BaseSizes`，不报错（属可降级输入）。
pub fn load(skinDir: &Path) -> BaseSizes {
    let path = filePath(skinDir);
    match std::fs::read(&path) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => BaseSizes::default(),
    }
}

pub fn save(skinDir: &Path, sizes: &BaseSizes) -> Result<(), ApiError> {
    let path = filePath(skinDir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| ApiError {
            code: "io_failed".into(),
            message: format!("mkdir {} failed: {}", parent.display(), e),
        })?;
    }
    let bytes = serde_json::to_vec_pretty(sizes).map_err(|e| ApiError {
        code: "encode_failed".into(),
        message: format!("encode baseSizes failed: {}", e),
    })?;
    std::fs::write(&path, &bytes).map_err(|e| ApiError {
        code: "io_failed".into(),
        message: format!("write {} failed: {}", path.display(), e),
    })
}

/// `<Category>/<partName>` 形式的查表 key。
pub fn keyFor(categoryDir: &str, partName: &str) -> String {
    format!("{}/{}", categoryDir, partName)
}
