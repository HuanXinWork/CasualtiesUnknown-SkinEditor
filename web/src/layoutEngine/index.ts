// 容器尺寸布局引擎：绑定可拖拽 flex-basis 分隔条并通过 workspacePersist 合并落盘。

import type { PanelLayout, ThemeConfig, WorkspaceLayout } from "../stateStore/types";
import { updateWorkspace } from "../stateStore/workspacePersist";

export const DEFAULT_LAYOUT: Readonly<Record<string, number>> = Object.freeze({
  "mainPane.left": 220,
  "mainPane.preview": 320,
  "mainPane.right": 280,
  "mainPane.bottom": 200,
  "editorCanvas.footerPct": 25,
});

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
let lastSplitRatios: Record<string, number> = {};
let persistCtx: PersistContext | null = null;

export function hydrateFromWorkspace(layout: WorkspaceLayout): void {
  state.clear();
  for (const [k, v] of Object.entries(DEFAULT_LAYOUT)) state.set(k, v);
  lastSplitRatios = { ...(layout.splitRatios ?? {}) };
  for (const [legacy, mapped] of Object.entries(LEGACY_RATIO_TO_SIZE)) {
    const v = lastSplitRatios[legacy];
    if (typeof v === "number" && Number.isFinite(v)) state.set(mapped, v);
  }
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

export function setPersistContext(ctx: PersistContext): void {
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
  if (!persistCtx) return;
  const ctx = persistCtx;
  const sizes: Record<string, number> = {};
  for (const [k, v] of state) sizes[k] = v;
  updateWorkspace(
    ctx.workspacePath,
    (draft) => {
      draft.layout.splitRatios = { ...lastSplitRatios };
      draft.layout.sizes = { ...(draft.layout.sizes ?? {}), ...sizes };
      draft.theme = ctx.getTheme();
    },
    300,
  );
}
