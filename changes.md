<!-- markdownlint-disable MD024 -->

# 更新日志

> 该文档是更新日志的说明。English version: [`changes.en.md`](./changes.en.md)。

---

## 1.0.3（2026-05-27）

### 新增

- **皮肤分辨率配置**：移除写死的 60 项分辨率常量表，改为按皮肤生成 `<skin>/baseSizes.json`；导入皮肤包时扫描 PNG 实际尺寸自动落盘；启动时检测旧皮肤缺该文件会自动补齐；自定义部件不入表，按磁盘实尺渲染，兼容任意分辨率皮肤。

### 完善

- **导入归类**：散装 zip 即使全部塞在 `Body/` 一个文件夹里，HeadDefault / wingUL / eyeOpen / disfiguredHead0 等也按真实分类落到 Head/Wings；`classifyEntry` 优先级翻转为"文件名优先"，路径段仅作为未知部件 fallback。
- **旧式导出血液**：旧式（Flat）格式下 `Blood/*.png` 跟随平铺去 `<皮肤名>/Body/`，与"所有部件落 Body"语义一致；新式仍保留独立 Blood/ 目录。
- **空角色态**：`data/skin/` 不再生成 `default/{Body,Head}/` 占位骨架；无任何皮肤目录时角色栏显示"未检测到角色"。

---

## 1.0.2（2026-05-27）

### 新增

- **血液粒子编辑面板**：`bloodPanel` 模块，可视化编辑 `<skin>/blood.json` 全部 14 个字段（粒子起止色 / 尺寸 / 寿命 / Alpha 曲线、Limb 暗亮血色、Additive 发光、帧动画、随机配色列表）；每字段 override 三态切换；切皮肤拉新值。
- **血液贴图分类**：角色栏新增"血液贴图"分组，列出 `<skin>/Blood/*.png`（如 `BloodParticle.png`）；可在编辑画布编辑像素 + 修改分辨率。
- **自定义色卡**：调色盘下方新增 3 排 × 8 = 24 个用户自定义槽位，长按或右键打开编辑器（HEX 输入 / 使用当前色 / 清空），会自动保存到工作区配置。
- **取色笔拖动模式**：进入取色模式后按下左键不松开，鼠标移动期间持续预览颜色，松开即确认；Esc或右键取消。
- **持久化扩展**：面板折叠 / 展开状态、调色盘最近用色（FIFO 12）、自定义色卡（24 槽）、角色栏分组折叠态、编辑画布 footer 高度（百分比）全部保存到工作区配置。
- **导出格式选项**：导出皮肤包时会弹出选择框 选择"旧式（皮肤名/Body 平铺所有部件）"或"新式（皮肤名/Body+Head+Wings+Accessories 分类）"，可选附带血液配置（blood.json + Blood/*.png）。
- **识别导入**：散装 zip（无 Body/Head 等目录段）按 PNG 文件名匹配标准部件表自动归类落到 `<新皮肤>/<分类>/`；含 `blood` 关键字的 PNG 自动落 Blood/。
- **F/B 后缀识别**：`experimentEyeOpenF` / `HandB` 等 sided 副本自动回查 base 名命中标准尺寸表，防止因为分辨率导致的预览错误。

### 完善

- **编辑画布**：footer 改百分比高度（默认 25%，10~70% 区间），顶部横线可拖拽调节，折叠展开后保持比例；stage 居中策略修复，画布点击加载后正确显示在中央而非贴顶。
- **导入 / 导出语义**：两种格式均套 `<皮肤名>/` 顶层前缀；blood.json + Blood/*.png 通过独立 `includeBlood` 开关控制是否打包。
- **调色盘手感**：色相环宽度 18px → 28px（内径 48 / 外径 76），SV 方块 88px → 96px；拖动 hue / SV 期间不再每帧都记录 记忆色，松手才记一次最终色。
- **取色精度**：取色坐标采用 `Math.round` 替代 `Math.floor`，减少偏差。
- **配件汉化**：27 个配件 itemId 在角色栏显示中文（autopump → 自动泵 等）；血液贴图 `BloodParticle` 显示为"血液粒子"。
- **mod 端翻身视觉**：Harmony patch `Body.SwitchDir` 翻所有 SpriteRenderer.sortingOrder，修复角色面左时手 / 臂 / 腿前后错位；patch `PickUpItem` 让新拿起的物品 sortingOrder 跟随当前朝向同步。

### 修复

- 编辑画布折叠 ▼ 展开后布局错位、footer 异常向上扩展。
- 画布点击部件后贴顶 + 下方大片空白（stage flex 居中失效）。
- baseSizes 由 `<skin>/baseSizes.json` 改为代码常量表 60 项；删除该 json 后装配不再错位。
- 删 BloodConfig.spritePath 字段（mod 端固定走 `Blood/BloodParticle.png`）。
- 折叠面板再展开时丢失 flex 布局导致 footer 拖拽失效。
- 自定义色卡保存后重启丢失（原生 `<input type=color>` 在 Tauri 不弹）。
- 取色 / 自定义色卡 / 折叠状态等改动重启后未保留。

---

## 1.0.1（2026-05-25）

### 新增

- **更高分辨率支持 + 修改分辨率**：编辑画布 / 后端 baseSizes 解除 64×64 上限，支持任意分辨率；新增"修改分辨率"操作，可对当前部件调整目标宽 × 高，原像素按选定算法重采样落地。
- **翅膀组件**：角色栏新增 Wings 分组，4 张固定贴图 `wingUL/wingUR/wingDL/wingDR.png`；合成预览按 `wings.json` 的 `x / y / rotation / zOrder` 装配。
- **wings.json 解析**：mod 端与编辑器读取 `<皮肤名>/wings.json` 覆盖默认装配位置；缺文件 / 解析失败回退默认值。
- **导入完善**：`importSkinPack` 接受任意合规皮肤 zip，自动剥离一层包装目录；只校验扩展名与路径越界，文件名大小写不敏感。
- **不对称皮肤创建**：从既有皮肤目录派生不对称副本，编辑器把单边 PNG 自动镜像为另一边并加 F/B 后缀。

### 完善

- 部件列表分组改为可折叠（Body / Head / Wings 三类）。
- 工具栏导出按钮在缺 zip 内容时给出更明确的 toast。
- 合成预览支持 wings 的 zOrder 与 rotation 参与排序。
- 修改分辨率后 layers 工程结构同步重建，不丢图层。

### 修复

- 高分辨率部件首次加载偶发画布偏移。
- 翅膀 4 张缺一时合成预览空指针导致崩溃。
- zip 顶层带空格目录名解压失败。

---

## 1.0.0（2026-05-18）

初始发布。

### 新增

- **桌面壳 + HTTP 双形态**：Tauri v2 桌面壳（portable exe）与 Axum HTTP 服务共享同一 Rust crate；桌面壳从 `rust-embed` 嵌入资源加载，release 不依赖磁盘外部文件。
- **皮肤目录管理**：`data/skin/<皮肤名>/{Body,Head}/` 目录扫描，皮肤下拉自动列出全部皮肤名；首次启动若 `data/skin/` 为空，生成 `default/{Body,Head}/` 占位。
- **像素编辑工具**：拖动 / 画笔 / 渐变 / 橡皮 4 件套；笔刷尺寸 1~64；按笔分组的撤销重做；50 条历史环。
- **多图层**：单部件最多 8 层，可见性 / 不透明度 / 层叠顺序 / 删除；保存写 `<皮肤名>/layers/<Cat>/<部件>/manifest.json` + `layerN.png`。
- **调色盘**：HSV 色环 + 明度滑块、当前色预览、PS 风格取色针、最近用色 8 格。
- **合成预览（装配模式）**：按 `assembly.json` 与表情 / 头部 / 朝向参数实时合成 100×100 视图；可关闭实时预览改手动刷新。
- **合成预览（动画模式）**：读取 BepInEx mod MotionRecorder 写出的 `captures/` JSON，按帧合成；播放 / 暂停 / 帧滑杆；支持在动画帧上切表情 / 头部 / 朝向并即时重渲。
- **皮肤包导入导出**：`importSkinPack` 接受 zip（顶层即 `Body/`/`Head/` 或带一层包装目录），导出按 `<皮肤名>/{Body,Head}/` 顶层结构打包。
- **可拖拽 dock 布局**：六块面板（部件 / 工具 / 编辑 / 图层 / 预览 / 调色）可在 dock host 间拖拽移位，越界 / 右键菜单触发 detach 到独立子窗口。
- **i18n + 主题**：中英文切换，快捷键全部可在设置面板录制重绑。
- **未保存确认**：关闭主窗口时若任何部件未保存，弹"保存并退出 / 不保存 / 取消"对话框。

### 完善

- WebView2 强制浅色 scheme（`color-scheme: light` 双重声明），避免 Windows 系统暗色模式把空背景渲成黑让用户误判加载失败。
- release 抑制 cmd 黑窗（`windows_subsystem = "windows"`）。
- 自绘 6 尺寸 ICO + 256 PNG 图标。
