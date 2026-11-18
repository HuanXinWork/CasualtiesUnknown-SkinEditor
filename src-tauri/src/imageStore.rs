// 拖入参考图子窗口（`image_<token>`）的进程内 RGBA 缓存与屏幕取色读取。
#![allow(non_snake_case)]

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard};

pub struct StoredImage {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

#[derive(Default)]
pub struct ImageStore {
    inner: Mutex<HashMap<String, StoredImage>>,
}

impl ImageStore {
    fn lockMap(&self) -> MutexGuard<'_, HashMap<String, StoredImage>> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn put(&self, token: String, img: StoredImage) {
        self.lockMap().insert(token, img);
    }

    pub fn remove(&self, token: &str) {
        self.lockMap().remove(token);
    }

    pub fn dimensions(&self, token: &str) -> Option<(u32, u32)> {
        self.lockMap().get(token).map(|img| (img.width, img.height))
    }

    pub fn get(&self, token: &str) -> Option<(u32, u32, Vec<u8>)> {
        self.lockMap()
            .get(token)
            .map(|img| (img.width, img.height, img.pixels.clone()))
    }

    /// 读取指定像素 RGB；越界或完全透明像素返回 `None`。
    pub fn pickPixel(&self, token: &str, x: u32, y: u32) -> Option<[u8; 3]> {
        let map = self.lockMap();
        let img = map.get(token)?;
        if x >= img.width || y >= img.height {
            return None;
        }
        let idx = ((y as usize).checked_mul(img.width as usize)?).checked_add(x as usize)?;
        let i = idx.checked_mul(4)?;
        let rgba = img.pixels.get(i..i + 4)?;
        if rgba[3] == 0 {
            return None;
        }
        Some([rgba[0], rgba[1], rgba[2]])
    }
}
