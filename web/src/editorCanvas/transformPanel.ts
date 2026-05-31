// 当前图层视图变换控件：翻转/缩放/旋转预览，应用后烘焙入历史，取消还原。
import {
  getLayers,
  setLayerTransform,
  bakeLayerTransform,
  type ApiError,
  type LayerTransform,
} from "../apiClient";
import { sessionStore, markPartDirty, pushHistoryRecord } from "../stateStore";
import { subscribeLang, t } from "../i18n";
import { showToast } from "../toast";

function identity(): LayerTransform {
  return { flipX: false, flipY: false, scaleX: 1, scaleY: 1, rotationDeg: 0 };
}

function isIdentity(tf: LayerTransform): boolean {
  return !tf.flipX && !tf.flipY
    && Math.abs(tf.scaleX - 1) < 1e-4
    && Math.abs(tf.scaleY - 1) < 1e-4
    && Math.abs(tf.rotationDeg) < 1e-4;
}

/// 挂载变换控件到容器；返回卸载函数。控件作用于当前部件 active 图层。
export function mountTransformControls(container: HTMLElement): () => void {
  container.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;";
  container.innerHTML =
    `<span data-role="label" style="opacity:0.7;"></span>` +
    `<button class="btn" data-role="flipH"></button>` +
    `<button class="btn" data-role="flipV"></button>` +
    `<label style="display:flex;align-items:center;gap:3px;"><span data-role="sxLabel"></span><input type="number" data-role="sx" step="0.05" style="width:56px;" /></label>` +
    `<label style="display:flex;align-items:center;gap:3px;"><span data-role="syLabel"></span><input type="number" data-role="sy" step="0.05" style="width:56px;" /></label>` +
    `<label style="display:flex;align-items:center;gap:3px;"><span data-role="rotLabel"></span><input type="number" data-role="rot" step="1" style="width:60px;" /></label>` +
    `<button class="btn btn-primary" data-role="apply"></button>` +
    `<button class="btn" data-role="cancel"></button>`;

  const labelEl = container.querySelector<HTMLSpanElement>('[data-role="label"]')!;
  const flipHBtn = container.querySelector<HTMLButtonElement>('[data-role="flipH"]')!;
  const flipVBtn = container.querySelector<HTMLButtonElement>('[data-role="flipV"]')!;
  const sxInput = container.querySelector<HTMLInputElement>('[data-role="sx"]')!;
  const syInput = container.querySelector<HTMLInputElement>('[data-role="sy"]')!;
  const rotInput = container.querySelector<HTMLInputElement>('[data-role="rot"]')!;
  const sxLabel = container.querySelector<HTMLSpanElement>('[data-role="sxLabel"]')!;
  const syLabel = container.querySelector<HTMLSpanElement>('[data-role="syLabel"]')!;
  const rotLabel = container.querySelector<HTMLSpanElement>('[data-role="rotLabel"]')!;
  const applyBtn = container.querySelector<HTMLButtonElement>('[data-role="apply"]')!;
  const cancelBtn = container.querySelector<HTMLButtonElement>('[data-role="cancel"]')!;

  let tf = identity();
  let activeLayerId: string | null = null;
  let activePartId: string | null = null;

  function applyTexts(): void {
    labelEl.textContent = t("transform.label");
    flipHBtn.title = t("transform.flipH");
    flipHBtn.textContent = t("transform.flipHShort");
    flipVBtn.title = t("transform.flipV");
    flipVBtn.textContent = t("transform.flipVShort");
    sxLabel.textContent = t("transform.scaleX");
    syLabel.textContent = t("transform.scaleY");
    rotLabel.textContent = t("transform.rotation");
    applyBtn.textContent = t("transform.apply");
    cancelBtn.textContent = t("transform.cancel");
  }

  function syncInputs(): void {
    flipHBtn.classList.toggle("btn-primary", tf.flipX);
    flipVBtn.classList.toggle("btn-primary", tf.flipY);
    sxInput.value = String(tf.scaleX);
    syInput.value = String(tf.scaleY);
    rotInput.value = String(tf.rotationDeg);
    const has = !isIdentity(tf);
    applyBtn.disabled = !has || !activeLayerId;
    cancelBtn.disabled = !has || !activeLayerId;
  }

  // 把 tf 推到后端预览并刷新画布/装配/动画预览。
  function pushPreview(): void {
    if (!activePartId || !activeLayerId) return;
    const partId = activePartId;
    const layerId = activeLayerId;
    const payload = isIdentity(tf) ? null : tf;
    setLayerTransform(partId, layerId, payload)
      .then(() => {
        const v = sessionStore.getState().layerSnapshotVersion ?? 0;
        sessionStore.setState({ layerSnapshotVersion: v + 1 });
      })
      .catch((e: ApiError) => console.warn(`[transform] setLayerTransform failed: ${e?.message ?? String(e)}`));
  }

  flipHBtn.addEventListener("click", () => { tf.flipX = !tf.flipX; syncInputs(); pushPreview(); });
  flipVBtn.addEventListener("click", () => { tf.flipY = !tf.flipY; syncInputs(); pushPreview(); });
  sxInput.addEventListener("input", () => { tf.scaleX = Number.parseFloat(sxInput.value) || 1; syncInputs(); pushPreview(); });
  syInput.addEventListener("input", () => { tf.scaleY = Number.parseFloat(syInput.value) || 1; syncInputs(); pushPreview(); });
  rotInput.addEventListener("input", () => { tf.rotationDeg = Number.parseFloat(rotInput.value) || 0; syncInputs(); pushPreview(); });

  applyBtn.addEventListener("click", () => {
    if (!activePartId || !activeLayerId || isIdentity(tf)) return;
    const partId = activePartId;
    bakeLayerTransform(partId, activeLayerId)
      .then((diff) => {
        tf = identity();
        syncInputs();
        if (diff.width === 0 || diff.height === 0) return;
        markPartDirty(partId);
        pushHistoryRecord({ partId, tool: "transform", rectW: diff.width, rectH: diff.height });
        sessionStore.setState({ lastAppliedDiff: { partId, diff, phase: "after" } });
        const v = sessionStore.getState().layerSnapshotVersion ?? 0;
        sessionStore.setState({ layerSnapshotVersion: v + 1 });
        showToast(t("transform.appliedToast"), "info");
      })
      .catch((e: ApiError) => showToast(e?.message ?? String(e), "error"));
  });

  cancelBtn.addEventListener("click", () => {
    resetPreview();
  });

  function resetPreview(): void {
    const hadTransform = !isIdentity(tf);
    tf = identity();
    syncInputs();
    if (hadTransform && activePartId && activeLayerId) {
      const partId = activePartId;
      const layerId = activeLayerId;
      setLayerTransform(partId, layerId, null)
        .then(() => {
          const v = sessionStore.getState().layerSnapshotVersion ?? 0;
          sessionStore.setState({ layerSnapshotVersion: v + 1 });
        })
        .catch(() => undefined);
    }
  }

  // 切部件/切图层时放弃未应用的预览，刷新 active 图层引用。
  function refreshActiveLayer(): void {
    const partId = sessionStore.getState().currentPartId;
    if (partId === activePartId) {
      // 仅 active 图层可能变化时更新引用。
      if (!partId) { activeLayerId = null; syncInputs(); return; }
      getLayers(partId).then((snap) => {
        const id = snap.layers[snap.activeLayerIndex]?.id ?? null;
        if (id !== activeLayerId && !isIdentity(tf)) resetPreview();
        activeLayerId = id;
        syncInputs();
      }).catch(() => undefined);
      return;
    }
    if (!isIdentity(tf)) resetPreview();
    activePartId = partId;
    activeLayerId = null;
    if (!partId) { syncInputs(); return; }
    getLayers(partId).then((snap) => {
      activeLayerId = snap.layers[snap.activeLayerIndex]?.id ?? null;
      syncInputs();
    }).catch(() => undefined);
  }

  let lastPartId = sessionStore.getState().currentPartId;
  let lastLayerVer = sessionStore.getState().layerSnapshotVersion ?? 0;
  const unsub = sessionStore.subscribe(() => {
    const st = sessionStore.getState();
    const ver = st.layerSnapshotVersion ?? 0;
    if (st.currentPartId !== lastPartId || ver !== lastLayerVer) {
      lastPartId = st.currentPartId;
      lastLayerVer = ver;
      refreshActiveLayer();
    }
  });
  const unsubLang = subscribeLang(applyTexts);

  applyTexts();
  refreshActiveLayer();
  syncInputs();

  return () => {
    unsub();
    unsubLang();
  };
}
