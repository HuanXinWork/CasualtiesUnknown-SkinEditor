// 程序入口：默认启动 Tauri 桌面壳，传入 `--http` 或设置 `SPE_HTTP=1` 时启动 Axum HTTP 服务。
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
#![allow(non_snake_case)]

use std::env;
use std::net::IpAddr;

use skin_preview_editor::{runDesktop, runHttp, HttpConfig};

const DEFAULT_BIND: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 5800;

fn main() {
    let args: Vec<String> = env::args().collect();
    let httpMode = args.iter().any(|a| a == "--http")
        || env::var("SPE_HTTP").map(|v| v == "1").unwrap_or(false);
    if httpMode {
        runHttp(parseHttpConfig(&args));
    } else {
        runDesktop();
    }
}

fn parseHttpConfig(args: &[String]) -> HttpConfig {
    let bindStr = parseFlag(args, "--bind")
        .or_else(|| env::var("SPE_BIND").ok())
        .unwrap_or_else(|| DEFAULT_BIND.to_string());
    let portStr = parseFlag(args, "--port")
        .or_else(|| env::var("SPE_PORT").ok())
        .unwrap_or_else(|| DEFAULT_PORT.to_string());
    let bind: IpAddr = bindStr.parse().unwrap_or_else(|_| {
        eprintln!("无效的绑定地址: {}", bindStr);
        std::process::exit(2);
    });
    let port: u16 = portStr.parse().unwrap_or_else(|_| {
        eprintln!("无效的端口: {}", portStr);
        std::process::exit(2);
    });
    HttpConfig { bind, port }
}

fn parseFlag(args: &[String], flag: &str) -> Option<String> {
    let mut iter = args.iter();
    while let Some(a) = iter.next() {
        if a == flag {
            return iter.next().cloned();
        }
        if let Some(rest) = a.strip_prefix(&format!("{}=", flag)) {
            return Some(rest.to_string());
        }
    }
    None
}
