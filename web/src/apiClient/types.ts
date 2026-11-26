// 前后端传输 DTO 类型定义（与 Rust `apiLayer/types.rs` 严格对齐）。

import type {
  Orientation,
  PartCategory,
  ThemeConfig,
  WorkspaceLayout,
} from "../stateStore/types";

export interface ApiError {
  code: string;
  message: string;
}

export interface LoadPartResult {
  partId: string;
  width: number;
  height: number;
  pixels: number[];
}

export interface MotionCaptureMeta {
  path: string;
  fileName: string;
  frameCount: number;
  durationSeconds: number;
}

export interface MotionCaptureLimb {
  name: string;
  limbNum: number;
  px: number;
  py: number;
  pz: number;
  rotZ: number;
  scaleX: number;
  scaleY: number;
  sortingOrder: number;
  visible: boolean;
  bcx: number;
  bcy: number;
  spriteName: string;
  pivotU: number;
  pivotV: number;
  spriteW: number;
  spriteH: number;
}

export interface MotionCaptureFrame {
  t: number;
  isRight: boolean;
  expression: number;
  limbs: MotionCaptureLimb[];
}

export interface MotionCaptureResult {
  path: string;
  fileName: string;
  version: number;
  modVersion: string;
  startedAtUnixMs: number;
  playerName: string;
  frameCount: number;
  durationSeconds: number;
  frames: MotionCaptureFrame[];
}

export interface PixelDiff {
  x: number;
  y: number;
  width: number;
  height: number;
  before: number[];
  after: number[];
  canvasWidth?: number;
  canvasHeight?: number;
  resized?: boolean;
}

export interface BrushParams {
  partId: string;
  cx: number;
  cy: number;
  brushSize: number;
  color: [number, number, number, number];
}

export interface EraserParams {
  partId: string;
  cx: number;
  cy: number;
  brushSize: number;
}

export interface ResizePartResult {
  partId: string;
  width: number;
  height: number;
}

export interface ResizeCanvasParams {
  partId: string;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
  syncBaseSize?: boolean;
}

export interface ResizeCanvasResult {
  partId: string;
  width: number;
  height: number;
  baseSize: [number, number] | null;
}

export interface BaseSizeResult {
  found: boolean;
  width: number;
  height: number;
}

export interface CreateSidePartResult {
  sidePartName: string;
}

export interface CreateOrientationPartResult {
  orientationPartName: string;
}

export interface CreatePartResult {
  partName: string;
}

export interface LayerTransform {
  flipX: boolean;
  flipY: boolean;
  scaleX: number;
  scaleY: number;
  rotationDeg: number;
}

export interface GradientParams {
  partId: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: [number, number, number, number];
}

export interface FillParams {
  partId: string;
  cx: number;
  cy: number;
  color: [number, number, number, number];
  tolerance: number;
}

export interface SoftBrushParams {
  partId: string;
  cx: number;
  cy: number;
  brushSize: number;
  hardness: number;
  color: [number, number, number, number];
}

export interface LayerMeta {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
}

export interface LayersSnapshot {
  layers: LayerMeta[];
  activeLayerIndex: number;
}

export type HeadVariant =
  | "default"
  | "mouthHalf"
  | "mouth"
  | "disfigured1"
  | "disfigured2"
  | "disfigured3"
  | "disfigured1Healed"
  | "disfigured2Healed"
  | "disfigured3Healed";

export interface CompositeParams {
  skinRoot: string;
  skinName: string;
  orientation: Orientation;
  expressionIndex: number;
  headVariant: HeadVariant | null;
  timeSec?: number;
  isRight?: boolean;
}

export interface CompositeResult {
  width: number;
  height: number;
  pixels: number[];
}

export interface MotionCompositeParams {
  skinRoot: string;
  skinName: string;
  capturePath: string;
  frameIndex: number;
  expressionIndex: number;
  headVariant: HeadVariant | null;
  timeSec?: number;
}

export interface MotionCompositeResult {
  width: number;
  height: number;
  pixels: number[];
  frame: MotionCaptureFrame;
}

export type WorkspaceSource = "file" | "fallback";

export interface WorkspaceResult {
  layout: WorkspaceLayout;
  theme: ThemeConfig;
  source: WorkspaceSource;
}

export interface ExportSkinPackResult {
  fileCount: number;
}

export interface ImportSkinPackResult {
  imported: number;
  skipped: number;
}

export type ExportLayout = "flat" | "categorized";

export interface DialogFilter {
  name: string;
  extensions: string[];
}

export interface SetAssemblyOverrideParams {
  partName: string;
  category: PartCategory;
  position: { x: number; y: number };
  rotation?: number;
  flipX?: boolean;
  zOrder?: number;
}

export interface AssemblyEntry {
  partName: string;
  category: PartCategory;
  position: { x: number; y: number };
  zOrder: number;
  flipX: boolean;
  rotation: number;
}

export interface AssemblyTable {
  parts: AssemblyEntry[];
}

export interface AssemblyResult {
  table: AssemblyTable;
  source: "file" | "fallback";
}

export interface WingPieceConfig {
  x: number;
  y: number;
  rotation: number;
  zOrder: number;
}

export interface WingsConfig {
  wingUL: WingPieceConfig;
  wingDL: WingPieceConfig;
  wingUR: WingPieceConfig;
  wingDR: WingPieceConfig;
}

export interface LoadImageResult {
  width: number;
  height: number;
  pixels: number[];
}
