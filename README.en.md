<!-- markdownlint-disable MD033 MD036 MD041 -->

<div align="center">

<p align="center">
  <a href="https://github.com/huanxin996"><img src="https://github.com/huanxin996.png" width="200" height="200" alt="huanxin996"></a>
</p>

# CasualtiesUnknown-SkinEditor

_✨ A standalone skin preview and pixel-level editor for the game `Casualties Unknown` ✨_

<p>
  <img src="https://img.shields.io/badge/version-1.0.5-blue.svg" alt="version">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="license">
  <img src="https://img.shields.io/badge/tauri-v2-FFC131?logo=tauri" alt="tauri">
  <img src="https://img.shields.io/badge/rust-1.75+-orange.svg?logo=rust" alt="rust">
  <img src="https://img.shields.io/badge/node-18+-brightgreen.svg?logo=node.js" alt="node">
  <img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="platform">
</p>

<p>
  <a href="README.md"><strong>中文项目说明</strong></a>
  ·
  <a href="docs/en/README.md"><strong>English User Guide</strong></a>
  ·
  <a href="changes.en.md"><strong>Changelog</strong></a>
</p>

<p>
  Skin mod repository:
  <a href="https://github.com/Paili-16/Scav-Prototype-The-Characters-Skins"><strong>Scav-Prototype-The-Characters-Skins</strong></a>
</p>

</div>

## Preview

<table>
  <tr>
    <td align="center" width="50%">
      <img src="https://raw.githubusercontent.com/huanxin996/CasualtiesUnknown-SkinEditor/main/docs/zh/images/main.png" alt="Chinese UI" width="100%">
      <br>
      <sub>Chinese UI</sub>
    </td>
    <td align="center" width="50%">
      <img src="https://raw.githubusercontent.com/huanxin996/CasualtiesUnknown-SkinEditor/main/docs/en/images/main.png" alt="English UI" width="100%">
      <br>
      <sub>English UI</sub>
    </td>
  </tr>
</table>

---

## Project Overview

This project is a standalone desktop application that turns the skin directory used by the game `Casualties Unknown` into a visual, editable project format, instead of forcing users to align PNG pixels and naming rules by hand.

## Architecture

### Two Forms, One Crate

```text
                        ┌──────────────────────────────┐
                        │  web/  (TypeScript + Vite)   │
                        │  Editor / Preview / Toolbar / i18n │
                        └─────────────┬────────────────┘
                                      │ build → web/dist/
                                      ▼
                        ┌──────────────────────────────┐
                        │ rust-embed (embedded at build time) │
                        │  frontend bundle + default exp skin │
                        └──────────────────────────────┘
                                      │
              ┌───────────────────────┼────────────────────────┐
              ▼                       ▼                        ▼
     ┌──────────────┐         ┌──────────────┐         ┌─────────────────┐
     │ Tauri desktop│         │ Axum HTTP svc│         │   apiLayer      │
     │ shell        │ ──────► │ /api/*       │ ──────► │ single source   │
     │ (WebView2)   │ Tauri   │ REST         │         │ of business logic│
     └──────────────┘ cmd     └──────────────┘         └─────────────────┘
                                                               │
                                                               ▼
                                                    skinLoader / imageOps /
                                                    layerSidecar / assemblyTable /
                                                    historyManager / windowManager
```

The desktop shell and the HTTP service are mutually exclusive startup paths, but both forward requests to the same set of business modules. The cost of this design is that the Rust backend must stay pure and must not depend on the Tauri runtime. The benefit is that any externally visible behavior only needs to be tested once to cover both entry points.

The 22 Tauri commands and the 22 HTTP REST routes mirror each other: command names and field names are identical, only the transport changes. On the frontend, `apiClient` dispatches to different transport implementations depending on the current mode, transparently to the caller.

### Backend Modules (`src-tauri/src/`)

| Module | Responsibility |
| --- | --- |
| `apiLayer` | Business-logic entrypoint; all mutating operations are serialized behind a single mutex, so conflicts resolve as natural last-write-wins |
| `skinLoader` | Scans skin roots, parses part files, imports and exports zip archives |
| `imageOps` | Per-layer pixel operations such as brush, eraser, gradient, flattening, and PNG encode/decode |
| `layerSidecar` | Persists multi-layer project data as `layers/<part>/manifest.json` plus `layerN.png` |
| `assemblyTable` | Part assembly table: z-order, coordinates, variants; falls back to built-in defaults when files are missing |
| `historyManager` | Ring-buffer undo/redo stack grouped by stroke rather than by pixel |
| `windowManager` | Serializes `workspace.json` (layout sizes, theme, current skin name) |
| `httpServer` | Axum routes; `rust-embed` asset serving plus JSON DTOs |
| `tauriCommands` | Tauri command adapter layer; shares DTOs with HTTP and converts `Result` into `tauri::Error` |

### Frontend Modules (`web/src/`)

The frontend is a single-page SPA. Child windows reuse the same bundle through URLs of the form `?panel=<id>` instead of building multiple entry bundles.

| Module | Responsibility |
| --- | --- |
| `apiClient` | Dispatches between Tauri and HTTP mode; runtime selection comes from `runtimeMode` |
| `stateStore` | Global store for skins, parts, layers, tools, undo stack, theme, language, dirty state |
| `dockHost` | Dockable / floating / collapsible panel container; also handles detach and reattach |
| `partPanel` / `editorCanvas` / `previewCanvas` / `layerPanel` | Four core panels; `previewCanvas` handles both part assembly preview and frame-by-frame motion preview |
| `colorPalette` / `toolPanel` | Color palette with eyedropper plus the toolbar |
| `closeGuard` | Dirty-state check and save prompt before the main window closes |
| `imageWindow` | Temporary child window for drag-in images that do not become part of the project |
| `layoutEngine` | Drag-resizable row/column sizes plus persistence into `workspace.json.sizes` |
| `i18n` / `themeSettings` / `langSettings` / `settingsPanel` | Bilingual dictionary, theme switching, language switching, shortcut editor |
| `shortcuts` | Global keyboard action router; automatically yields when focus is inside an input |

### Data Contract

The default data root is `data/`, and it can be changed from the UI:

```text
data/
├── workspace.json            # Layout sizes / theme / current skin
└── skin/
    └── <skinName>/           # One skin is one directory, and the directory name is the skin name
        ├── Body/             # Body-part PNGs
        ├── Head/             # Head-part PNGs
        └── layers/           # Project files used only by the editor, ignored by the mod
            └── <Cat>/<part>/
                ├── manifest.json
                └── layerN.png
```

The mod only reads the flat PNG files under `Body/` and `Head/`. The `layers/` directory is project data managed by the editor itself, so structural changes there do not affect what the mod loads and multi-layer information can be preserved without changing the runtime output.

If `data/` is missing at startup, the app creates it automatically and writes a default `workspace.json`. When `data/skin/` has no skin subdirectories, the built-in `exp` skin pack is unpacked to `data/skin/exp/` and selected automatically.

## Development and Running

### Environment

| Tool | Version | Purpose |
| --- | --- | --- |
| Rust toolchain | 1.75+ | `cargo build` / `cargo test` |
| Node.js | 18+ | Frontend build |
| npm | Bundled with Node | Dependency management |
| WebView2 Runtime | Built into Win11, available for Win10 1809+ | Tauri desktop shell |
| Tauri CLI (optional) | `^2.0` | `cargo tauri dev` |

Linux additionally needs GTK and WebKitGTK packages. macOS needs recent Xcode Command Line Tools. Windows does not require anything beyond the normal MSVC toolchain.

### Install Dependencies

```bash
cd web
npm install
cd ..
```

You only need to install `web/node_modules/` once. After that, `cargo build` triggers `npm run build` automatically through `tauri.conf.json`'s `beforeBuildCommand`, so you do not need to reinstall dependencies manually.

### Run Desktop Mode

During development:

```bash
cargo run --manifest-path src-tauri/Cargo.toml --bin CasualtiesUnknown-SkinEditor
```

Or use Tauri CLI with hot reload. In that case, start `npm --prefix web run dev` in another terminal first, and temporarily switch `tauri.conf.json`'s `build.devUrl` back to `http://localhost:5173`:

```bash
cargo install tauri-cli --version "^2.0"
cargo tauri dev --manifest-path src-tauri/Cargo.toml
```

Note: the default configuration does not use `devUrl`; the desktop shell loads directly from embedded assets.

### Run HTTP Mode

Run the same binary in server form:

```bash
cargo run --manifest-path src-tauri/Cargo.toml --bin CasualtiesUnknown-SkinEditor -- --http --bind 127.0.0.1 --port 5800
```

Environment variables are also supported: `SPE_HTTP=1 SPE_BIND=0.0.0.0 SPE_PORT=5800`.

Only Windows has been tested so far. Other desktop platforms and the web build are untested.

### Test and Build

```bash
# Rust unit + integration + property-based tests
cargo test --manifest-path src-tauri/Cargo.toml

# Frontend type-check only
cd web && npm run test

# Frontend build output goes to web/dist/
cd web && npm run build

# Desktop release build; the frontend is built and embedded automatically
cargo build --release --manifest-path src-tauri/Cargo.toml --bin CasualtiesUnknown-SkinEditor
```

Release artifact: `src-tauri/target/release/CasualtiesUnknown-SkinEditor.exe` on Windows, roughly 15 MB including the built-in `exp` skin pack. The frontend bundle and default skin are embedded at compile time via `rust-embed`.

Cross-platform desktop packaging, executed on the target platform:

```bash
cargo tauri build --bundles msi        # Windows
cargo tauri build --bundles dmg        # macOS
cargo tauri build --bundles appimage   # Linux
```

### Runtime Directory Behavior

On first launch, if `data/` is missing next to the exe, the app creates `data/workspace.json`; if `data/skin/` is empty it unpacks the built-in `exp` skin. `data/` is always resolved relative to the exe location (AppRoot), not the current working directory. You can place the exe anywhere, but it must have write permission. If it does not, the app falls back to read-only mode, save operations fail silently, and the UI does not recover automatically.

## Documentation

| Entry | Content |
| --- | --- |
| [`docs/zh/README.md`](docs/zh/README.md) | Chinese user guide: import skin packs, edit flow, export, shortcuts |
| [`docs/en/README.md`](docs/en/README.md) | English user guide: import, edit, export, shortcuts |
| [`motionRecorder/README.md`](motionRecorder/README.md) | Chinese MotionRecorder guide: install, capture flow, JSON schema |
| [`motionRecorder/README.en.md`](motionRecorder/README.en.md) | MotionRecorder guide: installation, capture flow, JSON schema |

## Preview Behavior

The right-side preview area does more than show a static composite. It supports two workflows:

- Assembly preview: composes the current skin in real time according to `assembly.json` plus the current expression and head-state settings in the UI.
- Motion preview: composites frames one by one from MotionRecorder JSON files under `captures/`, while still allowing expression, head, and facing changes on the active frame. The current release package already includes default captured motion data.

Those JSON files are produced by the in-game BepInEx mod MotionRecorder, which samples `Body.limbs[]`, the matched `TailScript`, facing, and expression on each recorded frame and writes the result to `BepInEx/plugins/MotionRecorder/captures/` when recording stops. Both modes share the same skin-resource dispatch path. Motion mode also supports previewing and switching expressions and states.

## License

MIT
