// 当前部件的图层列表面板；当激活魔法笔时切换为区块参数编辑视图。
// `layers[0]` 为底层、`layers[N-1]` 为顶层，界面按顶层在上倒序展示。

import {
  addLayer,
  getLayers,
  removeLayer,
  reorderLayers,
  setActiveLayer,
  setLayerOpacity,
  setLayerVisibility,
  type ApiError,
  type LayerMeta,
  type LayersSnapshot,
} from "../apiClient";
import { bumpLayerSnapshotVersion, markPartDirty, sessionStore } from "../stateStore";
import { zonesStore } from "../stateStore/zonesStore";
import { subscribeLang, t } from "../i18n";
import { copyLayerToClipboard, hasLayerClipboard, pasteLayerToPart } from "./layerClipboard";
import { createZoneInStore, refreshZoneSwatches, renderZonesList } from "./zoneEditor";

export function mountLayerPanel(container: HTMLElement, skinRoot: string): () => void {
  let snapshot: LayersSnapshot | null = null;
  let lastPartId = sessionStore.getState().currentPartId;
  let lastZoneMode = sessionStore.getState().activeTool === "zoneBrush";
  let lastActiveZoneId = sessionStore.getState().activeZoneId;
  let lastLayerSnapshotVer = sessionStore.getState().layerSnapshotVersion ?? 0;
  let lastCanvasSizeVer = sessionStore.getState().canvasSizeVersion ?? 0;
  let pendingPartId: string | null = lastPartId;
  const expandedZoneIds = new Set<number>();

  container.classList.add("panel");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.innerHTML =
    `<div class="layer-panel-toolbar" style="display:flex;align-items:center;gap:4px;padding:8px;border-bottom:1px solid rgba(var(--border-rgb),var(--border-opacity));">` +
    `<button class="btn" data-role="add">+</button>` +
    `<button class="btn" data-role="paste-layer" title="">⎘</button>` +
    `<button class="btn" data-role="up">↑</button>` +
    `<button class="btn" data-role="down">↓</button>` +
    `<span class="mono" data-role="meta" style="margin-left:auto;opacity:0.7;"></span>` +
    `</div>` +
    `<div data-role="error" style="display:none;padding:6px 8px;color:#c00;border-bottom:1px solid rgba(var(--border-rgb),var(--border-opacity));"></div>` +
    `<ul data-role="list" style="flex:1;min-height:0;overflow:auto;list-style:none;padding:0;margin:0;"></ul>`;

  const addBtn = container.querySelector<HTMLButtonElement>('[data-role="add"]')!;
  const pasteLayerBtn = container.querySelector<HTMLButtonElement>('[data-role="paste-layer"]')!;
  const upBtn = container.querySelector<HTMLButtonElement>('[data-role="up"]')!;
  const downBtn = container.querySelector<HTMLButtonElement>('[data-role="down"]')!;
  const metaEl = container.querySelector<HTMLSpanElement>('[data-role="meta"]')!;
  const errorEl = container.querySelector<HTMLDivElement>('[data-role="error"]')!;
  const listEl = container.querySelector<HTMLUListElement>('[data-role="list"]')!;

  function applyToolbarTexts(): void {
    addBtn.title = t("layerPanel.addLayer");
    upBtn.title = t("layerPanel.moveUp");
    downBtn.title = t("layerPanel.moveDown");
    pasteLayerBtn.title = t("layerClipboard.pasteLayer");
  }
  applyToolbarTexts();

  function updatePasteBtn(): void {
    const zoneMode = sessionStore.getState().activeTool === "zoneBrush";
    const partId = sessionStore.getState().currentPartId;
    pasteLayerBtn.disabled = zoneMode || !partId || !hasLayerClipboard();
    pasteLayerBtn.style.display = zoneMode ? "none" : "";
  }

  function clearError(): void {
    errorEl.style.display = "none";
    errorEl.textContent = "";
  }

  function showError(msg: string): void {
    errorEl.style.display = "block";
    errorEl.textContent = msg;
  }

  function applySnapshot(next: LayersSnapshot, mutatedPartId?: string): void {
    if (mutatedPartId && sessionStore.getState().currentPartId !== mutatedPartId) return;
    snapshot = next;
    clearError();
    if (mutatedPartId) {
      markPartDirty(mutatedPartId);
    }
    render();
    bumpLayerSnapshotVersion();
    lastLayerSnapshotVer = sessionStore.getState().layerSnapshotVersion ?? 0;
  }

  function handleApiError(prefix: string, e: ApiError): void {
    const msg = e?.message ?? String(e);
    console.warn(`[layerPanel] ${prefix} failed: ${msg}`);
    showError(`${prefix}：${msg}`);
  }

  pasteLayerBtn.addEventListener("click", () => {
    const partId = sessionStore.getState().currentPartId;
    if (!partId) return;
    pasteLayerToPart(partId, (snap) => applySnapshot(snap, partId));
  });

  function render(): void {
    updatePasteBtn();
    if (sessionStore.getState().activeTool === "zoneBrush") {
      renderZonesList({
        skinRoot,
        listEl,
        metaEl,
        addBtn,
        upBtn,
        downBtn,
        expandedZoneIds,
        requestRender: render,
      });
      return;
    }
    listEl.innerHTML = "";
    const partId = sessionStore.getState().currentPartId;
    if (!partId || !snapshot) {
      metaEl.textContent = "";
      addBtn.disabled = true;
      upBtn.disabled = true;
      downBtn.disabled = true;
      const li = document.createElement("li");
      li.style.cssText = "padding:8px;opacity:0.6;";
      li.textContent = partId ? t("layerPanel.loading") : t("layerPanel.notSelected");
      listEl.appendChild(li);
      return;
    }
    addBtn.disabled = snapshot.layers.length >= 8;
    upBtn.disabled = snapshot.activeLayerIndex >= snapshot.layers.length - 1;
    downBtn.disabled = snapshot.activeLayerIndex <= 0;
    metaEl.textContent = `${snapshot.layers.length}/8`;
    addBtn.title = t("layerPanel.addLayer");
    addBtn.textContent = "+";
    upBtn.style.display = "";
    downBtn.style.display = "";
    for (let i = snapshot.layers.length - 1; i >= 0; i--) {
      listEl.appendChild(renderRow(partId, snapshot.layers[i], i, i === snapshot.activeLayerIndex));
    }
  }

  function renderRow(partId: string, layer: LayerMeta, index: number, isActive: boolean): HTMLLIElement {
    const li = document.createElement("li");
    li.style.cssText =
      `display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;` +
      (isActive ? "background:rgba(var(--border-rgb),0.12);" : "");

    const visibleCb = document.createElement("input");
    visibleCb.type = "checkbox";
    visibleCb.checked = layer.visible;
    visibleCb.title = t("layerPanel.toggleVisible");
    visibleCb.addEventListener("click", (e) => e.stopPropagation());
    visibleCb.addEventListener("change", () => {
      setLayerVisibility(partId, layer.id, visibleCb.checked)
        .then((next) => applySnapshot(next, partId))
        .catch((err: ApiError) => handleApiError(t("layerPanel.errSetVisible"), err));
    });

    const nameEl = document.createElement("span");
    nameEl.textContent = layer.name;
    nameEl.style.cssText = "flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

    const opacityRange = document.createElement("input");
    opacityRange.type = "range";
    opacityRange.min = "0";
    opacityRange.max = "255";
    opacityRange.value = String(layer.opacity);
    opacityRange.style.width = "70px";
    const pctText = `${Math.round((layer.opacity / 255) * 100)}%`;
    opacityRange.title = `${t("layerPanel.opacityHint")} ${pctText}`;

    const opacityLabel = document.createElement("span");
    opacityLabel.textContent = pctText;
    opacityLabel.style.cssText = "min-width:3.5ch;text-align:right;opacity:0.7;font-size:11px;";
    opacityLabel.title = opacityRange.title;

    opacityRange.addEventListener("click", (e) => e.stopPropagation());
    // 滑动过程中不调 `render()` 重建 DOM，避免打断 `<input type="range">` 捕获。
    opacityRange.addEventListener("input", () => {
      const v = Math.max(0, Math.min(255, Math.round(Number(opacityRange.value) || 0)));
      const pct = `${Math.round((v / 255) * 100)}%`;
      opacityLabel.textContent = pct;
      opacityRange.title = `${t("layerPanel.opacityHint")} ${pct}`;
      setLayerOpacity(partId, layer.id, v)
        .then((next) => {
          if (sessionStore.getState().currentPartId !== partId) return;
          snapshot = next;
          markPartDirty(partId);
          bumpLayerSnapshotVersion();
          lastLayerSnapshotVer = sessionStore.getState().layerSnapshotVersion ?? 0;
        })
        .catch((err: ApiError) => handleApiError(t("layerPanel.errSetOpacity"), err));
    });

    const copyBtn = document.createElement("button");
    copyBtn.className = "btn";
    copyBtn.textContent = "⎘";
    copyBtn.title = t("layerClipboard.copyLayer");
    copyBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      copyLayerToClipboard(partId, layer.id, layer.name);
      updatePasteBtn();
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn";
    delBtn.textContent = "×";
    delBtn.title = t("layerPanel.removeLayer");
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeLayer(partId, layer.id)
        .then((next) => applySnapshot(next, partId))
        .catch((err: ApiError) => handleApiError(t("layerPanel.errRemoveLayer"), err));
    });

    li.addEventListener("click", () => {
      if (isActive) return;
      setActiveLayer(partId, index)
        .then((next) => applySnapshot(next))
        .catch((err: ApiError) => handleApiError(t("layerPanel.errSetActive"), err));
    });

    li.append(visibleCb, nameEl, opacityRange, opacityLabel, copyBtn, delBtn);
    return li;
  }

  function moveActive(delta: number): void {
    const partId = sessionStore.getState().currentPartId;
    if (!partId || !snapshot) return;
    const target = snapshot.activeLayerIndex + delta;
    if (target < 0 || target >= snapshot.layers.length) return;
    const order = snapshot.layers.map((l) => l.id);
    [order[snapshot.activeLayerIndex], order[target]] = [order[target], order[snapshot.activeLayerIndex]];
    reorderLayers(partId, order)
      .then((next) => applySnapshot(next, partId))
      .catch((err: ApiError) => handleApiError(t("layerPanel.errReorder"), err));
  }

  addBtn.addEventListener("click", () => {
    const partId = sessionStore.getState().currentPartId;
    if (!partId) return;
    if (sessionStore.getState().activeTool === "zoneBrush") {
      createZoneInStore(skinRoot, partId);
      return;
    }
    addLayer(partId)
      .then((next) => applySnapshot(next, partId))
      .catch((err: ApiError) => handleApiError(t("layerPanel.errAddLayer"), err));
  });
  upBtn.addEventListener("click", () => moveActive(1));
  downBtn.addEventListener("click", () => moveActive(-1));

  function fetchSnapshot(partId: string): void {
    pendingPartId = partId;
    getLayers(partId)
      .then((next) => {
        if (pendingPartId !== partId) return;
        snapshot = next;
        clearError();
        render();
      })
      .catch((err: ApiError) => {
        if (pendingPartId !== partId) return;
        handleApiError(t("layerPanel.errLoad"), err);
        snapshot = null;
        render();
      });
  }

  function onSessionChange(): void {
    const state = sessionStore.getState();
    const partId = state.currentPartId;
    const zoneMode = state.activeTool === "zoneBrush";
    const activeZoneId = state.activeZoneId;
    const layerVer = state.layerSnapshotVersion ?? 0;
    const sizeVer = state.canvasSizeVersion ?? 0;

    if (partId !== lastPartId) {
      lastPartId = partId;
      lastZoneMode = zoneMode;
      lastActiveZoneId = activeZoneId;
      lastLayerSnapshotVer = layerVer;
      lastCanvasSizeVer = sizeVer;
      clearError();
      if (partId === null) {
        pendingPartId = null;
        snapshot = null;
        render();
        return;
      }
      snapshot = null;
      render();
      fetchSnapshot(partId);
      return;
    }

    if (layerVer !== lastLayerSnapshotVer || sizeVer !== lastCanvasSizeVer) {
      lastLayerSnapshotVer = layerVer;
      lastCanvasSizeVer = sizeVer;
      if (partId) fetchSnapshot(partId);
    }

    if (zoneMode !== lastZoneMode || (zoneMode && activeZoneId !== lastActiveZoneId)) {
      lastZoneMode = zoneMode;
      lastActiveZoneId = activeZoneId;
      render();
    }
  }

  const unsubscribe = sessionStore.subscribe(onSessionChange);
  let lastZonesSig = "";
  const unsubZones = zonesStore.subscribe(() => {
    if (sessionStore.getState().activeTool !== "zoneBrush") return;
    const snap = zonesStore.get();
    const sig = snap.data ? `${snap.partId}::${snap.data.config.zones.map((z) => z.id).join(",")}` : "";
    if (sig !== lastZonesSig) {
      lastZonesSig = sig;
      render();
      return;
    }
    refreshZoneSwatches(listEl);
  });

  if (lastPartId) fetchSnapshot(lastPartId);
  render();

  const unsubLang = subscribeLang(() => {
    applyToolbarTexts();
    render();
  });

  return () => {
    unsubscribe();
    unsubZones();
    unsubLang();
    pendingPartId = null;
  };
}
