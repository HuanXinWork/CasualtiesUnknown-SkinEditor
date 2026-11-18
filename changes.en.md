<!-- markdownlint-disable MD024 -->

# Changelog

中文版本：[`changes.md`](./changes.md)

---

## 1.0.8 (2026-11-18)

### Added and Changed

- Added the zone brush and per-zone effect editor (up to 255 zones per part with radial/directional/scatter 2D lights, dual-color gradients, breathing pulses, 5 particle modes, and frame animations), plus 19 worn-slot bindings and `R_` right-facing sprite support across all 42 accessories.
- Added the 8th facial expression ("Locked in" / `experimentEyeLockedIn`), `BloodParticle_splat`, and full part-name support for `exp`, `milky`, and `dune` naming conventions.
- Aligned `baseSizes.json` serialization to the `{ "entries": { ... } }` envelope expected by `SkinSync`, and updated built-in accessory metadata to `requireWornSlot` with `HandB`/`FootB` `secondaryLimbs` for paired gear.

### Fixed

- Serialized `workspace.json` writes through a single in-memory snapshot and added the 5 missing backend `WorkspaceSettings` fields so concurrent updates from dividers, swatches, theme, and settings no longer overwrite each other.
- Serialized canvas brush IPC calls with Bresenham line interpolation to eliminate skipped pixels during fast strokes, and cleared stuck gradient drags on window blur.
- Discarded in-memory backend sessions when choosing "Don't save" on part switch, and added revision-checked dirty tracking so background saves do not clear newer edits.
- Corrected flipped left/right facing and `R_` texture selection in the preview canvas, seeded initial assembly coordinates, and normalized cross-character part names for `Shift`+drag positioning.
- Fixed high-DPI coordinate drift and transparent-overlay black sampling in the eyedropper, and adapted borders and highlights for dark themes.
- Included `*.zones.json` and `baseSizes.json` in zip import/export, routed `*.zones.*` files into their matching part category folders, switched file writes to atomic temp-file replacement, and hardened zip extraction against path traversal and oversized entries.
- Updated `MotionRecorder` (`1.0.2`) to read `Body.isRight`, bind `PlayerCamera.main.body` and `Body.tail` directly, subtract paused duration from frame timestamps, and detect `SkinSync` fluid-tail `MeshRenderer` components.

---

## 1.0.7 (2026-06-17)

### Added and Changed

- Automatically creates the `captures/` directory next to the executable the first time motion captures are listed, so you can drop `motion_*.json` files from `MotionRecorder` straight in and refresh (issue #4).

---

## 1.0.6 (2026-06-06)

### Added and Changed

- Embedded the default `exp` skin pack into the binary via `rust-embed`. When `data/skin/` is empty on first launch, it unpacks to `data/skin/exp/` (including Body, Head, Wings, Accessories, Blood, and `accessories.json`) and selects it automatically.
- Anchored relative paths such as `data/skin` to the executable directory (AppRoot) so launching from any working directory resolves files consistently.

---

## 1.0.5 (2026-05-31)

### Added and Changed

- Holding `Alt` with the brush, soft brush, or eraser temporarily switches to the canvas eyedropper and restores the previous tool on release.
- Added the 4-connected flood-fill bucket and the feathered soft brush (without intra-stroke darkening; double-click the tool icon to set `0%`–`100%` hardness).
- Added non-destructive layer flip, scale, and rotation controls in the canvas footer with live character preview feedback before baking into pixels.
- Added timed auto-save (minimum 10s, default 60s) and configurable unsaved-switch behavior (ask, auto-save, or discard) in Settings.
- Added right-click part copy (including layers) and part deletion in the part browser, plus cross-part single-layer copy and paste in the layer strip.
- Filtered already-created variants out of the add-part dialog and hid the add button once a category is complete.

---

## 1.0.4 (2026-05-28)

### Added and Changed

- Added shrink presets (`0.25×`, `0.5×`, `0.75×`), enlarge presets (`1×`–`4×`), and custom scale factors (`0.01`–`1000`, clamped to `1`–`4096` px) to the resize dialog.
- Added a confirmation warning when resizing a part below its registered dimensions in `<skin>/baseSizes.json`.
- Expanded the GitHub Actions workflow to build multi-platform release archives.

---

## 1.0.3 (2026-05-27)

### Added and Changed

- Replaced the hardcoded 60-entry size table with per-skin `<skin>/baseSizes.json`, generated automatically on import and backfilled at startup for existing skins.
- Prioritized filename matching over folder segments during zip import so flat packs inside `Body/` still route heads, eyes, wings, accessories, and blood textures into their real categories.
- Routed `Blood/*.png` into `<skinName>/Body/` when exporting legacy flat zips with blood enabled, while keeping a dedicated `Blood/` folder in categorized exports.
- Stopped generating an empty `default/` skeleton when `data/skin/` has no skins.

---

## 1.0.2 (2026-05-27)

### Added and Changed

- Added the `bloodPanel` editor for `<skin>/blood.json` (particle colors, size, lifetime, fade curve, limb wound colors, additive glow, sheet animation, and random palette) and the *Blood textures* category in the part browser.
- Added 24 custom swatch slots below the palette (right-click or long-press to edit HEX) and drag-to-preview sampling in the eyedropper.
- Added categorized vs. legacy flat format selection and an *Include blood* toggle when exporting zip packs.
- Persisted panel collapse states, recent colors, custom swatches, category collapse states, and canvas footer height in `workspace.json`.
- Widened the HSV wheel and SV square, added Chinese translations for standard accessories, and supported base-size lookup for `*F`/`*B` sided variants.

### Fixed

- Fixed layout stretching, top-stuck sprites, and broken footer dividers after collapsing and re-expanding panels.
- Fixed preview alignment errors when `baseSizes.json` or individual wing sprites were missing.
- Fixed custom swatches and collapse states failing to persist across restarts.

---

## 1.0.1 (2026-05-25)

### Added and Changed

- Lifted the `64×64` canvas limit to support arbitrary resolutions and layer-preserving resizing.
- Added the `Wings` category (`wingUL`, `wingUR`, `wingDL`, `wingDR`) and `<skin>/wings.json` overrides.
- Added front/back (`F`/`B`) variant creation and single-wrapper-folder stripping during zip import.

### Fixed

- Fixed initial canvas offset on high-res parts, crashes when a wing texture was missing, and zip extraction failures on folder names containing spaces.

---

## 1.0.0 (2026-05-18)

Initial release:
- Single Rust crate powering both the portable Tauri v2 desktop app (with embedded assets) and the Axum HTTP server.
- Pixel brush, linear gradient, eraser, viewport pan, 50-step stroke undo/redo stack, and up to 8 layers per part.
- 100×100 character preview with static assembly mode and `MotionRecorder` per-frame playback mode.
- `.zip` skin pack import/export, dockable and detachable panels, Chinese/English UI, customizable shortcuts, and unsaved-exit confirmation.
