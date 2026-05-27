// 跨 Tauri / Web 双形态的统一调用入口。
// 前端按 runtimeMode 把同名调用分发到 Tauri IPC 或 HTTP REST。

import type {
  AccessoryEntry,
  BloodConfig,
  Orientation,
  PartCategory,
  Skin,
  ThemeConfig,
  WorkspaceLayout,
  ZoneEntry,
  ZonesData,
} from "../stateStore/types";
import { getRuntimeMode } from "../runtimeMode";

export interface ApiError {
  code: string;
  message: string;
}

interface TauriInternals {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

function tauriInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const w = window as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  const invoke = w.__TAURI_INTERNALS__?.invoke;
  if (typeof invoke !== "function") {
    return Promise.reject<T>({
      code: "tauri_unavailable",
      message: "Tauri internals not present on window",
    } as ApiError);
  }
  return invoke(cmd, args) as Promise<T>;
}

async function httpGet<T>(path: string): Promise<T> {
  const resp = await fetch(path);
  if (!resp.ok) {
    let err: ApiError;
    try {
      err = (await resp.json()) as ApiError;
    } catch {
      err = { code: "http_error", message: `${resp.status} ${resp.statusText}` };
    }
    return Promise.reject<T>(err);
  }
  return (await resp.json()) as T;
}

async function httpPost<T>(path: string, body: unknown): Promise<T> {
  const resp = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    let err: ApiError;
    try {
      err = (await resp.json()) as ApiError;
    } catch {
      err = { code: "http_error", message: `${resp.status} ${resp.statusText}` };
    }
    return Promise.reject<T>(err);
  }
  return (await resp.json()) as T;
}

export function listSkins(skinRoot: string): Promise<string[]> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<string[]>("api_listSkins", { params: { skinRoot } });
  }
  const qs = new URLSearchParams({ skinRoot }).toString();
  return httpGet<string[]>(`/api/skins?${qs}`);
}

export function listParts(skinRoot: string, skinName: string): Promise<Skin> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<Skin>("api_listParts", { params: { skinRoot, skinName } });
  }
  const qs = new URLSearchParams({ skinRoot, skinName }).toString();
  return httpGet<Skin>(`/api/parts?${qs}`);
}

// loadPartImage：返回部件 PNG 解码后的 RGBA flat buffer。
// pixels 因 JSON 序列化为 number[]，调用方在渲染时转 Uint8ClampedArray。
export interface LoadPartResult {
  partId: string;
  width: number;
  height: number;
  pixels: number[];
}

export function loadPartImage(
  skinRoot: string,
  skinName: string,
  category: PartCategory,
  partName: string,
): Promise<LoadPartResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<LoadPartResult>("api_loadPartImage", {
      params: { skinRoot, skinName, category, partName },
    });
  }
  return httpPost<LoadPartResult>("/api/loadPart", { skinRoot, skinName, category, partName });
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

export function listMotionCaptures(captureRoot: string): Promise<MotionCaptureMeta[]> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<MotionCaptureMeta[]>("api_listMotionCaptures", { params: { captureRoot } });
  }
  const qs = new URLSearchParams({ captureRoot }).toString();
  return httpGet<MotionCaptureMeta[]>(`/api/motionCaptures?${qs}`);
}

export function loadMotionCapture(path: string): Promise<MotionCaptureResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<MotionCaptureResult>("api_loadMotionCapture", { path });
  }
  const qs = new URLSearchParams({ path }).toString();
  return httpGet<MotionCaptureResult>(`/api/motionCapture?${qs}`);
}

// PixelDiff：仅记录变化区域的 RGBA。before/after 因 JSON 序列化为 number[]，
// 调用方在 putImageData 时转 Uint8ClampedArray。
export interface PixelDiff {
  x: number;
  y: number;
  width: number;
  height: number;
  before: number[];
  after: number[];
}

// applyBrush 入参，与 apiLayer DTO BrushParams 对齐。
export interface BrushParams {
  partId: string;
  cx: number;
  cy: number;
  brushSize: number;
  color: [number, number, number, number];
}

// applyEraser 入参，与 apiLayer DTO EraserParams 对齐。
export interface EraserParams {
  partId: string;
  cx: number;
  cy: number;
  brushSize: number;
}

export function applyBrush(params: BrushParams): Promise<PixelDiff> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<PixelDiff>("api_applyBrush", { params });
  }
  return httpPost<PixelDiff>("/api/brush", params);
}

export function applyEraser(params: EraserParams): Promise<PixelDiff> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<PixelDiff>("api_applyEraser", { params });
  }
  return httpPost<PixelDiff>("/api/eraser", params);
}

// 保存当前部件 PNG（覆盖原文件）。后端 savePart 需要 partId + 目标绝对路径，
// 调用方负责拼好目标路径。
export function savePart(partId: string, targetPath: string): Promise<void> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_savePart", { params: { partId, targetPath } });
  }
  return httpPost<void>("/api/savePart", { partId, targetPath });
}

export interface ResizePartResult {
  partId: string;
  width: number;
  height: number;
}

/// 修改部件分辨率：以图中心为锚扩展或缩小所有图层并落盘覆盖磁盘 PNG。
export function resizePart(
  partId: string,
  width: number,
  height: number,
  targetPath: string,
): Promise<ResizePartResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<ResizePartResult>("api_resizePart", {
      params: { partId, width, height, targetPath },
    });
  }
  return httpPost<ResizePartResult>("/api/resizePart", { partId, width, height, targetPath });
}

export interface CreateSidePartResult {
  sidePartName: string;
}

/// 复制当前部件 PNG 为 F/B 后缀的前/后侧独立副本。仅"前后共享 sprite"白名单部件允许（后端限制）。
export function createSidePart(
  skinRoot: string,
  skinName: string,
  category: PartCategory,
  partName: string,
  side: "F" | "B",
): Promise<CreateSidePartResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<CreateSidePartResult>("api_createSidePart", {
      params: { skinRoot, skinName, category, partName, side },
    });
  }
  return httpPost<CreateSidePartResult>("/api/createSidePart", {
    skinRoot, skinName, category, partName, side,
  });
}

// 线性渐变。在当前 active 图层上沿 (x0,y0)→(x1,y1) 画主色到透明的渐变。
export interface GradientParams {
  partId: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: [number, number, number, number];
}

export function applyGradient(params: GradientParams): Promise<PixelDiff> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<PixelDiff>("api_applyGradient", { params });
  }
  return httpPost<PixelDiff>("/api/gradient", params);
}

// 笔画分组：一次 mousedown..mouseup 算一步撤销。
// 调用顺序：beginStroke → 多次 applyBrush/Eraser → endStroke。
// endStroke 返回整笔合并的 PixelDiff，width=0/height=0 表示空笔画不入栈。
export function beginStroke(partId: string): Promise<void> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_beginStroke", { params: { partId } });
  }
  return httpPost<void>("/api/strokeBegin", { partId });
}

export function endStroke(partId: string): Promise<PixelDiff> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<PixelDiff>("api_endStroke", { params: { partId } });
  }
  return httpPost<PixelDiff>("/api/strokeEnd", { partId });
}

// undo / redo 返回原始 PixelDiff，调用方按 undo→before / redo→after 把对应字节段贴回 canvas。
export function undo(partId: string): Promise<PixelDiff> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<PixelDiff>("api_undo", { params: { partId } });
  }
  return httpPost<PixelDiff>("/api/undo", { partId });
}

export function redo(partId: string): Promise<PixelDiff> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<PixelDiff>("api_redo", { params: { partId } });
  }
  return httpPost<PixelDiff>("/api/redo", { partId });
}

// LayerMeta 仅元信息，不带像素 buffer——像素由后端会话持有，前端编辑结果由 PixelDiff 增量贴回。
export interface LayerMeta {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
}

// apiLayer DTO `LayersSnapshot`：单部件图层列表 + 当前活动图层索引；
// 7 个图层 API 全部返回这一结构，前端拿到后整体替换缓存。
export interface LayersSnapshot {
  layers: LayerMeta[];
  activeLayerIndex: number;
}

export function addLayer(partId: string): Promise<LayersSnapshot> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<LayersSnapshot>("api_addLayer", { params: { partId } });
  }
  return httpPost<LayersSnapshot>("/api/layer/add", { partId });
}

export function removeLayer(partId: string, layerId: string): Promise<LayersSnapshot> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<LayersSnapshot>("api_removeLayer", { params: { partId, layerId } });
  }
  return httpPost<LayersSnapshot>("/api/layer/remove", { partId, layerId });
}

export function setLayerVisibility(
  partId: string,
  layerId: string,
  visible: boolean,
): Promise<LayersSnapshot> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<LayersSnapshot>("api_setLayerVisibility", {
      params: { partId, layerId, visible },
    });
  }
  return httpPost<LayersSnapshot>("/api/layer/visibility", { partId, layerId, visible });
}

export function setLayerOpacity(
  partId: string,
  layerId: string,
  opacity: number,
): Promise<LayersSnapshot> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<LayersSnapshot>("api_setLayerOpacity", {
      params: { partId, layerId, opacity },
    });
  }
  return httpPost<LayersSnapshot>("/api/layer/opacity", { partId, layerId, opacity });
}

export function reorderLayers(partId: string, order: string[]): Promise<LayersSnapshot> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<LayersSnapshot>("api_reorderLayers", { params: { partId, order } });
  }
  return httpPost<LayersSnapshot>("/api/layer/reorder", { partId, order });
}

export function setActiveLayer(partId: string, layerIndex: number): Promise<LayersSnapshot> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<LayersSnapshot>("api_setActiveLayer", {
      params: { partId, layerIndex },
    });
  }
  return httpPost<LayersSnapshot>("/api/layer/active", { partId, layerIndex });
}

export function getLayers(partId: string): Promise<LayersSnapshot> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<LayersSnapshot>("api_getLayers", { params: { partId } });
  }
  const qs = new URLSearchParams({ partId }).toString();
  return httpGet<LayersSnapshot>(`/api/layers?${qs}`);
}

// 当前部件的扁平像素快照（所有可见图层 source-over 合成）。
// editorCanvas 在 brush/eraser/gradient/undo/redo 后调用此接口刷新画布，
// 始终显示合并视图，与 active 图层是哪一层无关。
export function getFlatten(partId: string): Promise<LoadPartResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<LoadPartResult>("api_getFlatten", { params: { partId } });
  }
  const qs = new URLSearchParams({ partId }).toString();
  return httpGet<LoadPartResult>(`/api/flatten?${qs}`);
}

// CompositeParams：合成画布固定 100×100，orientation / expressionIndex / headVariant 用于 variants 过滤。
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
  /// 播放时刻（秒）。前端 RAF 循环递增；缺省 0 渲染静态首帧。
  timeSec?: number;
}

// CompositeResult：100×100 RGBA flat buffer。pixels 因 JSON 序列化为 number[]。
export interface CompositeResult {
  width: number;
  height: number;
  pixels: number[];
}

export function getCompositeImage(params: CompositeParams): Promise<CompositeResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<CompositeResult>("api_getCompositeImage", { params });
  }
  return httpPost<CompositeResult>("/api/composite", params);
}

export interface MotionCompositeParams {
  skinRoot: string;
  skinName: string;
  capturePath: string;
  frameIndex: number;
  expressionIndex: number;
  headVariant: HeadVariant | null;
  /// 播放时刻（秒），同 CompositeParams.timeSec。
  timeSec?: number;
}

export interface MotionCompositeResult {
  width: number;
  height: number;
  pixels: number[];
  frame: MotionCaptureFrame;
}

export function getMotionCompositeImage(params: MotionCompositeParams): Promise<MotionCompositeResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<MotionCompositeResult>("api_getMotionCompositeImage", { params });
  }
  return httpPost<MotionCompositeResult>("/api/motionComposite", params);
}

// workspace.json 调用。source 标记 layout 来自磁盘还是回退默认，启动恢复路径据此决定
// 是否覆盖 main.ts 的硬编码 initialSize。
export type WorkspaceSource = "file" | "fallback";

export interface WorkspaceResult {
  layout: WorkspaceLayout;
  theme: ThemeConfig;
  source: WorkspaceSource;
}

export function getWorkspace(path: string): Promise<WorkspaceResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<WorkspaceResult>("api_getWorkspace", { params: { path } });
  }
  const qs = new URLSearchParams({ path }).toString();
  return httpGet<WorkspaceResult>(`/api/workspace?${qs}`);
}

export function saveWorkspace(
  path: string,
  layout: WorkspaceLayout,
  theme: ThemeConfig,
): Promise<void> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_saveWorkspace", { params: { path, layout, theme } });
  }
  return httpPost<void>("/api/workspace", { path, layout, theme });
}

// resetLayout 不接受路径——后端始终返回内置默认 layout/theme，不写文件；
// 调用方负责把结果再 saveWorkspace 持久化。
export function resetLayout(): Promise<WorkspaceResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<WorkspaceResult>("api_resetLayout", {});
  }
  return httpPost<WorkspaceResult>("/api/workspace/reset", {});
}

// 皮肤包 zip 导入 / 导出。HTTP 路由 POST /api/skinPack/{export,import}，Tauri 命令同名。
export interface ExportSkinPackResult {
  fileCount: number;
}

export interface ImportSkinPackResult {
  imported: number;
  skipped: number;
}

/// 导出格式：
/// - "flat" = 旧式：所有 PNG 平铺到单一 `<皮肤名>/Body/`
/// - "categorized" = 新式：按分类放 `<皮肤名>/{Body,Head,Wings,Accessories}/`
export type ExportLayout = "flat" | "categorized";

export function exportSkinPack(
  skinRoot: string,
  zipPath: string,
  layout: ExportLayout = "categorized",
  includeBlood: boolean = false,
): Promise<ExportSkinPackResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<ExportSkinPackResult>("api_exportSkinPack", {
      params: { skinRoot, zipPath, layout, includeBlood },
    });
  }
  return httpPost<ExportSkinPackResult>("/api/skinPack/export", { skinRoot, zipPath, layout, includeBlood });
}

export function importSkinPack(
  skinRoot: string,
  zipPath: string,
  overwrite: boolean,
): Promise<ImportSkinPackResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<ImportSkinPackResult>("api_importSkinPack", {
      params: { skinRoot, zipPath, overwrite },
    });
  }
  return httpPost<ImportSkinPackResult>("/api/skinPack/import", { skinRoot, zipPath, overwrite });
}

// 系统文件选择器（仅 Tauri 可用）。Web 模式后端无法触达本机 FS，直接返回 null。
// filters 参数对齐 Tauri v2 DialogFilter：name + extensions（不含点）。
export interface DialogFilter {
  name: string;
  extensions: string[];
}

export function pickOpenFile(
  filters?: DialogFilter[],
  defaultPath?: string,
): Promise<string | null> {
  if (getRuntimeMode() !== "tauri") return Promise.resolve(null);
  return tauriInvoke<string | null>("plugin:dialog|open", {
    options: { multiple: false, directory: false, filters, defaultPath },
  });
}

export function pickSavePath(
  filters?: DialogFilter[],
  defaultPath?: string,
): Promise<string | null> {
  if (getRuntimeMode() !== "tauri") return Promise.resolve(null);
  return tauriInvoke<string | null>("plugin:dialog|save", {
    options: { filters, defaultPath },
  });
}


// 装配位置覆盖。预览拖动选中部件时调用，运行时改 entry.position（不持久化）。
// rotation / flipX / zOrder 都为可选；只想覆盖位置时其他字段留空，后端会回退装配表默认值。
export interface SetAssemblyOverrideParams {
  partName: string;
  category: PartCategory;
  position: { x: number; y: number };
  rotation?: number;
  flipX?: boolean;
  zOrder?: number;
}

export function setAssemblyOverride(params: SetAssemblyOverrideParams): Promise<void> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_setAssemblyOverride", { params });
  }
  return httpPost<void>("/api/assembly/override", params);
}

// 单皮肤翼装配配置：4 张翼独立 (x, y, rotation, zOrder)。
// 持久化到 <skin>/wings.json。下翼 (x,y) 为相对上翼根的偏移；下翼 rotation 为相对上翼末端的偏移。
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

export function loadWingsConfig(skinRoot: string, skinName: string): Promise<WingsConfig> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<WingsConfig>("api_loadWingsConfig", { params: { skinRoot, skinName } });
  }
  return httpPost<WingsConfig>("/api/wings", { skinRoot, skinName });
}

export function saveWingsConfig(skinRoot: string, skinName: string, config: WingsConfig): Promise<void> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_saveWingsConfig", { params: { skinRoot, skinName, config } });
  }
  return httpPost<void>("/api/wings/save", { skinRoot, skinName, config });
}

/// 切换单皮肤指定 id 配件的 enabled 字段并落盘 accessories.json。
export function setAccessoryEnabled(skinRoot: string, skinName: string, id: string, enabled: boolean): Promise<void> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_setAccessoryEnabled", { params: { skinRoot, skinName, id, enabled } });
  }
  return httpPost<void>("/api/accessories/setEnabled", { skinRoot, skinName, id, enabled });
}

/// 写整条配件配置；entry.id 已存在则原位替换，否则追加。
export function saveAccessoryConfig(skinRoot: string, skinName: string, entry: AccessoryEntry): Promise<void> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_saveAccessoryConfig", { params: { skinRoot, skinName, entry } });
  }
  return httpPost<void>("/api/accessories/save", { skinRoot, skinName, entry });
}

/// 读 per-skin blood.json；缺失时返回全 null 默认。
export function loadBloodConfig(skinRoot: string, skinName: string): Promise<BloodConfig> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<BloodConfig>("api_loadBloodConfig", { params: { skinRoot, skinName } });
  }
  return httpPost<BloodConfig>("/api/blood/load", { skinRoot, skinName });
}

/// 整体覆写 blood.json。
export function saveBloodConfig(skinRoot: string, skinName: string, config: BloodConfig): Promise<void> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_saveBloodConfig", { params: { skinRoot, skinName, config } });
  }
  return httpPost<void>("/api/blood/save", { skinRoot, skinName, config });
}

interface RawZonesData {
  width: number;
  height: number;
  ids: number[];
  config: { zones: ZoneEntry[] };
}

/// 读取部件区块 mask + 配置；缺失返回零 ids 数组与空 zones。
export async function loadZones(skinRoot: string, skinName: string, category: PartCategory, partName: string): Promise<ZonesData> {
  const raw = await (getRuntimeMode() === "tauri"
    ? tauriInvoke<RawZonesData>("api_loadZones", { params: { skinRoot, skinName, category, partName } })
    : httpPost<RawZonesData>("/api/zones/load", { skinRoot, skinName, category, partName }));
  return {
    width: raw.width,
    height: raw.height,
    ids: Uint8Array.from(raw.ids),
    config: raw.config ?? { zones: [] },
  };
}

/// 写整张 mask + 整份 config。
export function saveZones(skinRoot: string, skinName: string, category: PartCategory, partName: string, data: ZonesData): Promise<void> {
  const params = {
    skinRoot,
    skinName,
    category,
    partName,
    width: data.width,
    height: data.height,
    ids: Array.from(data.ids),
    config: data.config,
  };
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_saveZones", { params });
  }
  return httpPost<void>("/api/zones/save", params);
}

// 主窗口关闭拦截：仅 Tauri 桌面壳生效。Rust 端在用户点 X 时调 prevent_close
// 并把标志位置 true；前端轮询本接口拿到 true 后弹确认对话框。
// Web 模式后端没注册本命令，直接返回 false 即可。
export function pollCloseRequest(): Promise<boolean> {
  if (getRuntimeMode() !== "tauri") return Promise.resolve(false);
  return tauriInvoke<boolean>("api_pollCloseRequest", {}).catch(() => false);
}

// 用户在确认对话框选"丢弃 / 保存后退出"后调用：Rust 端置 forceClose 并主动关窗。
export function confirmCloseMain(): Promise<void> {
  if (getRuntimeMode() !== "tauri") return Promise.resolve();
  return tauriInvoke<void>("api_confirmCloseMain", {}).catch(() => undefined);
}

// 图片拖入：把 base64 编码的图片字节存进进程级 imageStore。token 由前端生成，
// 子窗口通过同一 token 取回字节渲染；主窗口取色器通过屏幕坐标命中子窗口找回 token。
export function storeImage(token: string, base64Data: string): Promise<void> {
  return tauriInvoke<void>("api_storeImage", { params: { token, base64Data } });
}

export interface LoadImageResult {
  width: number;
  height: number;
  pixels: number[];
}

export function loadImage(token: string): Promise<LoadImageResult> {
  return tauriInvoke<LoadImageResult>("api_loadImage", { params: { token } });
}

export function releaseImage(token: string): Promise<void> {
  return tauriInvoke<void>("api_releaseImage", { params: { token } }).catch(() => undefined);
}

// 主窗口取色器调用：传屏幕坐标 + 子窗口顶栏 toolbar 物理高度，Rust 遍历 image_*
// 子窗口找命中者，按 contain 缩放算图片像素坐标取 RGB。null 表示未命中。
export function pickImagePixelByScreenCoord(
  screenX: number,
  screenY: number,
  toolbarHeight: number,
): Promise<[number, number, number] | null> {
  if (getRuntimeMode() !== "tauri") return Promise.resolve(null);
  return tauriInvoke<[number, number, number] | null>(
    "api_pickImagePixelByScreenCoord",
    { params: { screenX, screenY, toolbarHeight } },
  ).catch(() => null);
}

// 取色笔轮询：拿当前光标的屏幕坐标。鼠标移出主窗口后浏览器 mousemove 不再触发，
// 必须用 Windows GetCursorPos 主动轮询。仅 Tauri 桌面壳生效。
export function getCursorScreenPos(): Promise<{ x: number; y: number } | null> {
  if (getRuntimeMode() !== "tauri") return Promise.resolve(null);
  return tauriInvoke<{ x: number; y: number }>("api_getCursorScreenPos", {}).catch(() => null);
}

// 检测鼠标左键状态。轮询期间通过未按 → 按下的边沿判定"用户点了确认取色"。
export function isMouseLeftDown(): Promise<boolean> {
  if (getRuntimeMode() !== "tauri") return Promise.resolve(false);
  return tauriInvoke<boolean>("api_isMouseLeftDown", {}).catch(() => false);
}

// 取色态全局 flag：主窗口取色器 start/stop 调 set，图片子窗口 mountImageWindow
// 启动轮询 is，决定自身 cursor 是否变滴管。
export function setPickActive(active: boolean): Promise<void> {
  if (getRuntimeMode() !== "tauri") return Promise.resolve();
  return tauriInvoke<void>("api_setPickActive", { active }).catch(() => undefined);
}

export function isPickActive(): Promise<boolean> {
  if (getRuntimeMode() !== "tauri") return Promise.resolve(false);
  return tauriInvoke<boolean>("api_isPickActive", {}).catch(() => false);
}
