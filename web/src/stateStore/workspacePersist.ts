// 工作区单点串行持久化：在内存中维护唯一快照并串行落盘，消除多模块并发写覆盖与字段丢失。

import { getWorkspace, saveWorkspace, type WorkspaceResult } from "../apiClient";
import { defaultTheme } from "./theme";
import type { PanelLayout, ThemeConfig, WorkspaceLayout, WorkspaceSettings } from "./types";

export interface WorkspaceSnapshot {
  layout: WorkspaceLayout;
  theme: ThemeConfig;
}

const DEFAULT_SETTINGS: WorkspaceSettings = {
  showMotionDebugPanel: true,
  showWingDebugPanel: false,
  showBloodPanel: false,
};

let snapshot: WorkspaceSnapshot | null = null;
let loadPromise: Promise<WorkspaceSnapshot> | null = null;
let pendingMutators: Array<(draft: WorkspaceSnapshot) => void> = [];
let debounceTimer: number | null = null;
let activePath = "data/workspace.json";
let writeChain: Promise<void> = Promise.resolve();

function ensureSettings(layout: WorkspaceLayout): WorkspaceSettings {
  if (!layout.settings) {
    layout.settings = { ...DEFAULT_SETTINGS };
  }
  return layout.settings;
}

/** 启动时拉取 workspace.json 初始化内存快照。 */
export async function initWorkspaceCache(workspacePath: string): Promise<WorkspaceResult> {
  activePath = workspacePath;
  const ws = await getWorkspace(workspacePath);
  snapshot = {
    layout: structuredClone(ws.layout),
    theme: structuredClone(ws.theme),
  };
  ensureSettings(snapshot.layout);
  if (pendingMutators.length > 0) {
    for (const fn of pendingMutators) fn(snapshot);
    pendingMutators = [];
  }
  return ws;
}

export function replaceWorkspaceCache(layout: WorkspaceLayout, theme: ThemeConfig): void {
  snapshot = {
    layout: structuredClone(layout),
    theme: structuredClone(theme),
  };
  ensureSettings(snapshot.layout);
}

export function getCachedWorkspace(): WorkspaceSnapshot | null {
  return snapshot;
}

async function ensureLoaded(workspacePath: string): Promise<WorkspaceSnapshot> {
  if (snapshot) return snapshot;
  if (!loadPromise) {
    loadPromise = getWorkspace(workspacePath)
      .then((ws) => {
        if (!snapshot) {
          snapshot = {
            layout: structuredClone(ws.layout),
            theme: structuredClone(ws.theme),
          };
          ensureSettings(snapshot.layout);
        }
        return snapshot;
      })
      .catch(() => {
        if (!snapshot) {
          snapshot = {
            layout: { version: 1, panels: [], splitRatios: {}, settings: { ...DEFAULT_SETTINGS } },
            theme: defaultTheme(),
          };
        }
        return snapshot;
      })
      .finally(() => {
        loadPromise = null;
      });
  }
  const loaded = await loadPromise;
  if (pendingMutators.length > 0) {
    for (const fn of pendingMutators) fn(loaded);
    pendingMutators = [];
  }
  return loaded;
}

/** 对工作区快照执行局部变更，并在去抖后单飞串行写盘。 */
export function updateWorkspace(
  workspacePath: string,
  mutator: (draft: WorkspaceSnapshot) => void,
  debounceMs = 250,
): void {
  activePath = workspacePath;
  if (snapshot) {
    mutator(snapshot);
  } else {
    pendingMutators.push(mutator);
  }
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer);
  }
  if (debounceMs <= 0) {
    debounceTimer = null;
    void flushWorkspace(workspacePath);
    return;
  }
  debounceTimer = window.setTimeout(() => {
    debounceTimer = null;
    void flushWorkspace(workspacePath);
  }, debounceMs);
}

/** 局部合并 `workspace.layout.settings` 子字段并去抖写盘。 */
export function updateWorkspaceSettings(
  workspacePath: string,
  patch: Partial<WorkspaceSettings>,
  debounceMs = 200,
): void {
  updateWorkspace(
    workspacePath,
    (draft) => {
      const cur = ensureSettings(draft.layout);
      draft.layout.settings = { ...cur, ...patch };
    },
    debounceMs,
  );
}

/** 更新或补插指定面板的折叠状态，兼容未在默认模板列出的扩展面板。 */
export function upsertPanelCollapsed(
  panels: PanelLayout[],
  panelId: string,
  collapsed: boolean,
  fallbackSize: { width: number; height: number } = { width: 280, height: 400 },
): PanelLayout[] {
  let found = false;
  const next = panels.map((p) => {
    if (p.id === panelId) {
      found = true;
      return { ...p, collapsed };
    }
    return p;
  });
  if (!found) {
    next.push({
      id: panelId,
      state: "docked",
      size: { width: fallbackSize.width, height: fallbackSize.height },
      collapsed,
    });
  }
  return next;
}

/** 立即将当前工作区快照串行写入磁盘。 */
export function flushWorkspace(workspacePath = activePath): Promise<void> {
  if (debounceTimer !== null) {
    window.clearTimeout(debounceTimer);
    debounceTimer = null;
  }
  writeChain = writeChain.then(async () => {
    const cur = await ensureLoaded(workspacePath);
    const layoutCopy = structuredClone(cur.layout);
    const themeCopy = structuredClone(cur.theme);
    try {
      await saveWorkspace(workspacePath, layoutCopy, themeCopy);
    } catch (e) {
      console.warn("[workspacePersist] saveWorkspace failed", e);
    }
  });
  return writeChain;
}
