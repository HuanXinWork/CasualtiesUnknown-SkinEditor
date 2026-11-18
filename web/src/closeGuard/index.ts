// 退出未保存守卫（Tauri 轮询窗口关闭拦截标志；Web 模式绑定 beforeunload）。

import { confirmCloseMain, pollCloseRequest, savePart, type ApiError } from "../apiClient";
import { getRuntimeMode } from "../runtimeMode";
import {
  getPartDirtyRevision,
  markPartClean,
  parsePartId,
  partIdToTargetPath,
  sessionStore,
} from "../stateStore";
import { localizePartName } from "../i18n/partNames";
import { t } from "../i18n";
import { showToast } from "../toast";

const POLL_INTERVAL_MS = 250;

export interface CloseGuardContext {
  skinRoot: string;
}

export function attachCloseGuard(ctx: CloseGuardContext): () => void {
  if (getRuntimeMode() === "tauri") {
    return attachTauriCloseGuard(ctx);
  }
  return attachWebCloseGuard();
}

function attachTauriCloseGuard(ctx: CloseGuardContext): () => void {
  let stopped = false;
  let dialogOpen = false;
  const timer = window.setInterval(async () => {
    if (stopped || dialogOpen) return;
    const requested = await pollCloseRequest();
    if (!requested) return;
    const dirty = [...sessionStore.getState().dirtyPartIds];
    if (dirty.length === 0) {
      void confirmCloseMain();
      return;
    }
    dialogOpen = true;
    showCloseDialog(dirty, async (decision) => {
      dialogOpen = false;
      if (decision === "cancel") return;
      if (decision === "discard") {
        void confirmCloseMain();
        return;
      }
      const result = await saveAllDirty(ctx.skinRoot, dirty);
      if (result.failed.length > 0) {
        showToast(t("editorCanvas.saveAllFailedPrefix") + result.failed.join(", "), "error");
        return;
      }
      void confirmCloseMain();
    });
  }, POLL_INTERVAL_MS);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

function attachWebCloseGuard(): () => void {
  const handler = (e: BeforeUnloadEvent): string | undefined => {
    if (sessionStore.getState().dirtyPartIds.length === 0) return undefined;
    e.preventDefault();
    e.returnValue = "";
    return "";
  };
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}

interface SaveAllResult {
  saved: string[];
  failed: string[];
}

async function saveAllDirty(skinRoot: string, partIds: string[]): Promise<SaveAllResult> {
  const saved: string[] = [];
  const failed: string[] = [];
  for (const partId of partIds) {
    const parsed = parsePartId(partId);
    const target = partIdToTargetPath(skinRoot, partId);
    if (!parsed || !target) {
      failed.push(partId);
      continue;
    }
    const rev = getPartDirtyRevision(partId);
    try {
      await savePart(partId, target);
      markPartClean(partId, rev);
      saved.push(partId);
    } catch (e) {
      console.warn("[closeGuard] savePart failed", (e as ApiError)?.message ?? e);
      failed.push(localizePartName(parsed.partName));
    }
  }
  return { saved, failed };
}

type Decision = "saveAndExit" | "discard" | "cancel";

function showCloseDialog(dirtyPartIds: string[], onDecision: (d: Decision) => void): void {
  const overlay = document.createElement("div");
  overlay.className = "close-guard-overlay";
  overlay.dataset.modalOpen = "true";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:2000;" +
    "display:flex;align-items:center;justify-content:center;";

  const card = document.createElement("div");
  card.className = "panel close-guard-card";
  card.style.cssText =
    "min-width:360px;max-width:520px;padding:16px 20px;display:flex;flex-direction:column;gap:12px;";

  const titleEl = document.createElement("div");
  titleEl.style.cssText = "font-size:14px;font-weight:600;";
  titleEl.textContent = t("editorCanvas.closeConfirmTitle");

  const bodyEl = document.createElement("div");
  bodyEl.style.cssText = "font-size:12px;opacity:0.85;";
  bodyEl.textContent = t("editorCanvas.closeConfirmBody");

  const listEl = document.createElement("ul");
  listEl.style.cssText =
    "max-height:160px;overflow:auto;padding:6px 12px;margin:0;font-size:12px;" +
    "background:rgba(var(--border-rgb),0.06);border-radius:4px;list-style:disc inside;";
  for (const partId of dirtyPartIds) {
    const li = document.createElement("li");
    const parsed = parsePartId(partId);
    li.textContent = parsed ? `${parsed.skinName} / ${localizePartName(parsed.partName)}` : partId;
    listEl.appendChild(li);
  }

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = t("editorCanvas.closeCancel");

  const discardBtn = document.createElement("button");
  discardBtn.className = "btn";
  discardBtn.textContent = t("editorCanvas.closeDiscard");

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = t("editorCanvas.closeSaveAndExit");

  btnRow.append(cancelBtn, discardBtn, saveBtn);
  card.append(titleEl, bodyEl, listEl, btnRow);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function close(decision: Decision): void {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    onDecision(decision);
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close("cancel");
    }
  }
  cancelBtn.addEventListener("click", () => close("cancel"));
  discardBtn.addEventListener("click", () => close("discard"));
  saveBtn.addEventListener("click", () => close("saveAndExit"));
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close("cancel");
  });
  document.addEventListener("keydown", onKey, true);
  saveBtn.focus();
}
