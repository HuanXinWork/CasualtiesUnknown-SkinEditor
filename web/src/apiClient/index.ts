// Tauri IPC 与 HTTP REST 双形态统一客户端入口。

import type {
  AccessoryEntry,
  BloodConfig,
  PartCategory,
  Skin,
  ThemeConfig,
  WorkspaceLayout,
  ZoneEntry,
  ZonesData,
} from "../stateStore/types";
import { getRuntimeMode } from "../runtimeMode";
import type {
  ApiError,
  AssemblyResult,
  BaseSizeResult,
  BrushParams,
  CompositeParams,
  CompositeResult,
  CreateOrientationPartResult,
  CreatePartResult,
  CreateSidePartResult,
  DialogFilter,
  EraserParams,
  ExportLayout,
  ExportSkinPackResult,
  FillParams,
  GradientParams,
  ImportSkinPackResult,
  LayersSnapshot,
  LayerTransform,
  LoadImageResult,
  LoadPartResult,
  MotionCaptureMeta,
  MotionCaptureResult,
  MotionCompositeParams,
  MotionCompositeResult,
  PixelDiff,
  ResizePartResult,
  SetAssemblyOverrideParams,
  SoftBrushParams,
  WingsConfig,
  WorkspaceResult,
} from "./types";

export type * from "./types";

interface TauriInternals {
  invoke?: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
}

/** 归一化 Tauri IPC 抛出的 JSON 错误字符串为结构化 `ApiError`。 */
function normalizeInvokeError(raw: unknown): ApiError {
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as Partial<ApiError>;
      if (parsed && typeof parsed.code === "string" && typeof parsed.message === "string") {
        return { code: parsed.code, message: parsed.message };
      }
    } catch {
      return { code: "invoke_error", message: raw };
    }
    return { code: "invoke_error", message: raw };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Partial<ApiError>;
    if (typeof obj.message === "string") {
      return { code: typeof obj.code === "string" ? obj.code : "invoke_error", message: obj.message };
    }
  }
  return { code: "invoke_error", message: String(raw) };
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
  return (invoke(cmd, args) as Promise<T>).catch((err) => Promise.reject<T>(normalizeInvokeError(err)));
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

/** 丢弃后端内存中未保存的部件会话，使下次加载与预览回退到磁盘文件。 */
export function discardPart(partId: string): Promise<void> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_discardPart", { params: { partId } });
  }
  return httpPost<void>("/api/discardPart", { partId });
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

export function savePart(partId: string, targetPath: string): Promise<void> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_savePart", { params: { partId, targetPath } });
  }
  return httpPost<void>("/api/savePart", { partId, targetPath });
}

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

export function getBaseSize(
  skinRoot: string,
  skinName: string,
  category: PartCategory,
  partName: string,
): Promise<BaseSizeResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<BaseSizeResult>("api_getBaseSize", {
      params: { skinRoot, skinName, category, partName },
    });
  }
  return httpPost<BaseSizeResult>("/api/baseSize", { skinRoot, skinName, category, partName });
}

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

export function createOrientationPart(
  skinRoot: string,
  skinName: string,
  category: PartCategory,
  partName: string,
): Promise<CreateOrientationPartResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<CreateOrientationPartResult>("api_createOrientationPart", {
      params: { skinRoot, skinName, category, partName },
    });
  }
  return httpPost<CreateOrientationPartResult>("/api/createOrientationPart", {
    skinRoot, skinName, category, partName,
  });
}

export function createPart(
  skinRoot: string,
  skinName: string,
  category: PartCategory,
  fileName: string,
  width: number,
  height: number,
): Promise<CreatePartResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<CreatePartResult>("api_createPart", {
      params: { skinRoot, skinName, category, fileName, width, height },
    });
  }
  return httpPost<CreatePartResult>("/api/createPart", {
    skinRoot, skinName, category, fileName, width, height,
  });
}

export function copyPart(
  skinRoot: string,
  skinName: string,
  category: PartCategory,
  sourcePartName: string,
  targetPartName: string,
  overwrite: boolean,
): Promise<CreatePartResult> {
  const params = { skinRoot, skinName, category, sourcePartName, targetPartName, overwrite };
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<CreatePartResult>("api_copyPart", { params });
  }
  return httpPost<CreatePartResult>("/api/copyPart", params);
}

export function createPartFromTemplate(
  skinRoot: string,
  skinName: string,
  category: PartCategory,
  partName: string,
): Promise<CreatePartResult> {
  const params = { skinRoot, skinName, category, partName };
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<CreatePartResult>("api_createPartFromTemplate", { params });
  }
  return httpPost<CreatePartResult>("/api/createPartFromTemplate", params);
}

export function deletePart(
  skinRoot: string,
  skinName: string,
  category: PartCategory,
  partName: string,
): Promise<void> {
  const params = { skinRoot, skinName, category, partName };
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_deletePart", { params });
  }
  return httpPost<void>("/api/deletePart", params);
}

export function copyLayerToPart(
  sourcePartId: string,
  sourceLayerId: string,
  targetPartId: string,
): Promise<LayersSnapshot> {
  const params = { sourcePartId, sourceLayerId, targetPartId };
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<LayersSnapshot>("api_copyLayerToPart", { params });
  }
  return httpPost<LayersSnapshot>("/api/layer/copyToPart", params);
}

export function setLayerTransform(
  partId: string,
  layerId: string,
  transform: LayerTransform | null,
): Promise<void> {
  const params = { partId, layerId, transform };
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_setLayerTransform", { params });
  }
  return httpPost<void>("/api/layer/transform", params);
}

export function bakeLayerTransform(partId: string, layerId: string): Promise<PixelDiff> {
  const params = { partId, layerId };
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<PixelDiff>("api_bakeLayerTransform", { params });
  }
  return httpPost<PixelDiff>("/api/layer/transform/bake", params);
}

export function applyGradient(params: GradientParams): Promise<PixelDiff> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<PixelDiff>("api_applyGradient", { params });
  }
  return httpPost<PixelDiff>("/api/gradient", params);
}

export function applyFill(params: FillParams): Promise<PixelDiff> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<PixelDiff>("api_applyFill", { params });
  }
  return httpPost<PixelDiff>("/api/fill", params);
}

export function applySoftBrush(params: SoftBrushParams): Promise<PixelDiff> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<PixelDiff>("api_applySoftBrush", { params });
  }
  return httpPost<PixelDiff>("/api/softBrush", params);
}

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

export function getFlatten(partId: string): Promise<LoadPartResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<LoadPartResult>("api_getFlatten", { params: { partId } });
  }
  const qs = new URLSearchParams({ partId }).toString();
  return httpGet<LoadPartResult>(`/api/flatten?${qs}`);
}

export function getCompositeImage(params: CompositeParams): Promise<CompositeResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<CompositeResult>("api_getCompositeImage", { params });
  }
  return httpPost<CompositeResult>("/api/composite", params);
}

export function getMotionCompositeImage(params: MotionCompositeParams): Promise<MotionCompositeResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<MotionCompositeResult>("api_getMotionCompositeImage", { params });
  }
  return httpPost<MotionCompositeResult>("/api/motionComposite", params);
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

export function resetLayout(): Promise<WorkspaceResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<WorkspaceResult>("api_resetLayout", {});
  }
  return httpPost<WorkspaceResult>("/api/workspace/reset", {});
}

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

export function setAssemblyOverride(params: SetAssemblyOverrideParams): Promise<void> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_setAssemblyOverride", { params });
  }
  return httpPost<void>("/api/assembly/override", params);
}

export function getAssemblyTable(path: string): Promise<AssemblyResult> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<AssemblyResult>("api_getAssemblyTable", { params: { path } });
  }
  const qs = new URLSearchParams({ path }).toString();
  return httpGet<AssemblyResult>(`/api/assembly?${qs}`);
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

export function setAccessoryEnabled(skinRoot: string, skinName: string, id: string, enabled: boolean): Promise<void> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_setAccessoryEnabled", { params: { skinRoot, skinName, id, enabled } });
  }
  return httpPost<void>("/api/accessories/setEnabled", { skinRoot, skinName, id, enabled });
}

export function saveAccessoryConfig(skinRoot: string, skinName: string, entry: AccessoryEntry): Promise<void> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<void>("api_saveAccessoryConfig", { params: { skinRoot, skinName, entry } });
  }
  return httpPost<void>("/api/accessories/save", { skinRoot, skinName, entry });
}

export function loadBloodConfig(skinRoot: string, skinName: string): Promise<BloodConfig> {
  if (getRuntimeMode() === "tauri") {
    return tauriInvoke<BloodConfig>("api_loadBloodConfig", { params: { skinRoot, skinName } });
  }
  return httpPost<BloodConfig>("/api/blood/load", { skinRoot, skinName });
}

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

export function pollCloseRequest(): Promise<boolean> {
  if (getRuntimeMode() !== "tauri") return Promise.resolve(false);
  return tauriInvoke<boolean>("api_pollCloseRequest", {}).catch(() => false);
}

export function confirmCloseMain(): Promise<void> {
  if (getRuntimeMode() !== "tauri") return Promise.resolve();
  return tauriInvoke<void>("api_confirmCloseMain", {}).catch(() => undefined);
}

export function storeImage(token: string, base64Data: string): Promise<void> {
  return tauriInvoke<void>("api_storeImage", { params: { token, base64Data } });
}

export function loadImage(token: string): Promise<LoadImageResult> {
  return tauriInvoke<LoadImageResult>("api_loadImage", { params: { token } });
}

export function releaseImage(token: string): Promise<void> {
  return tauriInvoke<void>("api_releaseImage", { params: { token } }).catch(() => undefined);
}

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

export function getCursorScreenPos(): Promise<{ x: number; y: number } | null> {
  if (getRuntimeMode() !== "tauri") return Promise.resolve(null);
  return tauriInvoke<{ x: number; y: number }>("api_getCursorScreenPos", {}).catch(() => null);
}

export function isMouseLeftDown(): Promise<boolean> {
  if (getRuntimeMode() !== "tauri") return Promise.resolve(false);
  return tauriInvoke<boolean>("api_isMouseLeftDown", {}).catch(() => false);
}

export function setPickActive(active: boolean): Promise<void> {
  if (getRuntimeMode() !== "tauri") return Promise.resolve();
  return tauriInvoke<void>("api_setPickActive", { active }).catch(() => undefined);
}

export function isPickActive(): Promise<boolean> {
  if (getRuntimeMode() !== "tauri") return Promise.resolve(false);
  return tauriInvoke<boolean>("api_isPickActive", {}).catch(() => false);
}
