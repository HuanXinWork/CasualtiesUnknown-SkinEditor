# MotionRecorder

`MotionRecorder` is a small BepInEx 5 plugin paired with `CasualtiesUnknown-SkinEditor`. During gameplay it records the player character's limb, tail, and wing transforms on each frame and writes them to a standalone JSON file when you stop recording. The skin editor's *Motion* preview reads those files to replay real movement under whatever skin you are painting.

If you only edit static skins or already have capture files, you do not need to install this plugin.

## 1. Output File and JSON Schema

Each start-to-stop session writes a new file (millisecond timestamps prevent collisions):

```text
<game folder>/BepInEx/plugins/MotionRecorder/captures/
└── motion_<local timestamp>_<player name>.json
```

Copy the generated `.json` file into the `captures/` folder next to the skin editor executable to use it in *Motion* mode.

Top-level fields:

| Field | Meaning |
| --- | --- |
| `version` | Schema version, currently `3` |
| `modVersion` | `MotionRecorder` version that wrote the file |
| `startedAtUnixMs` | Unix timestamp in milliseconds when recording started |
| `playerName` | `GameObject.name` of the recorded `Body` |
| `frameCount` | Total number of recorded frames |
| `frames[]` | Time-ordered list of frame samples |

Per-frame `frames[i]` fields:

| Field | Meaning |
| --- | --- |
| `t` | Elapsed recording time in seconds (time spent while the game is paused is subtracted automatically) |
| `isRight` | Whether the character is facing right (`Body.isRight`) |
| `expression` | Index of the active eye sprite in `FacialExpression.eyeList`, or `-1` if unmatched |
| `limbs[]` | Sampled parts for this frame: `Body.limbs[]`, `Tail`, and the four `SkinSync` wings |

Per-part `limbs[i]` fields (17 fields):

| Field | Meaning |
| --- | --- |
| `name` | Part name; `Tail` for the tail, and `wingUL` / `wingUR` / `wingDL` / `wingDR` for wings |
| `limbNum` | Index in `Body.limbs[]`; `-1` for `Tail`, and `-10` through `-13` for the four wings |
| `px` / `py` / `pz` | `Transform.localPosition` in Unity units (`1` unit = `8` editor pixels) |
| `rotZ` | Z rotation in degrees (`0`–`360`; local rotation for direct limbs, world Z rotation for nested tail/wings) |
| `scaleX` / `scaleY` | `Transform.localScale.x` and `y` |
| `sortingOrder` | Active renderer's `sortingOrder` |
| `visible` | Whether the object is active and its `SpriteRenderer` (or `SkinSync` fluid-tail `MeshRenderer`) is enabled |
| `bcx` / `bcy` | Renderer `bounds.center` converted back into `Body`-local space, used to place the tail and wings accurately |
| `spriteName` | Current `Sprite.name` |
| `pivotU` / `pivotV` | Normalized sprite pivot (`0`–`1`) |
| `spriteW` / `spriteH` | Sprite rect width and height in pixels |

Converting `Body`-local coordinates to the editor's `100×100` stage (where canvas Y grows downward and Unity local Y grows upward):

```text
x = round(px * 8)
y = round(-py * 8)
```

## 2. Building and Installation

1. Install BepInEx 5 (x64 Mono) into the game directory and launch the game once so `BepInEx/plugins/` is created.
2. Copy the 7 reference DLLs listed in `references/README.md` from your local game folder into `motionRecorder/references/` (ignored by git).
3. Build the plugin with the .NET SDK:

   ```bash
   cd motionRecorder
   dotnet build -c Release
   ```

4. Copy `bin/Release/MotionRecorder.dll` to `<game folder>/BepInEx/plugins/MotionRecorder/MotionRecorder.dll`.
5. Launch the game and check `BepInEx/LogOutput.log` for `MotionRecorder ready`.

## 3. In-Game Controls

Once inside an active game world (the overlay stays hidden on the main menu and loading screens):

- **`F9`**: start recording (ignored if already recording).
- **`F10`**: stop recording and write the JSON file to `captures/`.
- **`F8`**: toggle the settings window to rebind the start/stop keys (`Esc` cancels key capture) or hide the lower-left overlay.
- **Lower-left button**: click to start or stop recording with the mouse.

Keybindings and overlay visibility are saved to `<game folder>/BepInEx/config/com.casualtiesUnknown.motionRecorder.cfg`.

## 4. Sampling Notes

- Targets `PlayerCamera.main.body` and `Body.tail` directly, falling back to scene lookup only if camera references are unavailable, with a hierarchy and 3-unit distance guard so severed tails never bind to distant NPCs.
- Samples once per `Update()` without interpolation. While paused (`Time.timeScale <= 0`), frame capture pauses and paused wall-clock time is subtracted so playback stays continuous.
- Read-only at runtime: gameplay state and save files are never modified, and if the component is disabled mid-recording, captured frames are flushed automatically.
