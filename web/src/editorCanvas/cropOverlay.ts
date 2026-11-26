// 自由裁剪/扩展画布交互叠加层（8 向手柄 + 框体平移 + 顶部确认条 + Pivot 偏移警示）。

import { resizeCanvas, type ApiError, type ResizeCanvasResult } from "../apiClient";
import {
  bumpCanvasSizeVersion,
  markPartDirty,
  pushHistoryRecord,
  sessionStore,
  type Tool,
} from "../stateStore";
import { subscribeLang, t } from "../i18n";
import { localizePartName } from "../i18n/partNames";
import { showToast } from "../toast";

const MAX_DIM = 4096;

type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const HANDLES: ReadonlyArray<{ id: HandleId; left: string; top: string; cursor: string }> = [
  { id: "nw", left: "0%", top: "0%", cursor: "nwse-resize" },
  { id: "n", left: "50%", top: "0%", cursor: "ns-resize" },
  { id: "ne", left: "100%", top: "0%", cursor: "nesw-resize" },
  { id: "e", left: "100%", top: "50%", cursor: "ew-resize" },
  { id: "se", left: "100%", top: "100%", cursor: "nwse-resize" },
  { id: "s", left: "50%", top: "100%", cursor: "ns-resize" },
  { id: "sw", left: "0%", top: "100%", cursor: "nesw-resize" },
  { id: "w", left: "0%", top: "50%", cursor: "ew-resize" },
];

export interface CropOverlayOptions {
  gridEl: HTMLDivElement;
  actionBarEl: HTMLDivElement;
  getPartId: () => string | null;
  getPartName: () => string | null;
  onApplied: (result: ResizeCanvasResult) => void;
}

export interface CropOverlayController {
  syncCanvasSize(width: number, height: number, resetSelection?: boolean): void;
  syncZoom(zoom: number): void;
  destroy(): void;
}

function formatShift(v: number): string {
  const rounded = Math.round(v * 2) / 2;
  if (Math.abs(rounded) < 1e-6) return "0";
  const prefix = rounded > 0 ? "+" : "";
  return Number.isInteger(rounded) ? `${prefix}${rounded}` : `${prefix}${rounded.toFixed(1)}`;
}

export function createCropOverlayController(opts: CropOverlayOptions): CropOverlayController {
  const { gridEl, actionBarEl, getPartId, getPartName, onApplied } = opts;

  // 叠加层挂载在真实屏幕 CSS 尺寸的 gridEl 内，用百分比直接对齐图像逻辑像素，手柄与读数天然保持恒定屏幕尺寸。
  const rootEl = document.createElement("div");
  rootEl.className = "crop-overlay-root";
  rootEl.hidden = true;

  const maskTop = document.createElement("div");
  const maskBottom = document.createElement("div");
  const maskLeft = document.createElement("div");
  const maskRight = document.createElement("div");
  for (const m of [maskTop, maskBottom, maskLeft, maskRight]) {
    m.className = "crop-mask";
    rootEl.appendChild(m);
  }

  const boxEl = document.createElement("div");
  boxEl.className = "crop-box";
  rootEl.appendChild(boxEl);

  for (const h of HANDLES) {
    const el = document.createElement("div");
    el.className = "crop-handle";
    el.dataset.handle = h.id;
    el.style.left = h.left;
    el.style.top = h.top;
    el.style.cursor = h.cursor;
    boxEl.appendChild(el);
  }

  const readoutEl = document.createElement("div");
  readoutEl.className = "crop-readout";
  boxEl.appendChild(readoutEl);
  gridEl.appendChild(rootEl);

  actionBarEl.innerHTML =
    `<span data-role="crop-hint" style="opacity:0.8;flex:1;min-width:160px;"></span>` +
    `<button type="button" class="btn" data-role="crop-expand2" style="padding:2px 8px;font-size:12px;"></button>` +
    `<button type="button" class="btn" data-role="crop-reset" style="padding:2px 8px;font-size:12px;"></button>` +
    `<button type="button" class="btn btn-primary" data-role="crop-apply" style="padding:2px 10px;font-size:12px;"></button>` +
    `<button type="button" class="btn" data-role="crop-cancel" style="padding:2px 8px;font-size:12px;"></button>`;

  const hintEl = actionBarEl.querySelector<HTMLSpanElement>('[data-role="crop-hint"]')!;
  const expand2Btn = actionBarEl.querySelector<HTMLButtonElement>('[data-role="crop-expand2"]')!;
  const resetBtn = actionBarEl.querySelector<HTMLButtonElement>('[data-role="crop-reset"]')!;
  const applyBtn = actionBarEl.querySelector<HTMLButtonElement>('[data-role="crop-apply"]')!;
  const cancelBtn = actionBarEl.querySelector<HTMLButtonElement>('[data-role="crop-cancel"]')!;

  let canvasW = 0;
  let canvasH = 0;
  let zoom = 1;
  let crop: CropRect = { x: 0, y: 0, w: 0, h: 0 };
  let prevTool: Tool = "brush";
  let lastTool: Tool = sessionStore.getState().activeTool;
  let busy = false;

  let dragMode: "move" | HandleId | null = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartCrop: CropRect = { x: 0, y: 0, w: 0, h: 0 };

  function isActive(): boolean {
    return (
      sessionStore.getState().activeTool === "crop" &&
      canvasW > 0 &&
      canvasH > 0 &&
      getPartId() !== null
    );
  }

  function resetCrop(): void {
    crop = { x: 0, y: 0, w: Math.max(1, canvasW), h: Math.max(1, canvasH) };
    render();
  }

  function setBusy(next: boolean): void {
    busy = next;
    expand2Btn.disabled = busy;
    resetBtn.disabled = busy;
    applyBtn.disabled = busy;
    cancelBtn.disabled = busy;
  }

  function computePivotDelta(): { dx: number; dy: number } {
    // offsetX = -crop.x，旧图中心落在 (-crop.x + canvasW / 2)，相对新画布中心 (crop.w / 2) 的偏移：
    const dx = -crop.x + (canvasW - crop.w) / 2;
    const dy = -crop.y + (canvasH - crop.h) / 2;
    return { dx, dy };
  }

  function setRect(el: HTMLElement, x: number, y: number, w: number, h: number): void {
    if (w <= 0 || h <= 0 || canvasW <= 0 || canvasH <= 0) {
      el.style.display = "none";
      return;
    }
    el.style.display = "";
    el.style.left = `${(x / canvasW) * 100}%`;
    el.style.top = `${(y / canvasH) * 100}%`;
    el.style.width = `${(w / canvasW) * 100}%`;
    el.style.height = `${(h / canvasH) * 100}%`;
  }

  function render(): void {
    const active = isActive();
    rootEl.hidden = !active;
    actionBarEl.hidden = !active;
    if (!active) return;

    const ix0 = Math.max(0, Math.min(canvasW, crop.x));
    const iy0 = Math.max(0, Math.min(canvasH, crop.y));
    const ix1 = Math.max(0, Math.min(canvasW, crop.x + crop.w));
    const iy1 = Math.max(0, Math.min(canvasH, crop.y + crop.h));

    // 画布内部被裁掉的区域铺半透明暗遮罩，画布外侧外扩区域不遮罩并用虚线框高亮。
    setRect(maskTop, 0, 0, canvasW, iy0);
    setRect(maskBottom, 0, iy1, canvasW, canvasH - iy1);
    setRect(maskLeft, 0, iy0, ix0, iy1 - iy0);
    setRect(maskRight, ix1, iy0, canvasW - ix1, iy1 - iy0);

    // 百分比定位允许负值与超过 100%，外扩裁剪框可自然伸出画布边界且严格贴合显示像素。
    boxEl.style.left = `${(crop.x / canvasW) * 100}%`;
    boxEl.style.top = `${(crop.y / canvasH) * 100}%`;
    boxEl.style.width = `${(crop.w / canvasW) * 100}%`;
    boxEl.style.height = `${(crop.h / canvasH) * 100}%`;

    const expanding =
      crop.x < 0 || crop.y < 0 || crop.x + crop.w > canvasW || crop.y + crop.h > canvasH;
    const { dx, dy } = computePivotDelta();
    const shifted = Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4;

    boxEl.classList.toggle("crop-box-expanding", expanding);
    boxEl.classList.toggle("crop-box-warn", shifted);
    readoutEl.classList.toggle("crop-readout-warn", shifted);

    const pivotText = shifted
      ? t("editorCanvas.cropPivotShift")
          .replace("{dx}", formatShift(dx))
          .replace("{dy}", formatShift(dy))
      : t("editorCanvas.cropPivotCentered");
    readoutEl.textContent = `${crop.w}×${crop.h} · ${pivotText}`;

    hintEl.textContent = t("editorCanvas.cropHint");
    expand2Btn.textContent = t("editorCanvas.cropExpand2");
    resetBtn.textContent = t("editorCanvas.cropReset");
    applyBtn.textContent = t("editorCanvas.cropApply")
      .replace("{w}", String(crop.w))
      .replace("{h}", String(crop.h));
    cancelBtn.textContent = t("editorCanvas.cropCancel");
  }

  function exitCropTool(): void {
    const target: Tool = prevTool === "crop" ? "brush" : prevTool;
    if (sessionStore.getState().activeTool === "crop") {
      sessionStore.setState({ activeTool: target });
    }
  }

  function applyCrop(): void {
    if (!isActive() || busy) return;
    const partId = getPartId();
    if (!partId) return;
    if (crop.w < 1 || crop.h < 1 || crop.w > MAX_DIM || crop.h > MAX_DIM) {
      showToast(t("editorCanvas.resizeInvalid"), "error");
      return;
    }
    if (crop.x === 0 && crop.y === 0 && crop.w === canvasW && crop.h === canvasH) {
      showToast(t("editorCanvas.cropNoChange"), "info");
      exitCropTool();
      return;
    }

    setBusy(true);
    // 自由裁剪/扩展默认不改 baseSizes.json，保持现有游戏内基准尺寸配置。
    resizeCanvas({
      partId,
      width: crop.w,
      height: crop.h,
      offsetX: -crop.x,
      offsetY: -crop.y,
      syncBaseSize: false,
    })
      .then((res) => {
        markPartDirty(partId);
        pushHistoryRecord({ partId, tool: "resizeCanvas", rectW: res.width, rectH: res.height });
        bumpCanvasSizeVersion({ partId, width: res.width, height: res.height });
        onApplied(res);
        const name = getPartName();
        const label = name ? localizePartName(name) : partId;
        showToast(`✓ ${label} ${res.width}×${res.height}`, "info");
        exitCropTool();
      })
      .catch((e: ApiError) => {
        showToast(e?.message ?? String(e), "error");
      })
      .finally(() => {
        setBusy(false);
      });
  }

  function onBoxMouseDown(e: MouseEvent): void {
    // 保留中键/右键/Shift+左键给舞台平移使用。
    if (e.button !== 0 || e.shiftKey || busy) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target as HTMLElement | null;
    const handle = target?.dataset.handle as HandleId | undefined;
    dragMode = handle ?? "move";
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartCrop = { ...crop };
  }

  function onDocMouseMove(e: MouseEvent): void {
    if (!dragMode) return;
    const rect = gridEl.getBoundingClientRect();
    const scaleX = rect.width > 0 && canvasW > 0 ? rect.width / canvasW : Math.max(0.1, zoom);
    const scaleY = rect.height > 0 && canvasH > 0 ? rect.height / canvasH : Math.max(0.1, zoom);
    const dx = Math.round((e.clientX - dragStartX) / scaleX);
    const dy = Math.round((e.clientY - dragStartY) / scaleY);
    const s = dragStartCrop;

    if (dragMode === "move") {
      crop = { x: s.x + dx, y: s.y + dy, w: s.w, h: s.h };
      render();
      return;
    }

    let left = s.x;
    let right = s.x + s.w;
    let top = s.y;
    let bottom = s.y + s.h;

    if (dragMode.includes("w")) {
      left = Math.min(right - 1, Math.max(right - MAX_DIM, s.x + dx));
    }
    if (dragMode.includes("e")) {
      right = Math.max(left + 1, Math.min(left + MAX_DIM, s.x + s.w + dx));
    }
    if (dragMode.includes("n")) {
      top = Math.min(bottom - 1, Math.max(bottom - MAX_DIM, s.y + dy));
    }
    if (dragMode.includes("s")) {
      bottom = Math.max(top + 1, Math.min(top + MAX_DIM, s.y + s.h + dy));
    }

    crop = { x: left, y: top, w: right - left, h: bottom - top };
    render();
  }

  function onDocMouseUp(): void {
    dragMode = null;
  }

  function onKeyDown(e: KeyboardEvent): void {
    if (!isActive() || busy) return;
    if (document.querySelector('[data-modal-open="true"]')) return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT" ||
        target.isContentEditable)
    ) {
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      applyCrop();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      resetCrop();
      exitCropTool();
    }
  }

  expand2Btn.addEventListener("click", () => {
    if (!isActive() || busy) return;
    const nextW = Math.min(MAX_DIM, crop.w + 4);
    const nextH = Math.min(MAX_DIM, crop.h + 4);
    const dw = nextW - crop.w;
    const dh = nextH - crop.h;
    crop = {
      x: crop.x - Math.floor(dw / 2),
      y: crop.y - Math.floor(dh / 2),
      w: nextW,
      h: nextH,
    };
    render();
  });
  resetBtn.addEventListener("click", resetCrop);
  applyBtn.addEventListener("click", applyCrop);
  cancelBtn.addEventListener("click", () => {
    resetCrop();
    exitCropTool();
  });

  boxEl.addEventListener("mousedown", onBoxMouseDown);
  document.addEventListener("mousemove", onDocMouseMove);
  document.addEventListener("mouseup", onDocMouseUp);
  window.addEventListener("blur", onDocMouseUp);
  document.addEventListener("keydown", onKeyDown, true);

  const unsubStore = sessionStore.subscribe((st) => {
    if (st.activeTool !== lastTool) {
      if (lastTool !== "crop") prevTool = lastTool;
      lastTool = st.activeTool;
      if (st.activeTool === "crop") {
        resetCrop();
      } else {
        dragMode = null;
        render();
      }
    }
  });
  const unsubLang = subscribeLang(render);

  return {
    syncCanvasSize(width: number, height: number, resetSelection = true): void {
      const sizeChanged = width !== canvasW || height !== canvasH;
      canvasW = width;
      canvasH = height;
      if (resetSelection || sizeChanged || crop.w <= 0 || crop.h <= 0) {
        crop = { x: 0, y: 0, w: Math.max(1, width), h: Math.max(1, height) };
      }
      render();
    },
    syncZoom(nextZoom: number): void {
      zoom = nextZoom;
    },
    destroy(): void {
      unsubStore();
      unsubLang();
      boxEl.removeEventListener("mousedown", onBoxMouseDown);
      document.removeEventListener("mousemove", onDocMouseMove);
      document.removeEventListener("mouseup", onDocMouseUp);
      window.removeEventListener("blur", onDocMouseUp);
      document.removeEventListener("keydown", onKeyDown, true);
      rootEl.remove();
      actionBarEl.innerHTML = "";
      actionBarEl.hidden = true;
    },
  };
}
