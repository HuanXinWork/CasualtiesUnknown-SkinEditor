# MotionRecorder

MotionRecorder 是给 CasualtiesUnknown-SkinEditor 配套用的 BepInEx mod。

它做的事情很单一：在游戏里录下玩家角色每一帧的部件变换，停止录制时写成一份 JSON。编辑器的动画预览读的就是这份文件。

如果你只是替换皮肤，不需要安装它。

## 1. 这东西抓的是什么

录制期间，mod 每个 Update 都会看一次当前角色，然后把这一帧里每个部件的状态记下来，主要包括：

- `Body.limbs[]` 里每个 limb 的局部坐标、旋转、缩放
- 对应 `SpriteRenderer` 的排序和可见性
- 角色当前朝向
- 当前表情索引
- 尾巴对象 `TailScript`，如果场景里找得到的话
- sprite 的视觉中心和基础元信息，方便后面校对装配

它不改游戏逻辑，不写存档，也不会把数据塞回角色身上。整个 mod 只读运行时状态，最后落一份文件。

## 2. 动画是怎么抓出来的

流程很直接：

1. 你在游戏里按 `F9`，或者点左下角浮动按钮，开始录制。
2. mod 在场景里找第一个 active 且 `Body.limbs` 非空的 `Body`，通常就是当前玩家。
3. 录制期间，每次 `Update()` 都采一帧；如果游戏暂停了，也就是 `Time.timeScale == 0`，这一帧会跳过。
4. 对每个 limb，记录 `transform.localPosition`、`localEulerAngles.z`、`localScale`，再从 `SpriteRenderer` 取 `sortingOrder`、可见性、sprite 名称、pivot、尺寸，以及 `bounds.center` 反算到 Body 局部坐标后的视觉中心。
5. 尾巴不在 `Body.limbs[]` 里，mod 会单独找最接近当前 Body 的 active `TailScript`，如果找到就追加一条名为 `Tail` 的记录。
6. 表情不是直接读状态机字段，而是拿当前眼睛 sprite 去 `eyeList[]` 里反查索引；查不到时写 `-1`。
7. 再按一次 `F9` 或点按钮停止，mod 把整段录制写成一份 JSON 到 `BepInEx/plugins/MotionRecorder/captures/`。

也就是说，编辑器里的“动画预览”本质上不是自己在游戏里回放动作，而是读取这份逐帧采样出来的 JSON，再按当前皮肤重新合成。

## 3. 输出文件放哪

每次开始到停止会生成一份新文件：

```text
<游戏目录>/BepInEx/plugins/MotionRecorder/captures/
└── motion_<本地时间戳>_<玩家名>.json
```

文件名里的玩家名会做一次清洗：空格和非法文件名字符会被替换成下划线，所以同名角色也能稳定落盘。

## 4. JSON 结构

顶层字段：

| 字段 | 含义 |
| --- | --- |
| `version` | schema 版本；当前是 `3` |
| `modVersion` | 录制时 MotionRecorder 自身版本 |
| `startedAtUnixMs` | 开始录制时的本地 Unix 毫秒时间戳 |
| `playerName` | 被录制对象的 `GameObject.name` |
| `frameCount` | 总帧数 |
| `frames[]` | 逐帧采样结果 |

每帧 `frames[i]`：

| 字段 | 含义 |
| --- | --- |
| `t` | 距开始录制过去的秒数，使用 `Time.unscaledTime` |
| `isRight` | `Body.transform.localScale.x >= 0` 时为 `true` |
| `expression` | 当前表情索引；反查失败时为 `-1` |
| `limbs[]` | 当前帧的部件列表；来自 `Body.limbs[]`，尾巴会额外追加 |

每条 `limbs[i]`：

| 字段 | 含义 |
| --- | --- |
| `name` | limb 名；尾巴固定为 `Tail` |
| `limbNum` | `Body.limbs[]` 中的索引；尾巴固定为 `-1` |
| `px / py / pz` | `transform.localPosition`，Unity 单位 |
| `rotZ` | `transform.localEulerAngles.z`，0 到 360 度 |
| `scaleX / scaleY` | `transform.localScale.x/y` |
| `sortingOrder` | `SpriteRenderer.sortingOrder` |
| `visible` | `SpriteRenderer.enabled && gameObject.activeInHierarchy` |
| `bcx / bcy` | `SpriteRenderer.bounds.center` 反算到 Body 局部坐标后的视觉中心 |
| `spriteName` | 当前 sprite 名称，用来核对实际用了哪张图 |
| `pivotU / pivotV` | sprite 的归一化 pivot，范围约为 0 到 1 |
| `spriteW / spriteH` | sprite 矩形宽高，单位像素 |

## 5. 和编辑器怎么对上

编辑器的动画模式直接读取上面的 JSON。

- 每一帧的 limb 位置、旋转、朝向、排序用于当前皮肤的重新装配
- 即使部件还没保存到磁盘，编辑器也能优先使用内存里的图层状态参与当前帧合成
- 表情、头部变体、朝向切换仍然可以在预览里继续改，因为编辑器是拿捕捉到的骨架数据重新算图，而不是死放录制时的截图

如果你是为了回填装配表，位置换算关系是：

```text
assembly.position = round(limb.px * 8), round(-limb.py * 8)
```

Y 轴取负，是因为编辑器画布向下为正，而 Unity 局部坐标的 Y 向上为正。

## 6. 安装

1. 先在游戏目录安装 BepInEx 5（x64, Mono），并启动一次游戏，让 `BepInEx/plugins/` 建出来。
2. 用 dotnet 8 SDK 构建本项目：

   ```bash
   cd motionRecorder
   dotnet build -c Release
   ```

3. 把产物 `bin/Release/MotionRecorder.dll` 复制到：

   ```text
   <游戏目录>/BepInEx/plugins/MotionRecorder/MotionRecorder.dll
   ```

4. 启动游戏后，`BepInEx/LogOutput.log` 里能看到 `MotionRecorder ready` 就说明加载成功了。

本地构建需要的游戏 / Unity / BepInEx DLL 不放在仓库里，要你自己从游戏目录拷到 `motionRecorder/references/`。具体列表见 `references/README.md`。

## 7. 使用

进游戏后有两种入口：

- `F9`：开始 / 停止录制
- 左下角浮动按钮：开始录制 / 停止录制

录制中左下角会显示红色状态条：`REC mm:ss.xxx · NNN frames`。

停止后状态条回到空闲态，并在日志里打印保存路径。每次录制都会生成一份新文件；同一秒内连续录两次也没关系，文件名里带毫秒。

## 8. 已知边界

- 只会抓一个 `Body`，策略是“场景里第一个 active 且 limbs 非空的 Body”。大多数时候够用，但多人同屏时不保证一定是你想要的对象。
- 不做插值，采样频率就是游戏 `Update()` 的频率。
- 游戏暂停时会跳帧，避免写出一堆重复静止数据。
- 不记录 animator 内部状态机，只记录这一帧最终落到各 limb 上的结果。所以如果你想完全还原 `bodyAnimator` / `armsAnimator` 的内部状态，仅靠这份 JSON 不够。
- mod 卸载后不会留下任何游戏侧状态，只有你已经录出来的 JSON 文件还在磁盘上。
