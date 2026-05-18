<!-- markdownlint-disable MD033 MD036 MD041 -->

# CasualtiesUnknown-SkinEditor — User Guide

This document focuses on how to use the editor. For build and development details, see the repository [README.md](../../README.md). The repository overview is also available in English at [README.en.md](../../README.en.md).

---

## 1. Skin Package Layout

The mod `body_sprite_replacer` reads two fixed subdirectories from each skin folder: `Body/` and `Head/`. They hold the body and head PNG parts respectively. The editor adds a `layers/` directory next to them, used only by the editor itself to preserve multi-layer state.

```text
data/
├── workspace.json            # Layout / theme / current skin (auto-created at first launch)
└── skin/
    └── <skinName>/           # One skin = one directory; the directory name is the skin name
        ├── Body/             # Body parts as flat PNG (read by the mod)
        ├── Head/             # Head parts as flat PNG (read by the mod)
        └── layers/           # Editor project files; the mod ignores this folder entirely
            └── <Cat>/<part>/
                ├── manifest.json
                └── layerN.png
```

The mod only reads the flat PNG files under `Body/` and `Head/`. `layers/` is extra project data maintained by the editor so it can preserve undo state and layer structure.

## 2. First Launch

Double-click the release exe, or run from a development build. On first launch the editor does two things:

1. Creates `data/workspace.json` in the working directory with the default layout and theme.
2. If `data/skin/` is empty, scaffolds an empty `data/skin/default/{Body,Head}/` so the part list is not silently broken.

After launch the window has a top toolbar, a part list on the left, the editor canvas in the middle, a layer strip at the bottom, the composite preview on the right, and the color palette farthest right.

![Main window](images/main.png)

If `data/skin/` already contains skin directories, the skin dropdown at the top-left auto-populates. Otherwise the dropdown only shows the empty `default` placeholder and you have to import a zip or drop a directory in.

## 3. Importing a Skin Pack

### 3.1 Zip layout

The importer accepts either of the following shapes:

```text
Form A (preferred):
my-skin.zip
├── Body/
│   ├── body.png
│   └── ...
└── Head/
    ├── head.png
    └── ...

Form B (one wrapping directory is also accepted):
my-skin.zip
└── arbitrary-name/
    ├── Body/...
    └── Head/...
```

Validation:

- The file extension must be `.png`.
- Paths must not contain `..` or absolute path fragments.

The importer creates a new skin directory using the **zip file name without the `.zip` extension**, landing under `data/skin/<zipName>/`. If the directory already exists, the PNGs inside are overwritten, but the existing `layers/` project files are left untouched.

### 3.2 Doing the import

The import button on the toolbar opens the OS file dialog.

![Toolbar import button](images/toolbarImport.png)

After picking the file you get a toast:

- Green: import succeeded; the count in parentheses is how many parts landed.
- Yellow: import completed but `imported=0`. Usually means the zip layout does not match the rules above.
- Red: import failed. The text is prefixed with `importSkinPack:` followed by the actual error code.

On success the skin dropdown switches to the newly imported skin.

![Successful import](images/importSuccess.png)

### 3.3 Importing without the UI

If you just want to drop in a few skin folders, copy them into `data/skin/<skinName>/` directly. The skin dropdown picks them up after a refresh or restart. This path skips all validation; non-PNG files in the directory cause no error but are not used either.

## 4. Editing Workflow

### 4.1 Selecting a part

The left panel groups parts by Skin → Category → Part. Click a part to load its PNG into the central canvas. The canvas title bar shows a saved badge: green for clean, yellow for unsaved.

![Part selected](images/partSelected.png)

Part names render through a localization map (e.g. `experimentBody` shows up as "Body"). The backend identifier is still the raw file name, so renaming a PNG does not break existing project files but will be treated as a new part.

### 4.2 Toolbar

Toolbar groups, left to right:

| Group | Buttons | Purpose |
| --- | --- | --- |
| Tools | Pan / Brush / Gradient / Eraser | Mouse behavior on the canvas |
| Brush size | Numeric input | Brush and eraser size in pixels (1–64) |
| History | Undo / Redo / History | Per-stroke undo; the history popover is read-only, no jumping |
| Files | Export / Import / Save | Whole-skin export & import + current-part save |
| Settings | Language / Theme / Settings / Reset layout | Language toggle / theme color / shortcut editor / restore default layout |

![Full toolbar](images/toolbarFull.png)

### 4.3 Pixel editing

- **Brush**: mouse-down starts a stroke, drag to draw, release commits one history entry (not one per pixel).
- **Eraser**: same shape as the brush, but clears to fully transparent.
- **Gradient**: mouse-down picks the start point, drag picks the end point, release applies. The gradient runs from the current color to fully transparent.
- **Pan**: drags the view inside the canvas without touching pixels.

Undo and redo are stroke-grouped, so continuous painting does not blow up the undo stack. The history is a 50-entry ring; older entries are dropped once the limit is hit.

### 4.4 Layers

The bottom strip shows up to 8 layers for the current part. Each layer can:

- Toggle visibility (eye icon)
- Adjust opacity (0–100% slider)
- Reorder by drag
- Delete (deleting the last remaining layer is rejected)

New layers land on top of the active layer. Saving the part writes layer data to `layers/<Cat>/<part>/manifest.json` and one `layerN.png` per layer.

![Layer strip](images/layerPanel.png)

### 4.5 Color palette

The right-most palette offers:

- HSV color wheel with a value slider
- Current color preview and an eyedropper button (PS-style picker)
- 8 most-recent colors

Activating the eyedropper turns the cursor into a dropper. It picks colors from the editor canvas, the composite preview, and any drag-in image window — anywhere within this app's webview. The color updates live as the cursor moves; click to commit into "recent", press Esc to cancel and restore the previous color.

![Color palette](images/colorPalette.png)

### 4.6 Composite preview

The right preview area has two modes:

- **Assembly**: composes every visible part of the current skin from the assembly table, in z-order
- **Motion**: reads MotionRecorder JSON files from `captures/` and composites the skin frame by frame

Those JSON files are not recorded by the editor itself. They come from the in-game BepInEx mod MotionRecorder. Installation and field details are documented in [motionRecorder/README.en.md](../../motionRecorder/README.en.md).

Assembly mode has live preview on by default, so every committed stroke triggers a new composite. If performance is poor, turn off live preview and use the refresh button instead. Motion mode uses the same toggle: when live preview is enabled, the current frame also picks up unsaved in-memory layer edits immediately; when it is off, the frame stays stale until you hit the refresh button.

In motion mode the toolbar grows a small capture control group:

- a capture picker listing the JSON files under `captures/`
- a play / pause button
- a frame slider for jumping to any frame directly

While playback is running, the preview advances along the capture timeline. When paused, you can inspect a single frame against the real pose data. The "Current frame limbs" panel on the right lists each limb's name, coordinates, rotation, and z-order for the active frame; the panel itself can be hidden from settings, and the bottom preview info area can be resized by dragging its divider.

Expression, head variant, and facing controls stay active in motion mode. Changing them immediately re-composites the current captured frame, which makes it practical to compare different heads and eye states against the same recorded motion.

Switching skins ignores the live-preview toggle and forces one refresh, to avoid mismatched visuals.

## 5. Saving and Exporting

### 5.1 Saving the current part

The save button on the toolbar writes two things:

1. The flattened composite to `<skinName>/{Body|Head}/<part>.png` (this is what the mod reads)
2. The multi-layer project data to `<skinName>/layers/<Cat>/<part>/manifest.json` plus one `layerN.png` per layer

If a write fails (most often because the disk is read-only or permissions are missing), a red toast surfaces the error and the unsaved badge stays. Hitting save again retries. Failures while writing the `layers/` sidecar are logged to stderr but never block the main PNG from landing.

A part with unsaved changes shows a yellow badge in the title bar. Closing the main window while any part is unsaved triggers a confirmation dialog:

- **Save and exit**: bulk-saves every unsaved part, then exits
- **Don't save**: exits immediately, dropping changes
- **Cancel**: stays in the program

### 5.2 Exporting the whole skin

The export button packages the current skin into a zip. The zip's top level is `Body/` and `Head/`, with no wrapper directory:

```text
<skinName>.zip
├── Body/...
└── Head/...
```

Export contains **only the flat PNGs the mod needs**; `layers/` project data is intentionally left out. The cost is that re-importing the export on another machine loses layer history; the benefit is that you can hand the zip directly to mod users without post-processing.

If you need to migrate project files too, copy the entire `data/skin/<skinName>/` directory by hand.

### 5.3 Switching the data root

By default the editor treats `data/` next to the exe as the data root. To point it elsewhere (for example, edit the skin folder inside the mod install), change the skin path from the settings panel — the change is persisted to `workspace.json` and survives restarts.

Switching the path does not migrate in-flight edits; any unsaved part is dropped.

## 6. Shortcuts

The defaults below can all be rebound from the settings panel.

| Action | Default |
| --- | --- |
| Undo | Ctrl+Z |
| Redo | Ctrl+Y / Ctrl+Shift+Z |
| Save current part | Ctrl+S |
| Tool: Pan | H |
| Tool: Brush | B |
| Tool: Gradient | G |
| Tool: Eraser | E |
| Brush size +1 | ] |
| Brush size -1 | [ |

Global shortcuts step aside automatically while focus is in any text input (`input`, `textarea`, `contenteditable`), so they will not interfere with typing.

In the settings panel, click a row's key cell to record a new binding. Per-row reset and full reset are both supported.

![Settings panel](images/settingsPanel.png)

## 7. Troubleshooting

| Symptom | Likely cause | What to try |
| --- | --- | --- |
| Window opens to a blank dark page | Windows is in dark mode and WebView2 paints the empty background black | The frontend pins `color-scheme: light`; if it still happens, reinstall the WebView2 Runtime |
| Part list is empty | `data/skin/` has no `<skinName>/{Body,Head}/` structure | Import a zip, or drop a directory into `data/skin/` directly |
| Import shows `imported=0` | The zip has no `Body/` or `Head/` folder inside | Re-check the layout against the rules in section 3.1 |
| Saved a part but the mod still shows the old texture | The mod caches textures during play | Restart the game, or use whatever hot-reload path the mod exposes |
| Eyedropper does nothing in a drag-in image window | The dropper is off, or the window is not part of this app | The dropper only works inside this app's webviews; cross-process screen picking is not supported |
| Save dialog keeps coming back when closing | At least one part is still marked unsaved | Pick "Save and exit" or "Don't save"; "Cancel" keeps you in the app |

For anything not listed, the red toast usually starts with the API name (for example `importSkinPack:` or `savePart:`). Use that prefix when filing a GitHub issue.

## 8. References

- Repository overview, build commands, and module list: [Root README](../../README.md)
