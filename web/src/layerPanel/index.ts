// 当前部件的图层列表与图层操作 UI。
// 订阅 sessionStore.currentPartId（由 editorCanvas 在 loadPartImage 后写入），
// 非空时调 apiClient.getLayers 拉取 LayersSnapshot；操作走 apiClient 的 7 个图层接口。
// 每次操作返回的新 snapshot 整体替换本地缓存并重渲染。
//
// UI 排布：layers[0] 为底，layers[N-1] 为顶；面板从上到下显示反向（顶层在最上方）。
// opacity 为 0 的图层在面板中保持可见、可选中。

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
import { sessionStore } from "../stateStore";
import { subscribeLang, t } from "../i18n";

export function mountLayerPanel(container: HTMLElement): () => void {
  let snapshot: LayersSnapshot | null = null;
  let lastPartId = sessionStore.getState().currentPartId;
  // pendingPartId：用于忽略过期的异步响应（用户快速切换部件时）。
  let pendingPartId: string | null = lastPartId;

  container.classList.add("panel");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.innerHTML =
    `<div class="layer-panel-toolbar" style="display:flex;align-items:center;gap:4px;padding:8px;border-bottom:1px solid rgba(0,0,0,var(--border-opacity));">` +
    `<button class="btn" data-role="add">+</button>` +
    `<button class="btn" data-role="up">↑</button>` +
    `<button class="btn" data-role="down">↓</button>` +
    `<span class="mono" data-role="meta" style="margin-left:auto;opacity:0.7;"></span>` +
    `</div>` +
    `<div data-role="error" style="display:none;padding:6px 8px;color:#c00;border-bottom:1px solid rgba(0,0,0,var(--border-opacity));"></div>` +
    `<ul data-role="list" style="flex:1;min-height:0;overflow:auto;list-style:none;padding:0;margin:0;"></ul>`;

  const addBtn = container.querySelector<HTMLButtonElement>('[data-role="add"]')!;
  const upBtn = container.querySelector<HTMLButtonElement>('[data-role="up"]')!;
  const downBtn = container.querySelector<HTMLButtonElement>('[data-role="down"]')!;
  const metaEl = container.querySelector<HTMLSpanElement>('[data-role="meta"]')!;
  const errorEl = container.querySelector<HTMLDivElement>('[data-role="error"]')!;
  const listEl = container.querySelector<HTMLUListElement>('[data-role="list"]')!;

  function applyToolbarTexts(): void {
    addBtn.title = t("layerPanel.addLayer");
    upBtn.title = t("layerPanel.moveUp");
    downBtn.title = t("layerPanel.moveDown");
  }
  applyToolbarTexts();

  function clearError(): void {
    errorEl.style.display = "none";
    errorEl.textContent = "";
  }

  function showError(msg: string): void {
    errorEl.style.display = "block";
    errorEl.textContent = msg;
  }

  function applySnapshot(next: LayersSnapshot): void {
    snapshot = next;
    clearError();
    render();
    // 通知 editorCanvas 刷新 flatten 视图（删图层 / 切 active / 改 opacity 等）。
    const cur = sessionStore.getState().layerSnapshotVersion ?? 0;
    sessionStore.setState({ layerSnapshotVersion: cur + 1 });
  }

  // 把后端调用的失败统一收敛到面板内：保留旧 snapshot，顶部红字提示，console.warn 留痕。
  function handleApiError(prefix: string, e: ApiError): void {
    const msg = e?.message ?? String(e);
    console.warn(`[layerPanel] ${prefix} failed: ${msg}`);
    showError(`${prefix}：${msg}`);
  }

  function render(): void {
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
    // 顶层在前展示：倒序遍历 layers，但点击时仍传后端的真实索引（layers[i] 的 i）。
    for (let i = snapshot.layers.length - 1; i >= 0; i--) {
      listEl.appendChild(renderRow(partId, snapshot.layers[i], i, i === snapshot.activeLayerIndex));
    }
  }

  function renderRow(partId: string, layer: LayerMeta, index: number, isActive: boolean): HTMLLIElement {
    const li = document.createElement("li");
    li.style.cssText =
      `display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;` +
      (isActive ? "background:rgba(0,0,0,0.08);" : "");

    const visibleCb = document.createElement("input");
    visibleCb.type = "checkbox";
    visibleCb.checked = layer.visible;
    visibleCb.title = t("layerPanel.toggleVisible");
    visibleCb.addEventListener("click", (e) => e.stopPropagation());
    visibleCb.addEventListener("change", () => {
      setLayerVisibility(partId, layer.id, visibleCb.checked)
        .then(applySnapshot)
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
    // opacity 用百分比展示更直观。
    const pctText = `${Math.round((layer.opacity / 255) * 100)}%`;
    opacityRange.title = `${t("layerPanel.opacityHint")} ${pctText}`;

    const opacityLabel = document.createElement("span");
    opacityLabel.textContent = pctText;
    opacityLabel.style.cssText = "min-width:3.5ch;text-align:right;opacity:0.7;font-size:11px;";
    opacityLabel.title = opacityRange.title;

    opacityRange.addEventListener("click", (e) => e.stopPropagation());
    opacityRange.addEventListener("input", () => {
      const v = Number(opacityRange.value);
      // 即时更新展示，不等后端回包；后端 confirm 后 applySnapshot 重渲染会再覆盖一次。
      const pct = `${Math.round((v / 255) * 100)}%`;
      opacityLabel.textContent = pct;
      opacityRange.title = `${t("layerPanel.opacityHint")} ${pct}`;
      setLayerOpacity(partId, layer.id, v)
        .then(applySnapshot)
        .catch((err: ApiError) => handleApiError(t("layerPanel.errSetOpacity"), err));
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn";
    delBtn.textContent = "×";
    delBtn.title = t("layerPanel.removeLayer");
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeLayer(partId, layer.id)
        .then(applySnapshot)
        .catch((err: ApiError) => handleApiError(t("layerPanel.errRemoveLayer"), err));
    });

    li.addEventListener("click", () => {
      if (isActive) return;
      setActiveLayer(partId, index)
        .then(applySnapshot)
        .catch((err: ApiError) => handleApiError(t("layerPanel.errSetActive"), err));
    });

    li.appendChild(visibleCb);
    li.appendChild(nameEl);
    li.appendChild(opacityRange);
    li.appendChild(opacityLabel);
    li.appendChild(delBtn);
    return li;
  }

  function moveActive(delta: number): void {
    const partId = sessionStore.getState().currentPartId;
    if (!partId || !snapshot) return;
    const target = snapshot.activeLayerIndex + delta;
    if (target < 0 || target >= snapshot.layers.length) return;
    // 构造新 order：交换 active 与 target 位置的图层 id。
    const order = snapshot.layers.map((l) => l.id);
    [order[snapshot.activeLayerIndex], order[target]] = [order[target], order[snapshot.activeLayerIndex]];
    reorderLayers(partId, order)
      .then(applySnapshot)
      .catch((err: ApiError) => handleApiError(t("layerPanel.errReorder"), err));
  }

  addBtn.addEventListener("click", () => {
    const partId = sessionStore.getState().currentPartId;
    if (!partId) return;
    addLayer(partId)
      .then(applySnapshot)
      .catch((err: ApiError) => handleApiError(t("layerPanel.errAddLayer"), err));
  });
  upBtn.addEventListener("click", () => moveActive(1));
  downBtn.addEventListener("click", () => moveActive(-1));

  function fetchSnapshot(partId: string): void {
    pendingPartId = partId;
    getLayers(partId)
      .then((next) => {
        if (pendingPartId !== partId) return;
        applySnapshot(next);
      })
      .catch((err: ApiError) => {
        if (pendingPartId !== partId) return;
        handleApiError(t("layerPanel.errLoad"), err);
        snapshot = null;
        render();
      });
  }

  function onSessionChange(): void {
    const partId = sessionStore.getState().currentPartId;
    if (partId === lastPartId) return;
    lastPartId = partId;
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
  }

  const unsubscribe = sessionStore.subscribe(onSessionChange);
  // 首次挂载若已有 currentPartId（不太可能，但保持幂等），立即拉取。
  if (lastPartId) fetchSnapshot(lastPartId);
  render();

  // lang 切换：刷新工具栏 title 并重渲染列表（图层 row title 等都在 render 内）。
  const unsubLang = subscribeLang(() => {
    applyToolbarTexts();
    render();
  });

  return () => {
    unsubscribe();
    unsubLang();
    pendingPartId = null;
  };
}
