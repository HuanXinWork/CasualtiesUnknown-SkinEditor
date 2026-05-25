# MotionRecorder — 角色动作捕捉 mod

把游戏里玩家角色每一帧的 `Limb` 变换（局部坐标 / 旋转 / 排序 / 可见性 / 朝向 / 表情索引）写成一份独立的 JSON 文件，作为本编辑器装配表与动画分析的数据源。

它不打日志、不修改游戏行为；产出落到 mod 自己的目录，每按一次"开始 → 停止"生成一份新文件。

## 1. 目标读者

- 想用真实运行数据填充 `assemblyTable.defaultAssembly` 的开发者
- 想给皮肤编辑器后续加帧动画预览的人

如果只是用编辑器替换皮肤，不需要装这个 mod。

## 2. 数据形态

每次录制写一份独立 JSON：

```text
<游戏目录>/BepInEx/plugins/MotionRecorder/captures/
└── motion_<本地时间戳>_<玩家名>.json
```

JSON 字段：

| 字段 | 含义 |
| --- | --- |
| `version` | schema 版本，目前是 `3` |
| `modVersion` | 录制时 mod 自身版本 |
| `startedAtUnixMs` | 录制开始的本地 Unix 毫秒（仅用于排序，不做时区还原） |
| `playerName` | 录制对象 GameObject 的 name |
| `frameCount` | 总帧数 |
| `frames[]` | 每帧采样：见下表 |

每帧 `frames[i]`：

| 字段 | 含义 |
| --- | --- |
| `t` | 距录制起点的秒数 |
| `isRight` | `Body.transform.localScale.x > 0` 时 true，等价于 Limb 装配表里 `flipX = false` |
| `expression` | 当前 `FacialExpression.eyeIndex`，与游戏 `eyeList[]` 索引一致 |
| `limbs[]` | 数组。前 15 条对应 `Body.limbs[i]`；找到 `TailScript` 时会额外追加一条 `Tail` |

每条 `limbs[i]`：

| 字段 | 含义 |
| --- | --- |
| `name` | Limb 逻辑名；尾巴固定写 `Tail` |
| `limbNum` | `Body.LimbNum` 枚举数值；尾巴固定写 `-1` |
| `px / py / pz` | `transform.localPosition`，Unity 单位（× 8 即编辑器像素） |
| `rotZ` | `transform.localEulerAngles.z`，0–360 度 |
| `scaleX / scaleY` | `transform.localScale.{x,y}`，多数情况下为 1 |
| `sortingOrder` | `SpriteRenderer.sortingOrder` |
| `visible` | `SpriteRenderer.enabled && gameObject.activeInHierarchy` |

尾巴样本补充说明：

- `name = "Tail"`
- `spriteName` 一般为 `experimentTail`
- 它不在 `Body.limbs[]` 里，而是来自独立的 `TailScript`

## 3. 安装

1. 安装 BepInEx 5（x64，Mono）到游戏目录，先启动一次让它生成 `BepInEx/plugins/`。
2. 用 dotnet 8 SDK 构建本 mod：

   ```bash
   cd mods/motionRecorder
   dotnet build -c Release
   ```

3. 把产物 `bin/Release/MotionRecorder.dll` 拷到 `<游戏目录>/BepInEx/plugins/MotionRecorder/MotionRecorder.dll`。
4. 启动游戏。`BepInEx/LogOutput.log` 末尾会出现 `MotionRecorder ready`。

构建依赖的游戏 / Unity / BepInEx DLL 需要从你本地 `<游戏目录>/BepInEx/core/` 与 `<游戏目录>/CasualtiesUnknown_Data/Managed/` 拷贝到本目录的 `references/` 下，路径已被 `.gitignore` 忽略，不会进仓库。具体清单见 `references/README.md`。

## 4. 使用

进游戏后任意场景里：

- **开始录制（默认 F9）/ 停止录制（默认 F10）**：两个独立按键，避免误触把"停"当"开"。
- **设置面板（默认 F8）**：屏幕中浮窗，可热改两个录制按键、开关左下角浮动 UI。
- **左下角浮动按钮**：「开始录制 / 停止录制」按钮，鼠标可点；可在设置里隐藏。**只在游戏世界已加载（即 `PlayerCamera.main` 与 `WorldGeneration.world` 都就位）时显示**，主菜单 / 加载界面不会出现。

录制中卡片显示红色 `REC mm:ss.xxx · NNN frames · 停止 <Key>`，停止后卡片切回灰色，并提示落地的 JSON 文件路径。

每次开始-停止生成一份新文件。同一秒重复触发也会生成不同文件名（带毫秒后缀）。

按键与 UI 偏好持久化到 `<游戏目录>/BepInEx/config/com.casualtiesUnknown.motionRecorder.cfg`。

## 5. 行为约束

- 只捕捉一个 `Body`：默认取场景里第一个 active 的、且 `Body.limbs` 非空的对象，多数情况下就是玩家。
- 帧率跟游戏 Update 走，不做插值。30 秒大概 1500 帧，单文件约 1–3 MB。
- 录制中游戏暂停（`Time.timeScale == 0`）会跳过当帧，避免在暂停面板里写一堆重复值。
- 不影响游戏存档和任何运行时数据；只读 transform，不写。

## 6. 与皮肤编辑器的关系

抓出来的 `limbs[*].px,py` 与项目里 `assemblyTable.defaultAssembly` 的 `position` 同一坐标系。换算关系：

```text
assembly.position = round(limb.px * 8) , round(-limb.py * 8)
```

Y 轴取负是因为编辑器画布像素坐标向下增长，而 Unity 局部坐标 Y 向上。

## 7. 已知约束

- 不捕捉 `bodyAnimator / armsAnimator` 内部状态。如果两个 Limb 的 `localPosition` 因 anim 同步、但你想分别还原 anim 状态机，单看本捕获文件不够。
- `spriteName / pivot / sprite 尺寸` 已记录，但仍不捕捉 animator 内部状态机字段。
- 不写元数据到游戏存档；mod 卸载后没有任何残留。
