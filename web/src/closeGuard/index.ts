// 未保存退出守卫。
// Tauri 模式：Rust on_window_event 在用户点 X 时 prevent_close 并设标志位；
// 本模块按 ~250ms 轮询 pollCloseRequest，发现 true 时根据 dirtyPartIds 决定行为：
//   - 全干净 → 直接 confirmCloseMain（放行关窗）
//   - 有未保存 → 弹模态确认框：保存并退出 / 不保存 / 取消
// Web 模式：注册 beforeunload，dirty 非空时返回字符串触发浏览器原生确认。

import { confirmCloseMain, pollCloseRequest, savePart, type ApiError } from "../apiClient";
import { getRuntimeMode } from "../runtimeMode";
import { sessionStore, markPartClean } from "../stateStore";
import { localizePartName } from "../i18n/partNames";
import { t } from "../i18n";
import { showToast } from "../toast";

const POLL_INTERVAL_MS = 250;

export interface CloseGuardContext {
  /** 编辑器使用的皮肤根目录，与 main.ts 里 DEFAULT_SKIN_ROOT 同源。 */
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
    const dirty = sessionStore.getState().dirtyPartIds;
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
      // saveAndExit
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
    const parts = partId.split("::");
    if (parts.length !== 3) {
      failed.push(partId);
      continue;
    }
    const [skinName, categoryDir, partName] = parts;
    const target = `${skinRoot}/${skinName}/${categoryDir}/${partName}.png`;
    try {
      await savePart(partId, target);
      markPartClean(partId);
      saved.push(partId);
    } catch (e) {
      console.warn("[closeGuard] savePart failed", (e as ApiError)?.message ?? e);
      failed.push(localizePartName(partName));
    }
  }
  return { saved, failed };
}

type Decision = "saveAndExit" | "discard" | "cancel";

function showCloseDialog(dirtyPartIds: string[], onDecision: (d: Decision) => void): void {
  const overlay = document.createElement("div");
  overlay.className = "close-guard-overlay";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:2000;" +
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
    "background:rgba(0,0,0,0.04);border-radius:4px;list-style:disc inside;";
  for (const partId of dirtyPartIds) {
    const li = document.createElement("li");
    const tail = partId.split("::").pop() ?? partId;
    li.textContent = localizePartName(tail);
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

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(discardBtn);
  btnRow.appendChild(saveBtn);
  card.appendChild(titleEl);
  card.appendChild(bodyEl);
  card.appendChild(listEl);
  card.appendChild(btnRow);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  function close(decision: Decision): void {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    onDecision(decision);
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close("cancel");
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
