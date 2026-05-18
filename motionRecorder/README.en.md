# MotionRecorder

MotionRecorder is a small BepInEx mod used alongside CasualtiesUnknown-SkinEditor.

Its job is simple: record the player's limb transforms frame by frame during gameplay, then write the result as a JSON file when recording stops. The editor's motion preview reads that JSON.

If you only want to replace skins, you do not need this mod.

## 1. What It Captures

While recording, the mod samples the current character once per Update and stores the parts that matter for reconstruction:

- local position, rotation, and scale for each entry in `Body.limbs[]`
- sorting order and visibility from each limb's `SpriteRenderer`
- the character's facing direction
- the current facial expression index
- a `TailScript` sample when a matching tail object exists
- the sprite's visual center and basic metadata for later assembly checks

It does not change gameplay, write save data, or push anything back into the character. It only reads runtime state and writes one JSON file at the end.

## 2. How Motion Capture Works

The capture flow is straightforward:

1. Press `F9`, or click the floating button in the lower-left corner, to start recording.
2. The mod looks for the first active `Body` whose `limbs` array is not empty. In normal play, that is usually the player.
3. While recording, it samples one frame on every `Update()`. If the game is paused and `Time.timeScale == 0`, that frame is skipped.
4. For each limb, it records `transform.localPosition`, `localEulerAngles.z`, and `localScale`, then reads `sortingOrder`, visibility, sprite name, pivot, size, and the sprite's visual center from `SpriteRenderer.bounds.center` converted back into Body-local coordinates.
5. The tail is not part of `Body.limbs[]`, so the mod separately looks for the nearest active `TailScript`. If it finds one, it appends a record named `Tail`.
6. Facial expression is not read from an exposed state-machine field. Instead, the mod compares the current eye sprite against `eyeList[]` and writes the matching index. If no match is found, it writes `-1`.
7. Press `F9` again, or click the button again, to stop. The mod writes the whole capture to `BepInEx/plugins/MotionRecorder/captures/`.

So the editor's motion preview is not replaying the game directly. It is reading this per-frame JSON and recompositing the current skin on top of the captured pose data.

## 3. Output Location

Each start-to-stop session produces one new file:

```text
<game folder>/BepInEx/plugins/MotionRecorder/captures/
└── motion_<local timestamp>_<player name>.json
```

The player name is sanitized before writing, so spaces and invalid filename characters are replaced with underscores.

## 4. JSON Structure

Top-level fields:

| Field | Meaning |
| --- | --- |
| `version` | schema version; currently `3` |
| `modVersion` | MotionRecorder version used for this capture |
| `startedAtUnixMs` | local Unix timestamp in milliseconds when recording began |
| `playerName` | `GameObject.name` of the recorded target |
| `frameCount` | total number of captured frames |
| `frames[]` | per-frame samples |

Each `frames[i]` entry:

| Field | Meaning |
| --- | --- |
| `t` | seconds since the start of the recording, based on `Time.unscaledTime` |
| `isRight` | `true` when `Body.transform.localScale.x >= 0` |
| `expression` | current facial-expression index, or `-1` if lookup fails |
| `limbs[]` | part list for the frame; comes from `Body.limbs[]`, with tail appended separately |

Each `limbs[i]` entry:

| Field | Meaning |
| --- | --- |
| `name` | limb name; tail is always `Tail` |
| `limbNum` | index in `Body.limbs[]`; tail uses `-1` |
| `px / py / pz` | `transform.localPosition` in Unity units |
| `rotZ` | `transform.localEulerAngles.z`, from 0 to 360 degrees |
| `scaleX / scaleY` | `transform.localScale.x/y` |
| `sortingOrder` | `SpriteRenderer.sortingOrder` |
| `visible` | `SpriteRenderer.enabled && gameObject.activeInHierarchy` |
| `bcx / bcy` | sprite visual center from `SpriteRenderer.bounds.center`, converted into Body-local coordinates |
| `spriteName` | current sprite name, useful for checking which asset was actually used |
| `pivotU / pivotV` | normalized sprite pivot, typically in the range 0 to 1 |
| `spriteW / spriteH` | sprite rect width and height in pixels |

## 5. How the Editor Uses It

The editor's motion mode reads this JSON directly.

- limb position, rotation, facing, and sorting are reused to assemble the current skin for each frame
- unsaved in-memory layer edits can still participate in the frame composite before the PNG is written to disk
- expression, head variant, and facing can still be changed in preview because the editor recomposites from captured pose data instead of replaying screenshots

If you are using the capture to fill the assembly table, the coordinate conversion is:

```text
assembly.position = round(limb.px * 8), round(-limb.py * 8)
```

The Y axis is negated because the editor canvas grows downward, while Unity local Y grows upward.

## 6. Installation

1. Install BepInEx 5 (x64, Mono) into the game folder and launch the game once so `BepInEx/plugins/` is created.
2. Build this project with the .NET 8 SDK:

   ```bash
   cd motionRecorder
   dotnet build -c Release
   ```

3. Copy the output `bin/Release/MotionRecorder.dll` to:

   ```text
   <game folder>/BepInEx/plugins/MotionRecorder/MotionRecorder.dll
   ```

4. Launch the game. If `BepInEx/LogOutput.log` contains `MotionRecorder ready`, the mod loaded correctly.

The game, Unity, and BepInEx DLLs required for local builds are not committed to the repository. Copy them into `motionRecorder/references/` yourself. The exact list is documented in `references/README.md`.

## 7. Usage

There are two ways to control recording in game:

- `F9`: start / stop recording
- the floating button in the lower-left corner: start / stop recording

While recording, the lower-left overlay shows a red status line: `REC mm:ss.xxx · NNN frames`.

After stopping, the overlay returns to idle and the save path is written to the log. Every recording session creates a new file, and filenames remain unique even when you record multiple times within the same second because milliseconds are included.

## 8. Known Limits

- The mod only records one `Body`, using the first active object whose `limbs` array is not empty. That is usually good enough, but it is not a hard guarantee in scenes with multiple valid bodies.
- There is no interpolation. Sampling frequency is exactly the game's `Update()` frequency.
- Paused gameplay is skipped to avoid writing a long run of duplicate frames.
- Animator internal state is not captured. Only the final limb transforms visible on that frame are recorded. If you need the internal state of `bodyAnimator` or `armsAnimator`, this JSON alone is not enough.
- Uninstalling the mod leaves no state inside the game. Only the JSON files you already recorded remain on disk.
