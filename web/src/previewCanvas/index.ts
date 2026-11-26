// 静态装配与动作捕捉回放预览画布。

import {
  getCompositeImage,
  getMotionCompositeImage,
  listMotionCaptures,
  loadMotionCapture,
  setAssemblyOverride,
  type ApiError,
  type HeadVariant,
  type MotionCaptureMeta,
  type MotionCaptureResult,
  type SetAssemblyOverrideParams,
} from "../apiClient";
import { sessionStore, type SessionState } from "../stateStore";
import type { PartCategory } from "../stateStore/types";
import { subscribeLang, t } from "../i18n";
import { localizePartName } from "../i18n/partNames";
import {
  buildPreviewCanvasHtml,
  CAPTURE_ROOT,
  findFrameIndexByTime,
  populateBasePartPositions,
  renderCaptureDropdown,
  renderMotionDebugSection,
  syncExpressionSelect,
  syncHeadVariantSelect,
  toAssemblyEntryName,
} from "./helpers";

type ViewFacing = "left" | "right";
type PreviewMode = "assembly" | "motion";
type PlaceholderInfo =
  | { kind: "none" }
  | { kind: "notSelectedSkin" }
  | { kind: "message"; text: string }
  | { kind: "compositeFailed"; msg: string };

export function mountPreviewCanvas(container: HTMLElement, skinRoot: string): () => void {
  container.classList.add("panel", "preview-canvas");
  container.style.flexDirection = "column";
  container.innerHTML = buildPreviewCanvasHtml();

  const orientationEl = container.querySelector<HTMLDivElement>('[data-role="orientation"]')!;
  const expressionLabelEl = container.querySelector<HTMLSpanElement>('[data-role="expression-label"]')!;
  const expressionSelect = container.querySelector<HTMLSelectElement>('[data-role="expression-select"]')!;
  const headVariantLabelEl = container.querySelector<HTMLSpanElement>('[data-role="head-variant-label"]')!;
  const headVariantSelect = container.querySelector<HTMLSelectElement>('[data-role="head-variant-select"]')!;
  const previewModeEl = container.querySelector<HTMLDivElement>('[data-role="preview-mode"]')!;
  const motionCaptureHost = container.querySelector<HTMLDivElement>('[data-role="motion-capture-host"]')!;
  const motionCaptureToggle = container.querySelector<HTMLButtonElement>('[data-role="motion-capture-toggle"]')!;
  const motionCapturePopover = container.querySelector<HTMLDivElement>('[data-role="motion-capture-popover"]')!;
  const motionPlayBtn = container.querySelector<HTMLButtonElement>('[data-role="motion-play"]')!;
  const motionFrameRange = container.querySelector<HTMLInputElement>('[data-role="motion-frame-range"]')!;
  const motionFrameLabel = container.querySelector<HTMLSpanElement>('[data-role="motion-frame-label"]')!;
  const zoomRange = container.querySelector<HTMLInputElement>('[data-role="zoom-range"]')!;
  const zoomNum = container.querySelector<HTMLInputElement>('[data-role="zoom-num"]')!;
  const resetViewBtn = container.querySelector<HTMLButtonElement>('[data-role="reset-view"]')!;
  const stageMainEl = container.querySelector<HTMLDivElement>('[data-role="stage-main"]')!;
  const viewportEl = container.querySelector<HTMLDivElement>('[data-role="viewport"]')!;
  const canvas = container.querySelector<HTMLCanvasElement>('[data-role="canvas"]')!;
  const liveCb = container.querySelector<HTMLInputElement>('[data-role="live-cb"]')!;
  const liveLabel = container.querySelector<HTMLSpanElement>('[data-role="live-label"]')!;
  const refreshNowBtn = container.querySelector<HTMLButtonElement>('[data-role="refresh-now"]')!;
  const placeholderEl = container.querySelector<HTMLDivElement>('[data-role="placeholder"]')!;
  const motionSideEl = container.querySelector<HTMLElement>('[data-role="motion-side"]')!;
  const motionSideTitleEl = container.querySelector<HTMLDivElement>('[data-role="motion-side-title"]')!;
  const motionSideMetaEl = container.querySelector<HTMLDivElement>('[data-role="motion-side-meta"]')!;
  const motionPartsEl = container.querySelector<HTMLDivElement>('[data-role="motion-parts"]')!;
  const footerEl = container.querySelector<HTMLDivElement>('[data-role="footer"]')!;
  const footerResizeEl = container.querySelector<HTMLDivElement>('[data-role="footer-resize"]')!;
  const metaEl = container.querySelector<HTMLDivElement>('[data-role="meta"]')!;
  const hintEl = container.querySelector<HTMLDivElement>('[data-role="hint"]')!;
  const ctx = canvas.getContext("2d");
  if (ctx) ctx.imageSmoothingEnabled = false;
  footerEl.style.boxSizing = "border-box";

  let viewFacing: ViewFacing = "left";
  let currentMotionIsRight = false;
  let previewMode: PreviewMode = "assembly";
  const ZOOM_MIN_PCT = 10;
  const ZOOM_MAX_PCT = 800;
  const DEFAULT_ZOOM_PCT = 200;
  let zoomPct = DEFAULT_ZOOM_PCT;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let dragMode: "viewport" | "part" = "viewport";
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartOffX = 0;
  let dragStartOffY = 0;
  let dragPartName = "";
  let dragPartCategory: PartCategory = "Body";
  let dragStartPartX = 0;
  let dragStartPartY = 0;

  const basePartPositions = new Map<string, { x: number; y: number }>();
  const partOverridesCache = new Map<string, { x: number; y: number }>();
  let overrideInflight = false;
  let queuedOverride: SetAssemblyOverrideParams | null = null;

  let lastSkinName: string | null = sessionStore.getState().currentSkinName;
  let lastExpression: number = sessionStore.getState().expressionIndex;
  let lastHeadVariant: HeadVariant = sessionStore.getState().headVariant;
  let lastSelectedPart: string | null = sessionStore.getState().selectedPartName;
  let lastShowMotionDebugPanel: boolean = sessionStore.getState().showMotionDebugPanel;
  let livePreviewEnabled = true;
  let stalePending = false;
  let lastLayerSnapshotVersion: number = sessionStore.getState().layerSnapshotVersion ?? 0;
  let lastDiffRef: SessionState["lastAppliedDiff"] = sessionStore.getState().lastAppliedDiff;
  let lastAssemblyOverrideVersion: number = sessionStore.getState().assemblyOverrideVersion ?? 0;
  let lastAccessoriesVersion: number = sessionStore.getState().accessoriesVersion ?? 0;
  let lastCanvasSizeVersion: number = sessionStore.getState().canvasSizeVersion ?? 0;
  let pendingAssemblyKey = 0;
  let pendingMotionKey = 0;
  let placeholderInfo: PlaceholderInfo = { kind: "notSelectedSkin" };
  let motionCaptures: MotionCaptureMeta[] = [];
  let motionCapturePath = "";
  let motionData: MotionCaptureResult | null = null;
  let motionFrameIndex = 0;
  let motionLoading = false;
  let motionPlaying = false;
  let motionCapturePopoverOpen = false;
  let motionTimer = 0;
  let motionPlaybackStartMs = 0;
  let motionPlaybackStartTime = 0;
  let footerHeightPct = 14;
  let footerResizing = false;

  const FOOTER_MIN_PCT = 8;
  const FOOTER_MAX_PCT = 35;

  function flushQueuedOverride(): void {
    if (overrideInflight || !queuedOverride) return;
    const params = queuedOverride;
    queuedOverride = null;
    overrideInflight = true;
    setAssemblyOverride(params)
      .then(() => {
        if (previewMode === "assembly") refreshAssembly();
      })
      .catch((e) => console.warn("[previewCanvas] setAssemblyOverride failed", e))
      .finally(() => {
        overrideInflight = false;
        if (queuedOverride) flushQueuedOverride();
      });
  }

  function applyFooterHeight(): void {
    footerHeightPct = Math.max(FOOTER_MIN_PCT, Math.min(FOOTER_MAX_PCT, footerHeightPct));
    footerEl.style.flex = `0 0 ${footerHeightPct}%`;
    footerEl.style.height = `${footerHeightPct}%`;
  }

  function applyTransform(): void {
    const z = zoomPct / 100;
    // 原始 100×100 合成画布（头在 X=+10）默认面朝右；朝左时通过负 X 缩放水平镜像（与游戏 Body.localScale.x=-1 一致）。
    const mirror = previewMode === "motion" ? !currentMotionIsRight : viewFacing === "left";
    const sx = mirror ? -z : z;
    viewportEl.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scale(${sx}, ${z})`;
    zoomRange.value = String(zoomPct);
    zoomNum.value = String(zoomPct);
  }

  function setZoom(pct: number): void {
    if (!Number.isFinite(pct)) return;
    zoomPct = Math.max(ZOOM_MIN_PCT, Math.min(ZOOM_MAX_PCT, Math.round(pct)));
    applyTransform();
  }

  function resetView(): void {
    zoomPct = DEFAULT_ZOOM_PCT;
    offsetX = 0;
    offsetY = 0;
    applyTransform();
  }

  function renderPlaceholderText(info: PlaceholderInfo): string {
    switch (info.kind) {
      case "none":
        return "";
      case "notSelectedSkin":
        return t("previewCanvas.notSelectedSkin");
      case "message":
        return info.text;
      case "compositeFailed":
        return `${t("previewCanvas.compositeFailedPrefix")}${info.msg}`;
    }
  }

  function showPlaceholder(info: PlaceholderInfo, isError: boolean): void {
    placeholderInfo = info;
    canvas.style.display = "none";
    placeholderEl.style.display = "block";
    placeholderEl.style.color = isError ? "#c00" : "";
    placeholderEl.textContent = renderPlaceholderText(info);
  }

  function drawPixels(width: number, height: number, pixels: number[]): void {
    if (!ctx) return;
    const data = new ImageData(new Uint8ClampedArray(pixels), width, height);
    ctx.putImageData(data, 0, 0);
    canvas.style.display = "";
    placeholderEl.style.display = "none";
    placeholderInfo = { kind: "none" };
  }

  function stopMotionPlayback(): void {
    motionPlaying = false;
    if (motionTimer) {
      window.clearInterval(motionTimer);
      motionTimer = 0;
    }
  }

  function renderMotionPartPanel(frame: MotionCaptureResult["frames"][number] | null): void {
    renderMotionDebugSection(motionSideTitleEl, motionSideMetaEl, motionPartsEl, motionData, frame);
  }

  function renderMotionToolbar(): void {
    previewModeEl.innerHTML = "";
    for (const mode of ["assembly", "motion"] as PreviewMode[]) {
      const btn = document.createElement("button");
      btn.textContent = mode === "assembly" ? t("previewCanvas.modeAssembly") : t("previewCanvas.modeMotion");
      btn.className = mode === previewMode ? "btn btn-primary" : "btn";
      btn.addEventListener("click", () => {
        if (previewMode === mode) return;
        previewMode = mode;
        if (previewMode !== "motion") stopMotionPlayback();
        renderToolbar();
        renderMotionToolbar();
        updateRefreshBtn();
        applyTransform();
        refresh();
      });
      previewModeEl.appendChild(btn);
    }

    renderCaptureDropdown(
      motionCaptureToggle,
      motionCapturePopover,
      motionCaptures,
      motionCapturePath,
      motionLoading,
      (path) => {
        motionCapturePopoverOpen = false;
        motionCapturePopover.hidden = true;
        void selectMotionCapture(path);
      },
    );

    motionPlayBtn.textContent = motionPlaying ? t("previewCanvas.motionPause") : t("previewCanvas.motionPlay");
    motionPlayBtn.disabled = !motionData || motionData.frames.length <= 1;
    motionFrameRange.disabled = !motionData || motionData.frames.length === 0;
    motionFrameRange.max = String(Math.max(0, (motionData?.frames.length ?? 1) - 1));
    motionFrameRange.value = String(
      Math.min(motionFrameIndex, motionData?.frames.length ? motionData.frames.length - 1 : 0),
    );
    motionFrameLabel.textContent = motionData
      ? `${t("previewCanvas.motionFrameLabel")} ${motionFrameIndex + 1}/${motionData.frames.length}`
      : t("previewCanvas.motionCaptureEmpty");
    motionCaptureHost.style.display = previewMode === "motion" ? "" : "none";
    motionPlayBtn.style.display = previewMode === "motion" ? "" : "none";
    motionFrameRange.style.display = previewMode === "motion" ? "" : "none";
    motionFrameLabel.style.display = previewMode === "motion" ? "" : "none";
    motionSideEl.style.display =
      previewMode === "motion" && sessionStore.getState().showMotionDebugPanel ? "block" : "none";
    if (previewMode !== "motion") {
      motionCapturePopoverOpen = false;
      motionCapturePopover.hidden = true;
    } else {
      motionCapturePopover.hidden = !motionCapturePopoverOpen;
    }
  }

  function updateRefreshBtn(): void {
    liveCb.parentElement!.style.display = "flex";
    refreshNowBtn.style.display = !livePreviewEnabled ? "" : "none";
    refreshNowBtn.disabled = !stalePending;
    refreshNowBtn.title = stalePending
      ? t("previewCanvas.manualRefreshPending")
      : t("previewCanvas.manualRefreshIdle");
    refreshNowBtn.classList.toggle("btn-primary", stalePending);
  }

  function applyLiveTexts(): void {
    liveLabel.textContent = t("previewCanvas.livePreview");
    (liveCb.parentElement as HTMLLabelElement).title = t("previewCanvas.livePreviewHint");
    updateRefreshBtn();
  }

  async function selectMotionCapture(path: string): Promise<void> {
    motionCapturePath = path;
    motionData = null;
    motionFrameIndex = 0;
    stopMotionPlayback();
    renderMotionToolbar();
    if (!path) {
      renderMotionPartPanel(null);
      if (previewMode === "motion") refresh();
      return;
    }
    motionLoading = true;
    renderMotionToolbar();
    try {
      motionData = await loadMotionCapture(path);
      motionFrameIndex = 0;
      currentMotionIsRight = motionData.frames[0]?.isRight ?? false;
    } catch (e) {
      motionData = null;
      console.warn(`[previewCanvas] load motion capture failed: ${String(e)}`);
    } finally {
      motionLoading = false;
      renderMotionToolbar();
      renderMotionPartPanel(motionData?.frames[0] ?? null);
      applyTransform();
      if (previewMode === "motion") refresh();
    }
  }

  async function refreshMotionCaptureList(): Promise<void> {
    motionLoading = true;
    renderMotionToolbar();
    try {
      motionCaptures = await listMotionCaptures(CAPTURE_ROOT);
      const preferred = motionCaptures.find((v) => /奔跑/.test(v.fileName)) ?? motionCaptures[0];
      if (preferred) {
        await selectMotionCapture(preferred.path);
      } else {
        motionCapturePath = "";
        motionData = null;
      }
    } catch (e) {
      motionCaptures = [];
      motionCapturePath = "";
      motionData = null;
      console.warn(`[previewCanvas] list motion captures failed: ${String(e)}`);
    } finally {
      motionLoading = false;
      renderMotionToolbar();
    }
  }

  function startMotionPlayback(): void {
    if (!motionData || motionData.frames.length <= 1) return;
    stopMotionPlayback();
    motionPlaying = true;
    motionPlaybackStartMs = performance.now();
    motionPlaybackStartTime = motionData.frames[motionFrameIndex]?.t ?? 0;
    motionTimer = window.setInterval(() => {
      if (!motionData || motionData.frames.length === 0) return;
      const duration = motionData.durationSeconds || motionData.frames[motionData.frames.length - 1]?.t || 0;
      if (duration <= 0) return;
      const elapsed = (performance.now() - motionPlaybackStartMs) / 1000;
      const target = (motionPlaybackStartTime + elapsed) % duration;
      const nextIndex = findFrameIndexByTime(motionData.frames, target);
      if (nextIndex !== motionFrameIndex) {
        motionFrameIndex = nextIndex;
        renderMotionToolbar();
        refreshMotionFrame();
      }
    }, 80);
    renderMotionToolbar();
  }

  function renderToolbar(): void {
    const { expressionIndex } = sessionStore.getState();
    orientationEl.innerHTML = "";
    for (const f of ["left", "right"] as ViewFacing[]) {
      const btn = document.createElement("button");
      btn.textContent = f === "left" ? t("previewCanvas.front") : t("previewCanvas.back");
      btn.className = f === viewFacing ? "btn btn-primary" : "btn";
      btn.disabled = previewMode === "motion";
      btn.addEventListener("click", () => {
        if (viewFacing !== f) {
          viewFacing = f;
          renderToolbar();
          applyTransform();
          if (previewMode === "assembly") refreshAssembly();
        }
      });
      orientationEl.appendChild(btn);
    }

    syncExpressionSelect(expressionLabelEl, expressionSelect, expressionIndex);
    syncHeadVariantSelect(headVariantLabelEl, headVariantSelect, sessionStore.getState().headVariant);

    const sel = sessionStore.getState().selectedPartName;
    if (previewMode === "motion") {
      hintEl.textContent = t("previewCanvas.motionPanelTitle");
    } else if (sel) {
      hintEl.textContent = t("previewCanvas.dragHintWithPart").replace("{part}", localizePartName(sel));
    } else {
      hintEl.textContent = t("previewCanvas.dragHintNoPart");
    }
  }

  function refreshAssembly(): void {
    const skinName = sessionStore.getState().currentSkinName;
    if (!skinName) {
      metaEl.textContent = "";
      showPlaceholder({ kind: "notSelectedSkin" }, false);
      return;
    }
    const { expressionIndex, headVariant } = sessionStore.getState();
    metaEl.textContent = `${skinName} / ${viewFacing} / exp ${expressionIndex} / ${headVariant}`;
    const key = ++pendingAssemblyKey;
    const isRight = viewFacing === "right";
    getCompositeImage({
      skinRoot,
      skinName,
      orientation: "front",
      expressionIndex,
      headVariant,
      timeSec: 0,
      isRight,
    })
      .then((result) => {
        if (key !== pendingAssemblyKey || previewMode !== "assembly") return;
        drawPixels(result.width, result.height, result.pixels);
      })
      .catch((e: ApiError) => {
        if (key !== pendingAssemblyKey || previewMode !== "assembly") return;
        const msg = e?.message ?? String(e);
        console.warn(`[previewCanvas] composite failed: ${msg}`);
        showPlaceholder({ kind: "compositeFailed", msg }, true);
      });
  }

  function refreshMotionFrame(): void {
    const skinName = sessionStore.getState().currentSkinName;
    if (!skinName) {
      metaEl.textContent = "";
      renderMotionPartPanel(null);
      showPlaceholder({ kind: "notSelectedSkin" }, false);
      return;
    }
    if (motionLoading) {
      metaEl.textContent = "";
      renderMotionPartPanel(null);
      showPlaceholder({ kind: "message", text: t("previewCanvas.motionCaptureLoading") }, false);
      return;
    }
    if (!motionData || !motionCapturePath || motionData.frames.length === 0) {
      metaEl.textContent = "";
      renderMotionPartPanel(null);
      showPlaceholder({ kind: "message", text: t("previewCanvas.motionCaptureEmpty") }, false);
      return;
    }
    const frame = motionData.frames[motionFrameIndex];
    if (frame.isRight !== currentMotionIsRight) {
      currentMotionIsRight = frame.isRight;
      applyTransform();
    }
    const { expressionIndex, headVariant } = sessionStore.getState();
    metaEl.textContent = `${skinName} / motion / ${motionData.fileName} / ${motionFrameIndex + 1}/${motionData.frames.length} / t ${frame.t.toFixed(3)}s / exp ${expressionIndex} / ${headVariant}`;
    const key = ++pendingMotionKey;
    getMotionCompositeImage({
      skinRoot,
      skinName,
      capturePath: motionCapturePath,
      frameIndex: motionFrameIndex,
      expressionIndex,
      headVariant,
      timeSec: frame.t,
    })
      .then((result) => {
        if (key !== pendingMotionKey || previewMode !== "motion") return;
        if (result.frame.isRight !== currentMotionIsRight) {
          currentMotionIsRight = result.frame.isRight;
          applyTransform();
        }
        drawPixels(result.width, result.height, result.pixels);
        renderMotionPartPanel(result.frame);
      })
      .catch((e: ApiError) => {
        if (key !== pendingMotionKey || previewMode !== "motion") return;
        const msg = e?.message ?? String(e);
        console.warn(`[previewCanvas] motion composite failed: ${msg}`);
        showPlaceholder({ kind: "compositeFailed", msg }, true);
      });
  }

  function refresh(): void {
    if (previewMode === "motion") {
      refreshMotionFrame();
      return;
    }
    refreshAssembly();
  }

  function onSessionChange(): void {
    const state = sessionStore.getState();
    const skinChanged = state.currentSkinName !== lastSkinName;
    const expressionChanged = state.expressionIndex !== lastExpression;
    const headVariantChanged = state.headVariant !== lastHeadVariant;
    const selectedChanged = state.selectedPartName !== lastSelectedPart;
    const motionDebugChanged = state.showMotionDebugPanel !== lastShowMotionDebugPanel;
    const diffChanged = state.lastAppliedDiff !== lastDiffRef;
    const layerVer = state.layerSnapshotVersion ?? 0;
    const layerChanged = layerVer !== lastLayerSnapshotVersion;
    const overrideVer = state.assemblyOverrideVersion ?? 0;
    const overrideChanged = overrideVer !== lastAssemblyOverrideVersion;
    const accVer = state.accessoriesVersion ?? 0;
    const accChanged = accVer !== lastAccessoriesVersion;
    const sizeVer = state.canvasSizeVersion ?? 0;
    const sizeChanged = sizeVer !== lastCanvasSizeVersion;

    if (skinChanged) {
      partOverridesCache.clear();
      populateBasePartPositions(skinRoot, state.currentSkinName, basePartPositions);
    }

    if (skinChanged || expressionChanged || headVariantChanged || selectedChanged || motionDebugChanged) {
      lastSkinName = state.currentSkinName;
      lastExpression = state.expressionIndex;
      lastHeadVariant = state.headVariant;
      lastSelectedPart = state.selectedPartName;
      lastShowMotionDebugPanel = state.showMotionDebugPanel;
      renderToolbar();
      renderMotionToolbar();
    }

    lastDiffRef = state.lastAppliedDiff;
    lastLayerSnapshotVersion = layerVer;
    lastAssemblyOverrideVersion = overrideVer;
    lastAccessoriesVersion = accVer;
    lastCanvasSizeVersion = sizeVer;

    if (previewMode === "motion") {
      if (skinChanged || expressionChanged || headVariantChanged) {
        stalePending = false;
        refreshMotionFrame();
        updateRefreshBtn();
        return;
      }
      if (!(diffChanged || layerChanged || accChanged || sizeChanged)) return;
      if (!livePreviewEnabled) {
        stalePending = true;
        updateRefreshBtn();
        return;
      }
      stalePending = false;
      refreshMotionFrame();
      updateRefreshBtn();
      return;
    }
    if (
      !(
        skinChanged ||
        expressionChanged ||
        headVariantChanged ||
        diffChanged ||
        layerChanged ||
        overrideChanged ||
        accChanged ||
        sizeChanged
      )
    ) {
      return;
    }
    if (!livePreviewEnabled && !skinChanged) {
      stalePending = true;
      updateRefreshBtn();
      return;
    }
    refreshAssembly();
  }

  expressionSelect.addEventListener("change", () => {
    const idx = Number.parseInt(expressionSelect.value, 10);
    if (Number.isFinite(idx)) sessionStore.setState({ expressionIndex: idx });
  });
  headVariantSelect.addEventListener("change", () => {
    sessionStore.setState({ headVariant: headVariantSelect.value as HeadVariant });
  });
  zoomRange.addEventListener("input", () => setZoom(Number(zoomRange.value)));
  zoomNum.addEventListener("input", () => setZoom(Number(zoomNum.value)));
  resetViewBtn.addEventListener("click", resetView);
  resetViewBtn.textContent = t("previewCanvas.resetViewBtn");
  resetViewBtn.title = t("previewCanvas.resetView");

  stageMainEl.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 5 : -5;
      setZoom(zoomPct + delta);
    },
    { passive: false },
  );

  footerResizeEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    footerResizing = true;
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
    e.stopPropagation();
  });

  stageMainEl.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    if (previewMode === "assembly" && e.shiftKey) {
      const { selectedPartName, selectedCategory } = sessionStore.getState();
      if (selectedPartName && selectedCategory) {
        const entryName = toAssemblyEntryName(selectedCategory, selectedPartName);
        if (entryName) {
          dragMode = "part";
          dragPartName = entryName;
          dragPartCategory = selectedCategory;
          const key = `${dragPartCategory}::${dragPartName}`;
          const startPos = partOverridesCache.get(key) ?? basePartPositions.get(key) ?? { x: 0, y: 0 };
          dragStartPartX = startPos.x;
          dragStartPartY = startPos.y;
          stageMainEl.style.cursor = "crosshair";
          e.preventDefault();
          return;
        }
      }
    }
    dragMode = "viewport";
    dragStartOffX = offsetX;
    dragStartOffY = offsetY;
    stageMainEl.style.cursor = "grabbing";
  });

  const onDocMouseMove = (e: MouseEvent): void => {
    if (footerResizing) {
      const rect = container.getBoundingClientRect();
      if (rect.height > 0) {
        footerHeightPct = ((rect.bottom - e.clientY) / rect.height) * 100;
        applyFooterHeight();
      }
      return;
    }
    if (!dragging) return;
    if (dragMode === "viewport") {
      offsetX = dragStartOffX + (e.clientX - dragStartX);
      offsetY = dragStartOffY + (e.clientY - dragStartY);
      applyTransform();
      return;
    }
    const z = zoomPct / 100;
    const dxScreen = e.clientX - dragStartX;
    const dyScreen = e.clientY - dragStartY;
    const dxAssembly = Math.round(dxScreen / z) * (viewFacing === "left" ? -1 : 1);
    const dyAssembly = Math.round(dyScreen / z);
    const newX = dragStartPartX + dxAssembly;
    const newY = dragStartPartY + dyAssembly;
    const key = `${dragPartCategory}::${dragPartName}`;
    const prev = partOverridesCache.get(key);
    if (prev && prev.x === newX && prev.y === newY) return;
    partOverridesCache.set(key, { x: newX, y: newY });
    queuedOverride = {
      partName: dragPartName,
      category: dragPartCategory,
      position: { x: newX, y: newY },
    };
    flushQueuedOverride();
  };

  const endInteraction = (): void => {
    if (footerResizing) {
      footerResizing = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    if (dragging) {
      dragging = false;
      stageMainEl.style.cursor = "grab";
    }
  };

  document.addEventListener("mousemove", onDocMouseMove);
  document.addEventListener("mouseup", endInteraction);
  window.addEventListener("blur", endInteraction);
  stageMainEl.style.cursor = "grab";

  liveCb.addEventListener("change", () => {
    livePreviewEnabled = liveCb.checked;
    if (livePreviewEnabled && stalePending) {
      stalePending = false;
      refresh();
    }
    updateRefreshBtn();
  });
  refreshNowBtn.addEventListener("click", () => {
    if (!stalePending) return;
    stalePending = false;
    refresh();
    updateRefreshBtn();
  });
  motionCaptureToggle.addEventListener("click", (e) => {
    e.preventDefault();
    if (motionCaptureToggle.disabled) return;
    motionCapturePopoverOpen = !motionCapturePopoverOpen;
    motionCapturePopover.hidden = !motionCapturePopoverOpen;
  });
  motionPlayBtn.addEventListener("click", () => {
    if (motionPlaying) stopMotionPlayback();
    else startMotionPlayback();
    renderMotionToolbar();
  });
  motionFrameRange.addEventListener("input", () => {
    motionFrameIndex = Number(motionFrameRange.value);
    if (motionPlaying && motionData) {
      motionPlaybackStartMs = performance.now();
      motionPlaybackStartTime = motionData.frames[motionFrameIndex]?.t ?? 0;
    }
    renderMotionToolbar();
    if (previewMode === "motion") refreshMotionFrame();
  });

  populateBasePartPositions(skinRoot, lastSkinName, basePartPositions);
  applyLiveTexts();
  renderToolbar();
  renderMotionToolbar();
  applyFooterHeight();
  applyTransform();
  renderMotionPartPanel(null);

  const unsubscribe = sessionStore.subscribe(onSessionChange);
  const unsubLang = subscribeLang(() => {
    renderToolbar();
    renderMotionToolbar();
    resetViewBtn.textContent = t("previewCanvas.resetViewBtn");
    resetViewBtn.title = t("previewCanvas.resetView");
    applyLiveTexts();
    renderMotionPartPanel(previewMode === "motion" ? motionData?.frames[motionFrameIndex] ?? null : null);
    if (placeholderInfo.kind !== "none" && placeholderEl.style.display !== "none") {
      placeholderEl.textContent = renderPlaceholderText(placeholderInfo);
    }
  });

  const onDocMouseDown = (event: MouseEvent): void => {
    if (motionCapturePopover.hidden) return;
    const target = event.target as Node;
    if (motionCapturePopover.contains(target) || motionCaptureToggle.contains(target)) return;
    motionCapturePopoverOpen = false;
    motionCapturePopover.hidden = true;
  };
  document.addEventListener("mousedown", onDocMouseDown);

  void refreshMotionCaptureList().finally(() => {
    if (previewMode === "motion") refreshMotionFrame();
  });
  onSessionChange();

  return () => {
    unsubscribe();
    unsubLang();
    document.removeEventListener("mousedown", onDocMouseDown);
    document.removeEventListener("mousemove", onDocMouseMove);
    document.removeEventListener("mouseup", endInteraction);
    window.removeEventListener("blur", endInteraction);
    endInteraction();
    stopMotionPlayback();
    pendingAssemblyKey = -1;
    pendingMotionKey = -1;
  };
}
