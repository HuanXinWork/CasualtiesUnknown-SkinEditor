// 复制部件 / 删除部件：复制走选择式对话框（仿添加部件），选目标部件覆盖，不自由改文件名。
import { copyPart, deletePart, type ApiError } from "../apiClient";
import { sessionStore, bumpPartListVersion } from "../stateStore";
import type { PartCategory } from "../stateStore/types";
import { localizePartName } from "../i18n/partNames";
import { PART_CATALOG, inferPrefix, partAllComboNames } from "../editorCanvas/partCatalog";
import { showToast } from "../toast";
import { t } from "../i18n";

interface CopyTarget {
  name: string;
  exists: boolean;
}

/// 候选目标 = 该分类标准部件全维度组合名 ∪ 已有部件名；标注是否已存在，源部件排除。
function buildTargets(category: PartCategory, existingNames: string[], sourceName: string): CopyTarget[] {
  const existing = new Set(existingNames);
  const names = new Set<string>();
  const defs = PART_CATALOG[category];
  if (defs) {
    const prefix = inferPrefix(category, existingNames);
    for (const def of defs) {
      for (const n of partAllComboNames(def, prefix)) names.add(n);
    }
  }
  for (const n of existingNames) names.add(n);
  names.delete(sourceName);
  return Array.from(names)
    .sort((a, b) => a.localeCompare(b))
    .map((name) => ({ name, exists: existing.has(name) }));
}

export function openCopyPartDialog(
  skinRoot: string,
  skinName: string,
  category: PartCategory,
  sourcePartName: string,
  existingNames: string[],
): void {
  const targets = buildTargets(category, existingNames, sourcePartName);
  if (targets.length === 0) {
    showToast(t("partClipboard.noTarget"), "warn");
    return;
  }
  let selected: CopyTarget | null = null;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2200;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;";
  const dialog = document.createElement("div");
  dialog.className = "panel";
  dialog.style.cssText =
    "min-width:420px;max-width:520px;max-height:80vh;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:12px;font-size:13px;";
  overlay.appendChild(dialog);

  const title = document.createElement("div");
  title.style.cssText = "font-weight:600;font-size:15px;";
  title.textContent = t("partClipboard.copyTitle").replace("{name}", localizePartName(sourcePartName));

  const listWrap = document.createElement("div");
  listWrap.style.cssText =
    "max-height:280px;overflow:auto;display:flex;flex-direction:column;gap:2px;padding:6px;border:1px solid rgba(0,0,0,var(--border-opacity));border-radius:4px;";

  const hint = document.createElement("div");
  hint.style.cssText = "font-size:12px;min-height:18px;opacity:0.8;";

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = t("partClipboard.cancel");
  const okBtn = document.createElement("button");
  okBtn.className = "btn btn-primary";
  okBtn.textContent = t("partClipboard.confirm");
  okBtn.disabled = true;
  btnRow.append(cancelBtn, okBtn);

  dialog.append(title, listWrap, hint, btnRow);
  document.body.appendChild(overlay);

  function renderList(): void {
    listWrap.innerHTML = "";
    for (const target of targets) {
      const row = document.createElement("button");
      row.className = target === selected ? "btn btn-primary" : "btn";
      row.style.cssText = "display:flex;justify-content:space-between;gap:8px;text-align:left;font-size:12px;";
      const nameSpan = document.createElement("span");
      nameSpan.textContent = localizePartName(target.name);
      const tagSpan = document.createElement("span");
      tagSpan.style.opacity = "0.7";
      tagSpan.textContent = target.exists ? t("partClipboard.tagExists") : t("partClipboard.tagNew");
      row.append(nameSpan, tagSpan);
      row.addEventListener("click", () => {
        selected = target;
        okBtn.disabled = false;
        hint.textContent = target.exists
          ? t("partClipboard.overwriteHint").replace("{name}", localizePartName(target.name))
          : t("partClipboard.newHint").replace("{name}", localizePartName(target.name));
        renderList();
      });
      listWrap.appendChild(row);
    }
  }

  function close(): void {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
  function submit(): void {
    if (!selected) return;
    const target = selected;
    okBtn.disabled = true;
    copyPart(skinRoot, skinName, category, sourcePartName, target.name, target.exists)
      .then(() => {
        showToast(t("partClipboard.copyToast").replace("{name}", localizePartName(target.name)), "info");
        bumpPartListVersion();
        close();
      })
      .catch((e: ApiError) => {
        okBtn.disabled = false;
        showToast(e?.message ?? String(e), "error");
      });
  }
  cancelBtn.addEventListener("click", close);
  okBtn.addEventListener("click", submit);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);

  renderList();
}

export function deletePartWithConfirm(skinRoot: string, skinName: string, category: PartCategory, partName: string): void {
  confirmDialog(t("partClipboard.deleteConfirm").replace("{name}", partName), () => {
    deletePart(skinRoot, skinName, category, partName)
      .then(() => {
        const st = sessionStore.getState();
        if (st.selectedPartName === partName && st.selectedCategory === category) {
          sessionStore.setState({ selectedPartName: null, selectedCategory: null });
        }
        showToast(t("partClipboard.deleteToast").replace("{name}", partName), "info");
        bumpPartListVersion();
      })
      .catch((e: ApiError) => showToast(e?.message ?? String(e), "error"));
  });
}

function confirmDialog(message: string, onConfirm: () => void): void {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2200;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;";
  const dialog = document.createElement("div");
  dialog.className = "panel";
  dialog.style.cssText = "min-width:320px;max-width:420px;padding:16px;display:flex;flex-direction:column;gap:12px;font-size:13px;";
  const msg = document.createElement("div");
  msg.style.cssText = "line-height:1.5;";
  msg.textContent = message;
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  cancelBtn.textContent = t("partClipboard.cancel");
  const okBtn = document.createElement("button");
  okBtn.className = "btn btn-primary";
  okBtn.textContent = t("partClipboard.confirm");
  btnRow.append(cancelBtn, okBtn);
  dialog.append(msg, btnRow);
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  function close(): void {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
  cancelBtn.addEventListener("click", close);
  okBtn.addEventListener("click", () => { close(); onConfirm(); });
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
}
