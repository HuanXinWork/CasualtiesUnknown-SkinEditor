// 前端内存会话状态容器；持久化配置通过 workspacePersist 同步至 workspace.json。

import type { Orientation, PartCategory, ThemeConfig } from "./types";
import type { HeadVariant, PixelDiff } from "../apiClient";
import { defaultTheme } from "./theme";

export type Tool = "brush" | "eraser" | "pan" | "gradient" | "zoneBrush" | "fill" | "softBrush";

export type Lang = "zh" | "en";

export interface AppliedDiff {
  partId: string;
  diff: PixelDiff;
  phase: "before" | "after";
}

export interface HistoryRecord {
  id: number;
  partId: string;
  tool: "brush" | "eraser" | "gradient" | "fill" | "softBrush" | "transform" | "undo" | "redo";
  rectW: number;
  rectH: number;
  timestamp: number;
}

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
  layerSnapshotVersion: number;
  assemblyOverrideVersion: number;
  partListVersion: number;
  accessoriesVersion: number;
  activeZoneId: number;
  eraserMode: "part" | "zone";
  history: HistoryRecord[];
  orientation: Orientation;
  expressionIndex: number;
  headVariant: HeadVariant;
  lang: Lang;
  shortcuts?: Record<string, string>;
  showMotionDebugPanel: boolean;
  showWingDebugPanel: boolean;
  showBloodPanel: boolean;
  autoSaveEnabled: boolean;
  autoSaveIntervalSec: number;
  /** `""` 表示尚未记住选择，切换脏部件时弹框询问。 */
  switchSaveBehavior: "ask" | "auto" | "save" | "";
  softBrushHardness: number;
  dirtyPartIds: string[];
}

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
    partListVersion: 0,
    accessoriesVersion: 0,
    activeZoneId: 1,
    eraserMode: "part",
    history: [],
    orientation: "front",
    expressionIndex: 0,
    headVariant: "default",
    lang: "zh",
    showMotionDebugPanel: true,
    showWingDebugPanel: false,
    showBloodPanel: false,
    autoSaveEnabled: false,
    autoSaveIntervalSec: 60,
    switchSaveBehavior: "",
    softBrushHardness: 128,
    dirtyPartIds: [],
  };
}

export const sessionStore: Store<SessionState> = createStore(buildInitialState());

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

export interface ParsedPartId {
  skinName: string;
  category: PartCategory;
  partName: string;
}

const VALID_CATEGORIES = new Set<string>(["Body", "Head", "Wings", "Accessories", "Blood"]);

/** 解析 `skinName::Category::partName` 会话键。 */
export function parsePartId(partId: string): ParsedPartId | null {
  const parts = partId.split("::");
  if (parts.length !== 3) return null;
  const [skinName, category, partName] = parts;
  if (!skinName || !partName || !VALID_CATEGORIES.has(category)) return null;
  return { skinName, category: category as PartCategory, partName };
}

export function partIdToTargetPath(skinRoot: string, partId: string): string | null {
  const parsed = parsePartId(partId);
  if (!parsed) return null;
  return `${skinRoot}/${parsed.skinName}/${parsed.category}/${parsed.partName}.png`;
}

// 每个部件维护单调脏版本号，防止异步保存返回时清掉保存期间新产生的改动。
const dirtyRevisions = new Map<string, number>();

export function getPartDirtyRevision(partId: string): number {
  return dirtyRevisions.get(partId) ?? 0;
}

export function markPartDirty(partId: string): void {
  if (!partId) return;
  dirtyRevisions.set(partId, (dirtyRevisions.get(partId) ?? 0) + 1);
  const list = sessionStore.getState().dirtyPartIds;
  if (list.includes(partId)) return;
  sessionStore.setState({ dirtyPartIds: [...list, partId] });
}

/** 清除部件脏标记；若传入 `expectedRevision` 且期间产生新编辑则保留脏态。 */
export function markPartClean(partId: string, expectedRevision?: number): void {
  if (expectedRevision !== undefined && getPartDirtyRevision(partId) !== expectedRevision) {
    return;
  }
  const list = sessionStore.getState().dirtyPartIds;
  if (!list.includes(partId)) return;
  sessionStore.setState({ dirtyPartIds: list.filter((id) => id !== partId) });
}

export function isPartDirty(partId: string | null): boolean {
  if (!partId) return false;
  return sessionStore.getState().dirtyPartIds.includes(partId);
}

export function bumpLayerSnapshotVersion(): void {
  const v = sessionStore.getState().layerSnapshotVersion ?? 0;
  sessionStore.setState({ layerSnapshotVersion: v + 1 });
}

export function bumpAssemblyOverrideVersion(): void {
  const v = sessionStore.getState().assemblyOverrideVersion ?? 0;
  sessionStore.setState({ assemblyOverrideVersion: v + 1 });
}

export function bumpPartListVersion(): void {
  const v = sessionStore.getState().partListVersion ?? 0;
  sessionStore.setState({ partListVersion: v + 1 });
}

export function bumpAccessoriesVersion(): void {
  const v = sessionStore.getState().accessoriesVersion ?? 0;
  sessionStore.setState({ accessoriesVersion: v + 1 });
}
