// 单部件预览渲染 + 画笔/橡皮交互。
// 订阅 sessionStore 三元组 (currentSkinName, selectedPartName, selectedCategory)，
// 非空且变化时调 apiClient.loadPartImage 拉 RGBA 数据并渲染；
// 失败当作损坏部件处理，仅显示一行红字占位。
// canvas 在 stage 容器中由 flex center 对齐，CSS 中心等同于 (width/2, height/2) pivot。
// 缩放：CSS transform: scale，过渡 100ms linear。
// mousedown/move/up/leave 监听，命中像素 → applyBrush/applyEraser，
// 后端返回的 PixelDiff 通过 sessionStore.lastAppliedDiff 广播。

import {
  applyBrush,
  applyEraser,
  applyGradient,
  beginStroke as apiBeginStroke,
  endStroke as apiEndStroke,
  createSidePart,
  getFlatten,
  listParts,
  loadPartImage,
  loadZones,
  resizePart,
  getBaseSize,
  saveZones,
  setAccessoryEnabled,
  saveAccessoryConfig,
  type ApiError,
  type LoadPartResult,
  type PixelDiff,
} from "../apiClient";
import { sessionStore, pushHistoryRecord, markPartDirty, markPartClean, bumpPartListVersion } from "../stateStore";
import { zonesStore } from "../stateStore/zonesStore";
import type { AccessoryEntry, PartCategory, ZoneEntry, ZonesData } from "../stateStore/types";
import { subscribeLang, t } from "../i18n";
import { localizePartName } from "../i18n/partNames";
import { showToast } from "../toast";
import { CANVAS_CURSORS } from "../toolPanel/toolIcons";
import { getSize, setSize } from "../layoutEngine";

const ZOOM_MIN = 0.1;

/// 与后端 isSideSplittablePartName 同步：可以拆出 F / B 独立 PNG 的"前后共享"白名单。
/// HandF/HandB 自身已是独立 PNG，不在该列表内。
const SIDE_SPLIT_WHITELIST_SUFFIXES = [
  "UpTorso", "DownTorso", "Head", "UpArm", "DownArm",
  "Thigh", "Crus", "Foot", "Tail",
] as const;

function isSideSplittablePartName(partName: string): boolean {
  if (partName.endsWith("F") || partName.endsWith("B")) return false;
  return SIDE_SPLIT_WHITELIST_SUFFIXES.some((s) => partName.endsWith(s));
}

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
  container.innerHTML =
    `<div class="editor-canvas-toolbar" style="display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid rgba(0,0,0,var(--border-opacity));">` +
    `<button class="btn" data-role="zoom-out">-</button>` +
    `<span class="mono" data-role="zoom-pct">100%</span>` +
    `<button class="btn" data-role="zoom-in">+</button>` +
    `<span class="mono" data-role="meta" style="margin-left:8px;opacity:0.7;"></span>` +
    `</div>` +
    `<div class="editor-canvas-stage" style="flex:1;min-height:0;overflow:auto;display:flex;align-items:center;justify-content:center;padding:16px;">` +
    `<div class="transparent-grid" data-role="grid" style="display:none;position:relative;"><canvas></canvas><canvas data-role="zones-overlay" style="position:absolute;left:0;top:0;pointer-events:none;image-rendering:pixelated;"></canvas></div>` +
    `<div data-role="placeholder" style="opacity:0.6;">${t("editorCanvas.notSelected")}</div>` +
    `</div>` +
    `<div class="editor-canvas-footer-grip" data-role="footer-grip" style="flex:none;height:6px;cursor:row-resize;background:transparent;position:relative;"><div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:32px;height:2px;border-radius:2px;background:rgba(0,0,0,0.18);pointer-events:none;"></div></div>` +
    `<div class="editor-canvas-footer" data-role="footer" style="flex:none;display:flex;flex-direction:column;gap:6px;padding:8px;border-top:1px solid rgba(0,0,0,var(--border-opacity));overflow:auto;">` +
    `<div data-role="footer-row1" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">` +
    `<button class="btn" data-role="resize-btn" disabled></button>` +
    `<label data-role="acc-toggle-wrap" style="display:none;align-items:center;gap:6px;cursor:pointer;user-select:none;">` +
      `<span data-role="acc-toggle-text" style="font-size:13px;"></span>` +
      `<span data-role="acc-toggle-track" style="position:relative;display:inline-block;width:36px;height:18px;background:#bbb;border-radius:9px;transition:background 0.15s;">` +
        `<span data-role="acc-toggle-knob" style="position:absolute;top:2px;left:2px;width:14px;height:14px;background:#fff;border-radius:50%;transition:left 0.15s;"></span>` +
      `</span>` +
    `</label>` +
    `<button class="btn" data-role="acc-advanced-btn" style="display:none;"></button>` +
    `<button class="btn" data-role="side-f-btn" style="display:none;"></button>` +
    `<button class="btn" data-role="side-b-btn" style="display:none;"></button>` +
    `</div>` +
    `<div data-role="acc-advanced-panel" style="display:none;flex-direction:column;gap:6px;padding:6px 8px;background:rgba(0,0,0,0.04);border-radius:4px;">` +
      `<div style="display:flex;flex-wrap:wrap;gap:6px 12px;align-items:center;font-size:12px;">` +
        `<label style="display:flex;align-items:center;gap:4px;"><span data-role="acc-adv-offX-label"></span><input type="number" data-role="acc-adv-offX" style="width:56px;" /></label>` +
        `<label style="display:flex;align-items:center;gap:4px;"><span data-role="acc-adv-offY-label"></span><input type="number" data-role="acc-adv-offY" style="width:56px;" /></label>` +
        `<label style="display:flex;align-items:center;gap:4px;"><span data-role="acc-adv-rot-label"></span><input type="number" data-role="acc-adv-rot" step="1" style="width:60px;" /></label>` +
        `<label style="display:flex;align-items:center;gap:4px;"><span data-role="acc-adv-z-label"></span><input type="number" data-role="acc-adv-z" style="width:56px;" /></label>` +
        `<span data-role="acc-adv-status" style="font-size:11px;opacity:0.65;"></span>` +
      `</div>` +
    `</div>` +
    `</div>`;

  const zoomOutBtn = container.querySelector<HTMLButtonElement>('[data-role="zoom-out"]')!;
  const zoomInBtn = container.querySelector<HTMLButtonElement>('[data-role="zoom-in"]')!;
  const zoomPctEl = container.querySelector<HTMLSpanElement>('[data-role="zoom-pct"]')!;
  const metaEl = container.querySelector<HTMLSpanElement>('[data-role="meta"]')!;
  const resizeBtn = container.querySelector<HTMLButtonElement>('[data-role="resize-btn"]')!;
  const sideFBtn = container.querySelector<HTMLButtonElement>('[data-role="side-f-btn"]')!;
  const sideBBtn = container.querySelector<HTMLButtonElement>('[data-role="side-b-btn"]')!;
  const accToggleWrap = container.querySelector<HTMLLabelElement>('[data-role="acc-toggle-wrap"]')!;
  const accToggleText = container.querySelector<HTMLSpanElement>('[data-role="acc-toggle-text"]')!;
  const accToggleTrack = container.querySelector<HTMLSpanElement>('[data-role="acc-toggle-track"]')!;
  const accToggleKnob = container.querySelector<HTMLSpanElement>('[data-role="acc-toggle-knob"]')!;
  const accAdvBtn = container.querySelector<HTMLButtonElement>('[data-role="acc-advanced-btn"]')!;
  const accAdvPanel = container.querySelector<HTMLDivElement>('[data-role="acc-advanced-panel"]')!;
  const accAdvOffX = container.querySelector<HTMLInputElement>('[data-role="acc-adv-offX"]')!;
  const accAdvOffY = container.querySelector<HTMLInputElement>('[data-role="acc-adv-offY"]')!;
  const accAdvRot = container.querySelector<HTMLInputElement>('[data-role="acc-adv-rot"]')!;
  const accAdvZ = container.querySelector<HTMLInputElement>('[data-role="acc-adv-z"]')!;
  const accAdvStatus = container.querySelector<HTMLSpanElement>('[data-role="acc-adv-status"]')!;
  const accAdvOffXLabel = container.querySelector<HTMLSpanElement>('[data-role="acc-adv-offX-label"]')!;
  const accAdvOffYLabel = container.querySelector<HTMLSpanElement>('[data-role="acc-adv-offY-label"]')!;
  const accAdvRotLabel = container.querySelector<HTMLSpanElement>('[data-role="acc-adv-rot-label"]')!;
  const accAdvZLabel = container.querySelector<HTMLSpanElement>('[data-role="acc-adv-z-label"]')!;
  const gridEl = container.querySelector<HTMLDivElement>('[data-role="grid"]')!;
  const placeholderEl = container.querySelector<HTMLDivElement>('[data-role="placeholder"]')!;
  const canvas = gridEl.querySelector("canvas")!;
  const zonesOverlay = gridEl.querySelector<HTMLCanvasElement>('[data-role="zones-overlay"]')!;
  const zonesCtx = zonesOverlay.getContext("2d");
  const ctx = canvas.getContext("2d");

  // 当前部件尺寸（render 后写入），resize 弹窗预填默认值用。
  let currentPartName: string | null = null;
  let currentWidth = 0;
  let currentHeight = 0;
  let sideFBtnAvailable = false;
  let sideBBtnAvailable = false;

  let zoom = 1;
  // 图片拖动平移（独立于 zoom）。中键 / 右键 / Shift+左键 / pan 工具任一即可拖。
  let panOffsetX = 0;
  let panOffsetY = 0;
  let lastKey: string | null = null;
  let pendingKey: string | null = null;
  // 当前已加载部件的后端会话标识；null 表示未选中或加载失败，paint 直接 early return。
  let currentPartId: string | null = null;
  let isPainting = false;
  // 当前笔画所在的 partId 与工具种类。mousedown 时锁定，mouseup 时
  // endStroke 用同一个值，避免中途 currentPartId 被替换导致历史 push 错位。
  let paintingPartId: string | null = null;
  let paintingTool: "brush" | "eraser" = "brush";
  // 图片拖动平移状态。
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panStartOffX = 0;
  let panStartOffY = 0;
  let lastCx = -1;
  let lastCy = -1;
  // i18n：placeholder 文案随 lang 切换。记录最近一次占位的语义状态，在 lang
  // 变化或正常切换时统一由 refreshPlaceholder 写 textContent。
  type PlaceholderInfo =
    | { kind: "none" }
    | { kind: "notSelected" }
    | { kind: "loading"; partName: string }
    | { kind: "error"; partName: string; msg: string };
  let placeholderInfo: PlaceholderInfo = { kind: "notSelected" };
  // lastAppliedDiff 是 sessionStore 上的事件型字段，订阅回调通过引用比较
  // 区分本次推送是否已处理；不同发送方推同一对象会复用同一引用，不会重复贴像素。
  let lastAppliedDiffRef: ReturnType<typeof sessionStore.getState>["lastAppliedDiff"] = null;
  let lastLayerSnapshotVersion: number = sessionStore.getState().layerSnapshotVersion ?? 0;

  function cursorForTool(tool: string, panning: boolean): string {
    if (panning) return "grabbing";
    if (tool === "pan") return "grab";
    if (tool === "brush") return CANVAS_CURSORS.brush;
    if (tool === "eraser") return CANVAS_CURSORS.eraser;
    if (tool === "gradient") return CANVAS_CURSORS.gradient;
    if (tool === "zoneBrush") return CANVAS_CURSORS.zoneBrush;
    return "crosshair";
  }

  function applyZoom(): void {
    // transform 含 translate（拖动平移）+ scale（缩放）；origin center 让缩放围绕图片中心。
    gridEl.style.transform = `translate(${panOffsetX}px, ${panOffsetY}px) scale(${zoom})`;
    gridEl.style.transformOrigin = "center";
    zoomPctEl.textContent = `${Math.round(zoom * 100)}%`;
  }

  function updateInfoPanel(): void {
    if (!currentPartName) {
      metaEl.textContent = "";
      resizeBtn.disabled = true;
      resizeBtn.textContent = t("editorCanvas.resizeBtn");
      sideFBtn.style.display = "none";
      sideBBtn.style.display = "none";
      sideFBtn.textContent = t("editorCanvas.createSideFBtn");
      sideBBtn.textContent = t("editorCanvas.createSideBBtn");
      accToggleWrap.style.display = "none";
      return;
    }
    metaEl.textContent = `${localizePartName(currentPartName)} ${currentWidth}×${currentHeight}`;
    resizeBtn.disabled = !currentPartId;
    resizeBtn.textContent = t("editorCanvas.resizeBtn");
    sideFBtn.textContent = t("editorCanvas.createSideFBtn");
    sideBBtn.textContent = t("editorCanvas.createSideBBtn");
    sideFBtn.style.display = sideFBtnAvailable && currentPartId ? "" : "none";
    sideBBtn.style.display = sideBBtnAvailable && currentPartId ? "" : "none";
    refreshAccessoryToggle();
  }

  // 当前选中部件的 accessoryConfig 缓存；selectedCategory==='Accessories' 才填充。
  let currentAccessoryEnabled: boolean | null = null;
  let currentAccessoryEntry: AccessoryEntry | null = null;
  let advancedOpen = false;

  function applyAdvancedVisible(): void {
    accAdvPanel.style.display = advancedOpen && currentAccessoryEntry ? "flex" : "none";
    accAdvBtn.textContent = advancedOpen
      ? t("editorCanvas.accessoryAdvancedHide")
      : t("editorCanvas.accessoryAdvancedShow");
  }

  function fillAdvancedInputs(entry: AccessoryEntry): void {
    accAdvOffX.value = String(entry.offX);
    accAdvOffY.value = String(entry.offY);
    accAdvRot.value = String(entry.rot);
    accAdvZ.value = String(entry.z);
    accAdvOffXLabel.textContent = t("editorCanvas.accessoryOffsetX");
    accAdvOffYLabel.textContent = t("editorCanvas.accessoryOffsetY");
    accAdvRotLabel.textContent = t("editorCanvas.accessoryRotation");
    accAdvZLabel.textContent = t("editorCanvas.accessoryZOrder");
  }

  function refreshAccessoryToggle(): void {
    const { selectedCategory } = sessionStore.getState();
    if (selectedCategory !== "Accessories" || !currentPartName || !currentPartId) {
      accToggleWrap.style.display = "none";
      accAdvBtn.style.display = "none";
      accAdvPanel.style.display = "none";
      currentAccessoryEnabled = null;
      currentAccessoryEntry = null;
      return;
    }
    const skinName = currentPartId.split("::")[0];
    listParts(skinRoot, skinName)
      .then((skin) => {
        const cfg = skin.accessoryConfigs.find(
          (c) => c.id === currentPartName || c.sprite === currentPartName,
        );
        currentAccessoryEntry = cfg ?? null;
        currentAccessoryEnabled = cfg?.enabled ?? null;
        if (currentAccessoryEnabled === null) {
          accToggleWrap.style.display = "none";
          accAdvBtn.style.display = "none";
          accAdvPanel.style.display = "none";
          return;
        }
        accToggleWrap.style.display = "inline-flex";
        accToggleText.textContent = currentAccessoryEnabled
          ? t("editorCanvas.accessoryEnabledLabel")
          : t("editorCanvas.accessoryDisabledLabel");
        accToggleTrack.style.background = currentAccessoryEnabled ? "#4caf50" : "#bbb";
        accToggleKnob.style.left = currentAccessoryEnabled ? "20px" : "2px";
        accAdvBtn.style.display = "";
        if (cfg) fillAdvancedInputs(cfg);
        applyAdvancedVisible();
      })
      .catch(() => {
        accToggleWrap.style.display = "none";
        accAdvBtn.style.display = "none";
        accAdvPanel.style.display = "none";
        currentAccessoryEnabled = null;
        currentAccessoryEntry = null;
      });
  }

  accToggleWrap.addEventListener("click", () => {
    if (currentAccessoryEnabled === null || !currentPartName || !currentPartId) return;
    const skinName = currentPartId.split("::")[0];
    const next = !currentAccessoryEnabled;
    setAccessoryEnabled(skinRoot, skinName, currentPartName, next)
      .then(() => {
        currentAccessoryEnabled = next;
        if (currentAccessoryEntry) currentAccessoryEntry.enabled = next;
        accToggleText.textContent = next
          ? t("editorCanvas.accessoryEnabledLabel")
          : t("editorCanvas.accessoryDisabledLabel");
        accToggleTrack.style.background = next ? "#4caf50" : "#bbb";
        accToggleKnob.style.left = next ? "20px" : "2px";
        sessionStore.setState({
          accessoriesVersion: (sessionStore.getState().accessoriesVersion ?? 0) + 1,
        });
      })
      .catch((e) => {
        console.error("setAccessoryEnabled failed", e);
      });
  });

  accAdvBtn.addEventListener("click", () => {
    advancedOpen = !advancedOpen;
    applyAdvancedVisible();
  });

  // 配件高级参数实时去抖保存：输入停止 200ms 后写盘 + bump 触发预览重拉。
  let accAdvSaveTimer: number | null = null;
  function scheduleAccessoryAdvancedSave(): void {
    if (!currentAccessoryEntry || !currentPartId) return;
    if (accAdvSaveTimer !== null) window.clearTimeout(accAdvSaveTimer);
    accAdvStatus.textContent = t("editorCanvas.accessoryAdvancedSaving");
    accAdvSaveTimer = window.setTimeout(() => {
      accAdvSaveTimer = null;
      if (!currentAccessoryEntry || !currentPartId) return;
      const skinName = currentPartId.split("::")[0];
      const entry: AccessoryEntry = {
        ...currentAccessoryEntry,
        offX: Number.parseInt(accAdvOffX.value, 10) || 0,
        offY: Number.parseInt(accAdvOffY.value, 10) || 0,
        rot: Number.parseFloat(accAdvRot.value) || 0,
        z: Number.parseInt(accAdvZ.value, 10) || 0,
      };
      saveAccessoryConfig(skinRoot, skinName, entry)
        .then(() => {
          currentAccessoryEntry = entry;
          accAdvStatus.textContent = t("editorCanvas.accessoryAdvancedSaved");
          sessionStore.setState({
            accessoriesVersion: (sessionStore.getState().accessoriesVersion ?? 0) + 1,
          });
        })
        .catch((e) => {
          accAdvStatus.textContent = "";
          console.error("saveAccessoryConfig failed", e);
        });
    }, 200);
  }
  for (const el of [accAdvOffX, accAdvOffY, accAdvRot, accAdvZ]) {
    el.addEventListener("input", scheduleAccessoryAdvancedSave);
  }

  /// 刷新 side*Btn 的可见性：白名单内 + 当前 part 不带 F/B 后缀 + 同分类下不存在 <name>F.png / <name>B.png。
  function refreshMirrorAvailability(): void {
    sideFBtnAvailable = false;
    sideBBtnAvailable = false;
    if (!currentPartId || !currentPartName) {
      updateInfoPanel();
      return;
    }
    if (!isSideSplittablePartName(currentPartName)) {
      updateInfoPanel();
      return;
    }
    const parts = currentPartId.split("::");
    if (parts.length !== 3) {
      updateInfoPanel();
      return;
    }
    const [skinName, categoryDir, _name] = parts;
    listParts(skinRoot, skinName)
      .then((skin) => {
        const category = categoryDir as PartCategory;
        const list =
          category === "Body" ? skin.body :
          category === "Head" ? skin.head :
          category === "Wings" ? skin.wings :
          category === "Blood" ? skin.blood :
          skin.accessories;
        const fName = `${currentPartName}F`;
        const bName = `${currentPartName}B`;
        sideFBtnAvailable = !list.some((p) => p.name === fName);
        sideBBtnAvailable = !list.some((p) => p.name === bName);
        updateInfoPanel();
      })
      .catch(() => {
        sideFBtnAvailable = false;
        sideBBtnAvailable = false;
        updateInfoPanel();
      });
  }

  function showPlaceholder(info: PlaceholderInfo, isError: boolean): void {
    placeholderInfo = info;
    gridEl.style.display = "none";
    placeholderEl.style.display = "block";
    placeholderEl.style.color = isError ? "#c00" : "";
    placeholderEl.textContent = renderPlaceholderText(info);
    currentPartId = null;
    currentPartName = null;
    currentWidth = 0;
    currentHeight = 0;
    sideFBtnAvailable = false;
    sideBBtnAvailable = false;
    currentZones = null;
    zonesDirty = false;
    zonesStore.set(null);
    if (zonesCtx) zonesCtx.clearRect(0, 0, zonesOverlay.width, zonesOverlay.height);
    updateInfoPanel();
    // 未加载 / 加载中 / 加载失败时清空共享 partId，layerPanel 收到 null 后回到空态。
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

  function render(result: LoadPartResult, partName: string): void {
    if (!ctx) return;
    canvas.width = result.width;
    canvas.height = result.height;
    zonesOverlay.width = result.width;
    zonesOverlay.height = result.height;
    gridEl.style.width = `${result.width}px`;
    gridEl.style.height = `${result.height}px`;
    const data = new ImageData(
      new Uint8ClampedArray(result.pixels),
      result.width,
      result.height,
    );
    ctx.putImageData(data, 0, 0);
    gridEl.style.display = "";
    placeholderEl.style.display = "none";
    placeholderInfo = { kind: "none" };
    currentPartName = partName;
    currentWidth = result.width;
    currentHeight = result.height;
    currentPartId = result.partId;
    updateInfoPanel();
    refreshMirrorAvailability();
    // 写入共享 partId，layerPanel 据此拉取图层快照。
    sessionStore.setState({ currentPartId: result.partId });
    // 加载该部件的区块数据（mask + 配置）；缺失返回零 mask。
    loadZonesForCurrent();
    // 切换部件时按 stage 容器尺寸自动选择"贴边铺满"的 zoom，
    // 避免小部件（6×11）默认 1× 显示成几像素难以编辑。stage padding 16px ×2 留边。
    fitZoomToStage(result.width, result.height);
    applyZoom();
  }

  function fitZoomToStage(partW: number, partH: number): void {
    const stage = container.querySelector<HTMLDivElement>(".editor-canvas-stage");
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    // 贴边铺满 stage：预留 8px 边距；fit 不向下取整保持精确，
    // 但保留 0.5 步进让 image-rendering: pixelated 在简单倍率仍清晰。
    const availW = Math.max(50, rect.width - 16);
    const availH = Math.max(50, rect.height - 16);
    if (partW <= 0 || partH <= 0) return;
    const fit = Math.min(availW / partW, availH / partH);
    // 0.5 步进：避免抗锯齿模糊但允许 1.5x / 2.5x 等贴边接近
    const next = Math.max(ZOOM_MIN, Math.floor(fit * 2) / 2);
    zoom = next;
    // 切换部件时复位平移。
    panOffsetX = 0;
    panOffsetY = 0;
  }

  // 已废弃，保留避免误用——所有增量贴改为调 refreshFlatten 重拉合并视图。
  // diff 仍由 sessionStore.lastAppliedDiff 广播给 previewCanvas 等订阅方。
  function applyDiffToCanvas(_diff: PixelDiff, _phase: "before" | "after"): void {
    // no-op
  }

  // 从后端拉当前部件的扁平像素重绘画布。每次 brush/eraser/gradient/undo/redo
  // 后调用一次；partId 已变化时忽略过期响应。
  let pendingFlattenKey = 0;
  function refreshFlatten(): void {
    const partId = currentPartId;
    if (!partId || !ctx) return;
    const key = ++pendingFlattenKey;
    getFlatten(partId)
      .then((result) => {
        if (key !== pendingFlattenKey) return;
        if (result.partId !== currentPartId) return;
        const data = new ImageData(
          new Uint8ClampedArray(result.pixels),
          result.width,
          result.height,
        );
        ctx.putImageData(data, 0, 0);
      })
      .catch((e: ApiError) => {
        console.warn(`[editorCanvas] flatten failed: ${e?.message ?? String(e)}`);
      });
  }

  // 把鼠标事件换算为 canvas 内部像素坐标。getBoundingClientRect 已包含 CSS
  // transform: scale(zoom) 的视觉效果，用 rect.width / rect.height 作除数即可，无需再除 zoom。
  function eventToPixel(event: MouseEvent): { cx: number; cy: number } {
    const rect = canvas.getBoundingClientRect();
    const cx = Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width);
    const cy = Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height);
    return { cx, cy };
  }

  function paint(event: MouseEvent): void {
    const partId = currentPartId;
    if (!partId) return;
    const { cx, cy } = eventToPixel(event);
    if (cx < 0 || cy < 0 || cx >= canvas.width || cy >= canvas.height) return;
    if (cx === lastCx && cy === lastCy) return;
    lastCx = cx;
    lastCy = cy;
    const { activeTool, brushSize, color, alpha } = sessionStore.getState();
    const promise =
      activeTool === "eraser"
        ? applyEraser({ partId, cx, cy, brushSize })
        : applyBrush({
            partId,
            cx,
            cy,
            brushSize,
            color: [color[0], color[1], color[2], alpha],
          });
    promise
      .then((diff) => {
        // 把 diff 广播到 sessionStore，由订阅入口统一 putImageData，
        // 与 toolPanel 的 undo/redo 共用同一重绘路径。
        sessionStore.setState({
          lastAppliedDiff: { partId, diff, phase: "after" },
        });
        // 单像素描边不立即推历史；mouseup 时 endStroke 拿合并 diff 再 push 一条。
      })
      .catch((e: ApiError) => {
        // 单次描边失败保留会话不打断，控制台留痕即可。
        console.warn(`[editorCanvas] paint failed: ${e?.message ?? String(e)}`);
      });
  }

  // 调色板：每个区块 ID 一种 hue（自动配色），主件 + overlay 都用它。
  // displayColor 显式指定时优先；该函数只作为 fallback。
  function zoneHue(id: number): number {
    return ((id * 47) % 360 + 360) % 360;
  }

  /// 取区块在 overlay 上的最终填充 RGB——优先 displayColor，否则按 hue 自动调色板。
  function zoneFillRgb(id: number, cfg?: ZoneEntry): [number, number, number] {
    if (cfg?.displayColor && cfg.displayColor.length >= 3) {
      return [cfg.displayColor[0], cfg.displayColor[1], cfg.displayColor[2]];
    }
    return hslToRgb(zoneHue(id), 0.85, 0.55);
  }

  function getThemePrimary(): string {
    const v = getComputedStyle(container).getPropertyValue("--cp-primary").trim();
    return v.length > 0 ? v : "#3b82f6";
  }

  function redrawZonesOverlay(): void {
    if (!zonesCtx) return;
    zonesCtx.clearRect(0, 0, zonesOverlay.width, zonesOverlay.height);
    if (!currentZones) return;
    const w = currentZones.width;
    const h = currentZones.height;
    if (w === 0 || h === 0) return;
    if (zonesOverlay.width !== w || zonesOverlay.height !== h) {
      zonesOverlay.width = w;
      zonesOverlay.height = h;
    }
    // 收集所有出现过的区块 ID（去 0）。
    const seenIds = new Set<number>();
    for (let i = 0; i < currentZones.ids.length; i++) {
      const id = currentZones.ids[i];
      if (id !== 0) seenIds.add(id);
    }
    if (seenIds.size === 0) return;
    const cfgById = new Map(currentZones.config.zones.map((z) => [z.id, z]));
    // 半透明填充：每 ID 一个浅色（displayColor 优先），整体不透明度 0.28。
    const fill = zonesCtx.createImageData(w, h);
    for (let i = 0; i < currentZones.ids.length; i++) {
      const id = currentZones.ids[i];
      if (id === 0) continue;
      const [r, g, b] = zoneFillRgb(id, cfgById.get(id));
      fill.data[i * 4] = r;
      fill.data[i * 4 + 1] = g;
      fill.data[i * 4 + 2] = b;
      fill.data[i * 4 + 3] = 71;
    }
    zonesCtx.putImageData(fill, 0, 0);
    // 主题色描边：每个像素如果上下左右有不同 ID 邻居，就在 overlay 上画一个像素的描边色。
    const edge = zonesCtx.createImageData(w, h);
    const themeRgb = parseHexRgb(getThemePrimary()) ?? [59, 130, 246];
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
    // 把 edge 叠到 fill 之上：用 source-over 直接 putImageData 会覆盖；改 createImageData 后用临时 canvas 合成。
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const tctx = tmp.getContext("2d");
    if (tctx) {
      tctx.putImageData(edge, 0, 0);
      zonesCtx.drawImage(tmp, 0, 0);
    }
  }

  function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r1 = 0, g1 = 0, b1 = 0;
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
    const h = hex.replace(/^#/, "");
    if (h.length !== 3 && h.length !== 6) return null;
    const norm = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
    const r = Number.parseInt(norm.substring(0, 2), 16);
    const g = Number.parseInt(norm.substring(2, 4), 16);
    const b = Number.parseInt(norm.substring(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
    return [r, g, b];
  }
  let currentZones: ZonesData | null = null;
  let zonesDirty = false;

  function loadZonesForCurrent(): void {
    currentZones = null;
    zonesDirty = false;
    const partId = currentPartId;
    if (!partId) return;
    const parts = partId.split("::");
    if (parts.length !== 3) return;
    const [skinName, categoryDir, partName] = parts;
    const category = categoryDir as PartCategory;
    loadZones(skinRoot, skinName, category, partName)
      .then((data) => {
        if (currentPartId !== partId) return;
        currentZones = data;
        const ids = collectActiveZoneIds();
        if (syncZonesConfig(ids)) zonesDirty = true;
        zonesStore.set(currentZones);
        redrawZonesOverlay();
      })
      .catch((e: ApiError) => {
        console.warn(`[editorCanvas] loadZones failed: ${e?.message ?? String(e)}`);
      });
  }

  function flushZonesIfDirty(): void {
    if (!zonesDirty || !currentZones || !currentPartId) return;
    const partId = currentPartId;
    const data = currentZones;
    const parts = partId.split("::");
    if (parts.length !== 3) return;
    const [skinName, categoryDir, partName] = parts;
    zonesDirty = false;
    saveZones(skinRoot, skinName, categoryDir as PartCategory, partName, data)
      .then(() => {
        zonesStore.bump();
        sessionStore.setState({
          accessoriesVersion: (sessionStore.getState().accessoriesVersion ?? 0) + 1,
        });
      })
      .catch((e: ApiError) => console.warn(`[editorCanvas] saveZones failed: ${e?.message ?? String(e)}`));
  }

  // 收集 mask 中实际出现过的区块 ID（去 0），用于渲染区块列表。
  function collectActiveZoneIds(): number[] {
    if (!currentZones) return [];
    const seen = new Set<number>();
    for (let i = 0; i < currentZones.ids.length; i++) {
      const id = currentZones.ids[i];
      if (id !== 0) seen.add(id);
    }
    return Array.from(seen).sort((a, b) => a - b);
  }

  // 同步配置数组与 mask 中的实际 ID 集合：
  // - mask 出现但 config 没有的 ID：补默认 ZoneEntry
  // - config 有但 mask 没有的 ID：从 config 删
  function syncZonesConfig(activeIds: number[]): boolean {
    if (!currentZones) return false;
    const existing = new Map(currentZones.config.zones.map((z) => [z.id, z]));
    const next: typeof currentZones.config.zones = [];
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
    if (changed) currentZones.config.zones = next;
    return changed;
  }

  // 区块详情面板的展开态（以 zoneId 为 key）；切换部件时不重置——同名 ID 持续展开。
  const expandedZoneIds = new Set<number>();

  // 区块画笔：在以 (cx, cy) 为圆心、半径 = brushSize/2 的圆内
  // 把 mask ids 写为 activeZoneId（擦除模式则写 0）；只对当前画布像素 alpha>0 的位置生效。
  // 仅修改内存 mask + 重绘 overlay；mouseup 时由 endStroke 一次性 saveZones。
  function paintZone(event: MouseEvent, erase: boolean): void {
    if (!ctx || !currentZones) return;
    const { cx, cy } = eventToPixel(event);
    const w = currentZones.width;
    const h = currentZones.height;
    if (w === 0 || h === 0) return;
    if (cx === lastCx && cy === lastCy) return;
    lastCx = cx;
    lastCy = cy;
    const { brushSize, activeZoneId } = sessionStore.getState();
    const radius = Math.max(0.5, brushSize / 2);
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(w - 1, Math.ceil(cx + radius));
    const y1 = Math.min(h - 1, Math.ceil(cy + radius));
    if (x1 < x0 || y1 < y0) return;
    const pix = ctx.getImageData(x0, y0, x1 - x0 + 1, y1 - y0 + 1).data;
    let dirty = false;
    const targetId = erase ? 0 : Math.max(1, Math.min(255, activeZoneId | 0));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        if (!erase) {
          const ai = ((y - y0) * (x1 - x0 + 1) + (x - x0)) * 4 + 3;
          if (pix[ai] === 0) continue;
        }
        const idx = y * w + x;
        if (currentZones.ids[idx] !== targetId) {
          currentZones.ids[idx] = targetId;
          dirty = true;
        }
      }
    }
    if (dirty) {
      zonesDirty = true;
      const ids = collectActiveZoneIds();
      if (syncZonesConfig(ids)) zonesDirty = true;
      zonesStore.bump();
      redrawZonesOverlay();
    }
  }

  // 渐变拖线状态。activeTool === "gradient" 时按下记起点，松开调 applyGradient。
  let isGradient = false;
  let gradientStartCx = -1;
  let gradientStartCy = -1;

  // 区块画笔拖拽状态。
  let isZonePainting = false;
  let isZoneErasing = false;

  function onMouseDown(event: MouseEvent): void {
    // activeTool === "pan" 时左键直接拖；否则中键 / 右键 / Shift+左键 = 拖动。
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
    if (event.button !== 0) return;
    if (!currentPartId) return;
    if (tool === "gradient") {
      const { cx, cy } = eventToPixel(event);
      isGradient = true;
      gradientStartCx = cx;
      gradientStartCy = cy;
      return;
    }
    const eraserMode = sessionStore.getState().eraserMode ?? "part";
    if (tool === "zoneBrush" || (tool === "eraser" && eraserMode === "zone")) {
      // alt 键 = 擦除该区块；普通点击 = 绘制 activeZoneId（橡皮 zone 模式恒擦）。
      isZonePainting = true;
      isZoneErasing = tool === "eraser" || event.altKey;
      lastCx = -1;
      lastCy = -1;
      paintZone(event, isZoneErasing);
      return;
    }
    isPainting = true;
    lastCx = -1;
    lastCy = -1;
    // 开始一笔：后端记录 baseline，后续 brush/eraser 累计 rect 不入栈。
    paintingPartId = currentPartId;
    paintingTool = tool === "eraser" ? "eraser" : "brush";
    void apiBeginStroke(currentPartId).catch((e: ApiError) => {
      console.warn(`[editorCanvas] beginStroke failed: ${e?.message ?? String(e)}`);
    });
    paint(event);
  }

  function finishGradient(event: MouseEvent): void {
    if (!isGradient) return;
    isGradient = false;
    const partId = currentPartId;
    if (!partId) return;
    const { cx: endCx, cy: endCy } = eventToPixel(event);
    const { color, alpha } = sessionStore.getState();
    applyGradient({
      partId,
      x0: gradientStartCx,
      y0: gradientStartCy,
      x1: endCx,
      y1: endCy,
      color: [color[0], color[1], color[2], alpha],
    })
      .then((diff) => {
        sessionStore.setState({
          lastAppliedDiff: { partId, diff, phase: "after" },
        });
        markPartDirty(partId);
        pushHistoryRecord({
          partId,
          tool: "gradient",
          rectW: diff.width,
          rectH: diff.height,
        });
      })
      .catch((e: ApiError) => {
        console.warn(`[editorCanvas] gradient failed: ${e?.message ?? String(e)}`);
      });
  }

  function onMouseMove(event: MouseEvent): void {
    if (isPanning) {
      panOffsetX = panStartOffX + (event.clientX - panStartX);
      panOffsetY = panStartOffY + (event.clientY - panStartY);
      applyZoom();
      return;
    }
    if (isZonePainting) {
      paintZone(event, isZoneErasing);
      return;
    }
    if (!isPainting) return;
    paint(event);
  }

  function endStroke(event?: MouseEvent): void {
    if (event && isGradient) {
      finishGradient(event);
    }
    if (isPanning) {
      isPanning = false;
      // 恢复 cursor 跟随 activeTool 提示。
      const tool = sessionStore.getState().activeTool;
      gridEl.style.cursor = cursorForTool(tool, false);
    }
    if (isZonePainting) {
      isZonePainting = false;
      // 一次笔画结束写盘一次。
      flushZonesIfDirty();
    }
    // 结束 brush/eraser 笔画：拿后端合并 diff 一次性 push 历史；
    // 空笔画（width=0/height=0，仅点击未拖）后端不入栈，前端也不 push。
    if (isPainting && paintingPartId) {
      const partId = paintingPartId;
      const tool = paintingTool;
      paintingPartId = null;
      apiEndStroke(partId)
        .then((diff) => {
          if (diff.width === 0 || diff.height === 0) return;
          pushHistoryRecord({ partId, tool, rectW: diff.width, rectH: diff.height });
          markPartDirty(partId);
          // 通知 previewCanvas 重合成；editorCanvas 自身已在 paint 阶段实时刷新，
          // endStroke 不再重拉 flatten 避免抖动。
          sessionStore.setState({ lastAppliedDiff: { partId, diff, phase: "after" } });
        })
        .catch((e: ApiError) => {
          console.warn(`[editorCanvas] endStroke failed: ${e?.message ?? String(e)}`);
        });
    }
    isPainting = false;
    lastCx = -1;
    lastCy = -1;
  }

  function onSessionChange(): void {
    const state = sessionStore.getState();
    // activeTool 变化时同步 grid cursor 视觉提示。
    gridEl.style.cursor = cursorForTool(state.activeTool, isPanning);
    // 先处理 lastAppliedDiff 推送，与 stage/part 切换互不影响。
    if (state.lastAppliedDiff !== lastAppliedDiffRef) {
      lastAppliedDiffRef = state.lastAppliedDiff;
      if (state.lastAppliedDiff && state.lastAppliedDiff.partId === currentPartId) {
        // 改任意图层后画布显示合并视图，不再增量贴单层 diff。
        refreshFlatten();
      }
    }
    // layerPanel 改图层结构（删 / 切 active / 改可见 / 不透明）也触发画布刷新。
    const ver = state.layerSnapshotVersion ?? 0;
    if (ver !== lastLayerSnapshotVersion) {
      lastLayerSnapshotVersion = ver;
      if (currentPartId) refreshFlatten();
    }
    const { currentSkinName, selectedPartName, selectedCategory } = state;
    if (!currentSkinName || !selectedPartName || !selectedCategory) {
      lastKey = null;
      showPlaceholder({ kind: "notSelected" }, false);
      return;
    }
    const key = `${currentSkinName}::${selectedCategory}::${selectedPartName}`;
    if (key === lastKey) return;
    lastKey = key;
    pendingKey = key;
    showPlaceholder({ kind: "loading", partName: selectedPartName }, false);
    loadPartImage(skinRoot, currentSkinName, selectedCategory as PartCategory, selectedPartName)
      .then((result) => {
        // 期间用户切换到了别的部件，忽略过期响应。
        if (pendingKey !== key) return;
        render(result, selectedPartName);
      })
      .catch((e: ApiError) => {
        if (pendingKey !== key) return;
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

  resizeBtn.addEventListener("click", () => {
    if (!currentPartId || !currentPartName) return;
    void promptResize();
  });

  function attachSideBtn(btn: HTMLButtonElement, side: "F" | "B", availableRef: () => boolean): void {
    btn.addEventListener("click", () => {
      if (!currentPartId || !currentPartName || !availableRef()) return;
      const parts = currentPartId.split("::");
      if (parts.length !== 3) return;
      const [skinName, categoryDir, _name] = parts;
      const category = categoryDir as PartCategory;
      const partName = currentPartName;
      btn.disabled = true;
      createSidePart(skinRoot, skinName, category, partName, side)
        .then((r) => {
          showToast(`✓ ${r.sidePartName}`, "info");
          if (side === "F") sideFBtnAvailable = false;
          else sideBBtnAvailable = false;
          updateInfoPanel();
          bumpPartListVersion();
        })
        .catch((e: ApiError) => {
          showToast(e?.message ?? String(e), "error");
        })
        .finally(() => {
          btn.disabled = false;
        });
    });
  }
  attachSideBtn(sideFBtn, "F", () => sideFBtnAvailable);
  attachSideBtn(sideBBtn, "B", () => sideBBtnAvailable);

  /// 弹窗：让用户选缩放倍率（缩小 0.25/0.5/0.75 / 放大 1/2/3/4 / 自定义 0.01~1000）。
  /// 提交时按 partId 反推目标 PNG 路径并调 resizePart；成功后回写本地状态并写盘。
  function promptResize(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!currentPartId || !currentPartName) {
        resolve();
        return;
      }
      const parts = currentPartId.split("::");
      if (parts.length !== 3) {
        resolve();
        return;
      }
      const [skinName, categoryDir, partName] = parts;
      const targetPath = `${skinRoot}/${skinName}/${categoryDir}/${partName}.png`;

      const overlay = document.createElement("div");
      overlay.style.cssText =
        "position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;";
      const shrinkFactors: number[] = [0.25, 0.5, 0.75];
      const enlargeFactors: number[] = [1, 2, 3, 4];
      const renderFactorBtn = (f: number): string => {
        const label = f < 1 ? `${f}×` : `${f}×`;
        return `<button class="btn" data-role="factor" data-f="${f}" style="flex:1;">${label}</button>`;
      };
      const shrinkBtns = shrinkFactors.map(renderFactorBtn).join("");
      const enlargeBtns = enlargeFactors.map(renderFactorBtn).join("");
      overlay.innerHTML =
        `<div style="min-width:340px;max-width:480px;background:var(--surface,#fff);color:var(--on-background,#222);` +
        `padding:16px 20px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.3);font-size:13px;` +
        `display:flex;flex-direction:column;gap:10px;">` +
        `<div style="font-weight:600;">${t("editorCanvas.resizeTitle")}</div>` +
        `<div style="font-size:12px;opacity:0.75;">${t("editorCanvas.resizeHint")
          .replace("{w}", String(currentWidth))
          .replace("{h}", String(currentHeight))}</div>` +
        `<div style="font-size:12px;opacity:0.85;">${t("editorCanvas.resizeShrinkLabel")}</div>` +
        `<div style="display:flex;gap:8px;">${shrinkBtns}</div>` +
        `<div style="font-size:12px;opacity:0.85;">${t("editorCanvas.resizeEnlargeLabel")}</div>` +
        `<div style="display:flex;gap:8px;">${enlargeBtns}</div>` +
        `<div style="display:flex;align-items:center;gap:8px;">` +
        `<span style="font-size:12px;opacity:0.85;flex:none;">${t("editorCanvas.resizeCustomLabel")}</span>` +
        `<input data-role="custom" type="number" min="0.01" max="1000" step="0.01" placeholder="0.01 ~ 1000" style="flex:1;padding:4px 6px;" />` +
        `<button class="btn btn-primary" data-role="apply" style="flex:none;"></button>` +
        `</div>` +
        `<div style="display:flex;justify-content:flex-end;gap:8px;">` +
        `<button class="btn" data-role="cancel"></button>` +
        `</div></div>`;
      document.body.appendChild(overlay);
      const cancelBtn = overlay.querySelector<HTMLButtonElement>('[data-role="cancel"]')!;
      const applyBtn = overlay.querySelector<HTMLButtonElement>('[data-role="apply"]')!;
      const customInput = overlay.querySelector<HTMLInputElement>('[data-role="custom"]')!;
      cancelBtn.textContent = t("editorCanvas.resizeCancel");
      applyBtn.textContent = t("editorCanvas.resizeApply");

      const close = (): void => {
        overlay.remove();
        resolve();
      };
      cancelBtn.addEventListener("click", close);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) close();
      });

      const doApply = (w: number, h: number): void => {
        const partId = currentPartId!;
        overlay.querySelectorAll<HTMLButtonElement>("button").forEach((b) => { b.disabled = true; });
        customInput.disabled = true;
        resizePart(partId, w, h, targetPath)
          .then((r) => {
            currentWidth = r.width;
            currentHeight = r.height;
            updateInfoPanel();
            void reloadCurrent();
            markPartClean(partId);
            showToast(`✓ ${partName} ${r.width}×${r.height}`, "info");
            close();
          })
          .catch((e: ApiError) => {
            showToast(e?.message ?? String(e), "error");
            overlay.querySelectorAll<HTMLButtonElement>("button").forEach((b) => { b.disabled = false; });
            customInput.disabled = false;
          });
      };

      const confirmBelowBase = (w: number, h: number, baseW: number, baseH: number): void => {
        const dialog = document.createElement("div");
        dialog.style.cssText =
          "position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;";
        const hint = t("editorCanvas.resizeBelowBaseHint")
          .replace("{w}", String(w))
          .replace("{h}", String(h))
          .replace("{baseW}", String(baseW))
          .replace("{baseH}", String(baseH));
        dialog.innerHTML =
          `<div style="min-width:340px;max-width:480px;background:var(--surface,#fff);color:var(--on-background,#222);` +
          `padding:16px 20px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.3);font-size:13px;` +
          `display:flex;flex-direction:column;gap:10px;">` +
          `<div style="font-weight:600;color:#c0392b;">${t("editorCanvas.resizeBelowBaseTitle")}</div>` +
          `<div style="font-size:13px;line-height:1.5;">${hint}</div>` +
          `<div style="display:flex;justify-content:flex-end;gap:8px;">` +
          `<button class="btn" data-role="confirm-no"></button>` +
          `<button class="btn btn-primary" data-role="confirm-yes"></button>` +
          `</div></div>`;
        document.body.appendChild(dialog);
        const yesBtn = dialog.querySelector<HTMLButtonElement>('[data-role="confirm-yes"]')!;
        const noBtn = dialog.querySelector<HTMLButtonElement>('[data-role="confirm-no"]')!;
        yesBtn.textContent = t("editorCanvas.resizeBelowBaseYes");
        noBtn.textContent = t("editorCanvas.resizeBelowBaseNo");
        const closeDialog = (): void => { dialog.remove(); };
        noBtn.addEventListener("click", closeDialog);
        dialog.addEventListener("click", (e) => { if (e.target === dialog) closeDialog(); });
        yesBtn.addEventListener("click", () => {
          closeDialog();
          doApply(w, h);
        });
      };

      const submit = (factor: number): void => {
        if (!Number.isFinite(factor) || factor <= 0 || factor > 1000) {
          showToast(t("editorCanvas.resizeFactorInvalid"), "error");
          return;
        }
        const w = Math.max(1, Math.round(currentWidth * factor));
        const h = Math.max(1, Math.round(currentHeight * factor));
        if (w > 4096 || h > 4096) {
          showToast(t("editorCanvas.resizeInvalid"), "error");
          return;
        }
        const [skinNameVal, categoryDirVal, partNameVal] = currentPartId!.split("::");
        getBaseSize(skinRoot, skinNameVal, categoryDirVal as PartCategory, partNameVal)
          .then((base) => {
            if (base.found && (w < base.width || h < base.height)) {
              confirmBelowBase(w, h, base.width, base.height);
              return;
            }
            doApply(w, h);
          })
          .catch(() => {
            doApply(w, h);
          });
      };

      overlay.querySelectorAll<HTMLButtonElement>('[data-role="factor"]').forEach((btn) => {
        btn.addEventListener("click", () => {
          const f = parseFloat(btn.dataset.f ?? "1");
          submit(f);
        });
      });
      const submitCustom = (): void => {
        const f = parseFloat(customInput.value);
        submit(f);
      };
      applyBtn.addEventListener("click", submitCustom);
      customInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submitCustom();
        }
      });
    });
  }

  /// 触发一次重新 load：把后端 session 当前像素拉回来重绘 canvas。
  function reloadCurrent(): void {
    if (!currentPartId) return;
    const parts = currentPartId.split("::");
    if (parts.length !== 3) return;
    const [skinName, categoryDir, partName] = parts;
    const category = categoryDir as PartCategory;
    loadPartImage(skinRoot, skinName, category, partName)
      .then((r) => render(r, partName))
      .catch((e: ApiError) => {
        showPlaceholder({ kind: "error", partName, msg: e?.message ?? String(e) }, true);
      });
  }

  // 仅在 stageEl 上注册指针监听，避免事件从 canvas 冒泡到 stageEl 触发同一次 mousedown
  // 被处理两遍。stageEl 自身覆盖整个画布 + padding 区域，pan/gradient 拖到画布外仍生效。
  // 画布 + padding 区域，pan/gradient 拖到画布外仍生效。
  const stageEl = container.querySelector<HTMLDivElement>(".editor-canvas-stage")!;
  stageEl.addEventListener("contextmenu", (e) => e.preventDefault());
  stageEl.addEventListener("mousedown", onMouseDown);
  stageEl.addEventListener("mousemove", onMouseMove);
  stageEl.addEventListener("mouseup", (e) => endStroke(e));
  stageEl.addEventListener("mouseleave", () => endStroke());
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
  // zonesStore 变化（layerPanel 改 displayColor / 删除区块 / 新建区块 / 详情面板改光粒子等）
  // 同步 currentZones 引用并重绘 overlay，让画布即时反映区块管理面板的操作。
  const unsubZones = zonesStore.subscribe(() => {
    const data = zonesStore.get().data;
    currentZones = data;
    redrawZonesOverlay();
  });
  const detachInvertedBorder = attachInvertedBorder(stageEl);
  applyZoom();
  updateInfoPanel();
  onSessionChange();

  // 标题徽标显示当前部件保存状态。
  // 切换部件 / dirtyPartIds 变化 / lang 变化都重渲染。
  let lastBadgeKey = "";
  function refreshBadge(): void {
    if (!dock) return;
    const { currentPartId, dirtyPartIds } = sessionStore.getState();
    if (!currentPartId) {
      if (lastBadgeKey !== "") {
        dock.setTitleBadge("");
        lastBadgeKey = "";
      }
      return;
    }
    const dirty = dirtyPartIds.includes(currentPartId);
    const text = dirty ? t("editorCanvas.unsaved") : t("editorCanvas.saved");
    const variant = dirty ? "warn" : "ok";
    const key = `${dirty ? "1" : "0"}::${text}`;
    if (key === lastBadgeKey) return;
    lastBadgeKey = key;
    dock.setTitleBadge(text, variant);
  }
  refreshBadge();
  const unsubBadge = sessionStore.subscribe(refreshBadge);

  // lang 切换：仅刷新当前 placeholder 文案，不打扰已渲染的 canvas。
  const unsubLang = subscribeLang(() => {
    if (placeholderInfo.kind !== "none" && placeholderEl.style.display !== "none") {
      placeholderEl.textContent = renderPlaceholderText(placeholderInfo);
    }
    // 信息侧栏 + resize 按钮文案随 lang 切换，避免用户切语言后旧字面残留。
    updateInfoPanel();
    // lang 切换时 badge 文案需重渲染。
    lastBadgeKey = "";
    refreshBadge();
  });

  // footer 高度按 layoutEngine `editorCanvas.footerPct` 百分比持久化，顶部 grip 拖拽调节。
  const footerEl = container.querySelector<HTMLDivElement>('[data-role="footer"]')!;
  const footerGripEl = container.querySelector<HTMLDivElement>('[data-role="footer-grip"]')!;
  const FOOTER_PCT_MIN = 10;
  const FOOTER_PCT_MAX = 70;
  const FOOTER_PCT_DEFAULT = 25;
  function clampPct(n: number): number {
    return Math.max(FOOTER_PCT_MIN, Math.min(FOOTER_PCT_MAX, n));
  }
  let footerPct = clampPct(getSize("editorCanvas.footerPct") ?? FOOTER_PCT_DEFAULT);
  function applyFooterHeight(): void {
    footerEl.style.flex = `0 0 ${footerPct}%`;
  }
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
      const deltaPct = (dy / containerRect.height) * 100;
      footerPct = clampPct(startPct - deltaPct);
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

  return () => {
    unsubscribe();
    unsubZones();
    unsubBadge();
    unsubLang();
    detachInvertedBorder();
    pendingKey = null;
    // mousedown/move/up/leave 已只在 stageEl 注册；mouseup/mouseleave 用了箭头函数
    // 无法可靠 removeEventListener，依靠 stageEl 随 SPA 销毁即可。
  };
}

// 在 stage 容器外圈加反色描边，跟随主题刷新。
// outline 写在 stage 容器而非 canvas，避免随 zoom 缩放；中性灰退化用纯白替代以保证可见。
function attachInvertedBorder(target: HTMLElement): () => void {
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
