// 与 Rust 后端 serde 结构体字段 1:1 对齐的共享数据模型。

export type PartCategory = "Body" | "Head" | "Wings" | "Accessories" | "Blood";

export type Orientation = "front" | "back";

export type PanelState = "docked" | "detached" | "hidden";

export type DockPosition = "left" | "right" | "top" | "bottom" | "center";

export interface Skin {
  name: string;
  body: PartInfo[];
  head: PartInfo[];
  wings: PartInfo[];
  accessories: PartInfo[];
  accessoryConfigs: AccessoryEntry[];
  blood: PartInfo[];
}

export interface PartInfo {
  name: string;
  category: PartCategory;
  width: number;
  height: number;
  corrupted: boolean;
}

export interface AccessoryEntry {
  id: string;
  limb: string;
  sprite: string;
  offX: number;
  offY: number;
  rot: number;
  z: number;
  enabled: boolean;
  secondaryLimbs?: AccessorySecondaryLimb[];
  /** 指定穿戴槽位 ID；为空表示常驻显示。 */
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

export interface ZoneLightConfig {
  color: [number, number, number, number];
  intensity: number;
  outerRadius: number;
  innerRadius: number;
  color2?: [number, number, number, number];
  mode?: string;
  direction?: number;
  spread?: number;
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
  endColor?: [number, number, number, number];
  mode?: string;
  speed?: number;
  direction?: number;
  spread?: number;
  endSizeScale?: number;
  fadeCurve?: string;
}

export interface ZoneAnimationConfig {
  frames: string[];
  fps: number;
  loop: boolean;
}

export interface ZoneEntry {
  /** 区块 ID（`1..=255`）。 */
  id: number;
  name?: string;
  /** 仅编辑器叠加层使用的填充色。 */
  displayColor?: [number, number, number];
  light?: ZoneLightConfig;
  particle?: ZoneParticleConfig;
  animation?: ZoneAnimationConfig;
}

export interface ZonesData {
  width: number;
  height: number;
  /** 长度为 `width * height` 的单通道遮罩，`0` 表示无区块。 */
  ids: Uint8Array;
  config: { zones: ZoneEntry[] };
}

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
  rotation?: number;
  variants?: AssemblyVariants;
}

export interface AssemblyPosition {
  x: number;
  y: number;
}

export interface AssemblyVariants {
  orientation?: Orientation;
  expressionIndex?: number;
  headVariant?: string;
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
  autoSaveEnabled?: boolean;
  autoSaveIntervalSec?: number;
  switchSaveBehavior?: "ask" | "auto" | "save";
  softBrushHardness?: number;
  colorPaletteRecent?: Array<[number, number, number]>;
  colorPaletteCustom?: Array<[number, number, number] | null>;
  partGroupsCollapsed?: Record<string, boolean>;
  shortcuts?: Record<string, string>;
}

export interface ThemeConfig {
  primary: string;
  background: string;
  surface: string;
  onPrimary: string;
  onBackground: string;
  borderOpacity: number;
}
