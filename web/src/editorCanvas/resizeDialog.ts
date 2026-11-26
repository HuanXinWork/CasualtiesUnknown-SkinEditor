// 双 Tab 画布大小弹窗：Tab 1 为无损裁剪/扩展画布，Tab 2 为最近邻重采样缩放分辨率。

import {
  getBaseSize,
  getFlatten,
  resizeCanvas,
  resizePart,
  type ApiError,
} from "../apiClient";
import {
  bumpAssemblyOverrideVersion,
  bumpCanvasSizeVersion,
  bumpPartListVersion,
  markPartClean,
  markPartDirty,
  parsePartId,
  partIdToTargetPath,
  pushHistoryRecord,
} from "../stateStore";
import { t } from "../i18n";
import { localizePartName } from "../i18n/partNames";
import { showToast } from "../toast";

const MAX_DIM = 4096;

export interface OpenResizeDialogOptions {
  skinRoot: string;
  partId: string;
  currentWidth: number;
  currentHeight: number;
  initialTab?: "canvas" | "resample";
  onResized: (width: number, height: number) => void;
  onCanvasResized?: (width: number, height: number, baseSize: [number, number] | null) => void;
}

const ANCHOR_SYMBOLS = ["↖", "↑", "↗", "←", "●", "→", "↙", "↓", "↘"] as const;

function formatDelta(v: number): string {
  const rounded = Math.round(v * 2) / 2;
  if (Math.abs(rounded) < 1e-6) return "0";
  const sign = rounded > 0 ? "+" : "";
  return Number.isInteger(rounded) ? `${sign}${rounded}` : `${sign}${rounded.toFixed(1)}`;
}

function calcAnchorOffset(oldSize: number, newSize: number, align: 0 | 1 | 2): number {
  if (align === 0) return 0;
  if (align === 2) return newSize - oldSize;
  return Math.trunc((newSize - oldSize) / 2);
}

export function openResizeDialog(opts: OpenResizeDialogOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    const parsed = parsePartId(opts.partId);
    const targetPath = partIdToTargetPath(opts.skinRoot, opts.partId);
    if (!parsed || !targetPath) {
      resolve();
      return;
    }
    const partInfo = parsed;

    const overlay = document.createElement("div");
    overlay.className = "modal-mask";
    overlay.dataset.modalOpen = "true";

    const shrinkFactors = [0.25, 0.5, 0.75];
    const enlargeFactors = [1, 2, 3, 4];
    const renderFactorBtn = (f: number): string =>
      `<button type="button" class="btn" data-role="factor" data-f="${f}" style="flex:1;">${f}×</button>`;
    const renderAnchorCells = (): string =>
      ANCHOR_SYMBOLS.map(
        (sym, i) =>
          `<button type="button" class="anchor-cell${i === 4 ? " active" : ""}" data-role="anchor" data-col="${i % 3}" data-row="${Math.floor(i / 3)}">${sym}</button>`,
      ).join("");

    overlay.innerHTML =
      `<div class="modal-card">` +
      `<div class="modal-tabs">` +
      `<button type="button" class="modal-tab active" data-tab="canvas"></button>` +
      `<button type="button" class="modal-tab" data-tab="resample"></button>` +
      `</div>` +
      `<div data-pane="canvas" style="display:flex;flex-direction:column;gap:10px;">` +
      `<div data-role="cv-hint" style="font-size:12px;opacity:0.78;"></div>` +
      `<div style="display:flex;gap:10px;align-items:center;">` +
      `<label style="flex:1;display:flex;align-items:center;gap:6px;">` +
      `<span data-role="cv-w-label" style="min-width:2.5ch;"></span>` +
      `<input class="input mono" data-role="cv-w" type="number" min="1" max="${MAX_DIM}" step="1" style="flex:1;min-width:0;" />` +
      `</label>` +
      `<label style="flex:1;display:flex;align-items:center;gap:6px;">` +
      `<span data-role="cv-h-label" style="min-width:2.5ch;"></span>` +
      `<input class="input mono" data-role="cv-h" type="number" min="1" max="${MAX_DIM}" step="1" style="flex:1;min-width:0;" />` +
      `</label>` +
      `</div>` +
      `<div style="display:flex;gap:6px;flex-wrap:wrap;">` +
      `<button type="button" class="btn" data-role="cv-exp2" style="font-size:12px;padding:3px 8px;"></button>` +
      `<button type="button" class="btn" data-role="cv-exp4" style="font-size:12px;padding:3px 8px;"></button>` +
      `<button type="button" class="btn" data-role="cv-crop2" style="font-size:12px;padding:3px 8px;"></button>` +
      `<button type="button" class="btn" data-role="cv-trim" style="font-size:12px;padding:3px 8px;"></button>` +
      `</div>` +
      `<div style="display:flex;gap:14px;align-items:flex-start;">` +
      `<div style="display:flex;flex-direction:column;gap:4px;">` +
      `<span data-role="cv-anchor-label" style="font-size:12px;opacity:0.8;"></span>` +
      `<div class="anchor-grid">${renderAnchorCells()}</div>` +
      `</div>` +
      `<div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:6px;padding-top:18px;">` +
      `<div class="mono" data-role="cv-offset" style="font-size:12px;opacity:0.82;"></div>` +
      `<div data-role="cv-pivot-status" class="badge badge-ok" style="white-space:normal;align-items:flex-start;"></div>` +
      `</div>` +
      `</div>` +
      `<div style="display:flex;flex-direction:column;gap:3px;padding:8px 10px;border-radius:6px;background:rgba(var(--border-rgb),0.05);">` +
      `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;">` +
      `<input type="checkbox" data-role="cv-sync-base" />` +
      `<span data-role="cv-sync-label" style="font-weight:500;"></span>` +
      `</label>` +
      `<div data-role="cv-sync-hint" style="font-size:11px;opacity:0.72;padding-left:22px;line-height:1.45;"></div>` +
      `</div>` +
      `<div style="display:flex;justify-content:flex-end;gap:8px;">` +
      `<button type="button" class="btn" data-role="cv-cancel"></button>` +
      `<button type="button" class="btn btn-primary" data-role="cv-apply"></button>` +
      `</div>` +
      `</div>` +
      `<div data-pane="resample" style="display:none;flex-direction:column;gap:10px;">` +
      `<div data-role="hint" style="font-size:12px;opacity:0.75;"></div>` +
      `<div data-role="shrink-label" style="font-size:12px;opacity:0.85;"></div>` +
      `<div style="display:flex;gap:8px;">${shrinkFactors.map(renderFactorBtn).join("")}</div>` +
      `<div data-role="enlarge-label" style="font-size:12px;opacity:0.85;"></div>` +
      `<div style="display:flex;gap:8px;">${enlargeFactors.map(renderFactorBtn).join("")}</div>` +
      `<div style="display:flex;align-items:center;gap:8px;">` +
      `<span data-role="custom-label" style="font-size:12px;opacity:0.85;flex:none;"></span>` +
      `<input class="input" data-role="custom" type="number" min="0.01" max="1000" step="0.01" placeholder="0.01 ~ 1000" style="flex:1;" />` +
      `<button type="button" class="btn btn-primary" data-role="apply" style="flex:none;"></button>` +
      `</div>` +
      `<div style="display:flex;justify-content:flex-end;gap:8px;">` +
      `<button type="button" class="btn" data-role="cancel"></button>` +
      `</div>` +
      `</div>` +
      `</div>`;
    document.body.appendChild(overlay);

    const tabCanvasBtn = overlay.querySelector<HTMLButtonElement>('[data-tab="canvas"]')!;
    const tabResampleBtn = overlay.querySelector<HTMLButtonElement>('[data-tab="resample"]')!;
    const paneCanvas = overlay.querySelector<HTMLDivElement>('[data-pane="canvas"]')!;
    const paneResample = overlay.querySelector<HTMLDivElement>('[data-pane="resample"]')!;

    const cvWInput = overlay.querySelector<HTMLInputElement>('[data-role="cv-w"]')!;
    const cvHInput = overlay.querySelector<HTMLInputElement>('[data-role="cv-h"]')!;
    const cvExp2Btn = overlay.querySelector<HTMLButtonElement>('[data-role="cv-exp2"]')!;
    const cvExp4Btn = overlay.querySelector<HTMLButtonElement>('[data-role="cv-exp4"]')!;
    const cvCrop2Btn = overlay.querySelector<HTMLButtonElement>('[data-role="cv-crop2"]')!;
    const cvTrimBtn = overlay.querySelector<HTMLButtonElement>('[data-role="cv-trim"]')!;
    const cvOffsetEl = overlay.querySelector<HTMLDivElement>('[data-role="cv-offset"]')!;
    const cvPivotEl = overlay.querySelector<HTMLDivElement>('[data-role="cv-pivot-status"]')!;
    const cvSyncBaseCb = overlay.querySelector<HTMLInputElement>('[data-role="cv-sync-base"]')!;
    const cvApplyBtn = overlay.querySelector<HTMLButtonElement>('[data-role="cv-apply"]')!;
    const cvCancelBtn = overlay.querySelector<HTMLButtonElement>('[data-role="cv-cancel"]')!;
    const anchorBtns = Array.from(overlay.querySelectorAll<HTMLButtonElement>('[data-role="anchor"]'));

    const cancelBtn = overlay.querySelector<HTMLButtonElement>('[data-role="cancel"]')!;
    const applyBtn = overlay.querySelector<HTMLButtonElement>('[data-role="apply"]')!;
    const customInput = overlay.querySelector<HTMLInputElement>('[data-role="custom"]')!;

    tabCanvasBtn.textContent = t("editorCanvas.resizeTabCanvas");
    tabResampleBtn.textContent = t("editorCanvas.resizeTabResample");
    overlay.querySelector<HTMLElement>('[data-role="cv-hint"]')!.textContent = t(
      "editorCanvas.canvasCurrentHint",
    )
      .replace("{w}", String(opts.currentWidth))
      .replace("{h}", String(opts.currentHeight));
    overlay.querySelector<HTMLElement>('[data-role="cv-w-label"]')!.textContent =
      t("editorCanvas.canvasWidth");
    overlay.querySelector<HTMLElement>('[data-role="cv-h-label"]')!.textContent =
      t("editorCanvas.canvasHeight");
    cvExp2Btn.textContent = t("editorCanvas.canvasQuickExpand2");
    cvExp4Btn.textContent = t("editorCanvas.canvasQuickExpand4");
    cvCrop2Btn.textContent = t("editorCanvas.canvasQuickCrop2");
    cvTrimBtn.textContent = t("editorCanvas.canvasAutoTrim");
    overlay.querySelector<HTMLElement>('[data-role="cv-anchor-label"]')!.textContent =
      t("editorCanvas.canvasAnchorLabel");
    overlay.querySelector<HTMLElement>('[data-role="cv-sync-label"]')!.textContent =
      t("editorCanvas.canvasSyncBaseLabel");
    overlay.querySelector<HTMLElement>('[data-role="cv-sync-hint"]')!.textContent =
      t("editorCanvas.canvasSyncBaseHint");
    cvApplyBtn.textContent = t("editorCanvas.canvasApply");
    cvCancelBtn.textContent = t("editorCanvas.resizeCancel");

    overlay.querySelector<HTMLElement>('[data-role="hint"]')!.textContent = t(
      "editorCanvas.resizeHint",
    )
      .replace("{w}", String(opts.currentWidth))
      .replace("{h}", String(opts.currentHeight));
    overlay.querySelector<HTMLElement>('[data-role="shrink-label"]')!.textContent =
      t("editorCanvas.resizeShrinkLabel");
    overlay.querySelector<HTMLElement>('[data-role="enlarge-label"]')!.textContent =
      t("editorCanvas.resizeEnlargeLabel");
    overlay.querySelector<HTMLElement>('[data-role="custom-label"]')!.textContent =
      t("editorCanvas.resizeCustomLabel");
    cancelBtn.textContent = t("editorCanvas.resizeCancel");
    applyBtn.textContent = t("editorCanvas.resizeApply");

    // 同步更新 baseSizes.json 默认不勾选，避免无意更改游戏内缩放基准。
    cvSyncBaseCb.checked = false;
    cvWInput.value = String(opts.currentWidth);
    cvHInput.value = String(opts.currentHeight);

    let anchorCol: 0 | 1 | 2 = 1;
    let anchorRow: 0 | 1 | 2 = 1;
    // 自动紧裁产生的精确偏移覆盖；一旦用户手动修改尺寸或点击九宫格锚点即清除。
    let explicitOffset: { x: number; y: number } | null = null;
    let activeTab: "canvas" | "resample" = opts.initialTab ?? "canvas";

    function switchTab(next: "canvas" | "resample"): void {
      activeTab = next;
      tabCanvasBtn.classList.toggle("active", next === "canvas");
      tabResampleBtn.classList.toggle("active", next === "resample");
      paneCanvas.style.display = next === "canvas" ? "flex" : "none";
      paneResample.style.display = next === "resample" ? "flex" : "none";
    }
    tabCanvasBtn.addEventListener("click", () => switchTab("canvas"));
    tabResampleBtn.addEventListener("click", () => switchTab("resample"));
    switchTab(activeTab);

    function currentCanvasValues(): { w: number; h: number; ox: number; oy: number } {
      const w = Number.parseInt(cvWInput.value, 10);
      const h = Number.parseInt(cvHInput.value, 10);
      const safeW = Number.isFinite(w) ? w : opts.currentWidth;
      const safeH = Number.isFinite(h) ? h : opts.currentHeight;
      const ox =
        explicitOffset !== null
          ? explicitOffset.x
          : calcAnchorOffset(opts.currentWidth, safeW, anchorCol);
      const oy =
        explicitOffset !== null
          ? explicitOffset.y
          : calcAnchorOffset(opts.currentHeight, safeH, anchorRow);
      return { w: safeW, h: safeH, ox, oy };
    }

    function updateCanvasPreview(): void {
      const { w, h, ox, oy } = currentCanvasValues();
      cvOffsetEl.textContent = t("editorCanvas.canvasOffsetReadout")
        .replace("{ox}", String(ox))
        .replace("{oy}", String(oy));
      const dx = ox + (opts.currentWidth - w) / 2;
      const dy = oy + (opts.currentHeight - h) / 2;
      const shifted = Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4;
      cvPivotEl.className = shifted ? "badge badge-warn" : "badge badge-ok";
      cvPivotEl.textContent = shifted
        ? t("editorCanvas.canvasPivotWarn")
            .replace("{dx}", formatDelta(dx))
            .replace("{dy}", formatDelta(dy))
        : t("editorCanvas.canvasPivotOk");
      for (const btn of anchorBtns) {
        const col = Number(btn.dataset.col);
        const row = Number(btn.dataset.row);
        btn.classList.toggle("active", explicitOffset === null && col === anchorCol && row === anchorRow);
      }
    }

    function setAnchor(col: 0 | 1 | 2, row: 0 | 1 | 2): void {
      anchorCol = col;
      anchorRow = row;
      explicitOffset = null;
      updateCanvasPreview();
    }

    for (const btn of anchorBtns) {
      btn.addEventListener("click", () => {
        setAnchor(
          Number(btn.dataset.col) as 0 | 1 | 2,
          Number(btn.dataset.row) as 0 | 1 | 2,
        );
      });
    }

    cvWInput.addEventListener("input", () => {
      explicitOffset = null;
      updateCanvasPreview();
    });
    cvHInput.addEventListener("input", () => {
      explicitOffset = null;
      updateCanvasPreview();
    });

    function adjustSymmetric(deltaEachSide: number): void {
      const curW = Math.max(1, Number.parseInt(cvWInput.value, 10) || opts.currentWidth);
      const curH = Math.max(1, Number.parseInt(cvHInput.value, 10) || opts.currentHeight);
      const nextW = Math.max(1, Math.min(MAX_DIM, curW + deltaEachSide * 2));
      const nextH = Math.max(1, Math.min(MAX_DIM, curH + deltaEachSide * 2));
      cvWInput.value = String(nextW);
      cvHInput.value = String(nextH);
      setAnchor(1, 1);
    }

    cvExp2Btn.addEventListener("click", () => adjustSymmetric(2));
    cvExp4Btn.addEventListener("click", () => adjustSymmetric(4));
    cvCrop2Btn.addEventListener("click", () => adjustSymmetric(-2));

    cvTrimBtn.addEventListener("click", () => {
      cvTrimBtn.disabled = true;
      getFlatten(opts.partId)
        .then((res) => {
          let minX = res.width;
          let minY = res.height;
          let maxX = -1;
          let maxY = -1;
          const px = res.pixels;
          for (let y = 0; y < res.height; y++) {
            for (let x = 0; x < res.width; x++) {
              if (px[(y * res.width + x) * 4 + 3] > 0) {
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
              }
            }
          }
          if (maxX < minX || maxY < minY) {
            showToast(t("editorCanvas.canvasAutoTrimEmpty"), "warn");
            return;
          }
          cvWInput.value = String(maxX - minX + 1);
          cvHInput.value = String(maxY - minY + 1);
          explicitOffset = { x: -minX, y: -minY };
          updateCanvasPreview();
        })
        .catch((e: ApiError) => showToast(e?.message ?? String(e), "error"))
        .finally(() => {
          cvTrimBtn.disabled = false;
        });
    });

    function setAllDisabled(disabled: boolean): void {
      overlay.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
        b.disabled = disabled;
      });
      overlay.querySelectorAll<HTMLInputElement>("input").forEach((i) => {
        i.disabled = disabled;
      });
    }

    const close = (): void => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve();
    };

    function submitCanvasResize(): void {
      const { w, h, ox, oy } = currentCanvasValues();
      if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w > MAX_DIM || h > MAX_DIM) {
        showToast(t("editorCanvas.resizeInvalid"), "error");
        return;
      }
      if (w === opts.currentWidth && h === opts.currentHeight && ox === 0 && oy === 0 && !cvSyncBaseCb.checked) {
        showToast(t("editorCanvas.cropNoChange"), "info");
        close();
        return;
      }
      setAllDisabled(true);
      resizeCanvas({
        partId: opts.partId,
        width: w,
        height: h,
        offsetX: ox,
        offsetY: oy,
        syncBaseSize: cvSyncBaseCb.checked,
      })
        .then((r) => {
          markPartDirty(opts.partId);
          pushHistoryRecord({
            partId: opts.partId,
            tool: "resizeCanvas",
            rectW: r.width,
            rectH: r.height,
          });
          bumpCanvasSizeVersion({ partId: opts.partId, width: r.width, height: r.height });
          opts.onCanvasResized?.(r.width, r.height, r.baseSize);
          showToast(`✓ ${localizePartName(partInfo.partName)} ${r.width}×${r.height}`, "info");
          close();
        })
        .catch((e: ApiError) => {
          showToast(e?.message ?? String(e), "error");
          setAllDisabled(false);
        });
    }

    cvApplyBtn.addEventListener("click", submitCanvasResize);
    cvCancelBtn.addEventListener("click", close);

    const doResample = (w: number, h: number): void => {
      setAllDisabled(true);
      resizePart(opts.partId, w, h, targetPath)
        .then((r) => {
          markPartClean(opts.partId);
          opts.onResized(r.width, r.height);
          bumpPartListVersion();
          bumpAssemblyOverrideVersion();
          bumpCanvasSizeVersion({ partId: opts.partId, width: r.width, height: r.height });
          showToast(`✓ ${localizePartName(partInfo.partName)} ${r.width}×${r.height}`, "info");
          close();
        })
        .catch((e: ApiError) => {
          showToast(e?.message ?? String(e), "error");
          setAllDisabled(false);
        });
    };

    const confirmBelowBase = (w: number, h: number, baseW: number, baseH: number): void => {
      const dialog = document.createElement("div");
      dialog.className = "modal-mask";
      dialog.style.zIndex = "10002";
      dialog.dataset.modalOpen = "true";
      const hint = t("editorCanvas.resizeBelowBaseHint")
        .replace("{w}", String(w))
        .replace("{h}", String(h))
        .replace("{baseW}", String(baseW))
        .replace("{baseH}", String(baseH));
      dialog.innerHTML =
        `<div class="modal-card" style="max-width:460px;">` +
        `<div data-role="c-title" style="font-weight:600;color:var(--danger-color);"></div>` +
        `<div data-role="c-hint" style="font-size:13px;line-height:1.5;"></div>` +
        `<div style="display:flex;justify-content:flex-end;gap:8px;">` +
        `<button type="button" class="btn" data-role="confirm-no"></button>` +
        `<button type="button" class="btn btn-primary" data-role="confirm-yes"></button>` +
        `</div></div>`;
      document.body.appendChild(dialog);
      dialog.querySelector<HTMLElement>('[data-role="c-title"]')!.textContent =
        t("editorCanvas.resizeBelowBaseTitle");
      dialog.querySelector<HTMLElement>('[data-role="c-hint"]')!.textContent = hint;
      const yesBtn = dialog.querySelector<HTMLButtonElement>('[data-role="confirm-yes"]')!;
      const noBtn = dialog.querySelector<HTMLButtonElement>('[data-role="confirm-no"]')!;
      yesBtn.textContent = t("editorCanvas.resizeBelowBaseYes");
      noBtn.textContent = t("editorCanvas.resizeBelowBaseNo");
      const closeDialog = (): void => dialog.remove();
      noBtn.addEventListener("click", closeDialog);
      dialog.addEventListener("mousedown", (e) => {
        if (e.target === dialog) closeDialog();
      });
      yesBtn.addEventListener("click", () => {
        closeDialog();
        doResample(w, h);
      });
    };

    const submitResample = (factor: number): void => {
      if (!Number.isFinite(factor) || factor <= 0 || factor > 1000) {
        showToast(t("editorCanvas.resizeFactorInvalid"), "error");
        return;
      }
      const w = Math.max(1, Math.round(opts.currentWidth * factor));
      const h = Math.max(1, Math.round(opts.currentHeight * factor));
      if (w > MAX_DIM || h > MAX_DIM) {
        showToast(t("editorCanvas.resizeInvalid"), "error");
        return;
      }
      getBaseSize(opts.skinRoot, partInfo.skinName, partInfo.category, partInfo.partName)
        .then((base) => {
          if (base.found && (w < base.width || h < base.height)) {
            confirmBelowBase(w, h, base.width, base.height);
            return;
          }
          doResample(w, h);
        })
        .catch(() => doResample(w, h));
    };

    overlay.querySelectorAll<HTMLButtonElement>('[data-role="factor"]').forEach((btn) => {
      btn.addEventListener("click", () => submitResample(Number.parseFloat(btn.dataset.f ?? "1")));
    });
    const submitCustom = (): void => submitResample(Number.parseFloat(customInput.value));
    applyBtn.addEventListener("click", submitCustom);
    cancelBtn.addEventListener("click", close);

    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      } else if (
        e.key === "Enter" &&
        activeTab === "canvas" &&
        !(e.target instanceof HTMLButtonElement)
      ) {
        e.preventDefault();
        e.stopPropagation();
        submitCanvasResize();
      }
    }
    document.addEventListener("keydown", onKey, true);
    customInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitCustom();
      }
    });
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close();
    });

    updateCanvasPreview();
  });
}
