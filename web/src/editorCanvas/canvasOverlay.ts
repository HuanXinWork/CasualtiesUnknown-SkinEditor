// 画布高倍像素网格、Pivot (0.5, 0.5) 中心参考线叠加层与底部紧凑单行状态栏。

import {
  sessionStore,
  setShowPixelGrid,
  setShowPivotCross,
} from "../stateStore";
import { subscribeLang, t } from "../i18n";

const GRID_MIN_ZOOM = 6;
const MAX_OVERLAY_BUFFER_DIM = 2048;

export interface CanvasOverlayOptions {
  overlayCanvas: HTMLCanvasElement;
  statusBarEl: HTMLDivElement;
  onOpenCanvasSize: () => void;
}

export interface CanvasOverlayController {
  sync(canvasW: number, canvasH: number, zoom: number): void;
  setCursor(cx: number | null, cy: number | null): void;
  setBaseSize(baseSize: [number, number] | null): void;
  destroy(): void;
}

export function createCanvasOverlayController(
  opts: CanvasOverlayOptions,
): CanvasOverlayController {
  const { overlayCanvas, statusBarEl, onOpenCanvasSize } = opts;
  const overlayCtx = overlayCanvas.getContext("2d");

  statusBarEl.innerHTML =
    `<span class="mono editor-status-item" data-role="st-coord">(-, -)</span>` +
    `<span class="mono editor-status-item" data-role="st-zoom">100%</span>` +
    `<span class="mono editor-status-item" data-role="st-size">-</span>` +
    `<span class="editor-status-actions">` +
    `<button type="button" class="editor-status-btn" data-role="st-grid"></button>` +
    `<button type="button" class="editor-status-btn" data-role="st-pivot"></button>` +
    `<button type="button" class="editor-status-btn" data-role="st-canvas-size" disabled></button>` +
    `</span>`;

  const coordEl = statusBarEl.querySelector<HTMLSpanElement>('[data-role="st-coord"]')!;
  const zoomEl = statusBarEl.querySelector<HTMLSpanElement>('[data-role="st-zoom"]')!;
  const sizeEl = statusBarEl.querySelector<HTMLSpanElement>('[data-role="st-size"]')!;
  const gridBtn = statusBarEl.querySelector<HTMLButtonElement>('[data-role="st-grid"]')!;
  const pivotBtn = statusBarEl.querySelector<HTMLButtonElement>('[data-role="st-pivot"]')!;
  const canvasSizeBtn = statusBarEl.querySelector<HTMLButtonElement>('[data-role="st-canvas-size"]')!;

  let canvasW = 0;
  let canvasH = 0;
  let zoom = 1;
  let cursorX: number | null = null;
  let cursorY: number | null = null;
  let currentBaseSize: [number, number] | null = null;
  let lastGrid = sessionStore.getState().showPixelGrid;
  let lastPivot = sessionStore.getState().showPivotCross;

  function renderStatusBar(): void {
    const { showPixelGrid, showPivotCross } = sessionStore.getState();
    coordEl.textContent =
      cursorX !== null && cursorY !== null ? `(${cursorX}, ${cursorY})` : "(-, -)";
    zoomEl.textContent = `${Math.round(zoom * 100)}%`;
    if (canvasW > 0 && canvasH > 0) {
      const basePart = currentBaseSize
        ? ` · ${t("editorCanvas.baseSizeTag")} ${currentBaseSize[0]}×${currentBaseSize[1]}`
        : "";
      sizeEl.textContent = `${canvasW}×${canvasH}${basePart}`;
      canvasSizeBtn.disabled = false;
    } else {
      sizeEl.textContent = "-";
      canvasSizeBtn.disabled = true;
    }
    gridBtn.textContent = t("editorCanvas.statusGrid");
    gridBtn.classList.toggle("active", showPixelGrid);
    pivotBtn.textContent = t("editorCanvas.statusPivot");
    pivotBtn.classList.toggle("active", showPivotCross);
    canvasSizeBtn.textContent = t("editorCanvas.statusCanvasSize");
  }

  function redrawOverlay(): void {
    if (!overlayCtx) return;
    const { showPixelGrid, showPivotCross } = sessionStore.getState();
    const drawGrid = showPixelGrid && zoom >= GRID_MIN_ZOOM && canvasW > 0 && canvasH > 0;
    const drawPivot = showPivotCross && canvasW > 0 && canvasH > 0;

    if (!drawGrid && !drawPivot) {
      if (overlayCanvas.width !== 1 || overlayCanvas.height !== 1) {
        overlayCanvas.width = 1;
        overlayCanvas.height = 1;
      } else {
        overlayCtx.clearRect(0, 0, 1, 1);
      }
      return;
    }

    // 按屏幕物理像素分配后备缓冲并限制上限，既保证高倍缩放 1px 网格锐利，又避免超大尺寸内存飙升。
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rawW = Math.max(1, Math.round(canvasW * zoom * dpr));
    const rawH = Math.max(1, Math.round(canvasH * zoom * dpr));
    const clampScale = Math.min(1, MAX_OVERLAY_BUFFER_DIM / Math.max(rawW, rawH));
    const bufW = Math.max(1, Math.round(rawW * clampScale));
    const bufH = Math.max(1, Math.round(rawH * clampScale));

    if (overlayCanvas.width !== bufW || overlayCanvas.height !== bufH) {
      overlayCanvas.width = bufW;
      overlayCanvas.height = bufH;
    } else {
      overlayCtx.clearRect(0, 0, bufW, bufH);
    }

    const scaleX = bufW / canvasW;
    const scaleY = bufH / canvasH;

    if (drawGrid) {
      const borderRgb =
        getComputedStyle(document.documentElement).getPropertyValue("--border-rgb").trim() ||
        "0, 0, 0";
      overlayCtx.save();
      overlayCtx.strokeStyle = `rgba(${borderRgb}, 0.22)`;
      overlayCtx.lineWidth = 1;
      overlayCtx.beginPath();
      for (let x = 1; x < canvasW; x++) {
        const px = Math.floor(x * scaleX) + 0.5;
        overlayCtx.moveTo(px, 0);
        overlayCtx.lineTo(px, bufH);
      }
      for (let y = 1; y < canvasH; y++) {
        const py = Math.floor(y * scaleY) + 0.5;
        overlayCtx.moveTo(0, py);
        overlayCtx.lineTo(bufW, py);
      }
      overlayCtx.stroke();
      overlayCtx.restore();
    }

    if (drawPivot) {
      const cx = Math.floor((canvasW / 2) * scaleX) + 0.5;
      const cy = Math.floor((canvasH / 2) * scaleY) + 0.5;
      const dashUnit = Math.max(3, Math.round(4 * dpr * clampScale));
      const strokeCross = (color: string, lineWidth: number, dash: number[]): void => {
        overlayCtx.save();
        overlayCtx.strokeStyle = color;
        overlayCtx.lineWidth = lineWidth;
        overlayCtx.setLineDash(dash);
        overlayCtx.beginPath();
        overlayCtx.moveTo(cx, 0);
        overlayCtx.lineTo(cx, bufH);
        overlayCtx.moveTo(0, cy);
        overlayCtx.lineTo(bufW, cy);
        overlayCtx.stroke();
        overlayCtx.restore();
      };
      // 双层描边（暗底 + 亮青虚线）确保在纯黑与纯白像素上都清晰可见。
      strokeCross("rgba(0, 0, 0, 0.35)", Math.max(2, dpr * clampScale * 1.5), [dashUnit, dashUnit]);
      strokeCross("rgba(14, 165, 233, 0.9)", Math.max(1, dpr * clampScale), [dashUnit, dashUnit]);

      const r = Math.max(3, Math.round(4 * dpr * clampScale));
      overlayCtx.save();
      overlayCtx.strokeStyle = "rgba(14, 165, 233, 0.95)";
      overlayCtx.lineWidth = Math.max(1.2, dpr * clampScale);
      overlayCtx.beginPath();
      overlayCtx.arc(cx, cy, r, 0, Math.PI * 2);
      overlayCtx.stroke();
      overlayCtx.restore();
    }
  }

  gridBtn.addEventListener("click", () => {
    setShowPixelGrid(!sessionStore.getState().showPixelGrid);
  });
  pivotBtn.addEventListener("click", () => {
    setShowPivotCross(!sessionStore.getState().showPivotCross);
  });
  canvasSizeBtn.addEventListener("click", () => {
    if (canvasW > 0 && canvasH > 0) onOpenCanvasSize();
  });

  const unsubStore = sessionStore.subscribe((st) => {
    if (st.showPixelGrid !== lastGrid || st.showPivotCross !== lastPivot) {
      lastGrid = st.showPixelGrid;
      lastPivot = st.showPivotCross;
      renderStatusBar();
      redrawOverlay();
    }
  });
  const unsubLang = subscribeLang(renderStatusBar);
  const onThemeApplied = (): void => redrawOverlay();
  window.addEventListener("themeApplied", onThemeApplied);

  renderStatusBar();

  return {
    sync(w: number, h: number, z: number): void {
      canvasW = w;
      canvasH = h;
      zoom = z;
      renderStatusBar();
      redrawOverlay();
    },
    setCursor(cx: number | null, cy: number | null): void {
      if (cursorX === cx && cursorY === cy) return;
      cursorX = cx;
      cursorY = cy;
      coordEl.textContent =
        cursorX !== null && cursorY !== null ? `(${cursorX}, ${cursorY})` : "(-, -)";
    },
    setBaseSize(baseSize: [number, number] | null): void {
      currentBaseSize = baseSize;
      renderStatusBar();
    },
    destroy(): void {
      unsubStore();
      unsubLang();
      window.removeEventListener("themeApplied", onThemeApplied);
    },
  };
}
