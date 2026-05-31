// 切换部件守卫：当前部件有未保存改动时，按配置自动切换 / 先保存 / 弹框询问。
import { savePart, getWorkspace, saveWorkspace, type ApiError } from "../apiClient";
import { sessionStore, markPartClean, isPartDirty } from "../stateStore";
import { showToast } from "../toast";
import { t } from "../i18n";

const WORKSPACE_PATH = "data/workspace.json";

type Behavior = "auto" | "save";

interface SwitchTarget {
  partName: string;
  category: import("../stateStore/types").PartCategory;
}

function applySwitch(target: SwitchTarget): void {
  sessionStore.setState({ selectedPartName: target.partName, selectedCategory: target.category });
}

function partIdToTarget(skinRoot: string, partId: string): string | null {
  const parts = partId.split("::");
  if (parts.length !== 3) return null;
  const [skinName, categoryDir, partName] = parts;
  return `${skinRoot}/${skinName}/${categoryDir}/${partName}.png`;
}

async function saveCurrent(skinRoot: string, partId: string): Promise<void> {
  const target = partIdToTarget(skinRoot, partId);
  if (!target) return;
  await savePart(partId, target);
  markPartClean(partId);
}

function persistBehavior(behavior: Behavior): void {
  sessionStore.setState({ switchSaveBehavior: behavior });
  void getWorkspace(WORKSPACE_PATH)
    .then((ws) => saveWorkspace(WORKSPACE_PATH, {
      ...ws.layout,
      settings: {
        ...(ws.layout.settings ?? { showMotionDebugPanel: true, showWingDebugPanel: false, showBloodPanel: false }),
        switchSaveBehavior: behavior,
      },
    }, ws.theme))
    .catch((e) => console.warn(`[partSwitchGuard] persist behavior failed: ${String(e)}`));
}

/// 请求切换到目标部件；当前部件脏则按配置处理，未记住时弹框询问。
export function requestSwitchPart(skinRoot: string, target: SwitchTarget): void {
  const { currentPartId, switchSaveBehavior } = sessionStore.getState();
  if (!currentPartId || !isPartDirty(currentPartId)) {
    applySwitch(target);
    return;
  }
  if (switchSaveBehavior === "auto") {
    applySwitch(target);
    return;
  }
  if (switchSaveBehavior === "save") {
    void saveCurrent(skinRoot, currentPartId)
      .catch((e: ApiError) => showToast(e?.message ?? String(e), "error"))
      .finally(() => applySwitch(target));
    return;
  }
  openSwitchDialog(skinRoot, currentPartId, target);
}

function openSwitchDialog(skinRoot: string, currentPartId: string, target: SwitchTarget): void {
  const overlay = document.createElement("div");
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
  const autoBtn = document.createElement("button");
  autoBtn.className = "btn";
  autoBtn.textContent = t("switchSave.discard");
  const saveBtn = document.createElement("button");
  saveBtn.className = "btn btn-primary";
  saveBtn.textContent = t("switchSave.save");
  btnRow.append(cancelBtn, autoBtn, saveBtn);

  dialog.append(title, desc, rememberRow, btnRow);
  document.body.appendChild(overlay);

  function close(): void {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  autoBtn.addEventListener("click", () => {
    if (rememberCb.checked) persistBehavior("auto");
    close();
    applySwitch(target);
  });
  saveBtn.addEventListener("click", () => {
    if (rememberCb.checked) persistBehavior("save");
    close();
    void saveCurrent(skinRoot, currentPartId)
      .catch((e: ApiError) => showToast(e?.message ?? String(e), "error"))
      .finally(() => applySwitch(target));
  });
  document.addEventListener("keydown", onKey);
}
