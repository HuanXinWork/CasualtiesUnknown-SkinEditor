// 与 Rust 后端 serde 序列化字段严格对齐的共享数据模型。
// 字段名、可选性、字面量联合必须与对应 Rust 结构体一致。

export type PartCategory = "Body" | "Head";

export type Orientation = "front" | "back";

export type PanelState = "docked" | "detached" | "hidden";

export type DockPosition = "left" | "right" | "top" | "bottom" | "center";

export interface Skin {
  name: string;
  body: PartInfo[];
  head: PartInfo[];
}

export interface PartInfo {
  name: string;
  category: PartCategory;
  width: number;
  height: number;
  corrupted: boolean;
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
}

export interface ThemeConfig {
  primary: string;
  background: string;
  surface: string;
  onPrimary: string;
  onBackground: string;
  borderOpacity: number;
}
