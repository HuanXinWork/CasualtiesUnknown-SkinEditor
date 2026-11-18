// 未保存改动守卫：供切换部件、切换皮肤、导入皮肤包等操作统一拦截未落盘编辑。

import { discardPart, savePart, type ApiError } from "../apiClient";
import {
  bumpAssemblyOverrideVersion,
  getPartDirtyRevision,
  isPartDirty,
  markPartClean,
  partIdToTargetPath,
  sessionStore,
} from "../stateStore";
import { updateWorkspaceSettings } from "../stateStore/workspacePersist";
import type { PartCategory } from "../stateStore/types";
import { showToast } from "../toast";
import { t } from "../i18n";

const WORKSPACE_PATH = "data/workspace.json";

type Behavior = "auto" | "save";

export interface SwitchTarget {
  partName: string;
  category: PartCategory;
}

async function saveCurrent(skinRoot: string, partId: string): Promise<void> {
  const target = partIdToTargetPath(skinRoot, partId);
  if (!target) return;
  const rev = getPartDirtyRevision(partId);
  await savePart(partId, target);
  markPartClean(partId, rev);
}

async function discardCurrent(partId: string): Promise<void> {
  try {
    await discardPart(partId);
  } catch (e) {
    console.warn(`[partSwitchGuard] discardPart ${partId} failed`, e);
  }
  markPartClean(partId);
  bumpAssemblyOverrideVersion();
}

function persistBehavior(behavior: Behavior): void {
  sessionStore.setState({ switchSaveBehavior: behavior });
  updateWorkspaceSettings(WORKSPACE_PATH, { switchSaveBehavior: behavior });
}

/** 拦截当前部件的未保存改动；干净或用户确认保存/丢弃后执行 `onProceed`。 */
export function guardUnsavedCurrentPart(skinRoot: string, onProceed: () => void): void {
  const { currentPartId, switchSaveBehavior } = sessionStore.getState();
  if (!currentPartId || !isPartDirty(currentPartId)) {
    onProceed();
    return;
  }
  if (switchSaveBehavior === "auto") {
    void discardCurrent(currentPartId).finally(() => onProceed());
    return;
  }
  if (switchSaveBehavior === "save") {
    void saveCurrent(skinRoot, currentPartId)
      .then(() => onProceed())
      .catch((e: ApiError) => showToast(e?.message ?? String(e), "error"));
    return;
  }
  openSwitchDialog(skinRoot, currentPartId, onProceed);
}

export function requestSwitchPart(skinRoot: string, target: SwitchTarget): void {
  const cur = sessionStore.getState();
  if (cur.selectedPartName === target.partName && cur.selectedCategory === target.category) {
    return;
  }
  guardUnsavedCurrentPart(skinRoot, () => {
    sessionStore.setState({ selectedPartName: target.partName, selectedCategory: target.category });
  });
}

function openSwitchDialog(skinRoot: string, currentPartId: string, onProceed: () => void): void {
  const overlay = document.createElement("div");
  overlay.dataset.modalOpen = "true";
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2100;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;";
  const dialog = document.createElement("div");
  dialog.className = "panel";
  dialog.style.cssText =
    "min-width:360px;max-width:460px;padding:16px;display:flex;flex-direction:column;gap:12px;font-size:13px;";
  overlay.appendChild(dialog);

  const title = document.createElement("div");
  title.style.cssText = "font-weight:600;font-size:15px;";
  title.textContent = t("switchSave.title");
  const desc = document.createElement("div");
  desc.style.cssText = "opacity:0.8;line-height:1.5;";
  desc.textContent = t("switchSave.desc");

  const rememberRow = document.createElement("label");
  rememberRow.style.cssText = "display:flex;gap:8px;align-items:center;cursor:pointer;";
  const rememberCb = document.createElement("input");
  rememberCb.type = "checkbox";
  const rememberText = document.createElement("span");
  rememberText.textContent = t("switchSave.remember");
  rememberRow.append(rememberCb, rememberText);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = t("switchSave.cancel");
  const discardBtn = document.createElement("button");
  discardBtn.className = "btn";
  discardBtn.textContent = t("switchSave.discard");
  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = t("switchSave.save");
  btnRow.append(cancelBtn, discardBtn, saveBtn);

  dialog.append(title, desc, rememberRow, btnRow);
  document.body.appendChild(overlay);

  function close(): void {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  discardBtn.addEventListener("click", () => {
    if (rememberCb.checked) persistBehavior("auto");
    close();
    void discardCurrent(currentPartId).finally(() => onProceed());
  });
  saveBtn.addEventListener("click", () => {
    if (rememberCb.checked) persistBehavior("save");
    close();
    void saveCurrent(skinRoot, currentPartId)
      .then(() => onProceed())
      .catch((e: ApiError) => showToast(e?.message ?? String(e), "error"));
  });
  document.addEventListener("keydown", onKey, true);
}
