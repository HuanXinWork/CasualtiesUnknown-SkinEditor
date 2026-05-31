// 柔和笔刷硬度设置弹框：滑块 0~100%（映射 0~255），确定后写 sessionStore 并持久化。
import { sessionStore } from "../stateStore";
import { getWorkspace, saveWorkspace } from "../apiClient";
import { subscribeLang, t } from "../i18n";

function persistHardness(workspacePath: string, hardness: number): void {
  void getWorkspace(workspacePath)
    .then((ws) => saveWorkspace(workspacePath, {
      ...ws.layout,
      settings: {
        ...(ws.layout.settings ?? { showMotionDebugPanel: true, showWingDebugPanel: false, showBloodPanel: false }),
        softBrushHardness: hardness,
      },
    }, ws.theme))
    .catch((e) => console.warn(`[softBrushDialog] persist failed: ${String(e)}`));
}

export function openSoftBrushDialog(workspacePath: string): void {
  const current = sessionStore.getState().softBrushHardness;
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2300;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;";
  const dialog = document.createElement("div");
  dialog.className = "panel";
  dialog.style.cssText = "min-width:300px;max-width:380px;padding:16px;display:flex;flex-direction:column;gap:12px;font-size:13px;";
  overlay.appendChild(dialog);

  const title = document.createElement("div");
  title.style.cssText = "font-weight:600;font-size:15px;";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;align-items:center;gap:10px;";
  const range = document.createElement("input");
  range.type = "range";
  range.min = "0";
  range.max = "100";
  range.value = String(Math.round((current / 255) * 100));
  range.style.flex = "1";
  const valEl = document.createElement("span");
  valEl.className = "mono";
  valEl.style.cssText = "min-width:4ch;text-align:right;";
  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
  const cancelBtn = document.createElement("button");
  cancelBtn.className = "btn";
  const okBtn = document.createElement("button");
  okBtn.className = "btn btn-primary";
  btnRow.append(cancelBtn, okBtn);
  row.append(range, valEl);
  dialog.append(title, row, btnRow);
  document.body.appendChild(overlay);

  function applyTexts(): void {
    title.textContent = t("softBrush.title");
    cancelBtn.textContent = t("softBrush.cancel");
    okBtn.textContent = t("softBrush.apply");
  }
  function syncVal(): void {
    valEl.textContent = `${range.value}%`;
  }
  const unsubLang = subscribeLang(applyTexts);
  applyTexts();
  syncVal();

  function close(): void {
    document.removeEventListener("keydown", onKey);
    unsubLang();
    overlay.remove();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
    else if (e.key === "Enter") submit();
  }
  function submit(): void {
    const pct = Number.parseInt(range.value, 10) || 0;
    const hardness = Math.round((pct / 100) * 255);
    sessionStore.setState({ softBrushHardness: hardness });
    persistHardness(workspacePath, hardness);
    close();
  }
  range.addEventListener("input", syncVal);
  cancelBtn.addEventListener("click", close);
  okBtn.addEventListener("click", submit);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);
}
