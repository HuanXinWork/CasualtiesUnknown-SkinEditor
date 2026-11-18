// 当前活动图层变换控件（翻转/缩放/旋转实时预览，应用烘焙入历史栈，取消还原）。
import {
  bakeLayerTransform,
  getLayers,
  setLayerTransform,
  type ApiError,
  type LayerTransform,
} from "../apiClient";
import {
  bumpLayerSnapshotVersion,
  markPartDirty,
  pushHistoryRecord,
  sessionStore,
} from "../stateStore";
import { subscribeLang, t } from "../i18n";
import { showToast } from "../toast";

function identity(): LayerTransform {
  return { flipX: false, flipY: false, scaleX: 1, scaleY: 1, rotationDeg: 0 };
}

function isIdentity(tf: LayerTransform): boolean {
  return (
    !tf.flipX &&
    !tf.flipY &&
    Math.abs(tf.scaleX - 1) < 1e-4 &&
    Math.abs(tf.scaleY - 1) < 1e-4 &&
    Math.abs(tf.rotationDeg) < 1e-4
  );
}

export function mountTransformControls(container: HTMLElement): () => void {
  container.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12px;";
  container.innerHTML =
    `<span data-role="label" style="opacity:0.7;"></span>` +
    `<button class="btn" data-role="flipH"></button>` +
    `<button class="btn" data-role="flipV"></button>` +
    `<label style="display:flex;align-items:center;gap:3px;"><span data-role="sxLabel"></span><input class="input" type="number" data-role="sx" step="0.05" style="width:56px;" /></label>` +
    `<label style="display:flex;align-items:center;gap:3px;"><span data-role="syLabel"></span><input class="input" type="number" data-role="sy" step="0.05" style="width:56px;" /></label>` +
    `<label style="display:flex;align-items:center;gap:3px;"><span data-role="rotLabel"></span><input class="input" type="number" data-role="rot" step="1" style="width:60px;" /></label>` +
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
  let querySeq = 0;

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

  function syncActionButtons(): void {
    flipHBtn.classList.toggle("btn-primary", tf.flipX);
    flipVBtn.classList.toggle("btn-primary", tf.flipY);
    const has = !isIdentity(tf);
    applyBtn.disabled = !has || !activeLayerId;
    cancelBtn.disabled = !has || !activeLayerId;
  }

  function syncInputs(): void {
    sxInput.value = String(tf.scaleX);
    syInput.value = String(tf.scaleY);
    rotInput.value = String(tf.rotationDeg);
    syncActionButtons();
  }

  function pushPreview(): void {
    if (!activePartId || !activeLayerId) return;
    const partId = activePartId;
    const layerId = activeLayerId;
    const payload = isIdentity(tf) ? null : { ...tf };
    setLayerTransform(partId, layerId, payload)
      .then(() => bumpLayerSnapshotVersion())
      .catch((e: ApiError) => console.warn(`[transform] setLayerTransform failed: ${e?.message ?? String(e)}`));
  }

  flipHBtn.addEventListener("click", () => {
    tf.flipX = !tf.flipX;
    syncInputs();
    pushPreview();
  });
  flipVBtn.addEventListener("click", () => {
    tf.flipY = !tf.flipY;
    syncInputs();
    pushPreview();
  });

  // 输入过程仅在解析出有效非零缩放时推送预览，不覆写用户正在敲击的小数点或负号。
  sxInput.addEventListener("input", () => {
    const v = Number.parseFloat(sxInput.value);
    if (Number.isFinite(v) && Math.abs(v) >= 0.05) {
      tf.scaleX = v;
      syncActionButtons();
      pushPreview();
    }
  });
  sxInput.addEventListener("change", () => {
    const v = Number.parseFloat(sxInput.value);
    tf.scaleX = Number.isFinite(v) && Math.abs(v) >= 0.05 ? v : 1;
    syncInputs();
    pushPreview();
  });

  syInput.addEventListener("input", () => {
    const v = Number.parseFloat(syInput.value);
    if (Number.isFinite(v) && Math.abs(v) >= 0.05) {
      tf.scaleY = v;
      syncActionButtons();
      pushPreview();
    }
  });
  syInput.addEventListener("change", () => {
    const v = Number.parseFloat(syInput.value);
    tf.scaleY = Number.isFinite(v) && Math.abs(v) >= 0.05 ? v : 1;
    syncInputs();
    pushPreview();
  });

  rotInput.addEventListener("input", () => {
    const v = Number.parseFloat(rotInput.value);
    if (Number.isFinite(v)) {
      tf.rotationDeg = v;
      syncActionButtons();
      pushPreview();
    }
  });
  rotInput.addEventListener("change", () => {
    const v = Number.parseFloat(rotInput.value);
    tf.rotationDeg = Number.isFinite(v) ? v : 0;
    syncInputs();
    pushPreview();
  });

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
        bumpLayerSnapshotVersion();
        showToast(t("transform.appliedToast"), "info");
      })
      .catch((e: ApiError) => showToast(e?.message ?? String(e), "error"));
  });

  cancelBtn.addEventListener("click", () => resetPreview());

  function resetPreview(): void {
    const hadTransform = !isIdentity(tf);
    tf = identity();
    syncInputs();
    if (hadTransform && activePartId && activeLayerId) {
      const partId = activePartId;
      const layerId = activeLayerId;
      setLayerTransform(partId, layerId, null)
        .then(() => bumpLayerSnapshotVersion())
        .catch(() => undefined);
    }
  }

  function refreshActiveLayer(): void {
    const partId = sessionStore.getState().currentPartId;
    const seq = ++querySeq;
    if (partId === activePartId) {
      if (!partId) {
        activeLayerId = null;
        syncInputs();
        return;
      }
      getLayers(partId)
        .then((snap) => {
          if (seq !== querySeq || activePartId !== partId) return;
          const id = snap.layers[snap.activeLayerIndex]?.id ?? null;
          if (id !== activeLayerId && !isIdentity(tf)) resetPreview();
          activeLayerId = id;
          syncInputs();
        })
        .catch(() => undefined);
      return;
    }
    if (!isIdentity(tf)) resetPreview();
    activePartId = partId;
    activeLayerId = null;
    if (!partId) {
      syncInputs();
      return;
    }
    getLayers(partId)
      .then((snap) => {
        if (seq !== querySeq || activePartId !== partId) return;
        activeLayerId = snap.layers[snap.activeLayerIndex]?.id ?? null;
        syncInputs();
      })
      .catch(() => undefined);
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
