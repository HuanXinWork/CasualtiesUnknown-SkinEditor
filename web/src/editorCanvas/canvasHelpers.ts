// 编辑画布 DOM 骨架、几何连线插值、反色边框与底栏拖拽辅助函数。

import type { PartCategory } from "../stateStore/types";
import { t } from "../i18n";
import { CANVAS_CURSORS } from "../toolPanel/toolIcons";
import { getSize, setSize } from "../layoutEngine";

const SIDE_SPLIT_SUFFIXES = [
  "uptorso",
  "downtorso",
  "head",
  "headback",
  "uparm",
  "downarm",
  "mildownarm",
  "milkytorso",
  "thigh",
  "crus",
  "foot",
  "tail",
] as const;

export function isSideSplittablePartName(partName: string): boolean {
  if (partName.endsWith("F") || partName.endsWith("B")) return false;
  const lower = partName.toLowerCase();
  if (lower.endsWith("handf") || lower.endsWith("handb")) return false;
  return SIDE_SPLIT_SUFFIXES.some((s) => lower.endsWith(s));
}

export function isOrientationSplittablePartName(
  partName: string,
  category: PartCategory,
): boolean {
  if (!partName || partName.startsWith("R_")) return false;
  return category === "Body" || category === "Head" || category === "Accessories";
}

export function bresenhamLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  let cx = x0;
  let cy = y0;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    pts.push([cx, cy]);
    if (cx === x1 && cy === y1) break;
    const e2 = err * 2;
    if (e2 > -dy) {
      err -= dy;
      cx += sx;
    }
    if (e2 < dx) {
      err += dx;
      cy += sy;
    }
  }
  return pts;
}

export function cursorForTool(tool: string, panning: boolean): string {
  if (panning) return "grabbing";
  if (tool === "pan") return "grab";
  if (tool === "brush") return CANVAS_CURSORS.brush;
  if (tool === "softBrush") return CANVAS_CURSORS.softBrush;
  if (tool === "eraser") return CANVAS_CURSORS.eraser;
  if (tool === "gradient") return CANVAS_CURSORS.gradient;
  if (tool === "fill") return CANVAS_CURSORS.fill;
  if (tool === "zoneBrush") return CANVAS_CURSORS.zoneBrush;
  return "crosshair";
}

export function buildEditorCanvasHtml(): string {
  return (
    `<div class="editor-canvas-toolbar" style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid rgba(var(--border-rgb),var(--border-opacity));">` +
    `<button class="btn" data-role="zoom-out">-</button>` +
    `<span class="mono" data-role="zoom-pct">100%</span>` +
    `<button class="btn" data-role="zoom-in">+</button>` +
    `<span class="mono" data-role="meta" style="margin-left:8px;opacity:0.7;"></span>` +
    `</div>` +
    `<div class="editor-canvas-stage" style="flex:1;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center;padding:16px;">` +
    `<div class="transparent-grid" data-role="grid" style="display:none;position:relative;"><canvas></canvas><canvas data-role="zones-overlay" style="position:absolute;left:0;top:0;pointer-events:none;image-rendering:pixelated;"></canvas></div>` +
    `<div data-role="placeholder" style="opacity:0.6;">${t("editorCanvas.notSelected")}</div>` +
    `</div>` +
    `<div class="editor-canvas-footer-grip" data-role="footer-grip" style="flex:none;height:6px;cursor:row-resize;background:transparent;position:relative;"><div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:32px;height:2px;border-radius:2px;background:rgba(var(--border-rgb),0.25);pointer-events:none;"></div></div>` +
    `<div class="editor-canvas-footer" data-role="footer" style="flex:none;display:flex;flex-direction:column;gap:6px;padding:8px;border-top:1px solid rgba(var(--border-rgb),var(--border-opacity));overflow:auto;">` +
    `<div data-role="footer-row1" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">` +
    `<button class="btn" data-role="resize-btn" disabled></button>` +
    `<label data-role="acc-toggle-wrap" style="display:none;align-items:center;gap:6px;cursor:pointer;user-select:none;">` +
    `<span data-role="acc-toggle-text" style="font-size:13px;"></span>` +
    `<span data-role="acc-toggle-track" style="position:relative;display:inline-block;width:36px;height:18px;background:#999;border-radius:9px;transition:background 0.15s;">` +
    `<span data-role="acc-toggle-knob" style="position:absolute;top:2px;left:2px;width:14px;height:14px;background:#fff;border-radius:50%;transition:left 0.15s;"></span>` +
    `</span>` +
    `</label>` +
    `<button class="btn" data-role="acc-advanced-btn" style="display:none;"></button>` +
    `<button class="btn" data-role="side-f-btn" style="display:none;"></button>` +
    `<button class="btn" data-role="side-b-btn" style="display:none;"></button>` +
    `<button class="btn" data-role="orient-r-btn" style="display:none;"></button>` +
    `<button class="btn" data-role="transform-toggle"></button>` +
    `</div>` +
    `<div data-role="transform-panel" style="display:none;padding:6px 8px;background:rgba(var(--border-rgb),0.05);border-radius:4px;"></div>` +
    `<div data-role="acc-advanced-panel" style="display:none;flex-direction:column;gap:6px;padding:6px 8px;background:rgba(var(--border-rgb),0.05);border-radius:4px;">` +
    `<div style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:12px;">` +
    `<label style="display:flex;align-items:center;gap:4px;"><span data-role="acc-adv-offX-label"></span><input class="input" type="number" data-role="acc-adv-offX" style="width:56px;" /></label>` +
    `<label style="display:flex;align-items:center;gap:4px;"><span data-role="acc-adv-offY-label"></span><input class="input" type="number" data-role="acc-adv-offY" style="width:56px;" /></label>` +
    `<label style="display:flex;align-items:center;gap:4px;"><span data-role="acc-adv-rot-label"></span><input class="input" type="number" data-role="acc-adv-rot" step="1" style="width:60px;" /></label>` +
    `<label style="display:flex;align-items:center;gap:4px;"><span data-role="acc-adv-z-label"></span><input class="input" type="number" data-role="acc-adv-z" style="width:56px;" /></label>` +
    `<label style="display:flex;align-items:center;gap:4px;"><span data-role="acc-adv-slot-label"></span><span data-role="acc-adv-slot-host"></span></label>` +
    `<span data-role="acc-adv-status" style="font-size:11px;opacity:0.65;"></span>` +
    `</div>` +
    `</div>` +
    `</div>`
  );
}

export function attachInvertedBorder(target: HTMLElement): () => void {
  function parseHex(hex: string): [number, number, number] | null {
    const v = hex.trim().replace(/^#/, "");
    if (v.length === 3) {
      const r = parseInt(v[0] + v[0], 16);
      const g = parseInt(v[1] + v[1], 16);
      const b = parseInt(v[2] + v[2], 16);
      return Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) ? null : [r, g, b];
    }
    if (v.length === 6) {
      const r = parseInt(v.slice(0, 2), 16);
      const g = parseInt(v.slice(2, 4), 16);
      const b = parseInt(v.slice(4, 6), 16);
      return Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) ? null : [r, g, b];
    }
    return null;
  }
  function refresh(): void {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--background");
    const rgb = parseHex(raw) ?? [255, 255, 255];
    let inv: [number, number, number] = [255 - rgb[0], 255 - rgb[1], 255 - rgb[2]];
    if (
      Math.abs(rgb[0] - 128) <= 8 &&
      Math.abs(rgb[1] - 128) <= 8 &&
      Math.abs(rgb[2] - 128) <= 8
    ) {
      inv = [255, 255, 255];
    }
    target.style.outline = `4px solid rgb(${inv[0]},${inv[1]},${inv[2]})`;
    target.style.outlineOffset = "2px";
  }
  refresh();
  window.addEventListener("themeApplied", refresh);
  return () => window.removeEventListener("themeApplied", refresh);
}

export function attachFooterGrip(
  container: HTMLElement,
  footerEl: HTMLElement,
  footerGripEl: HTMLElement,
): void {
  const clampPct = (n: number): number => Math.max(10, Math.min(70, n));
  let footerPct = clampPct(getSize("editorCanvas.footerPct") ?? 25);
  const applyFooterHeight = (): void => {
    footerEl.style.flex = `0 0 ${footerPct}%`;
  };
  applyFooterHeight();
  footerGripEl.addEventListener("mousedown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const containerRect = container.getBoundingClientRect();
    if (containerRect.height <= 0) return;
    const startY = event.clientY;
    const startPct = footerPct;
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    function onMove(ev: MouseEvent): void {
      const dy = ev.clientY - startY;
      footerPct = clampPct(startPct - (dy / containerRect.height) * 100);
      applyFooterHeight();
    }
    function onUp(): void {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setSize("editorCanvas.footerPct", footerPct);
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });
}
