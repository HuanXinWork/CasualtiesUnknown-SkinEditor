# MotionRecorder 角色动作录制插件

`MotionRecorder` 是配合皮肤编辑器使用的 BepInEx 5 小插件。它在游戏运行期间按帧读取玩家角色的身体肢体、尾巴与翅膀变换，停止录制时写成一份独立的 JSON 文件，供编辑器的"动画"预览模式逐帧回放。

如果你只用编辑器画静态贴图或直接使用现成的动作文件，不需要在游戏里装这个插件。

## 1. 输出文件与 JSON 结构

每次按下开始到停止录制，都会在插件目录下生成一份新文件（文件名带毫秒时间戳，连按也不会覆盖）：

```text
<游戏目录>/BepInEx/plugins/MotionRecorder/captures/
└── motion_<本地时间戳>_<角色名>.json
```

把生成的 `.json` 文件拷到皮肤编辑器同级的 `captures/` 目录，切到编辑器的"动画"预览模式即可选用。

顶层字段：

| 字段 | 说明 |
| --- | --- |
| `version` | 格式版本号，当前固定为 `3` |
| `modVersion` | 录制该文件时的插件版本 |
| `startedAtUnixMs` | 开始录制时的 Unix 毫秒时间戳 |
| `playerName` | 目标角色 `GameObject` 名称 |
| `frameCount` | 录下的总帧数 |
| `frames[]` | 按时间顺序排列的帧数组 |

每帧 `frames[i]` 字段：

| 字段 | 说明 |
| --- | --- |
| `t` | 距离录制起点的秒数（游戏暂停期间的挂钟耗时会自动扣除） |
| `isRight` | 角色当前是否面朝右（读取 `Body.isRight`） |
| `expression` | 当前眼睛贴图在 `FacialExpression.eyeList` 中的索引，未命中时为 `-1` |
| `limbs[]` | 当前帧采集到的全部部位，包含 `Body.limbs[]`、尾巴 `Tail` 以及 `SkinSync` 挂载的四片翅膀 |

每条部位 `limbs[i]` 字段（共 17 项）：

| 字段 | 说明 |
| --- | --- |
| `name` | 部位名；尾巴固定为 `Tail`，翅膀固定为 `wingUL` / `wingUR` / `wingDL` / `wingDR` |
| `limbNum` | `Body.limbs[]` 下标；尾巴记 `-1`，四片翅膀记 `-10` 至 `-13` |
| `px` / `py` / `pz` | `Transform.localPosition`（Unity 单位，`1` 单位等于编辑器画布 `8` 像素） |
| `rotZ` | Z 轴旋转角度（`0`–`360` 度；常规肢体取局部旋转，挂在深层节点的尾巴与翅膀取世界旋转） |
| `scaleX` / `scaleY` | `Transform.localScale` 的 X 与 Y 分量 |
| `sortingOrder` | 渲染器的 `sortingOrder` |
| `visible` | 当前部位在场景中是否激活且渲染器已启用（兼容 `SkinSync` 流体尾巴的 `MeshRenderer`） |
| `bcx` / `bcy` | 渲染包围盒中心（`bounds.center`）转回 `Body` 根节点局部空间的坐标，供尾巴与翅膀精确定位 |
| `spriteName` | 当前挂载的 `Sprite` 名称 |
| `pivotU` / `pivotV` | 贴图归一化中心锚点（`0`–`1`） |
| `spriteW` / `spriteH` | 贴图矩形像素宽高 |

局部坐标换算到编辑器 `100×100` 装配画布的公式为（画布 Y 轴向下，Unity 局部 Y 轴向上）：

```text
x = round(px * 8)
y = round(-py * 8)
```

## 2. 编译与安装

1. 先在游戏目录装好 BepInEx 5（x64 Mono），启动一次游戏让它生成 `BepInEx/plugins/`。
2. 按 `references/README.md` 里的清单，把本地游戏目录的 7 个依赖 DLL 拷进 `motionRecorder/references/`（该目录已在 `.gitignore` 忽略）。
3. 使用 .NET SDK 编译插件：

   ```bash
   cd motionRecorder
   dotnet build -c Release
   ```

4. 把生成好的 `bin/Release/MotionRecorder.dll` 复制到 `<游戏目录>/BepInEx/plugins/MotionRecorder/MotionRecorder.dll`。
5. 启动游戏，看到 `BepInEx/LogOutput.log` 里打印出 `MotionRecorder ready` 即代表加载成功。

## 3. 游戏内操作

进入有角色的游戏场景后（主菜单和加载界面不会显示录制按钮）：

- **`F9`**：开始录制（已在录制中再按不会重开，防止误触）。
- **`F10`**：停止录制并把数据写入 `captures/`。
- **`F8`**：打开或关闭设置浮窗，可在游戏内直接改绑开始/停止按键（改键时按 `Esc` 可取消）或隐藏左下角按钮。
- **左下角按钮**：也可以直接用鼠标点屏幕左下角的"开始录制 / 停止录制"按钮。

按键和界面显隐配置会自动保存在 `<游戏目录>/BepInEx/config/com.casualtiesUnknown.motionRecorder.cfg`。

## 4. 采样细节与边界

- 插件优先锁定 `PlayerCamera.main.body`（当前玩家控制的身体）和 `Body.tail`；只有在相机引用缺失时才回退扫描场景，并且对尾巴做了层级与 3 单位距离限制，断尾时不会误抓远处 NPC 的尾巴。
- 采样频率跟随游戏的 `Update()` 帧率，不做额外插值；按 `Esc` 暂停游戏（`Time.timeScale <= 0`）时会暂停采样并扣除暂停耗时，恢复后动作时间轴依然连贯。
- 插件全程只读组件状态，不改任何游戏逻辑或存档文件；录制途中如果直接退出场景或关闭游戏，已有帧也会在组件卸载时自动落盘。
