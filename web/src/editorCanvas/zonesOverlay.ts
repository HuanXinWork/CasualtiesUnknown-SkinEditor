// 画布区块（Zones）半透明叠加层渲染、遮罩圆刷连线绘制与持久化。

import { loadZones, saveZones, type ApiError } from "../apiClient";
import { bumpAccessoriesVersion, parsePartId, sessionStore } from "../stateStore";
import { zonesStore } from "../stateStore/zonesStore";
import type { ZoneEntry, ZonesData } from "../stateStore/types";

export interface ZonesOverlayController {
  loadForPart(partId: string | null): void;
  clear(): void;
  paintAt(cx: number, cy: number, prevCx: number, prevCy: number, erase: boolean): void;
  flushIfDirty(): void;
  destroy(): void;
}

function zoneHue(id: number): number {
  return (((id * 47) % 360) + 360) % 360;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (h < 60) [r1, g1, b1] = [c, x, 0];
  else if (h < 120) [r1, g1, b1] = [x, c, 0];
  else if (h < 180) [r1, g1, b1] = [0, c, x];
  else if (h < 240) [r1, g1, b1] = [0, x, c];
  else if (h < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

function parseHexRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace(/^#/, "");
  if (h.length !== 3 && h.length !== 6) return null;
  const norm = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = Number.parseInt(norm.substring(0, 2), 16);
  const g = Number.parseInt(norm.substring(2, 4), 16);
  const b = Number.parseInt(norm.substring(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return [r, g, b];
}

function zoneFillRgb(id: number, cfg?: ZoneEntry): [number, number, number] {
  if (cfg?.displayColor && cfg.displayColor.length >= 3) {
    return [cfg.displayColor[0], cfg.displayColor[1], cfg.displayColor[2]];
  }
  return hslToRgb(zoneHue(id), 0.85, 0.55);
}

export function createZonesOverlayController(
  skinRoot: string,
  baseCtx: CanvasRenderingContext2D | null,
  overlayCanvas: HTMLCanvasElement,
): ZonesOverlayController {
  const overlayCtx = overlayCanvas.getContext("2d");
  const edgeScratch = document.createElement("canvas");
  const edgeCtx = edgeScratch.getContext("2d");

  let activePartId: string | null = null;
  let currentZones: ZonesData | null = null;
  let zonesDirty = false;
  let loadSeq = 0;

  function collectActiveZoneIds(data: ZonesData): number[] {
    const seen = new Set<number>();
    for (let i = 0; i < data.ids.length; i++) {
      const id = data.ids[i];
      if (id !== 0) seen.add(id);
    }
    return Array.from(seen).sort((a, b) => a - b);
  }

  function syncZonesConfig(data: ZonesData, activeIds: number[]): boolean {
    const existing = new Map(data.config.zones.map((z) => [z.id, z]));
    const next: ZoneEntry[] = [];
    let changed = false;
    for (const id of activeIds) {
      const entry = existing.get(id);
      if (entry) {
        next.push(entry);
        existing.delete(id);
      } else {
        next.push({ id });
        changed = true;
      }
    }
    if (existing.size > 0) changed = true;
    if (changed) data.config.zones = next;
    return changed;
  }

  function redraw(): void {
    if (!overlayCtx) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (!currentZones) return;
    const w = currentZones.width;
    const h = currentZones.height;
    if (w === 0 || h === 0) return;
    if (overlayCanvas.width !== w || overlayCanvas.height !== h) {
      overlayCanvas.width = w;
      overlayCanvas.height = h;
    }
    const activeIds = collectActiveZoneIds(currentZones);
    if (activeIds.length === 0) return;

    const cfgById = new Map(currentZones.config.zones.map((z) => [z.id, z]));
    const fill = overlayCtx.createImageData(w, h);
    for (let i = 0; i < currentZones.ids.length; i++) {
      const id = currentZones.ids[i];
      if (id === 0) continue;
      const [r, g, b] = zoneFillRgb(id, cfgById.get(id));
      fill.data[i * 4] = r;
      fill.data[i * 4 + 1] = g;
      fill.data[i * 4 + 2] = b;
      fill.data[i * 4 + 3] = 71;
    }
    overlayCtx.putImageData(fill, 0, 0);

    const primaryHex = getComputedStyle(document.documentElement).getPropertyValue("--primary");
    const themeRgb = parseHexRgb(primaryHex) ?? [59, 130, 246];
    const edge = overlayCtx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        const id = currentZones.ids[idx];
        if (id === 0) continue;
        const left = x > 0 ? currentZones.ids[idx - 1] : 0;
        const right = x < w - 1 ? currentZones.ids[idx + 1] : 0;
        const up = y > 0 ? currentZones.ids[idx - w] : 0;
        const down = y < h - 1 ? currentZones.ids[idx + w] : 0;
        if (left !== id || right !== id || up !== id || down !== id) {
          edge.data[idx * 4] = themeRgb[0];
          edge.data[idx * 4 + 1] = themeRgb[1];
          edge.data[idx * 4 + 2] = themeRgb[2];
          edge.data[idx * 4 + 3] = 255;
        }
      }
    }
    if (edgeCtx) {
      edgeScratch.width = w;
      edgeScratch.height = h;
      edgeCtx.putImageData(edge, 0, 0);
      overlayCtx.drawImage(edgeScratch, 0, 0);
    }
  }

  function stampCircle(
    cx: number,
    cy: number,
    radius: number,
    targetId: number,
    erase: boolean,
    alphaSnapshot: Uint8ClampedArray,
  ): boolean {
    if (!currentZones) return false;
    const w = currentZones.width;
    const h = currentZones.height;
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(w - 1, Math.ceil(cx + radius));
    const y1 = Math.min(h - 1, Math.ceil(cy + radius));
    let dirty = false;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const idx = y * w + x;
        if (!erase && alphaSnapshot[idx * 4 + 3] === 0) continue;
        if (currentZones.ids[idx] !== targetId) {
          currentZones.ids[idx] = targetId;
          dirty = true;
        }
      }
    }
    return dirty;
  }

  const unsubZones = zonesStore.subscribe(() => {
    const st = zonesStore.get();
    if (st.partId === activePartId) {
      currentZones = st.data;
      redraw();
    }
  });

  function flushDirtyInternal(): void {
    if (!zonesDirty || !currentZones || !activePartId) return;
    const parsed = parsePartId(activePartId);
    if (!parsed) return;
    const data = currentZones;
    zonesDirty = false;
    saveZones(skinRoot, parsed.skinName, parsed.category, parsed.partName, data)
      .then(() => {
        zonesStore.bump();
        bumpAccessoriesVersion();
      })
      .catch((e: ApiError) => console.warn(`[editorCanvas] saveZones failed: ${e?.message ?? String(e)}`));
  }

  return {
    loadForPart(partId: string | null): void {
      if (partId !== activePartId) flushDirtyInternal();
      activePartId = partId;
      currentZones = null;
      zonesDirty = false;
      const parsed = partId ? parsePartId(partId) : null;
      if (!partId || !parsed) {
        zonesStore.set(null, null);
        redraw();
        return;
      }
      const seq = ++loadSeq;
      loadZones(skinRoot, parsed.skinName, parsed.category, parsed.partName)
        .then((data) => {
          if (seq !== loadSeq || activePartId !== partId) return;
          currentZones = data;
          const ids = collectActiveZoneIds(data);
          if (syncZonesConfig(data, ids)) zonesDirty = true;
          zonesStore.set(data, partId);
          redraw();
        })
        .catch((e: ApiError) => {
          console.warn(`[editorCanvas] loadZones failed: ${e?.message ?? String(e)}`);
        });
    },

    clear(): void {
      flushDirtyInternal();
      activePartId = null;
      currentZones = null;
      zonesDirty = false;
      zonesStore.set(null, null);
      if (overlayCtx) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    },

    paintAt(cx: number, cy: number, prevCx: number, prevCy: number, erase: boolean): void {
      if (!baseCtx || !currentZones || currentZones.width === 0 || currentZones.height === 0) return;
      const { brushSize, activeZoneId } = sessionStore.getState();
      const radius = Math.max(0.5, brushSize / 2);
      const targetId = erase ? 0 : Math.max(1, Math.min(255, activeZoneId | 0));
      const alphaSnapshot = baseCtx.getImageData(0, 0, currentZones.width, currentZones.height).data;

      let touched = false;
      if (prevCx >= 0 && prevCy >= 0 && (prevCx !== cx || prevCy !== cy)) {
        const steps = Math.max(Math.abs(cx - prevCx), Math.abs(cy - prevCy));
        for (let i = 1; i <= steps; i++) {
          const ix = Math.round(prevCx + ((cx - prevCx) * i) / steps);
          const iy = Math.round(prevCy + ((cy - prevCy) * i) / steps);
          if (stampCircle(ix, iy, radius, targetId, erase, alphaSnapshot)) touched = true;
        }
      } else if (stampCircle(cx, cy, radius, targetId, erase, alphaSnapshot)) {
        touched = true;
      }

      if (touched) {
        zonesDirty = true;
        const ids = collectActiveZoneIds(currentZones);
        syncZonesConfig(currentZones, ids);
        zonesStore.bump();
        redraw();
      }
    },

    flushIfDirty(): void {
      flushDirtyInternal();
    },

    destroy(): void {
      flushDirtyInternal();
      unsubZones();
    },
  };
}
