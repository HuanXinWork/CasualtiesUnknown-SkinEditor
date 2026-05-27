// 跨模块共享的当前部件区块数据。
// editorCanvas 在 loadZones / paintZone / 删除 / 新建 后写入并 bump version；
// layerPanel 订阅以渲染区块管理 UI。

import type { ZonesData, ZoneEntry } from "./types";

interface ZonesStoreState {
  data: ZonesData | null;
  version: number;
}

const listeners = new Set<() => void>();
const state: ZonesStoreState = { data: null, version: 0 };

export const zonesStore = {
  get: (): ZonesStoreState => state,
  set: (data: ZonesData | null): void => {
    state.data = data;
    state.version++;
    for (const l of listeners) l();
  },
  /// 在不替换 data 引用的情况下声明数据已改（mask 或 config 内部突变）；触发订阅刷新。
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

/// 在 1~255 范围内找到第一个未占用的 ID；都满返回 0（前端层面不创建）。
export function nextFreeZoneId(zones: ZoneEntry[]): number {
  const used = new Set(zones.map((z) => z.id));
  for (let id = 1; id <= 255; id++) {
    if (!used.has(id)) return id;
  }
  return 0;
}
