// 单点管理所有可调容器尺寸（mainPane.* + dockable.<panel>.height），
// 与 DOM flex-basis 绑定，拖拽结束后 300ms 去抖写盘到 workspace.json。

import type { PanelLayout, ThemeConfig, WorkspaceLayout } from "../stateStore/types";
import { saveWorkspace } from "../apiClient";

// 与后端 windowManager::defaultLayoutSizes 一一对应；缺失的 key 由本表兜底。
export const DEFAULT_LAYOUT: Readonly<Record<string, number>> = Object.freeze({
  "mainPane.left": 220,
  "mainPane.preview": 320,
  "mainPane.right": 280,
  "mainPane.bottom": 200,
});

// 旧 splitRatios 4 个 key 与新 sizes 字段的语义映射，仅用于反序列化兜底。
const LEGACY_RATIO_TO_SIZE: Readonly<Record<string, string>> = Object.freeze({
  sidebarLeft: "mainPane.left",
  sidebarPreview: "mainPane.preview",
  sidebarRight: "mainPane.right",
  bottomLayers: "mainPane.bottom",
});

interface PersistContext {
  workspacePath: string;
  getPanels: () => PanelLayout[];
  getTheme: () => ThemeConfig;
}

const state = new Map<string, number>();
// 写盘时把旧 splitRatios 原样回填，避免误丢未参与新模型的字段。
let lastSplitRatios: Record<string, number> = {};
let persistCtx: PersistContext | null = null;
let saveTimer: number | null = null;

export function hydrateFromWorkspace(layout: WorkspaceLayout): void {
  state.clear();
  // 1) 默认值
  for (const [k, v] of Object.entries(DEFAULT_LAYOUT)) state.set(k, v);
  // 2) 旧 splitRatios 映射覆盖（保留原始表用于回写兼容）
  lastSplitRatios = { ...(layout.splitRatios ?? {}) };
  for (const [legacy, mapped] of Object.entries(LEGACY_RATIO_TO_SIZE)) {
    const v = lastSplitRatios[legacy];
    if (typeof v === "number" && Number.isFinite(v)) state.set(mapped, v);
  }
  // 3) 新 sizes 字段最终覆盖（优先级最高）
  if (layout.sizes) {
    for (const [k, v] of Object.entries(layout.sizes)) {
      if (typeof v === "number" && Number.isFinite(v)) state.set(k, v);
    }
  }
}

export function getSize(key: string): number | undefined {
  return state.get(key);
}

export function setSize(key: string, px: number): void {
  if (!Number.isFinite(px)) return;
  state.set(key, px);
  scheduleSave();
}

export function setPersistContext(ctx: {
  workspacePath: string;
  getPanels: () => PanelLayout[];
  getTheme: () => ThemeConfig;
}): void {
  persistCtx = ctx;
}

export function makeDragHandle(opts: {
  orientation: "horizontal" | "vertical";
  key: string;
  host: HTMLElement;
  sign: 1 | -1;
  getMin: () => number;
  getMax: () => number;
}): HTMLElement {
  const { orientation, key, host, sign, getMin, getMax } = opts;
  const isVertical = orientation === "vertical";
  const divider = document.createElement("div");
  divider.className = `layout-divider ${isVertical ? "layout-divider-v" : "layout-divider-h"}`;
  divider.dataset.layoutKey = key;

  divider.addEventListener("mousedown", (e: MouseEvent) => {
    e.preventDefault();
    const rect = host.getBoundingClientRect();
    const startCoord = isVertical ? e.clientX : e.clientY;
    const startSize = isVertical ? rect.width : rect.height;
    const cursor = isVertical ? "col-resize" : "row-resize";
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = cursor;
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent): void => {
      const cur = isVertical ? ev.clientX : ev.clientY;
      const delta = (cur - startCoord) * sign;
      const next = Math.max(getMin(), Math.min(getMax(), startSize + delta));
      host.style.flexBasis = `${next}px`;
      state.set(key, next);
    };
    const onUp = (): void => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      scheduleSave();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  return divider;
}

function scheduleSave(): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void persist();
  }, 300);
}

async function persist(): Promise<void> {
  if (!persistCtx) return;
  const sizes: Record<string, number> = {};
  for (const [k, v] of state) sizes[k] = v;
  const layout: WorkspaceLayout = {
    version: 1,
    panels: persistCtx.getPanels(),
    splitRatios: lastSplitRatios,
    sizes,
  };
  try {
    await saveWorkspace(persistCtx.workspacePath, layout, persistCtx.getTheme());
  } catch (e) {
    console.warn("[layoutEngine] saveWorkspace failed", e);
  }
}
