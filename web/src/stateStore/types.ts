// 与 Rust 后端 serde 序列化字段严格对齐的共享数据模型。
// 字段名、可选性、字面量联合必须与对应 Rust 结构体一致。

export type PartCategory = "Body" | "Head" | "Wings" | "Accessories" | "Blood";

export type Orientation = "front" | "back";

export type PanelState = "docked" | "detached" | "hidden";

export type DockPosition = "left" | "right" | "top" | "bottom" | "center";

export interface Skin {
  name: string;
  body: PartInfo[];
  head: PartInfo[];
  wings: PartInfo[];
  /** Accessories 目录下的 PNG 文件列表，与 body/head/wings 同结构。 */
  accessories: PartInfo[];
  /** 皮肤目录 accessories.json 的解析结果；缺失时为空数组。 */
  accessoryConfigs: AccessoryEntry[];
  /** Blood 目录下的 PNG（如 BloodParticle.png 等粒子贴图），不参与装配预览，可在编辑画布编辑像素。 */
  blood: PartInfo[];
}

export interface PartInfo {
  name: string;
  category: PartCategory;
  width: number;
  height: number;
  corrupted: boolean;
}

/** 单个配件条目，与后端 AccessoryEntry / mod 端 RawEntry 字段 1:1 对齐。 */
export interface AccessoryEntry {
  id: string;
  limb: string;
  sprite: string;
  offX: number;
  offY: number;
  rot: number;
  z: number;
  enabled: boolean;
  /** 副件列表，仿游戏 Wearable.secondaryLimbs。 */
  secondaryLimbs?: AccessorySecondaryLimb[];
  /** 仅在玩家穿戴对应 wearSlotId 装备时才显示；空 = 总是显示。读时兼容旧字段名 slot。 */
  requireWornSlot?: string;
}

export interface AccessorySecondaryLimb {
  limb: string;
  sprite: string;
  offX: number;
  offY: number;
  rot: number;
  z: number;
}

/** 区块 light 配置：URP 2D Light 主要参数。 */
export interface ZoneLightConfig {
  color: [number, number, number, number];
  intensity: number;
  outerRadius: number;
  innerRadius: number;
  /** 渐变末端色；缺省与 color 相同（无渐变）。 */
  color2?: [number, number, number, number];
  /** "radial" / "directional" / "scatter"，缺省 radial。 */
  mode?: string;
  /** directional / scatter 模式方向（度，0=右，90=上）。 */
  direction?: number;
  /** directional 圆锥角宽（度）。 */
  spread?: number;
  /** 衰减幂次（默认 2）。 */
  falloffPower?: number;
  breathing?: boolean;
  breathSpeed?: number;
  breathAmplitude?: number;
}

export interface ZoneParticleConfig {
  rate: number;
  lifetime: number;
  startSize: number;
  startColor: [number, number, number, number];
  gravity: number;
  shape: string;
  shapeRadius: number;
  /** 末态颜色。 */
  endColor?: [number, number, number, number];
  /** "gravity" / "star" / "fire" / "water" / "orbit"，缺省 gravity。 */
  mode?: string;
  /** 起始速度乘子。 */
  speed?: number;
  /** 发射方向（度，0=右，90=上）。 */
  direction?: number;
  /** 散射角（度）。 */
  spread?: number;
  /** 末态相对起始大小的比例。 */
  endSizeScale?: number;
  /** "linear" / "easeOut" / "blink" / "constant"。 */
  fadeCurve?: string;
}

export interface ZoneAnimationConfig {
  frames: string[];
  fps: number;
  loop: boolean;
}

/** 部件区块条目（与后端 zones::ZoneEntry 1:1 对齐）。 */
export interface ZoneEntry {
  /** 1~255 区块 ID。 */
  id: number;
  name?: string;
  /** 画布 overlay 填充色（RGB），缺失时自动按 hue 调色板。仅编辑器使用。 */
  displayColor?: [number, number, number];
  light?: ZoneLightConfig;
  particle?: ZoneParticleConfig;
  animation?: ZoneAnimationConfig;
}

/** loadZones 返回：mask + 配置一对。 */
export interface ZonesData {
  width: number;
  height: number;
  /** length = width * height；R 通道值，0=无区块。 */
  ids: Uint8Array;
  config: { zones: ZoneEntry[] };
}

/** per-skin 自定义血液配置，与后端 BloodConfig / mod 端 BloodConfigLoader 字段 1:1 对齐。 */
export interface BloodConfig {
  particleStartColor?: [number, number, number, number] | null;
  particleEndColor?: [number, number, number, number] | null;
  randomColors?: Array<[number, number, number, number]> | null;
  particleSize?: number | null;
  particleLifetime?: number | null;
  fadeCurve?: string | null;
  bloodDark?: [number, number, number, number] | null;
  bloodLight?: [number, number, number, number] | null;
  glow?: boolean | null;
  glowIntensity?: number | null;
  animated?: boolean | null;
  animFrames?: number | null;
  animFps?: number | null;
}

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  pixels: Uint8Array;
}

export interface PartEditState {
  partName: string;
  width: number;
  height: number;
  layers: Layer[];
}

export interface HistoryEntry {
  layerId: string;
  diff: PixelDiff;
  timestamp: number;
}

/// 矩形像素 diff：before/after 都是 width*height*4 字节的 RGBA 副本。
export interface PixelDiff {
  x: number;
  y: number;
  width: number;
  height: number;
  before: Uint8Array;
  after: Uint8Array;
}

export interface AssemblyTable {
  parts: AssemblyEntry[];
}

export interface AssemblyEntry {
  partName: string;
  category: PartCategory;
  position: AssemblyPosition;
  zOrder: number;
  flipX: boolean;
  /** sprite 自身绕中心的旋转角（度，逆时针为正）。后端缺省时回退 0；旧 assembly.json 兼容。 */
  rotation?: number;
  variants?: AssemblyVariants;
}

/// 相对角色中心的像素偏移，可正可负。
export interface AssemblyPosition {
  x: number;
  y: number;
}

export interface AssemblyVariants {
  orientation?: Orientation;
  expressionIndex?: number;
}

export interface PanelLayout {
  id: string;
  state: PanelState;
  dockPosition?: DockPosition;
  dockOrder?: number;
  size: PanelSize;
  windowPosition?: WindowPosition;
  alwaysOnTop?: boolean;
  collapsed: boolean;
}

export interface PanelSize {
  width: number;
  height: number;
}

export interface WindowPosition {
  x: number;
  y: number;
}

/// 工作区根结构。sizes / activeSkin 与后端 `#[serde(default)]` 对齐，
/// 旧 workspace.json 反序列化为缺省后由前端兜底。splitRatios 保留以兼容旧写盘格式。
export interface WorkspaceLayout {
  version: number;
  panels: PanelLayout[];
  splitRatios: Record<string, number>;
  sizes?: Record<string, number>;
  activeSkin?: string;
  settings?: WorkspaceSettings;
}

export interface WorkspaceSettings {
  showMotionDebugPanel: boolean;
  showWingDebugPanel: boolean;
  showBloodPanel: boolean;
  /** 定时自动保存所有未保存部件；默认关闭。 */
  autoSaveEnabled?: boolean;
  /** 自动保存间隔（秒），默认 60，最小 10。 */
  autoSaveIntervalSec?: number;
  /** 切换部件时对未保存改动的处理：ask 弹框 / auto 直接切不保存 / save 先保存再切。 */
  switchSaveBehavior?: "ask" | "auto" | "save";
  /** 柔和笔刷硬度 0~255，默认 128。 */
  softBrushHardness?: number;
  /** 最近用色 FIFO（最多 12 项），与 colorPalette/index.ts.RECENT_LIMIT 对齐。 */
  colorPaletteRecent?: Array<[number, number, number]>;
  /** 用户自定义色卡槽：3 排 × 8 = 24 个；空槽用 null 表示。 */
  colorPaletteCustom?: Array<[number, number, number] | null>;
  /** partPanel 各分组折叠态：key = body/head/wings/expression/accessories。 */
  partGroupsCollapsed?: Record<string, boolean>;
}

export interface ThemeConfig {
  primary: string;
  background: string;
  surface: string;
  onPrimary: string;
  onBackground: string;
  borderOpacity: number;
}
