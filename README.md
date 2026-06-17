<!-- markdownlint-disable MD033 MD036 MD041 -->

<div align="center">

<p align="center">
  <a href="https://github.com/huanxin996"><img src="https://github.com/huanxin996.png" width="200" height="200" alt="huanxin996"></a>
</p>

# CasualtiesUnknown-SkinEditor

_✨ 为 游戏 `Casualties Unknown` 提供独立的皮肤预览与像素级编辑器 ✨_

<p>
  <img src="https://img.shields.io/badge/version-1.0.7-blue.svg" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license">
  <img src="https://img.shields.io/badge/tauri-v2-FFC131?logo=tauri" alt="tauri">
  <img src="https://img.shields.io/badge/rust-1.75+-orange.svg?logo=rust" alt="rust">
  <img src="https://img.shields.io/badge/node-18+-brightgreen.svg?logo=node.js" alt="node">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="platform">
</p>

<p>
  <a href="docs/zh/README.md"><strong>中文使用文档</strong></a>
  ·
  <a href="docs/en/README.md"><strong>English User Guide</strong></a>
  ·
  <a href="changes.md"><strong>更新日志</strong></a>
</p>

<p>
  皮肤 Mod 仓库：
  <a href="https://github.com/Paili-16/Scav-Prototype-The-Characters-Skins"><strong>Scav-Prototype-The-Characters-Skins</strong></a>
</p>

</div>

## 项目预览

<table>
  <tr>
    <td align="center" width="50%">
      <img src="https://raw.githubusercontent.com/huanxin996/CasualtiesUnknown-SkinEditor/main/docs/zh/images/main.png" alt="中文界面 / Chinese UI" width="100%">
      <br>
      <sub>中文界面 / Chinese UI</sub>
    </td>
    <td align="center" width="50%">
      <img src="https://raw.githubusercontent.com/huanxin996/CasualtiesUnknown-SkinEditor/main/docs/en/images/main.png" alt="English UI" width="100%">
      <br>
      <sub>English UI</sub>
    </td>
  </tr>
</table>

---

## 项目说明

本项目是一个独立桌面应用，目标是把 游戏 `Casualties Unknown` 所依赖的皮肤目录变成可视化、可编辑的工程文件，而不是让 mod 用户去手工对齐 PNG 像素与目录命名。

## 架构

### 双形态共用同一 crate

```text
                        ┌──────────────────────────────┐
                        │  web/  (TypeScript + Vite)   │
                        │  编辑器 / 预览 / 工具栏 / i18n │
                        └─────────────┬────────────────┘
                                      │ build → web/dist/
                                      ▼
                        ┌──────────────────────────────┐
                        │  rust-embed (编译期嵌入二进制) │
                        │  前端 bundle + 默认皮肤 exp   │
                        └──────────────────────────────┘
                                      │
              ┌───────────────────────┼────────────────────────┐
              ▼                       ▼                        ▼
     ┌──────────────┐         ┌──────────────┐         ┌─────────────────┐
     │  Tauri 桌面壳 │         │ Axum HTTP svc│         │   apiLayer      │
     │ (WebView2)   │ ──────► │ /api/*       │ ──────► │ (业务逻辑唯一源) │
     └──────────────┘ Tauri   └──────────────┘  REST   └─────────────────┘
                      cmd                                      │
                                                               ▼
                                                    skinLoader / imageOps /
                                                    layerSidecar / assemblyTable /
                                                    historyManager / windowManager
```

桌面壳和 HTTP 服务是两条互斥启动路径，但它们都把请求转发给同一组业务模块。

22 条 Tauri command 与 22 条 HTTP REST 路由是镜像关系：命令名 / 字段名一致，仅传输层不同。前端 `apiClient` 在两种模式下分发到不同的传输实现，对调用方透明。

### 后端模块（`src-tauri/src/`）

| 模块 | 职责 |
| --- | --- |
| `apiLayer` | 业务逻辑入口；所有变更操作过单 mutex 串行，自然 last-write-wins |
| `skinLoader` | 扫描皮肤根目录、解析部件文件、导入/导出 zip |
| `imageOps` | 单图层像素操作（画笔、橡皮、渐变、合并、PNG 编解码） |
| `layerSidecar` | 多图层工程文件落盘（`layers/<部件>/manifest.json` + `layerN.png`） |
| `assemblyTable` | 部件装配表：z-order、坐标、变体；缺文件时回退内置默认 |
| `historyManager` | 撤销/重做的环形栈；按笔分组而不是按像素 |
| `windowManager` | workspace.json 序列化（布局 sizes + 主题 + 当前皮肤名） |
| `httpServer` | Axum 路由；`rust-embed` 资源回放 + JSON DTO |
| `tauriCommands` | Tauri command 适配层；DTO 与 HTTP 共享，Result 转 `tauri::Error` |

### 前端模块（`web/src/`）

前端是单页 SPA，子窗口通过 URL `?panel=<id>` 复用同一 bundle 渲染单个面板（不是多 bundle 多入口）。

| 模块 | 职责 |
| --- | --- |
| `apiClient` | Tauri/HTTP 双形态分发；运行期通过 `runtimeMode` 判定 |
| `stateStore` | 全局 store（皮肤、部件、图层、工具、撤销栈、主题、语言、脏标记） |
| `dockHost` | 可拖拽 / 可悬浮 / 可折叠的面板容器；负责 detach 与重连 |
| `partPanel` / `editorCanvas` / `previewCanvas` / `layerPanel` | 4 个核心面板；其中 `previewCanvas` 同时承载装配预览与动作捕捉逐帧预览 |
| `colorPalette` / `toolPanel` | 调色盘（含取色针）与工具栏 |
| `closeGuard` | 主窗口关闭前的脏检查与保存对话框 |
| `imageWindow` | 拖入图片打开的临时子窗口（图片不入工程） |
| `layoutEngine` | 列宽 / 行高拖动 + 持久化 `workspace.json.sizes` |
| `i18n` / `themeSettings` / `langSettings` / `settingsPanel` | 双语词典、主题切换、语言切换、快捷键编辑 |
| `shortcuts` | 全局键盘动作分发；输入框中自动让位 |

### 数据约定

数据根目录默认 `data/`，可由 UI 修改：

```text
data/
├── workspace.json            # 布局 sizes / 主题 / 当前皮肤名
└── skin/
    └── <skinName>/           # 一个皮肤就是一个目录，目录名即皮肤名
        ├── Body/             # 身体部件 PNG
        ├── Head/             # 头部部件 PNG
        └── layers/           # 工程文件（仅编辑器使用，mod 不读）
            └── <Cat>/<part>/
                ├── manifest.json
                └── layerN.png
```

mod 只读 `Body/` 与 `Head/` 下的扁平 PNG。`layers/` 是编辑器自管的工程文件，结构变化不影响 mod 加载，因此可以在不破坏运行期产物的前提下保留多图层信息。

启动时若 `data/` 缺失会被自动创建，并写入默认 `workspace.json`。若 `data/skin/` 下没有任何皮肤子目录，会把编译期内置的 `exp` 皮肤包展开到 `data/skin/exp/` 并自动选中。

## 开发与运行

### 环境

| 工具 | 版本 | 用途 |
| --- | --- | --- |
| Rust toolchain | 1.75+ | `cargo build` / `cargo test` |
| Node.js | 18+ | 前端构建 |
| npm | 随 Node 一起 | 依赖管理 |
| WebView2 Runtime | Win10 1809+ / Win11 自带 | Tauri 桌面壳 |
| Tauri CLI（可选） | `^2.0` | `cargo tauri dev` |

Linux 还需要 GTK / WebKitGTK 等系统包；macOS 需要最新 Xcode CLT。Windows 不需要装 MSVC 之外的额外组件。

### 安装依赖

```bash
cd web
npm install
cd ..
```

`web/node_modules/` 安装一次即可，后续 `cargo build` 会通过 `tauri.conf.json` 的 `beforeBuildCommand` 自动触发 `npm run build`，不需要手动重新装依赖。

### 启动桌面模式

开发期：

```bash
cargo run --manifest-path src-tauri/Cargo.toml --bin CasualtiesUnknown-SkinEditor
```

或者使用 Tauri CLI（带 hot-reload，需先在另一个终端跑 `npm --prefix web run dev`，并临时把 `tauri.conf.json` 的 `build.devUrl` 改回 `http://localhost:5173`）：

```bash
cargo install tauri-cli --version "^2.0"
cargo tauri dev --manifest-path src-tauri/Cargo.toml
```

注意：默认配置不挂 `devUrl`，桌面壳直接从嵌入资源加载。

### 启动 HTTP 模式

把同一份二进制以 server 形态运行：

```bash
cargo run --manifest-path src-tauri/Cargo.toml --bin CasualtiesUnknown-SkinEditor -- --http --bind 127.0.0.1 --port 5800
```

也可以走环境变量：`SPE_HTTP=1 SPE_BIND=0.0.0.0 SPE_PORT=5800`。

当前只测试了Windows，其他平台都为测试，网页未测试

### 测试与构建

```bash
# Rust 单元 + 集成 + property-based 测试
cargo test --manifest-path src-tauri/Cargo.toml

# 前端类型检查（不打包）
cd web && npm run test

# 前端打包（产物 web/dist/）
cd web && npm run build

# 桌面壳 release（前端会被自动 build 并嵌入）
cargo build --release --manifest-path src-tauri/Cargo.toml --bin CasualtiesUnknown-SkinEditor
```

release 产物：`src-tauri/target/release/CasualtiesUnknown-SkinEditor.exe`（Windows，约 15 MB，含内置 `exp` 皮肤包）。前端 bundle 与默认皮肤通过 `rust-embed` 编译期嵌入。

跨平台桌面包（在对应平台上执行）：

```bash
cargo tauri build --bundles msi        # Windows
cargo tauri build --bundles dmg        # macOS
cargo tauri build --bundles appimage   # Linux
```

### 运行目录

首次启动若工作目录下没有 `data/`，应用会创建 `data/workspace.json`；若 `data/skin/` 为空则自动展开内置 `exp` 皮肤。`data/` 始终相对 exe 所在目录（AppRoot）解析，与当前工作目录无关。把 exe 放到任意位置都可以，但要让它有写权限（无写权限会回退到只读模式，所有保存按钮静默失败，UI 不会自动恢复）

## 文档与规范

| 入口 | 内容 |
| --- | --- |
| [`docs/zh/README.md`](docs/zh/README.md) | 中文使用文档：导入皮肤包、编辑流程、导出、快捷键 |
| [`docs/en/README.md`](docs/en/README.md) | English user guide：import / edit / export / shortcuts |
| [`motionRecorder/README.md`](motionRecorder/README.md) | 动作捕捉 mod 说明：安装、抓取流程、JSON 字段 |
| [`motionRecorder/README.en.md`](motionRecorder/README.en.md) | MotionRecorder guide: install, capture flow, JSON schema |

## 预览说明

右侧预览区不只负责静态装配。它同时覆盖两种工作方式：

- 装配预览：按 `assembly.json` 和当前 UI 里的表情 / 头部状态实时合成
- 动画预览：按 MotionRecorder 写出的 `captures/` JSON 逐帧合成，并允许在同一帧上切换表情、头部和朝向，当前的发布包中，已打包了默认录取的动作动画

这些 JSON 由游戏内的 BepInEx mod MotionRecorder 生成：录制时逐帧采样当前 `Body.limbs[]`、匹配到的 `TailScript`、朝向和表情，停止时写到 `BepInEx/plugins/MotionRecorder/captures/`。两种模式共用同一套皮肤资源分发逻辑。动画模式下同样支持预览，表情，状态的切回。

## 许可

MIT
