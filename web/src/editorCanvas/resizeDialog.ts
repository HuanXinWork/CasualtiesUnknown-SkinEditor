// 修改部件分辨率弹窗（含低于 `baseSizes.json` 标准尺寸时的二次确认守卫）。

import { getBaseSize, resizePart, type ApiError } from "../apiClient";
import {
  bumpAssemblyOverrideVersion,
  bumpPartListVersion,
  markPartClean,
  parsePartId,
  partIdToTargetPath,
} from "../stateStore";
import { t } from "../i18n";
import { localizePartName } from "../i18n/partNames";
import { showToast } from "../toast";

export interface OpenResizeDialogOptions {
  skinRoot: string;
  partId: string;
  currentWidth: number;
  currentHeight: number;
  onResized: (width: number, height: number) => void;
}

export function openResizeDialog(opts: OpenResizeDialogOptions): Promise<void> {
  return new Promise<void>((resolve) => {
    const parsed = parsePartId(opts.partId);
    const targetPath = partIdToTargetPath(opts.skinRoot, opts.partId);
    if (!parsed || !targetPath) {
      resolve();
      return;
    }

    const overlay = document.createElement("div");
    overlay.dataset.modalOpen = "true";
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,0.45);display:flex;align-items:center;justify-content:center;";
    const shrinkFactors = [0.25, 0.5, 0.75];
    const enlargeFactors = [1, 2, 3, 4];
    const renderFactorBtn = (f: number): string =>
      `<button class="btn" data-role="factor" data-f="${f}" style="flex:1;">${f}×</button>`;

    overlay.innerHTML =
      `<div class="panel" style="min-width:340px;max-width:480px;padding:16px 20px;box-shadow:0 8px 24px rgba(0,0,0,0.3);font-size:13px;display:flex;flex-direction:column;gap:10px;">` +
      `<div data-role="title" style="font-weight:600;"></div>` +
      `<div data-role="hint" style="font-size:12px;opacity:0.75;"></div>` +
      `<div data-role="shrink-label" style="font-size:12px;opacity:0.85;"></div>` +
      `<div style="display:flex;gap:8px;">${shrinkFactors.map(renderFactorBtn).join("")}</div>` +
      `<div data-role="enlarge-label" style="font-size:12px;opacity:0.85;"></div>` +
      `<div style="display:flex;gap:8px;">${enlargeFactors.map(renderFactorBtn).join("")}</div>` +
      `<div style="display:flex;align-items:center;gap:8px;">` +
      `<span data-role="custom-label" style="font-size:12px;opacity:0.85;flex:none;"></span>` +
      `<input class="input" data-role="custom" type="number" min="0.01" max="1000" step="0.01" placeholder="0.01 ~ 1000" style="flex:1;" />` +
      `<button class="btn btn-primary" data-role="apply" style="flex:none;"></button>` +
      `</div>` +
      `<div style="display:flex;justify-content:flex-end;gap:8px;">` +
      `<button class="btn" data-role="cancel"></button>` +
      `</div></div>`;
    document.body.appendChild(overlay);

    overlay.querySelector<HTMLElement>('[data-role="title"]')!.textContent = t("editorCanvas.resizeTitle");
    overlay.querySelector<HTMLElement>('[data-role="hint"]')!.textContent = t("editorCanvas.resizeHint")
      .replace("{w}", String(opts.currentWidth))
      .replace("{h}", String(opts.currentHeight));
    overlay.querySelector<HTMLElement>('[data-role="shrink-label"]')!.textContent =
      t("editorCanvas.resizeShrinkLabel");
    overlay.querySelector<HTMLElement>('[data-role="enlarge-label"]')!.textContent =
      t("editorCanvas.resizeEnlargeLabel");
    overlay.querySelector<HTMLElement>('[data-role="custom-label"]')!.textContent =
      t("editorCanvas.resizeCustomLabel");

    const cancelBtn = overlay.querySelector<HTMLButtonElement>('[data-role="cancel"]')!;
    const applyBtn = overlay.querySelector<HTMLButtonElement>('[data-role="apply"]')!;
    const customInput = overlay.querySelector<HTMLInputElement>('[data-role="custom"]')!;
    cancelBtn.textContent = t("editorCanvas.resizeCancel");
    applyBtn.textContent = t("editorCanvas.resizeApply");

    const close = (): void => {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve();
    };
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    }
    document.addEventListener("keydown", onKey, true);
    cancelBtn.addEventListener("click", close);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close();
    });

    const doApply = (w: number, h: number): void => {
      overlay.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
        b.disabled = true;
      });
      customInput.disabled = true;
      resizePart(opts.partId, w, h, targetPath)
        .then((r) => {
          markPartClean(opts.partId);
          opts.onResized(r.width, r.height);
          bumpPartListVersion();
          bumpAssemblyOverrideVersion();
          showToast(`✓ ${localizePartName(parsed.partName)} ${r.width}×${r.height}`, "info");
          close();
        })
        .catch((e: ApiError) => {
          showToast(e?.message ?? String(e), "error");
          overlay.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
            b.disabled = false;
          });
          customInput.disabled = false;
        });
    };

    const confirmBelowBase = (w: number, h: number, baseW: number, baseH: number): void => {
      const dialog = document.createElement("div");
      dialog.dataset.modalOpen = "true";
      dialog.style.cssText =
        "position:fixed;inset:0;z-index:10002;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;";
      const hint = t("editorCanvas.resizeBelowBaseHint")
        .replace("{w}", String(w))
        .replace("{h}", String(h))
        .replace("{baseW}", String(baseW))
        .replace("{baseH}", String(baseH));
      dialog.innerHTML =
        `<div class="panel" style="min-width:340px;max-width:480px;padding:16px 20px;box-shadow:0 8px 24px rgba(0,0,0,0.3);font-size:13px;display:flex;flex-direction:column;gap:10px;">` +
        `<div data-role="c-title" style="font-weight:600;color:#dc3545;"></div>` +
        `<div data-role="c-hint" style="font-size:13px;line-height:1.5;"></div>` +
        `<div style="display:flex;justify-content:flex-end;gap:8px;">` +
        `<button class="btn" data-role="confirm-no"></button>` +
        `<button class="btn btn-primary" data-role="confirm-yes"></button>` +
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
        doApply(w, h);
      });
    };

    const submit = (factor: number): void => {
      if (!Number.isFinite(factor) || factor <= 0 || factor > 1000) {
        showToast(t("editorCanvas.resizeFactorInvalid"), "error");
        return;
      }
      const w = Math.max(1, Math.round(opts.currentWidth * factor));
      const h = Math.max(1, Math.round(opts.currentHeight * factor));
      if (w > 4096 || h > 4096) {
        showToast(t("editorCanvas.resizeInvalid"), "error");
        return;
      }
      getBaseSize(opts.skinRoot, parsed.skinName, parsed.category, parsed.partName)
        .then((base) => {
          if (base.found && (w < base.width || h < base.height)) {
            confirmBelowBase(w, h, base.width, base.height);
            return;
          }
          doApply(w, h);
        })
        .catch(() => doApply(w, h));
    };

    overlay.querySelectorAll<HTMLButtonElement>('[data-role="factor"]').forEach((btn) => {
      btn.addEventListener("click", () => submit(Number.parseFloat(btn.dataset.f ?? "1")));
    });
    const submitCustom = (): void => submit(Number.parseFloat(customInput.value));
    applyBtn.addEventListener("click", submitCustom);
    customInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitCustom();
      }
    });
  });
}
