// 合成预览画布。
// 默认模式仍是装配预览；新增动画模式后，可直接读取 captures JSON 播放并在右侧显示当前 limb 帧数据。

import {
  getCompositeImage,
  getMotionCompositeImage,
  loadMotionCapture,
  listMotionCaptures,
  setAssemblyOverride,
  type ApiError,
  type HeadVariant,
  type MotionCaptureFrame,
  type MotionCaptureMeta,
  type MotionCaptureResult,
} from "../apiClient";
import { sessionStore, type SessionState } from "../stateStore";
import { subscribeLang, t } from "../i18n";
import { localizePartName } from "../i18n/partNames";
import { ICON_REFRESH } from "../toolPanel/toolIcons";

const COMPOSITE_W = 100;
const COMPOSITE_H = 100;
const EXPRESSION_COUNT = 7;
const CAPTURE_ROOT = "captures";

const HEAD_VARIANTS: HeadVariant[] = [
  "default",
  "mouthHalf",
  "mouth",
  "disfigured1",
  "disfigured2",
  "disfigured3",
  "disfigured1Healed",
  "disfigured2Healed",
  "disfigured3Healed",
];

type ViewFacing = "left" | "right";
type PreviewMode = "assembly" | "motion";
type PlaceholderInfo =
  | { kind: "none" }
  | { kind: "notSelectedSkin" }
  | { kind: "message"; text: string }
  | { kind: "compositeFailed"; msg: string };

function findFrameIndexByTime(frames: MotionCaptureFrame[], targetTime: number): number {
  if (frames.length === 0) return 0;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (frames[mid].t <= targetTime) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function mountPreviewCanvas(container: HTMLElement, skinRoot: string): () => void {
  container.classList.add("panel", "preview-canvas");
  container.style.flexDirection = "column";
  container.innerHTML =
    `<div class="preview-toolbar" style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid rgba(0,0,0,var(--border-opacity));flex-wrap:wrap;">` +
    `<div data-role="orientation" style="display:flex;gap:4px;"></div>` +
    `<div data-role="expression" style="display:flex;gap:4px;"></div>` +
    `</div>` +
    `<div class="preview-toolbar" style="display:flex;align-items:center;gap:4px;padding:6px 8px;border-bottom:1px solid rgba(0,0,0,var(--border-opacity));flex-wrap:wrap;">` +
    `<span data-role="head-variant-label" style="opacity:0.7;font-size:11px;"></span>` +
    `<div data-role="head-variant" style="display:flex;gap:4px;flex-wrap:wrap;"></div>` +
    `</div>` +
    `<div class="preview-toolbar" style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid rgba(0,0,0,var(--border-opacity));flex-wrap:wrap;">` +
    `<div data-role="preview-mode" style="display:flex;gap:4px;"></div>` +
    `<div data-role="motion-capture-host" style="position:relative;min-width:180px;max-width:240px;display:none;">` +
    `<button class="btn" data-role="motion-capture-toggle" type="button" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding-right:8px;"></button>` +
    `<div class="panel" data-role="motion-capture-popover" hidden style="position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:20;max-height:240px;overflow:auto;padding:4px;"></div>` +
    `</div>` +
    `<button class="btn" data-role="motion-play" type="button"></button>` +
    `<input type="range" data-role="motion-frame-range" min="0" max="0" step="1" value="0" style="flex:1;min-width:80px;" />` +
    `<span data-role="motion-frame-label" class="mono" style="font-size:11px;opacity:0.7;"></span>` +
    `</div>` +
    `<div class="preview-zoom-bar" style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:1px solid rgba(0,0,0,var(--border-opacity));flex-wrap:wrap;">` +
    `<input type="range" data-role="zoom-range" min="10" max="800" step="1" value="200" style="flex:1;min-width:80px;" />` +
    `<input type="number" data-role="zoom-num" min="10" max="800" step="1" value="200" style="width:64px;" />` +
    `<span class="mono" style="opacity:0.6;">%</span>` +
    `<button class="btn" data-role="reset-view" type="button"></button>` +
    `<label data-role="live-toggle" style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;user-select:none;">` +
    `<input type="checkbox" data-role="live-cb" checked />` +
    `<span data-role="live-label"></span>` +
    `</label>` +
    `<button class="btn cp-tool-btn" data-role="refresh-now" type="button" style="display:none;">${ICON_REFRESH}</button>` +
    `</div>` +
    `<div class="preview-stage" data-role="stage" style="flex:1;min-height:0;display:flex;align-items:stretch;padding:0;overflow:hidden;position:relative;">` +
    `<div data-role="stage-main" style="flex:1;min-width:0;position:relative;display:flex;align-items:center;justify-content:center;padding:16px;overflow:hidden;">` +
    `<div data-role="viewport" style="position:absolute;left:50%;top:50%;will-change:transform;">` +
    `<canvas data-role="canvas" width="${COMPOSITE_W}" height="${COMPOSITE_H}" style="image-rendering:pixelated;display:none;"></canvas>` +
    `</div>` +
    `<div data-role="placeholder" style="opacity:0.6;"></div>` +
    `</div>` +
    `<aside data-role="motion-side" style="width:240px;display:none;align-self:stretch;border-left:1px solid rgba(0,0,0,var(--border-opacity));padding:8px;overflow:auto;background:rgba(0,0,0,0.03);">` +
    `<div data-role="motion-side-title" style="font-size:12px;font-weight:600;margin-bottom:6px;"></div>` +
    `<div data-role="motion-side-meta" class="mono" style="font-size:11px;opacity:0.7;white-space:pre-wrap;margin-bottom:8px;"></div>` +
    `<div data-role="motion-parts" class="mono" style="font-size:11px;line-height:1.45;white-space:pre-wrap;"></div>` +
    `</aside>` +
    `</div>` +
    `<div data-role="footer" style="flex:0 0 14%;height:14%;min-height:56px;display:flex;flex-direction:column;border-top:1px solid rgba(0,0,0,var(--border-opacity));overflow:hidden;">` +
    `<div data-role="footer-resize" style="flex:0 0 8px;height:8px;cursor:ns-resize;position:relative;user-select:none;">` +
    `<div style="position:absolute;left:0;right:0;top:0;height:1px;background:rgba(0,0,0,var(--border-opacity));"></div>` +
    `</div>` +
    `<div data-role="meta" class="mono" style="flex:0 0 45%;min-height:0;padding:6px 8px 2px;opacity:0.7;overflow:auto;"></div>` +
    `<div data-role="hint" class="mono" style="flex:1 1 auto;min-height:0;padding:0 8px 6px;opacity:0.55;font-size:11px;overflow:auto;"></div>` +
    `</div>`;

  const orientationEl = container.querySelector<HTMLDivElement>('[data-role="orientation"]')!;
  const expressionEl = container.querySelector<HTMLDivElement>('[data-role="expression"]')!;
  const headVariantEl = container.querySelector<HTMLDivElement>('[data-role="head-variant"]')!;
  const headVariantLabelEl = container.querySelector<HTMLSpanElement>('[data-role="head-variant-label"]')!;
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
  let dragPartCategory: "Body" | "Head" = "Body";
  let dragStartPartX = 0;
  let dragStartPartY = 0;
  const partOverridesCache = new Map<string, { x: number; y: number }>();
  let lastSkinName: string | null = sessionStore.getState().currentSkinName;
  let lastExpression: number = sessionStore.getState().expressionIndex;
  let lastHeadVariant: HeadVariant = sessionStore.getState().headVariant;
  let lastSelectedPart: string | null = sessionStore.getState().selectedPartName;
  let lastShowMotionDebugPanel: boolean = sessionStore.getState().showMotionDebugPanel;
  let livePreviewEnabled = true;
  let stalePending = false;
  let lastLayerSnapshotVersion: number = sessionStore.getState().layerSnapshotVersion ?? 0;
  let lastDiffRef: SessionState["lastAppliedDiff"] = sessionStore.getState().lastAppliedDiff;
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

  function applyFooterHeight(): void {
    footerHeightPct = Math.max(FOOTER_MIN_PCT, Math.min(FOOTER_MAX_PCT, footerHeightPct));
    footerEl.style.flex = `0 0 ${footerHeightPct}%`;
    footerEl.style.height = `${footerHeightPct}%`;
  }

  function applyTransform(): void {
    const z = zoomPct / 100;
    const sx = viewFacing === "right" ? -z : z;
    viewportEl.style.transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px)) scale(${sx}, ${z})`;
    zoomRange.value = String(zoomPct);
    zoomNum.value = String(zoomPct);
  }

  function setZoom(pct: number): void {
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

  function renderMotionPartPanel(frame: MotionCaptureFrame | null): void {
    motionSideTitleEl.textContent = t("previewCanvas.motionPanelTitle");
    if (!frame || !motionData) {
      motionSideMetaEl.textContent = "";
      motionPartsEl.textContent = t("previewCanvas.motionNoFrame");
      return;
    }
    motionSideMetaEl.textContent = `${motionData.playerName}\nt=${frame.t.toFixed(3)}s\ndir=${frame.isRight ? "right" : "left"}\nexp=${frame.expression}`;
    const hasTail = frame.limbs.some((limb) => limb.name === "Tail" || limb.name === "experimentTail" || limb.limbNum === -1);
    const rows = frame.limbs
      .slice()
      .sort((a, b) => a.limbNum - b.limbNum)
      .map((limb) => {
        const x = Math.round(limb.px * 8);
        const y = Math.round(-limb.py * 8);
        const sprite = limb.spriteName ? ` ${limb.spriteName}` : "";
        return `${limb.name.padEnd(10)} x=${x.toString().padStart(3)} y=${y.toString().padStart(3)} rot=${Math.round(limb.rotZ).toString().padStart(3)} z=${limb.sortingOrder.toString().padStart(4)}${sprite}`;
      });
    if (!hasTail) {
      rows.push(`Tail      ${t("previewCanvas.motionTailFallback")}`);
    }
    motionPartsEl.textContent = rows.join("\n");
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
        refresh();
      });
      previewModeEl.appendChild(btn);
    }

    motionCaptureToggle.title = t("previewCanvas.motionCaptureLabel");
    motionCaptureToggle.disabled = motionLoading || motionCaptures.length === 0;
    const selectedCapture = motionCaptures.find((capture) => capture.path === motionCapturePath);
    const captureLabel = motionLoading
      ? t("previewCanvas.motionCaptureLoading")
      : selectedCapture?.fileName ?? (motionCaptures.length === 0 ? t("previewCanvas.motionCaptureEmpty") : t("previewCanvas.motionCaptureLabel"));
    motionCaptureToggle.innerHTML = `<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${captureLabel}</span><span aria-hidden="true" style="flex:none;opacity:0.7;">▾</span>`;
    motionCapturePopover.innerHTML = "";
    if (motionLoading || motionCaptures.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:8px 10px;opacity:0.6;";
      empty.textContent = motionLoading ? t("previewCanvas.motionCaptureLoading") : t("previewCanvas.motionCaptureEmpty");
      motionCapturePopover.appendChild(empty);
    } else {
      for (const capture of motionCaptures) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = capture.path === motionCapturePath ? "btn btn-primary" : "btn";
        item.style.cssText = "display:block;width:100%;margin:0 0 4px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
        item.textContent = capture.fileName;
        item.title = capture.fileName;
        item.addEventListener("click", () => {
          motionCapturePopoverOpen = false;
          motionCapturePopover.hidden = true;
          void selectMotionCapture(capture.path);
        });
        motionCapturePopover.appendChild(item);
      }
    }
    motionPlayBtn.textContent = motionPlaying ? t("previewCanvas.motionPause") : t("previewCanvas.motionPlay");
    motionPlayBtn.disabled = !motionData || motionData.frames.length <= 1;
    motionFrameRange.disabled = !motionData || motionData.frames.length === 0;
    motionFrameRange.max = String(Math.max(0, (motionData?.frames.length ?? 1) - 1));
    motionFrameRange.value = String(Math.min(motionFrameIndex, motionData?.frames.length ? motionData.frames.length - 1 : 0));
    motionFrameLabel.textContent = motionData
      ? `${t("previewCanvas.motionFrameLabel")} ${motionFrameIndex + 1}/${motionData.frames.length}`
      : t("previewCanvas.motionCaptureEmpty");
    motionCaptureHost.style.display = previewMode === "motion" ? "" : "none";
    motionPlayBtn.style.display = previewMode === "motion" ? "" : "none";
    motionFrameRange.style.display = previewMode === "motion" ? "" : "none";
    motionFrameLabel.style.display = previewMode === "motion" ? "" : "none";
    motionSideEl.style.display = previewMode === "motion" && sessionStore.getState().showMotionDebugPanel ? "block" : "none";
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
    } catch (e) {
      motionData = null;
      console.warn(`[previewCanvas] load motion capture failed: ${String(e)}`);
    } finally {
      motionLoading = false;
      renderMotionToolbar();
      renderMotionPartPanel(motionData?.frames[0] ?? null);
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
      btn.addEventListener("click", () => {
        if (viewFacing !== f) {
          viewFacing = f;
          renderToolbar();
          applyTransform();
        }
      });
      orientationEl.appendChild(btn);
    }

    expressionEl.innerHTML = "";
    for (let i = 0; i < EXPRESSION_COUNT; i++) {
      const btn = document.createElement("button");
      btn.textContent = t(`previewCanvas.expression${i}`);
      btn.title = `${t("previewCanvas.expressionPrefix")} ${i}: ${btn.textContent}`;
      btn.className = i === expressionIndex ? "btn btn-primary" : "btn";
      btn.addEventListener("click", () => sessionStore.setState({ expressionIndex: i }));
      expressionEl.appendChild(btn);
    }

    const currentHv = sessionStore.getState().headVariant;
    headVariantLabelEl.textContent = t("previewCanvas.headVariantLabel");
    headVariantEl.innerHTML = "";
    for (const hv of HEAD_VARIANTS) {
      const btn = document.createElement("button");
      btn.textContent = t(`previewCanvas.headVariant_${hv}`);
      btn.title = btn.textContent;
      btn.className = hv === currentHv ? "btn btn-primary" : "btn";
      btn.addEventListener("click", () => sessionStore.setState({ headVariant: hv }));
      headVariantEl.appendChild(btn);
    }

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
    getCompositeImage({ skinRoot, skinName, orientation: "front", expressionIndex, headVariant })
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
    })
      .then((result) => {
        if (key !== pendingMotionKey || previewMode !== "motion") return;
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
    if (previewMode === "motion") {
      if (skinChanged || expressionChanged || headVariantChanged) {
        stalePending = false;
        refreshMotionFrame();
        updateRefreshBtn();
        return;
      }
      if (!(diffChanged || layerChanged)) return;
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
    if (!(skinChanged || expressionChanged || headVariantChanged || diffChanged || layerChanged)) return;
    if (!livePreviewEnabled && !skinChanged) {
      stalePending = true;
      updateRefreshBtn();
      return;
    }
    refreshAssembly();
  }

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
        dragMode = "part";
        dragPartName = selectedPartName;
        dragPartCategory = selectedCategory;
        const cached = partOverridesCache.get(`${dragPartCategory}::${dragPartName}`);
        dragStartPartX = cached?.x ?? 0;
        dragStartPartY = cached?.y ?? 0;
        stageMainEl.style.cursor = "crosshair";
        e.preventDefault();
        return;
      }
    }
    dragMode = "viewport";
    dragStartOffX = offsetX;
    dragStartOffY = offsetY;
    stageMainEl.style.cursor = "grabbing";
  });
  document.addEventListener("mousemove", (e) => {
    if (footerResizing) {
      const rect = container.getBoundingClientRect();
      const nextPct = ((rect.bottom - e.clientY) / rect.height) * 100;
      footerHeightPct = nextPct;
      applyFooterHeight();
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
    const dxAssembly = Math.round(dxScreen / z) * (viewFacing === "right" ? -1 : 1);
    const dyAssembly = Math.round(dyScreen / z);
    const newX = dragStartPartX + dxAssembly;
    const newY = dragStartPartY + dyAssembly;
    partOverridesCache.set(`${dragPartCategory}::${dragPartName}`, { x: newX, y: newY });
    void setAssemblyOverride({
      partName: dragPartName,
      category: dragPartCategory,
      position: { x: newX, y: newY },
    }).then(() => refreshAssembly());
  });
  document.addEventListener("mouseup", () => {
    if (footerResizing) {
      footerResizing = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    if (!dragging) return;
    dragging = false;
    stageMainEl.style.cursor = "";
  });
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
    stopMotionPlayback();
    pendingAssemblyKey = -1;
    pendingMotionKey = -1;
  };
}
