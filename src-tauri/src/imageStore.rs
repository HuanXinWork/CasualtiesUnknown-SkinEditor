// 进程级图片字节缓存。主窗口拖入图片时把解码后的 RGBA 存入；
// 图片子窗口（label = "image_<token>"）启动时按 token 取回渲染；
// 主窗口取色器把屏幕坐标交给 Rust 找命中子窗口后按图片像素坐标取色。

#![allow(non_snake_case)]

use std::collections::HashMap;
use std::sync::Mutex;

pub struct StoredImage {
    pub width: u32,
    pub height: u32,
    /// RGBA8 扁平像素，长度 = width * height * 4。
    pub pixels: Vec<u8>,
}

#[derive(Default)]
pub struct ImageStore {
    inner: Mutex<HashMap<String, StoredImage>>,
}

impl ImageStore {
    pub fn put(&self, token: String, img: StoredImage) {
        self.inner.lock().unwrap().insert(token, img);
    }

    pub fn remove(&self, token: &str) {
        self.inner.lock().unwrap().remove(token);
    }

    /// 返回 (width, height, pixels) 副本。JSON 序列化必须 owned。
    pub fn get(&self, token: &str) -> Option<(u32, u32, Vec<u8>)> {
        self.inner
            .lock()
            .unwrap()
            .get(token)
            .map(|img| (img.width, img.height, img.pixels.clone()))
    }

    /// 按图片像素坐标读单像素 RGB。坐标越界返回 None。
    pub fn pickPixel(&self, token: &str, x: u32, y: u32) -> Option<[u8; 3]> {
        let map = self.inner.lock().unwrap();
        let img = map.get(token)?;
        if x >= img.width || y >= img.height {
            return None;
        }
        let i = ((y as usize) * (img.width as usize) + (x as usize)) * 4;
        Some([img.pixels[i], img.pixels[i + 1], img.pixels[i + 2]])
    }
}
