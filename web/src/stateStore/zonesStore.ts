// 当前编辑部件的区块遮罩与配置共享状态（连同所属 partId 绑定，防止切换部件时闭包串写）。

import type { ZonesData, ZoneEntry } from "./types";

export interface ZonesStoreState {
  partId: string | null;
  data: ZonesData | null;
  version: number;
}

const listeners = new Set<() => void>();
const state: ZonesStoreState = { partId: null, data: null, version: 0 };

export const zonesStore = {
  get: (): ZonesStoreState => state,
  set: (data: ZonesData | null, partId: string | null = null): void => {
    state.partId = data ? partId : null;
    state.data = data;
    state.version++;
    for (const l of listeners) l();
  },
  bump: (): void => {
    state.version++;
    for (const l of listeners) l();
  },
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

/** 查找 `1..=255` 范围内首个未占用的区块 ID；已满返回 `0`。 */
export function nextFreeZoneId(zones: ZoneEntry[]): number {
  const used = new Set(zones.map((z) => z.id));
  for (let id = 1; id <= 255; id++) {
    if (!used.has(id)) return id;
  }
  return 0;
}
