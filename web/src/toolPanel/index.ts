// 顶部工具栏：工具切换、画笔尺寸、撤销重做、历史 popover、保存、导入导出、
// 设置、重置布局、语言主题入口。toolPanel 不可分离，始终内嵌。
//
// undo / redo 调 apiClient.undo / redo，把返回的 PixelDiff 通过 sessionStore
// .lastAppliedDiff 广播给 editorCanvas，由其单点重绘（与 brush/eraser 共用一条路径）。

import { redo as apiRedo, undo as apiUndo, type ApiError } from "../apiClient";
import {
  exportSkinPack,
  importSkinPack,
  pickOpenFile,
  pickSavePath,
  resetLayout,
  saveWorkspace,
} from "../apiClient";
import { getRuntimeMode } from "../runtimeMode";
import { sessionStore, pushHistoryRecord, markPartDirty, markPartClean } from "../stateStore";
import { mountThemeButton } from "../themeSettings";
import { mountLangButton } from "../langSettings";
import { showToast } from "../toast";
import { subscribeLang, t } from "../i18n";
import { savePart } from "../apiClient";
import {
  TOOL_ICONS,
  ICON_UNDO,
  ICON_REDO,
  ICON_HISTORY,
  ICON_IMPORT,
  ICON_EXPORT,
  ICON_RESET_LAYOUT,
  ICON_SETTINGS,
  ICON_SAVE,
} from "./toolIcons";
import { mountSettingsPopover } from "../settingsPanel";
import {
  attachGlobalShortcuts,
  registerAction,
  setShortcutContext,
} from "../shortcuts";

const BRUSH_MIN = 1;
const BRUSH_MAX = 32;

export function mountToolPanel(
  container: HTMLElement,
  skinRoot: string,
  workspacePath: string,
): () => void {
  container.classList.add("panel");
  container.style.display = "flex";
  container.style.alignItems = "center";
  container.style.gap = "12px";
  container.style.padding = "0 12px";
  container.innerHTML =
    `<div data-role="tools" style="display:flex;gap:4px;">` +
    `<button class="btn cp-tool-btn" data-tool="pan">${TOOL_ICONS.pan}</button>` +
    `<button class="btn cp-tool-btn" data-tool="brush">${TOOL_ICONS.brush}</button>` +
    `<button class="btn cp-tool-btn" data-tool="gradient">${TOOL_ICONS.gradient}</button>` +
    `<button class="btn cp-tool-btn" data-tool="eraser">${TOOL_ICONS.eraser}</button>` +
    `</div>` +
    `<div data-role="brush-size" style="display:flex;align-items:center;gap:4px;">` +
    `<span data-role="size-label" style="opacity:0.7;"></span>` +
    `<button class="btn" data-role="size-dec">-</button>` +
    `<span class="mono" data-role="size-val" style="min-width:2ch;text-align:center;"></span>` +
    `<button class="btn" data-role="size-inc">+</button>` +
    `</div>` +
    `<div data-role="history" style="display:flex;gap:4px;margin-left:auto;">` +
    `<button class="btn cp-tool-btn" data-role="undo">${ICON_UNDO}</button>` +
    `<button class="btn cp-tool-btn" data-role="redo">${ICON_REDO}</button>` +
    `<button class="btn cp-tool-btn" data-role="history-toggle">${ICON_HISTORY}</button>` +
    `</div>` +
    `<button class="btn cp-tool-btn" data-role="export-pack">${ICON_EXPORT}</button>` +
    `<button class="btn cp-tool-btn" data-role="import-pack">${ICON_IMPORT}</button>` +
    `<button class="btn cp-tool-btn" data-role="save-part">${ICON_SAVE}</button>` +
    `<span data-role="lang-host" style="display:inline-flex;"></span>` +
    `<span data-role="theme-host" style="display:inline-flex;"></span>` +
    `<button class="btn cp-tool-btn" data-role="settings-toggle">${ICON_SETTINGS}</button>` +
    `<button class="btn cp-tool-btn" data-role="reset-layout">${ICON_RESET_LAYOUT}</button>`;

  const brushBtn = container.querySelector<HTMLButtonElement>('[data-tool="brush"]')!;
  const eraserBtn = container.querySelector<HTMLButtonElement>('[data-tool="eraser"]')!;
  const panBtn = container.querySelector<HTMLButtonElement>('[data-tool="pan"]')!;
  const gradientBtn = container.querySelector<HTMLButtonElement>('[data-tool="gradient"]')!;
  const sizeLabelEl = container.querySelector<HTMLSpanElement>('[data-role="size-label"]')!;
  const sizeDecBtn = container.querySelector<HTMLButtonElement>('[data-role="size-dec"]')!;
  const sizeIncBtn = container.querySelector<HTMLButtonElement>('[data-role="size-inc"]')!;
  const sizeValEl = container.querySelector<HTMLSpanElement>('[data-role="size-val"]')!;
  const undoBtn = container.querySelector<HTMLButtonElement>('[data-role="undo"]')!;
  const redoBtn = container.querySelector<HTMLButtonElement>('[data-role="redo"]')!;
  const historyToggleBtn = container.querySelector<HTMLButtonElement>('[data-role="history-toggle"]')!;
  const exportBtn = container.querySelector<HTMLButtonElement>('[data-role="export-pack"]')!;
  const importBtn = container.querySelector<HTMLButtonElement>('[data-role="import-pack"]')!;
  const saveBtn = container.querySelector<HTMLButtonElement>('[data-role="save-part"]')!;
  const settingsBtn = container.querySelector<HTMLButtonElement>('[data-role="settings-toggle"]')!;
  const resetLayoutBtn = container.querySelector<HTMLButtonElement>(
    '[data-role="reset-layout"]',
  )!;
  const langHost = container.querySelector<HTMLSpanElement>('[data-role="lang-host"]')!;
  const themeHost = container.querySelector<HTMLSpanElement>('[data-role="theme-host"]')!;
  const langUnsubscribe = mountLangButton(langHost);
  const themeUnsubscribe = mountThemeButton(themeHost, workspacePath);

  function applyTexts(): void {
    // 工具按钮内容是 SVG 图标，不能 textContent 覆盖；只设 title 提示。
    brushBtn.title = t("toolPanel.brush");
    eraserBtn.title = t("toolPanel.eraser");
    panBtn.title = t("toolPanel.pan");
    gradientBtn.title = t("toolPanel.gradient");
    sizeLabelEl.textContent = t("toolPanel.size");
    // undo/redo/history/import/export/resetLayout 全部改为图标按钮，仅设 title。
    undoBtn.title = t("toolPanel.undo");
    redoBtn.title = t("toolPanel.redo");
    historyToggleBtn.title = t("toolPanel.history");
    saveBtn.title = t("settings.action_save");
    settingsBtn.title = t("settings.title");
    exportBtn.title = t("toolPanel.export");
    importBtn.title = t("toolPanel.importPack");
    resetLayoutBtn.title = t("toolPanel.resetLayout");
  }
  applyTexts();
  const langUnsubscribe2 = subscribeLang(applyTexts);

  function renderFromState(): void {
    const { activeTool, brushSize, currentPartId } = sessionStore.getState();
    brushBtn.classList.toggle("btn-primary", activeTool === "brush");
    eraserBtn.classList.toggle("btn-primary", activeTool === "eraser");
    panBtn.classList.toggle("btn-primary", activeTool === "pan");
    gradientBtn.classList.toggle("btn-primary", activeTool === "gradient");
    sizeValEl.textContent = String(brushSize);
    sizeDecBtn.disabled = brushSize <= BRUSH_MIN;
    sizeIncBtn.disabled = brushSize >= BRUSH_MAX;
    undoBtn.disabled = currentPartId === null;
    redoBtn.disabled = currentPartId === null;
  }

  brushBtn.addEventListener("click", () => sessionStore.setState({ activeTool: "brush" }));
  eraserBtn.addEventListener("click", () => sessionStore.setState({ activeTool: "eraser" }));
  panBtn.addEventListener("click", () => sessionStore.setState({ activeTool: "pan" }));
  gradientBtn.addEventListener("click", () => sessionStore.setState({ activeTool: "gradient" }));

  sizeDecBtn.addEventListener("click", () => {
    const cur = sessionStore.getState().brushSize;
    const next = Math.max(BRUSH_MIN, cur - 1);
    if (next !== cur) sessionStore.setState({ brushSize: next });
  });
  sizeIncBtn.addEventListener("click", () => {
    const cur = sessionStore.getState().brushSize;
    const next = Math.min(BRUSH_MAX, cur + 1);
    if (next !== cur) sessionStore.setState({ brushSize: next });
  });

  function runHistory(kind: "undo" | "redo"): void {
    const { currentPartId } = sessionStore.getState();
    if (!currentPartId) return;
    const promise = kind === "undo" ? apiUndo(currentPartId) : apiRedo(currentPartId);
    promise
      .then((diff) => {
        sessionStore.setState({
          lastAppliedDiff: {
            partId: currentPartId,
            diff,
            phase: kind === "undo" ? "before" : "after",
          },
        });
        // undo / redo 都视作产生未保存修改——即便回到磁盘已存的快照，
        // 后端 PartSession 仍处于内存状态，不与原 PNG 自动同步。
        markPartDirty(currentPartId);
        // 撤销 / 重做也作为历史条目展示，不与原始 brush 合并。
        pushHistoryRecord({
          partId: currentPartId,
          tool: kind,
          rectW: diff.width,
          rectH: diff.height,
        });
      })
      .catch((e: ApiError) => {
        // 栈空（nothing_to_undo / nothing_to_redo）属预期失败，仅 console 留痕，不打断会话。
        console.warn(`[toolPanel] ${kind} failed: ${e?.message ?? String(e)}`);
      });
  }

  undoBtn.addEventListener("click", () => runHistory("undo"));
  redoBtn.addEventListener("click", () => runHistory("redo"));

  // 历史 popover：列出 sessionStore.history 最新在前，仅展示元数据。
  // 撤销 / 重做仍走工具栏按钮，不在 popover 中跳跃 N 步。
  const historyPopover = mountHistoryPopover(historyToggleBtn);

  // 设置 popover（快捷键编辑）。
  const settingsPopover = mountSettingsPopover(settingsBtn, workspacePath);
  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    settingsPopover.toggle();
  });

  // 保存当前部件 PNG（覆盖原文件）。partId 编码 = "skinName::Category::partName"，
  // 解码后拼回 skinRoot 下的目标路径。
  function runSave(): void {
    const { currentPartId } = sessionStore.getState();
    if (!currentPartId) return;
    const parts = currentPartId.split("::");
    if (parts.length !== 3) return;
    const [skinName, categoryDir, partName] = parts;
    const target = `${skinRoot}/${skinName}/${categoryDir}/${partName}.png`;
    saveBtn.disabled = true;
    savePart(currentPartId, target)
      .then(() => {
        markPartClean(currentPartId);
        showToast(`✓ ${partName}.png`, "info");
      })
      .catch((e: ApiError) => showToast(e?.message ?? String(e), "error"))
      .finally(() => { saveBtn.disabled = false; });
  }
  saveBtn.addEventListener("click", runSave);

  // 把所有动作注册到 shortcuts，全局 keydown 监听按需触发。
  const unregActions: Array<() => void> = [
    registerAction("undo", () => runHistory("undo")),
    registerAction("redo", () => runHistory("redo")),
    registerAction("save", runSave),
    registerAction("tool.brush", () => sessionStore.setState({ activeTool: "brush" })),
    registerAction("tool.eraser", () => sessionStore.setState({ activeTool: "eraser" })),
    registerAction("tool.gradient", () => sessionStore.setState({ activeTool: "gradient" })),
    registerAction("tool.pan", () => sessionStore.setState({ activeTool: "pan" })),
    registerAction("brush.larger", () => {
      const cur = sessionStore.getState().brushSize;
      const next = Math.min(BRUSH_MAX, cur + 1);
      if (next !== cur) sessionStore.setState({ brushSize: next });
    }),
    registerAction("brush.smaller", () => {
      const cur = sessionStore.getState().brushSize;
      const next = Math.max(BRUSH_MIN, cur - 1);
      if (next !== cur) sessionStore.setState({ brushSize: next });
    }),
  ];
  setShortcutContext({
    triggerHistoryPanel: () => historyToggleBtn.click(),
    triggerSettingsPanel: () => settingsPopover.toggle(),
  });
  const detachShortcuts = attachGlobalShortcuts();

  // zip 导入 / 导出。Tauri 模式调系统文件对话框，Web / fallback 模式 prompt 输入绝对路径。
  const zipFilters = [{ name: "Zip", extensions: ["zip"] }];
  exportBtn.addEventListener("click", async () => {
    // 仅导出当前角色（skinName 子目录），不全量打包。
    const skinName = sessionStore.getState().currentSkinName;
    if (!skinName) {
      showToast(t("toolPanel.exportNoSkin"), "warn");
      return;
    }
    const skinDir = `${skinRoot}/${skinName}`;
    const def = `${skinName}.zip`;
    let path: string | null = null;
    try {
      path = await pickSavePath(zipFilters, def);
    } catch (e) {
      const msg = (e as ApiError)?.message ?? String(e);
      showToast(msg, "error");
      return;
    }
    if (path === null) {
      // pickSavePath 返回 null：可能是用户取消（Tauri）或 Web 模式不支持。
      // Web 模式直接走 prompt 兜底；Tauri 模式用户取消即结束（再 prompt 反复打扰）。
      if (getRuntimeMode() === "tauri") return;
      path = window.prompt(t("toolPanel.exportPrompt"), def);
    }
    if (!path) return;
    exportBtn.disabled = true;
    exportSkinPack(skinDir, path)
      .then((r) => {
        showToast(t("toolPanel.exportSuccess").replace("{n}", String(r.fileCount)), "info");
      })
      .catch((e: ApiError) => showToast(e?.message ?? String(e), "error"))
      .finally(() => {
        exportBtn.disabled = false;
      });
  });

  importBtn.addEventListener("click", async () => {
    let path: string | null = null;
    try {
      path = await pickOpenFile(zipFilters);
    } catch (e) {
      const msg = (e as ApiError)?.message ?? String(e);
      showToast(`pickOpenFile: ${msg}`, "error");
      return;
    }
    if (path === null) {
      if (getRuntimeMode() === "tauri") return;
      path = window.prompt(t("toolPanel.importPrompt"), "");
    }
    if (!path) return;
    const zipPath =
      typeof path === "string" ? path : (path as { path?: string }).path ?? String(path);
    // 以 zip 文件名（去扩展名）作为新皮肤名，落到 <skinRoot>/<newSkinName>/...；
    // 不再覆盖当前选中皮肤。新皮肤目录由后端 importSkinPack 在写入时自动 mkdir。
    const baseName = zipPath.split(/[\\/]/).pop() ?? "";
    const newSkinName = baseName.replace(/\.zip$/i, "") || "imported";
    const skinDir = `${skinRoot}/${newSkinName}`;
    importBtn.disabled = true;
    importSkinPack(skinDir, zipPath, true)
      .then((r) => {
        // imported=0 时给用户更明确的提示，避免误判"成功了但没生效"。
        const kind: "info" | "warn" = r.imported === 0 ? "warn" : "info";
        showToast(
          `${newSkinName}: ${t("toolPanel.importSuccess")
            .replace("{n}", String(r.imported))
            .replace("{m}", String(r.skipped))}`,
          kind,
        );
        if (r.imported > 0) {
          window.setTimeout(() => window.location.reload(), 500);
        }
      })
      .catch((e: ApiError) => {
        showToast(`importSkinPack: ${e?.message ?? String(e)}`, "error");
      })
      .finally(() => {
        importBtn.disabled = false;
      });
  });

  // 拿后端默认 layout/theme → 写回 workspace.json → reload。
  // dock 状态分散在 dockHost 内部，整页刷新是回到默认布局最直接的路径。
  // catch 里 toast.error 暴露真实错误；setTimeout 让 toast 有时间渲染再 reload。
  resetLayoutBtn.addEventListener("click", () => {
    resetLayoutBtn.disabled = true;
    resetLayout()
      .then((ws) => saveWorkspace(workspacePath, ws.layout, ws.theme))
      .then(() => {
        window.setTimeout(() => window.location.reload(), 200);
      })
      .catch((e: ApiError) => {
        console.warn(`[toolPanel] resetLayout failed: ${e?.message ?? String(e)}`);
        showToast(e?.message ?? String(e), "error");
        resetLayoutBtn.disabled = false;
      });
  });

  const unsubscribe = sessionStore.subscribe(renderFromState);
  renderFromState();

  return () => {
    unsubscribe();
    langUnsubscribe();
    langUnsubscribe2();
    themeUnsubscribe();
    historyPopover();
    settingsPopover.destroy();
    detachShortcuts();
    for (const fn of unregActions) fn();
  };
}

// 历史 popover：position:fixed 浮层，挂在 history 按钮下方。
// outside click + Esc 关闭，列表从最新到最旧；条目仅展示元数据
// （工具图标 + 区域 + 时间），不可"点击跳转到该状态"——撤销/重做仍走 toolbar
// 上的 undo/redo 按钮，避免一次跳跃 N 步带来的栈语义混乱。
function mountHistoryPopover(triggerBtn: HTMLElement): () => void {
  const popover = document.createElement("div");
  popover.className = "panel history-popover";
  popover.hidden = true;
  popover.style.cssText =
    "position:fixed;z-index:1200;min-width:240px;max-height:320px;overflow:auto;" +
    "padding:6px 0;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);";
  document.body.appendChild(popover);

  function render(): void {
    const list = sessionStore.getState().history;
    if (list.length === 0) {
      popover.innerHTML = `<div style="padding:8px 12px;opacity:0.6;">${t("toolPanel.historyEmpty")}</div>`;
      return;
    }
    popover.innerHTML = "";
    // 倒序：最新在最上方
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      const row = document.createElement("div");
      row.style.cssText = "padding:4px 12px;display:flex;gap:8px;align-items:center;";
      const time = new Date(r.timestamp);
      const hh = String(time.getHours()).padStart(2, "0");
      const mm = String(time.getMinutes()).padStart(2, "0");
      const ss = String(time.getSeconds()).padStart(2, "0");
      const labelKey = `toolPanel.historyTool_${r.tool}`;
      row.innerHTML =
        `<span class="mono" style="opacity:0.6;min-width:6ch;">${hh}:${mm}:${ss}</span>` +
        `<span style="flex:1;">${t(labelKey)}</span>` +
        `<span class="mono" style="opacity:0.5;font-size:11px;">${r.rectW}×${r.rectH}</span>`;
      popover.appendChild(row);
    }
  }

  function position(): void {
    const rect = triggerBtn.getBoundingClientRect();
    popover.style.right = `${window.innerWidth - rect.right}px`;
    popover.style.top = `${rect.bottom + 4}px`;
    popover.style.left = "auto";
  }

  triggerBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (popover.hidden) {
      render();
      position();
      popover.hidden = false;
    } else {
      popover.hidden = true;
    }
  });

  function onDocClick(e: MouseEvent): void {
    if (popover.hidden) return;
    const target = e.target as Node;
    if (popover.contains(target) || triggerBtn.contains(target)) return;
    popover.hidden = true;
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") popover.hidden = true;
  }
  document.addEventListener("mousedown", onDocClick);
  document.addEventListener("keydown", onKey);

  // 历史更新时若 popover 打开，自动重渲染。
  const unsub = sessionStore.subscribe(() => {
    if (!popover.hidden) render();
  });

  return () => {
    unsub();
    document.removeEventListener("mousedown", onDocClick);
    document.removeEventListener("keydown", onKey);
    popover.remove();
  };
}
