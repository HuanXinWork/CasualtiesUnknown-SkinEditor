// 前端会话级状态容器。仅在内存中维护当前 skin、选中 part、当前工具、画笔参数、
// 主题等；刷新页面即重置，持久化交给 workspace.json。

import type { Orientation, PartCategory, ThemeConfig } from "./types";
import type { HeadVariant, PixelDiff } from "../apiClient";
import { defaultTheme } from "./theme";

/// 编辑工具：brush / eraser / pan / gradient。
export type Tool = "brush" | "eraser" | "pan" | "gradient";

/// i18n 语言；会话级，刷新页面回到默认 zh，不写盘。
export type Lang = "zh" | "en";

/// 广播给订阅方的"刚刚应用到 active 图层的 PixelDiff"。
/// phase=after 贴 diff.after（brush/eraser/redo），phase=before 贴 diff.before（undo）。
export interface AppliedDiff {
  partId: string;
  diff: PixelDiff;
  phase: "before" | "after";
}

/// 历史 popover 用的元数据。撤销 / 重做语义由后端 historyManager 维护，
/// 前端历史只是 UI 可视化，不存 PixelDiff 字节。
export interface HistoryRecord {
  id: number;
  partId: string;
  tool: "brush" | "eraser" | "gradient" | "undo" | "redo";
  rectW: number;
  rectH: number;
  timestamp: number;
}

/// 会话级状态。currentPartId 由 editorCanvas 在 loadPartImage 后写入；
/// lastAppliedDiff 由编辑发起方广播，editorCanvas 单点订阅做 putImageData。
export interface SessionState {
  currentSkinName: string | null;
  selectedPartName: string | null;
  selectedCategory: PartCategory | null;
  currentPartId: string | null;
  activeTool: Tool;
  brushSize: number;
  color: [number, number, number];
  alpha: number;
  theme: ThemeConfig;
  lastAppliedDiff: AppliedDiff | null;
  /// layerPanel 增删改图层后递增；editorCanvas 监听变化重拉 flatten 刷新画布。
  layerSnapshotVersion: number;
  /// wingDebugPanel 改 override 后递增；previewCanvas 监听变化重拉合成预览。
  assemblyOverrideVersion: number;
  /// 历史环形缓冲，最多 50 条。
  history: HistoryRecord[];
  /// previewCanvas 合成预览的过滤参数。
  orientation: Orientation;
  expressionIndex: number;
  headVariant: HeadVariant;
  lang: Lang;
  /// 用户自定义快捷键覆盖；缺失字段走 DEFAULT_SHORTCUTS。
  shortcuts?: Record<string, string>;
  /// Motion 预览右侧当前帧部件调试面板显隐。
  showMotionDebugPanel: boolean;
  /// 翼装配调试面板显隐；默认关闭，需要时去设置勾选。
  showWingDebugPanel: boolean;
  /// 未保存改动追踪：brush/eraser/gradient/undo/redo 后置脏；savePart 成功后清脏。
  dirtyPartIds: string[];
}

/// 最小订阅式容器：读、浅 merge 写、订阅。
export interface Store<T> {
  getState(): T;
  setState(partial: Partial<T>): void;
  subscribe(listener: (state: T) => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state: T = initial;
  const listeners = new Set<(state: T) => void>();
  return {
    getState() {
      return state;
    },
    setState(partial) {
      state = { ...state, ...partial };
      for (const listener of listeners) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

// 默认初值：未选中 skin / part；画笔 8px、纯黑、不透明；浅色主题。
function buildInitialState(): SessionState {
  return {
    currentSkinName: null,
    selectedPartName: null,
    selectedCategory: null,
    currentPartId: null,
    activeTool: "brush",
    brushSize: 8,
    color: [0, 0, 0],
    alpha: 255,
    theme: defaultTheme(),
    lastAppliedDiff: null,
    layerSnapshotVersion: 0,
    assemblyOverrideVersion: 0,
    history: [],
    orientation: "front",
    expressionIndex: 0,
    headVariant: "default",
    lang: "zh",
    showMotionDebugPanel: true,
    showWingDebugPanel: false,
    dirtyPartIds: [],
  };
}

export const sessionStore: Store<SessionState> = createStore(buildInitialState());

// 把一次操作 push 到历史环形缓冲。最多 HISTORY_MAX 条，超过丢弃最早；
// id 单调递增不复用，便于历史面板用作稳定 key。
const HISTORY_MAX = 50;
let historyIdSeq = 0;
export function pushHistoryRecord(record: Omit<HistoryRecord, "id" | "timestamp">): void {
  const cur = sessionStore.getState().history;
  const next: HistoryRecord = {
    id: ++historyIdSeq,
    timestamp: Date.now(),
    ...record,
  };
  const trimmed = cur.length >= HISTORY_MAX
    ? [...cur.slice(cur.length - HISTORY_MAX + 1), next]
    : [...cur, next];
  sessionStore.setState({ history: trimmed });
}

// 脏标记：编辑后调 markPartDirty，savePart 成功后调 markPartClean。
export function markPartDirty(partId: string): void {
  const list = sessionStore.getState().dirtyPartIds;
  if (list.includes(partId)) return;
  sessionStore.setState({ dirtyPartIds: [...list, partId] });
}

export function markPartClean(partId: string): void {
  const list = sessionStore.getState().dirtyPartIds;
  if (!list.includes(partId)) return;
  sessionStore.setState({ dirtyPartIds: list.filter((id) => id !== partId) });
}

export function isPartDirty(partId: string | null): boolean {
  if (!partId) return false;
  return sessionStore.getState().dirtyPartIds.includes(partId);
}

/// 调试面板改装配 override 后调一次，让 previewCanvas 重拉合成预览。
export function bumpAssemblyOverrideVersion(): void {
  const v = sessionStore.getState().assemblyOverrideVersion ?? 0;
  sessionStore.setState({ assemblyOverrideVersion: v + 1 });
}
