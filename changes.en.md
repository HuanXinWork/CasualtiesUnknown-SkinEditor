<!-- markdownlint-disable MD024 -->

# Changelog

> This document is a description of the update log. 中文版本：[`changes.md`](./changes.md)。

---

## 1.0.3 (2026-05-27)

### Added

- **Per-skin resolution config**: removed the 60-entry hardcoded size table; the editor now generates `<skin>/baseSizes.json` per skin from each PNG's actual pixel size. Created automatically on import, and back-filled at startup for older skins missing the file. Custom parts stay out of the table and render at disk resolution, so any resolution skin works out of the box.

### Improved

- **Import routing**: even when a flat zip dumps everything into a single `Body/` folder, parts like `HeadDefault` / `wingUL` / `eyeOpen` / `disfiguredHead0` now land in their real category. `classifyEntry` priority is flipped to "filename first"; the directory segment is only a fallback for unknown parts.
- **Legacy export blood**: in Legacy (Flat) format, `Blood/*.png` now flows into `<skinName>/Body/` along with everything else, matching the "all parts under Body" semantics. Categorized format still keeps a separate `Blood/` folder.
- **Empty character state**: `data/skin/` no longer auto-creates a `default/{Body,Head}/` skeleton; when no skin folder is present, the character pane shows "No character detected".

---

## 1.0.2 (2026-05-27)

### Added

- **Blood particle editor panel**: `bloodPanel` module visually edits all 14 fields of `<skin>/blood.json` (particle start/end color, size, lifetime, fade curve; limb dark/light wound colors; additive glow; sprite-sheet animation; random palette). Each field has an override tri-state toggle. Switching skin reloads the values.
- **Blood textures category**: new "Blood textures" group in the part panel listing `<skin>/Blood/*.png` (e.g. `BloodParticle.png`); editable in the canvas with resize support.
- **Custom swatches**: 3 rows × 8 = 24 user slots below the palette. Long-press or right-click opens an editor (HEX input / use current color / clear); auto-saved to workspace config.
- **Eyedropper drag mode**: hold the left mouse button after activating the dropper for live color preview; release to commit; Esc or right-click cancels.
- **Persistence expansion**: panel collapse states, recent colors (FIFO 12), custom swatches (24 slots), part panel group collapse states, editor canvas footer height (percent) all save to workspace config.
- **Export format options**: a selection dialog opens on export — pick "Legacy (`<skin>/Body` flat — all parts in one folder)" or "Categorized (`<skin>/Body, Head, Wings, Accessories`)", with an optional checkbox to include blood config (`blood.json` + `Blood/*.png`).
- **Filename-routed import**: PNGs in a zip without `Body/Head/...` subfolders are auto-routed by filename against the standard part table; filenames containing `blood` go to `Blood/`.
- **F/B suffix detection**: sided copies (`experimentEyeOpenF`, `HandB`, etc.) fall back to the base name when looking up standard sizes, preventing preview misalignment caused by resolution mismatch.

### Improved

- **Editor canvas**: footer height switched to a percentage (default 25%, 10–70% range); top divider is draggable; ratio is preserved across collapse / expand. Stage centering bug fixed — selected parts now load in the middle instead of stuck at the top.
- **Import/export semantics**: both formats wrap output under `<skin-name>/`; `blood.json` + `Blood/*.png` are gated by a separate `includeBlood` flag.
- **Palette feel**: hue ring widened from 18px to 28px (inner 48 / outer 76), SV box 88 → 96px. Dragging hue / SV no longer records into the recent-colors list every frame; only the final color on mouseup is recorded.
- **Picker precision**: pixel coordinates use `Math.round` instead of `Math.floor`, reducing sampling drift.
- **Accessory localization**: 27 accessory item IDs render in Chinese (`autopump` → 自动泵 etc.) under zh locale; `BloodParticle` shows as "血液粒子".
- **Mod runtime visuals**: `Body.SwitchDir` Harmony patch flips all `SpriteRenderer.sortingOrder`, fixing limb z-order when the character faces left; `PickUpItem` patch keeps newly picked-up items in sync with the current direction.

### Fixed

- Editor canvas collapse ▼ + expand caused layout breakage; footer would balloon upward.
- Selected part stuck at the top of stage with a large empty area below (broken flex centering).
- `baseSizes` migrated from per-skin `baseSizes.json` to a 60-entry code constant table; deleting the json no longer breaks composite preview alignment.
- Removed `BloodConfig.spritePath` field (mod always uses `Blood/BloodParticle.png` now).
- Re-expanding a collapsed dock previously dropped its `flex` style, disabling footer drag.
- Custom swatches were lost after restart (native `<input type=color>` doesn't open in Tauri).
- Several other persistence regressions across recent colors / custom swatches / collapse states.

---

## 1.0.1 (2026-05-25)

### Added

- **Higher-resolution support + resize**: the editor canvas and backend `baseSizes` lift the 64×64 limit and accept arbitrary resolutions; a "Resize" action lets you retarget a part's width × height with a chosen resampling algorithm.
- **Wing parts**: new Wings group in the part panel with four fixed sprites — `wingUL/wingUR/wingDL/wingDR.png`; the composite preview assembles them by `x / y / rotation / zOrder` from `wings.json`.
- **wings.json parser**: both the mod and the editor read `<skinName>/wings.json` to override the default assembly position; missing or malformed files fall back to defaults.
- **Import polishing**: `importSkinPack` accepts any well-formed skin zip and auto-strips a single wrapping directory; only file extension and path traversal are validated, filenames are case-insensitive.
- **Asymmetric skin creation**: derives an asymmetric copy from an existing skin directory; the editor mirrors single-sided PNGs to the other side and adds the F/B suffix.

### Improved

- Part list groups (Body / Head / Wings) are now collapsible.
- Toolbar export button now produces a clearer toast when zip contents are missing.
- Composite preview honors wings' `zOrder` and `rotation` during sort.
- Resizing a part rebuilds the layers project structure synchronously without losing layers.

### Fixed

- Occasional canvas offset on first load of high-resolution parts.
- Composite preview crashed (null pointer) when one of the four wings was missing.
- Zip top-level directory names containing spaces failed to extract.

---

## 1.0.0 (2026-05-18)

Initial release.

### Added

- **Desktop shell + HTTP dual mode**: the Tauri v2 desktop shell (portable exe) and the Axum HTTP service share one Rust crate; the desktop shell loads via `rust-embed` and the release binary depends on no external files on disk.
- **Skin directory management**: scans `data/skin/<skinName>/{Body,Head}/`; the skin dropdown auto-populates; a `default/{Body,Head}/` scaffold is created on first launch when `data/skin/` is empty.
- **Pixel editing toolset**: pan / brush / gradient / eraser; brush size 1–64; per-stroke undo & redo; 50-entry history ring.
- **Multi-layer**: up to 8 layers per part with visibility / opacity / reorder / delete; saving writes `<skinName>/layers/<Cat>/<part>/manifest.json` and one `layerN.png` per layer.
- **Color palette**: HSV color wheel + value slider, current color preview, PS-style eyedropper, 8-slot recent colors.
- **Composite preview (assembly)**: live 100×100 composite from `assembly.json` plus the current expression / head / facing parameters; live preview can be toggled off in favor of manual refresh.
- **Composite preview (motion)**: reads MotionRecorder JSON files written by the in-game BepInEx mod from `captures/` and composites frame by frame; play / pause / frame slider; expression / head / facing can still be changed on the active frame and re-renders immediately.
- **Skin pack import / export**: `importSkinPack` accepts zips (top-level `Body/`/`Head/`, optionally one wrapper directory); export packages the skin with a `<skinName>/{Body,Head}/` top-level layout.
- **Draggable dock layout**: the six panels (parts / tools / editor / layers / preview / palette) can be moved between dock hosts; out-of-viewport drops or right-click menu detach to a standalone child window.
- **i18n + theme**: zh / en switch; every shortcut can be rebound from the settings panel.
- **Unsaved-confirm**: closing the main window with any unsaved part shows a "Save and exit / Don't save / Cancel" dialog.

### Improved

- WebView2 forced to the light color scheme (`color-scheme: light` declared in two places) so Windows dark mode does not paint the empty background black and confuse users into thinking loading failed.
- Release build suppresses the cmd black window (`windows_subsystem = "windows"`).
- Self-drawn icon set: 6-size ICO + 256 PNG.
