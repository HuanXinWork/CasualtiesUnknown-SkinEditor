// 单部件像素编辑画布（支持单飞串行画笔队列、Bresenham 连线插值、图层变换、区块遮罩与配件参数）。

import {
  applyBrush,
  applyEraser,
  applyFill,
  applyGradient,
  applySoftBrush,
  beginStroke as apiBeginStroke,
  endStroke as apiEndStroke,
  getBaseSize,
  getFlatten,
  loadPartImage,
  type ApiError,
  type LoadPartResult,
} from "../apiClient";
import {
  markPartDirty,
  normalizeSoftBrushHardness,
  parsePartId,
  pushHistoryRecord,
  sessionStore,
} from "../stateStore";
import { subscribeLang, t } from "../i18n";
import { localizePartName } from "../i18n/partNames";
import { mountAccessoryBar } from "./accessoryBar";
import {
  attachFooterGrip,
  attachInvertedBorder,
  bresenhamLine,
  buildEditorCanvasHtml,
  cursorForTool,
  mountMirrorPartControls,
} from "./canvasHelpers";
import { createCanvasOverlayController } from "./canvasOverlay";
import { createCropOverlayController } from "./cropOverlay";
import { attachAltCursor, sampleCanvasRgb } from "./eyedropper";
import { openResizeDialog } from "./resizeDialog";
import { mountTransformControls } from "./transformPanel";
import { createZonesOverlayController } from "./zonesOverlay";

const ZOOM_MIN = 0.1;

export function mountEditorCanvas(
  container: HTMLElement,
  skinRoot: string,
  dock?: { setTitleBadge: (text: string, variant?: "default" | "ok" | "warn") => void },
): () => void {
  container.classList.add("panel");
  container.style.flex = "1";
  container.style.minHeight = "0";
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.innerHTML = buildEditorCanvasHtml();

  const zoomOutBtn = container.querySelector<HTMLButtonElement>('[data-role="zoom-out"]')!;
  const zoomInBtn = container.querySelector<HTMLButtonElement>('[data-role="zoom-in"]')!;
  const zoomPctEl = container.querySelector<HTMLSpanElement>('[data-role="zoom-pct"]')!;
  const metaEl = container.querySelector<HTMLSpanElement>('[data-role="meta"]')!;
  const resizeBtn = container.querySelector<HTMLButtonElement>('[data-role="resize-btn"]')!;
  const sideFBtn = container.querySelector<HTMLButtonElement>('[data-role="side-f-btn"]')!;
  const sideBBtn = container.querySelector<HTMLButtonElement>('[data-role="side-b-btn"]')!;
  const orientRBtn = container.querySelector<HTMLButtonElement>('[data-role="orient-r-btn"]')!;
  const gridEl = container.querySelector<HTMLDivElement>('[data-role="grid"]')!;
  const cropBarEl = container.querySelector<HTMLDivElement>('[data-role="crop-bar"]')!;
  const statusBarEl = container.querySelector<HTMLDivElement>('[data-role="status-bar"]')!;
  const placeholderEl = container.querySelector<HTMLDivElement>('[data-role="placeholder"]')!;
  const stageEl = container.querySelector<HTMLDivElement>(".editor-canvas-stage")!;
  const canvas = gridEl.querySelector("canvas")!;
  const zonesOverlay = gridEl.querySelector<HTMLCanvasElement>('[data-role="zones-overlay"]')!;
  const canvasOverlayEl = gridEl.querySelector<HTMLCanvasElement>('[data-role="canvas-overlay"]')!;
  const ctx = canvas.getContext("2d");

  const accessoryBar = mountAccessoryBar(
    {
      toggleWrap: container.querySelector('[data-role="acc-toggle-wrap"]')!,
      toggleText: container.querySelector('[data-role="acc-toggle-text"]')!,
      toggleTrack: container.querySelector('[data-role="acc-toggle-track"]')!,
      toggleKnob: container.querySelector('[data-role="acc-toggle-knob"]')!,
      advBtn: container.querySelector('[data-role="acc-advanced-btn"]')!,
      advPanel: container.querySelector('[data-role="acc-advanced-panel"]')!,
      offXInput: container.querySelector('[data-role="acc-adv-offX"]')!,
      offYInput: container.querySelector('[data-role="acc-adv-offY"]')!,
      rotInput: container.querySelector('[data-role="acc-adv-rot"]')!,
      zInput: container.querySelector('[data-role="acc-adv-z"]')!,
      statusEl: container.querySelector('[data-role="acc-adv-status"]')!,
      offXLabel: container.querySelector('[data-role="acc-adv-offX-label"]')!,
      offYLabel: container.querySelector('[data-role="acc-adv-offY-label"]')!,
      rotLabel: container.querySelector('[data-role="acc-adv-rot-label"]')!,
      zLabel: container.querySelector('[data-role="acc-adv-z-label"]')!,
      slotLabel: container.querySelector('[data-role="acc-adv-slot-label"]')!,
      slotHost: container.querySelector('[data-role="acc-adv-slot-host"]')!,
    },
    skinRoot,
  );
  const zonesCtrl = createZonesOverlayController(skinRoot, ctx, zonesOverlay);
  const mirrorCtrl = mountMirrorPartControls(skinRoot, sideFBtn, sideBBtn, orientRBtn);

  let currentPartName: string | null = null;
  let currentWidth = 0;
  let currentHeight = 0;
  let currentBaseSize: [number, number] | null = null;
  let baseSizeSeq = 0;

  let zoom = 1;
  let panOffsetX = 0;
  let panOffsetY = 0;
  let lastKey: string | null = null;
  let loadSeq = 0;
  let currentPartId: string | null = null;

  let isPainting = false;
  let paintingPartId: string | null = null;
  let paintingTool: "brush" | "eraser" | "softBrush" = "brush";
  let strokeQueue: Promise<void> = Promise.resolve();

  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartOffX = 0;
  let panStartOffY = 0;
  let lastCx = -1;
  let lastCy = -1;

  let isGradient = false;
  let gradientStartCx = -1;
  let gradientStartCy = -1;
  let isZonePainting = false;
  let isZoneErasing = false;

  type PlaceholderInfo =
    | { kind: "none" }
    | { kind: "notSelected" }
    | { kind: "loading"; partName: string }
    | { kind: "error"; partName: string; msg: string };
  let placeholderInfo: PlaceholderInfo = { kind: "notSelected" };
  let lastAppliedDiffRef: ReturnType<typeof sessionStore.getState>["lastAppliedDiff"] = null;
  let lastLayerSnapshotVersion = sessionStore.getState().layerSnapshotVersion ?? 0;

  function openResizeModal(initialTab: "canvas" | "resample"): void {
    if (!currentPartId) return;
    void openResizeDialog({
      skinRoot,
      partId: currentPartId,
      currentWidth,
      currentHeight,
      initialTab,
      onResized: (w, h) => {
        currentWidth = w;
        currentHeight = h;
        updateInfoPanel();
        reloadCurrent();
      },
      onCanvasResized: (w, h, baseSize) => {
        handleCanvasResized(w, h, baseSize);
      },
    });
  }

  const canvasOverlay = createCanvasOverlayController({
    overlayCanvas: canvasOverlayEl,
    statusBarEl,
    onOpenCanvasSize: () => openResizeModal("canvas"),
  });

  const cropOverlay = createCropOverlayController({
    gridEl,
    actionBarEl: cropBarEl,
    getPartId: () => currentPartId,
    getPartName: () => currentPartName,
    onApplied: (res) => handleCanvasResized(res.width, res.height, res.baseSize),
  });

  function enqueueStrokeOp(op: () => Promise<void>): void {
    strokeQueue = strokeQueue.then(op, op);
  }

  function applyZoom(): void {
    gridEl.style.transform = `translate(${panOffsetX}px, ${panOffsetY}px) scale(${zoom})`;
    gridEl.style.transformOrigin = "center";
    zoomPctEl.textContent = `${Math.round(zoom * 100)}%`;
    canvasOverlay.sync(currentWidth, currentHeight, zoom);
    cropOverlay.syncZoom(zoom);
  }

  function updateInfoPanel(): void {
    resizeBtn.textContent = t("editorCanvas.resizeBtn");
    mirrorCtrl.applyTexts();
    if (!currentPartName || !currentPartId) {
      metaEl.textContent = "";
      resizeBtn.disabled = true;
      accessoryBar.refresh(null, null);
      return;
    }
    const basePart = currentBaseSize
      ? ` (${t("editorCanvas.baseSizeTag")} ${currentBaseSize[0]}×${currentBaseSize[1]})`
      : "";
    metaEl.textContent = `${localizePartName(currentPartName)} ${currentWidth}×${currentHeight}${basePart}`;
    resizeBtn.disabled = false;
    accessoryBar.refresh(currentPartId, currentPartName);
  }

  function refreshBaseSize(explicit?: [number, number] | null): void {
    if (explicit !== undefined) {
      currentBaseSize = explicit;
      canvasOverlay.setBaseSize(currentBaseSize);
      updateInfoPanel();
      return;
    }
    const partId = currentPartId;
    const parsed = partId ? parsePartId(partId) : null;
    if (!partId || !parsed) {
      currentBaseSize = null;
      canvasOverlay.setBaseSize(null);
      return;
    }
    const seq = ++baseSizeSeq;
    getBaseSize(skinRoot, parsed.skinName, parsed.category, parsed.partName)
      .then((res) => {
        if (seq !== baseSizeSeq || currentPartId !== partId) return;
        currentBaseSize = res.found ? [res.width, res.height] : null;
        canvasOverlay.setBaseSize(currentBaseSize);
        updateInfoPanel();
      })
      .catch(() => {
        if (seq === baseSizeSeq && currentPartId === partId) {
          currentBaseSize = null;
          canvasOverlay.setBaseSize(null);
        }
      });
  }

  function applyCanvasDimensions(w: number, h: number): void {
    canvas.width = w;
    canvas.height = h;
    zonesOverlay.width = w;
    zonesOverlay.height = h;
    gridEl.style.width = `${w}px`;
    gridEl.style.height = `${h}px`;
    currentWidth = w;
    currentHeight = h;
    canvasOverlay.sync(w, h, zoom);
    cropOverlay.syncCanvasSize(w, h);
    updateInfoPanel();
  }

  function handleCanvasResized(w: number, h: number, baseSize?: [number, number] | null): void {
    applyCanvasDimensions(w, h);
    if (baseSize) refreshBaseSize(baseSize);
    else refreshBaseSize();
    if (currentPartId) zonesCtrl.loadForPart(currentPartId);
    refreshFlatten();
    applyZoom();
  }

  function showPlaceholder(info: PlaceholderInfo, isError: boolean): void {
    placeholderInfo = info;
    gridEl.style.display = "none";
    placeholderEl.style.display = "block";
    placeholderEl.style.color = isError ? "#dc3545" : "";
    placeholderEl.textContent = renderPlaceholderText(info);
    currentPartId = null;
    currentPartName = null;
    currentWidth = 0;
    currentHeight = 0;
    currentBaseSize = null;
    mirrorCtrl.clear();
    zonesCtrl.clear();
    canvasOverlay.setBaseSize(null);
    canvasOverlay.setCursor(null, null);
    canvasOverlay.sync(0, 0, zoom);
    cropOverlay.syncCanvasSize(0, 0);
    updateInfoPanel();
    if (sessionStore.getState().currentPartId !== null) {
      sessionStore.setState({ currentPartId: null });
    }
  }

  function renderPlaceholderText(info: PlaceholderInfo): string {
    switch (info.kind) {
      case "none":
        return "";
      case "notSelected":
        return t("editorCanvas.notSelected");
      case "loading":
        return `${t("editorCanvas.loadingPrefix")}${localizePartName(info.partName)}`;
      case "error":
        return `${t("editorCanvas.loadFailedPrefix")} ${localizePartName(info.partName)}：${info.msg}`;
    }
  }

  function fitZoomToStage(partW: number, partH: number): void {
    const rect = stageEl.getBoundingClientRect();
    const availW = Math.max(50, rect.width - 16);
    const availH = Math.max(50, rect.height - 16);
    if (partW <= 0 || partH <= 0) return;
    const fit = Math.min(availW / partW, availH / partH);
    zoom = Math.max(ZOOM_MIN, Math.floor(fit * 2) / 2);
    panOffsetX = 0;
    panOffsetY = 0;
  }

  function render(result: LoadPartResult, partName: string, resetView = true): void {
    if (!ctx) return;
    currentPartName = partName;
    currentPartId = result.partId;
    applyCanvasDimensions(result.width, result.height);
    const data = new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height);
    ctx.putImageData(data, 0, 0);
    gridEl.style.display = "";
    placeholderEl.style.display = "none";
    placeholderInfo = { kind: "none" };
    mirrorCtrl.refresh(result.partId, partName);
    refreshBaseSize();
    sessionStore.setState({ currentPartId: result.partId });
    zonesCtrl.loadForPart(result.partId);
    if (resetView) fitZoomToStage(result.width, result.height);
    applyZoom();
  }

  let pendingFlattenKey = 0;
  function refreshFlatten(): void {
    const partId = currentPartId;
    if (!partId || !ctx) return;
    const key = ++pendingFlattenKey;
    getFlatten(partId)
      .then((result) => {
        if (key !== pendingFlattenKey || result.partId !== currentPartId) return;
        if (result.width !== canvas.width || result.height !== canvas.height) {
          applyCanvasDimensions(result.width, result.height);
        }
        const data = new ImageData(new Uint8ClampedArray(result.pixels), result.width, result.height);
        ctx.putImageData(data, 0, 0);
      })
      .catch((e: ApiError) => {
        console.warn(`[editorCanvas] flatten failed: ${e?.message ?? String(e)}`);
      });
  }

  function eventToPixel(event: MouseEvent): { cx: number; cy: number } {
    const rect = canvas.getBoundingClientRect();
    const cx = Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width);
    const cy = Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height);
    return { cx, cy };
  }

  function paintSegment(event: MouseEvent): void {
    const partId = paintingPartId;
    if (!partId || canvas.width <= 0 || canvas.height <= 0) return;
    const { cx, cy } = eventToPixel(event);
    if (cx === lastCx && cy === lastCy) return;
    const pts =
      lastCx >= 0 && lastCy >= 0
        ? bresenhamLine(lastCx, lastCy, cx, cy).slice(1)
        : [[cx, cy] as [number, number]];
    lastCx = cx;
    lastCy = cy;

    const inBounds = pts.filter(([px, py]) => px >= 0 && py >= 0 && px < canvas.width && py < canvas.height);
    if (inBounds.length === 0) return;

    const { brushSize, color, alpha, softBrushHardness } = sessionStore.getState();
    const tool = paintingTool;
    const rgba: [number, number, number, number] = [color[0], color[1], color[2], alpha];

    enqueueStrokeOp(async () => {
      let lastDiff = null;
      for (const [px, py] of inBounds) {
        try {
          const diff =
            tool === "eraser"
              ? await applyEraser({ partId, cx: px, cy: py, brushSize })
              : tool === "softBrush"
                ? await applySoftBrush({
                    partId,
                    cx: px,
                    cy: py,
                    brushSize,
                    hardness: normalizeSoftBrushHardness(softBrushHardness),
                    color: rgba,
                  })
                : await applyBrush({ partId, cx: px, cy: py, brushSize, color: rgba });
          if (diff.width > 0 && diff.height > 0) lastDiff = diff;
        } catch (e) {
          console.warn(`[editorCanvas] paint failed: ${(e as ApiError)?.message ?? String(e)}`);
        }
      }
      if (lastDiff) {
        markPartDirty(partId);
        sessionStore.setState({ lastAppliedDiff: { partId, diff: lastDiff, phase: "after" } });
      }
    });
  }

  function onMouseDown(event: MouseEvent): void {
    const tool = sessionStore.getState().activeTool;
    const isPan =
      event.button === 1 ||
      event.button === 2 ||
      (event.button === 0 && (event.shiftKey || tool === "pan"));
    if (isPan) {
      event.preventDefault();
      isPanning = true;
      panStartX = event.clientX;
      panStartY = event.clientY;
      panStartOffX = panOffsetX;
      panStartOffY = panOffsetY;
      gridEl.style.cursor = "grabbing";
      return;
    }
    if (event.button !== 0 || !currentPartId || tool === "crop") return;

    if ((tool === "brush" || tool === "eraser" || tool === "softBrush") && event.altKey) {
      const { cx, cy } = eventToPixel(event);
      const rgb = sampleCanvasRgb(ctx, cx, cy, canvas.width, canvas.height);
      if (rgb) sessionStore.setState({ color: rgb });
      return;
    }
    if (tool === "gradient") {
      const { cx, cy } = eventToPixel(event);
      isGradient = true;
      gradientStartCx = cx;
      gradientStartCy = cy;
      return;
    }
    if (tool === "fill") {
      doFill(event);
      return;
    }
    const eraserMode = sessionStore.getState().eraserMode ?? "part";
    if (tool === "zoneBrush" || (tool === "eraser" && eraserMode === "zone")) {
      isZonePainting = true;
      isZoneErasing = tool === "eraser" || event.altKey;
      const { cx, cy } = eventToPixel(event);
      zonesCtrl.paintAt(cx, cy, -1, -1, isZoneErasing);
      lastCx = cx;
      lastCy = cy;
      return;
    }

    isPainting = true;
    lastCx = -1;
    lastCy = -1;
    const partId = currentPartId;
    paintingPartId = partId;
    paintingTool = tool === "eraser" ? "eraser" : tool === "softBrush" ? "softBrush" : "brush";
    enqueueStrokeOp(async () => {
      try {
        await apiBeginStroke(partId);
      } catch (e) {
        console.warn(`[editorCanvas] beginStroke failed: ${(e as ApiError)?.message ?? String(e)}`);
      }
    });
    paintSegment(event);
  }

  function doFill(event: MouseEvent): void {
    const partId = currentPartId;
    if (!partId) return;
    const { cx, cy } = eventToPixel(event);
    if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) return;
    const { color, alpha } = sessionStore.getState();
    enqueueStrokeOp(async () => {
      try {
        const diff = await applyFill({
          partId,
          cx,
          cy,
          color: [color[0], color[1], color[2], alpha],
          tolerance: 0,
        });
        if (diff.width === 0 || diff.height === 0) return;
        markPartDirty(partId);
        sessionStore.setState({ lastAppliedDiff: { partId, diff, phase: "after" } });
        pushHistoryRecord({ partId, tool: "fill", rectW: diff.width, rectH: diff.height });
      } catch (e) {
        console.warn(`[editorCanvas] fill failed: ${(e as ApiError)?.message ?? String(e)}`);
      }
    });
  }

  function finishGradient(event: MouseEvent): void {
    isGradient = false;
    const partId = currentPartId;
    if (!partId) return;
    const { cx: endCx, cy: endCy } = eventToPixel(event);
    const { color, alpha } = sessionStore.getState();
    const x0 = gradientStartCx;
    const y0 = gradientStartCy;
    enqueueStrokeOp(async () => {
      try {
        const diff = await applyGradient({
          partId,
          x0,
          y0,
          x1: endCx,
          y1: endCy,
          color: [color[0], color[1], color[2], alpha],
        });
        if (diff.width === 0 || diff.height === 0) return;
        markPartDirty(partId);
        sessionStore.setState({ lastAppliedDiff: { partId, diff, phase: "after" } });
        pushHistoryRecord({ partId, tool: "gradient", rectW: diff.width, rectH: diff.height });
      } catch (e) {
        console.warn(`[editorCanvas] gradient failed: ${(e as ApiError)?.message ?? String(e)}`);
      }
    });
  }

  function onDocMouseMove(event: MouseEvent): void {
    if (isPanning) {
      panOffsetX = panStartOffX + (event.clientX - panStartX);
      panOffsetY = panStartOffY + (event.clientY - panStartY);
      applyZoom();
      return;
    }
    if (isZonePainting) {
      const { cx, cy } = eventToPixel(event);
      if (cx !== lastCx || cy !== lastCy) {
        zonesCtrl.paintAt(cx, cy, lastCx, lastCy, isZoneErasing);
        lastCx = cx;
        lastCy = cy;
      }
      return;
    }
    if (isPainting) {
      paintSegment(event);
    }
  }

  function endActiveInteraction(event?: MouseEvent): void {
    if (isGradient) {
      if (event) finishGradient(event);
      else isGradient = false;
    }
    if (isPanning) {
      isPanning = false;
      gridEl.style.cursor = cursorForTool(sessionStore.getState().activeTool, false);
    }
    if (isZonePainting) {
      isZonePainting = false;
      zonesCtrl.flushIfDirty();
    }
    if (isPainting && paintingPartId) {
      const partId = paintingPartId;
      const tool = paintingTool;
      paintingPartId = null;
      enqueueStrokeOp(async () => {
        try {
          const diff = await apiEndStroke(partId);
          if (diff.width === 0 || diff.height === 0) return;
          markPartDirty(partId);
          pushHistoryRecord({ partId, tool, rectW: diff.width, rectH: diff.height });
          sessionStore.setState({ lastAppliedDiff: { partId, diff, phase: "after" } });
        } catch (e) {
          console.warn(`[editorCanvas] endStroke failed: ${(e as ApiError)?.message ?? String(e)}`);
        }
      });
    }
    isPainting = false;
    lastCx = -1;
    lastCy = -1;
  }

  function onDocMouseUp(event: MouseEvent): void {
    if (isPanning || isPainting || isZonePainting || isGradient) {
      endActiveInteraction(event);
    }
  }

  function onWindowBlur(): void {
    endActiveInteraction();
  }

  function reloadCurrent(): void {
    if (!currentPartId) return;
    const parsed = parsePartId(currentPartId);
    if (!parsed) return;
    const seq = ++loadSeq;
    loadPartImage(skinRoot, parsed.skinName, parsed.category, parsed.partName)
      .then((r) => {
        if (seq !== loadSeq) return;
        render(r, parsed.partName, false);
      })
      .catch((e: ApiError) => {
        if (seq !== loadSeq) return;
        lastKey = null;
        showPlaceholder({ kind: "error", partName: parsed.partName, msg: e?.message ?? String(e) }, true);
      });
  }

  function onSessionChange(): void {
    const state = sessionStore.getState();
    gridEl.style.cursor = cursorForTool(state.activeTool, isPanning);
    if (state.lastAppliedDiff !== lastAppliedDiffRef) {
      lastAppliedDiffRef = state.lastAppliedDiff;
      if (state.lastAppliedDiff && state.lastAppliedDiff.partId === currentPartId) {
        const diff = state.lastAppliedDiff.diff;
        if (diff.resized) {
          // 撤销/重做整画布裁扩时同步重建画布/叠加层尺寸、重载区块与基准尺寸显示。
          const nextW = diff.canvasWidth ?? currentWidth;
          const nextH = diff.canvasHeight ?? currentHeight;
          applyCanvasDimensions(nextW, nextH);
          zonesCtrl.loadForPart(currentPartId);
          refreshBaseSize();
          applyZoom();
        }
        refreshFlatten();
      }
    }
    const ver = state.layerSnapshotVersion ?? 0;
    if (ver !== lastLayerSnapshotVersion) {
      lastLayerSnapshotVersion = ver;
      if (currentPartId) refreshFlatten();
    }
    const { currentSkinName, selectedPartName, selectedCategory } = state;
    if (!currentSkinName || !selectedPartName || !selectedCategory) {
      lastKey = null;
      loadSeq++;
      showPlaceholder({ kind: "notSelected" }, false);
      return;
    }
    const key = `${currentSkinName}::${selectedCategory}::${selectedPartName}`;
    if (key === lastKey) return;
    lastKey = key;
    const seq = ++loadSeq;
    showPlaceholder({ kind: "loading", partName: selectedPartName }, false);
    loadPartImage(skinRoot, currentSkinName, selectedCategory, selectedPartName)
      .then((result) => {
        if (seq !== loadSeq) return;
        render(result, selectedPartName, true);
      })
      .catch((e: ApiError) => {
        if (seq !== loadSeq) return;
        lastKey = null;
        showPlaceholder(
          { kind: "error", partName: selectedPartName, msg: e.message ?? String(e) },
          true,
        );
      });
  }

  zoomOutBtn.addEventListener("click", () => {
    zoom = Math.max(ZOOM_MIN, zoom / 1.25);
    applyZoom();
  });
  zoomInBtn.addEventListener("click", () => {
    zoom = zoom * 1.25;
    applyZoom();
  });

  resizeBtn.addEventListener("click", () => openResizeModal("canvas"));

  stageEl.addEventListener("contextmenu", (e) => e.preventDefault());
  stageEl.addEventListener("mousedown", onMouseDown);
  stageEl.addEventListener("mousemove", (event) => {
    if (!currentPartId || canvas.width <= 0 || canvas.height <= 0) {
      canvasOverlay.setCursor(null, null);
      return;
    }
    const { cx, cy } = eventToPixel(event);
    if (cx >= 0 && cy >= 0 && cx < canvas.width && cy < canvas.height) {
      canvasOverlay.setCursor(cx, cy);
    } else {
      canvasOverlay.setCursor(null, null);
    }
  });
  stageEl.addEventListener("mouseleave", () => canvasOverlay.setCursor(null, null));
  document.addEventListener("mousemove", onDocMouseMove);
  document.addEventListener("mouseup", onDocMouseUp);
  window.addEventListener("blur", onWindowBlur);
  stageEl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      zoom = Math.max(ZOOM_MIN, zoom * factor);
      applyZoom();
    },
    { passive: false },
  );

  const unsubscribe = sessionStore.subscribe(onSessionChange);
  const detachInverted = attachInvertedBorder(stageEl);
  const detachAlt = attachAltCursor(stageEl);

  const transformPanelEl = container.querySelector<HTMLDivElement>('[data-role="transform-panel"]')!;
  const transformToggleBtn = container.querySelector<HTMLButtonElement>('[data-role="transform-toggle"]')!;
  const detachTransform = mountTransformControls(transformPanelEl);
  function applyTransformToggleText(): void {
    transformToggleBtn.textContent = t("transform.toggle");
  }
  applyTransformToggleText();
  transformToggleBtn.addEventListener("click", () => {
    const open = transformPanelEl.style.display === "none";
    transformPanelEl.style.display = open ? "block" : "none";
    transformToggleBtn.classList.toggle("btn-primary", open);
  });

  applyZoom();
  updateInfoPanel();
  onSessionChange();

  let lastBadgeKey = "";
  function refreshBadge(): void {
    if (!dock) return;
    const { currentPartId: pid, dirtyPartIds } = sessionStore.getState();
    if (!pid) {
      if (lastBadgeKey !== "") {
        dock.setTitleBadge("");
        lastBadgeKey = "";
      }
      return;
    }
    const dirty = dirtyPartIds.includes(pid);
    const text = dirty ? t("editorCanvas.unsaved") : t("editorCanvas.saved");
    const variant = dirty ? "warn" : "ok";
    const key = `${dirty ? "1" : "0"}::${text}`;
    if (key === lastBadgeKey) return;
    lastBadgeKey = key;
    dock.setTitleBadge(text, variant);
  }
  refreshBadge();
  const unsubBadge = sessionStore.subscribe(refreshBadge);

  const unsubLang = subscribeLang(() => {
    if (placeholderInfo.kind !== "none" && placeholderEl.style.display !== "none") {
      placeholderEl.textContent = renderPlaceholderText(placeholderInfo);
    }
    updateInfoPanel();
    accessoryBar.refreshLang();
    lastBadgeKey = "";
    refreshBadge();
    applyTransformToggleText();
  });

  attachFooterGrip(
    container,
    container.querySelector<HTMLDivElement>('[data-role="footer"]')!,
    container.querySelector<HTMLDivElement>('[data-role="footer-grip"]')!,
  );

  return () => {
    unsubscribe();
    unsubBadge();
    unsubLang();
    accessoryBar.destroy();
    zonesCtrl.destroy();
    canvasOverlay.destroy();
    cropOverlay.destroy();
    detachInverted();
    detachAlt();
    detachTransform();
    document.removeEventListener("mousemove", onDocMouseMove);
    document.removeEventListener("mouseup", onDocMouseUp);
    window.removeEventListener("blur", onWindowBlur);
    loadSeq++;
  };
}
