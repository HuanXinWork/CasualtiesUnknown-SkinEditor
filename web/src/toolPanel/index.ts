// 顶部工具栏：工具切换、笔刷尺寸、撤销/重做、历史记录、保存、皮肤包导入导出、语言/主题/设置与重置布局。

import {
  exportSkinPack,
  importSkinPack,
  pickOpenFile,
  pickSavePath,
  redo as apiRedo,
  resetLayout,
  savePart,
  undo as apiUndo,
  type ApiError,
} from "../apiClient";
import { getRuntimeMode } from "../runtimeMode";
import {
  getPartDirtyRevision,
  markPartClean,
  markPartDirty,
  parsePartId,
  partIdToTargetPath,
  pushHistoryRecord,
  sessionStore,
} from "../stateStore";
import { flushWorkspace, replaceWorkspaceCache } from "../stateStore/workspacePersist";
import { guardUnsavedCurrentPart } from "../partPanel/partSwitchGuard";
import { mountThemeButton } from "../themeSettings";
import { mountLangButton } from "../langSettings";
import { showToast } from "../toast";
import { subscribeLang, t } from "../i18n";
import {
  ICON_EXPORT,
  ICON_HISTORY,
  ICON_IMPORT,
  ICON_REDO,
  ICON_RESET_LAYOUT,
  ICON_SAVE,
  ICON_SETTINGS,
  ICON_UNDO,
  TOOL_ICONS,
} from "./toolIcons";
import { mountSettingsPopover } from "../settingsPanel";
import { openSoftBrushDialog } from "./softBrushDialog";
import { attachGlobalShortcuts, registerAction, setShortcutContext } from "../shortcuts";

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
  container.style.gap = "8px";
  container.style.padding = "0 10px";
  container.innerHTML =
    `<div data-role="tools-draw" style="display:flex;align-items:center;gap:4px;">` +
    `<button class="btn cp-tool-btn" data-tool="brush">${TOOL_ICONS.brush}</button>` +
    `<button class="btn cp-tool-btn" data-tool="softBrush">${TOOL_ICONS.softBrush}</button>` +
    `<button class="btn cp-tool-btn" data-tool="gradient">${TOOL_ICONS.gradient}</button>` +
    `<button class="btn cp-tool-btn" data-tool="fill">${TOOL_ICONS.fill}</button>` +
    `<button class="btn cp-tool-btn" data-tool="eraser">${TOOL_ICONS.eraser}</button>` +
    `<button class="btn cp-tool-btn" data-tool="zoneBrush">${TOOL_ICONS.zoneBrush}</button>` +
    `</div>` +
    `<div data-role="brush-size" style="display:flex;align-items:center;gap:4px;">` +
    `<span data-role="size-label" style="opacity:0.7;"></span>` +
    `<button class="btn" data-role="size-dec">-</button>` +
    `<span class="mono" data-role="size-val" style="min-width:2ch;text-align:center;"></span>` +
    `<button class="btn" data-role="size-inc">+</button>` +
    `</div>` +
    `<span class="toolbar-sep" aria-hidden="true"></span>` +
    `<div data-role="tools-view" style="display:flex;align-items:center;gap:4px;">` +
    `<button class="btn cp-tool-btn" data-tool="crop">${TOOL_ICONS.crop}</button>` +
    `<button class="btn cp-tool-btn" data-tool="pan">${TOOL_ICONS.pan}</button>` +
    `</div>` +
    `<div data-role="history" style="display:flex;align-items:center;gap:4px;margin-left:auto;">` +
    `<button class="btn cp-tool-btn" data-role="undo">${ICON_UNDO}</button>` +
    `<button class="btn cp-tool-btn" data-role="redo">${ICON_REDO}</button>` +
    `<button class="btn cp-tool-btn" data-role="history-toggle">${ICON_HISTORY}</button>` +
    `</div>` +
    `<span class="toolbar-sep" aria-hidden="true"></span>` +
    `<div data-role="actions" style="display:flex;align-items:center;gap:4px;">` +
    `<button class="btn cp-tool-btn" data-role="save-part">${ICON_SAVE}</button>` +
    `<button class="btn cp-tool-btn" data-role="export-pack">${ICON_EXPORT}</button>` +
    `<button class="btn cp-tool-btn" data-role="import-pack">${ICON_IMPORT}</button>` +
    `<span data-role="lang-host" style="display:inline-flex;"></span>` +
    `<span data-role="theme-host" style="display:inline-flex;"></span>` +
    `<button class="btn cp-tool-btn" data-role="settings-toggle">${ICON_SETTINGS}</button>` +
    `<button class="btn cp-tool-btn" data-role="reset-layout">${ICON_RESET_LAYOUT}</button>` +
    `</div>`;

  const brushBtn = container.querySelector<HTMLButtonElement>('[data-tool="brush"]')!;
  const softBrushBtn = container.querySelector<HTMLButtonElement>('[data-tool="softBrush"]')!;
  const eraserBtn = container.querySelector<HTMLButtonElement>('[data-tool="eraser"]')!;
  const panBtn = container.querySelector<HTMLButtonElement>('[data-tool="pan"]')!;
  const cropBtn = container.querySelector<HTMLButtonElement>('[data-tool="crop"]')!;
  const gradientBtn = container.querySelector<HTMLButtonElement>('[data-tool="gradient"]')!;
  const fillBtn = container.querySelector<HTMLButtonElement>('[data-tool="fill"]')!;
  const zoneBrushBtn = container.querySelector<HTMLButtonElement>('[data-tool="zoneBrush"]')!;
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
  const resetLayoutBtn = container.querySelector<HTMLButtonElement>('[data-role="reset-layout"]')!;
  const langHost = container.querySelector<HTMLSpanElement>('[data-role="lang-host"]')!;
  const themeHost = container.querySelector<HTMLSpanElement>('[data-role="theme-host"]')!;
  const langUnsubscribe = mountLangButton(langHost);
  const themeUnsubscribe = mountThemeButton(themeHost, workspacePath);

  let savingNow = false;

  function applyTexts(): void {
    brushBtn.title = t("toolPanel.brush");
    softBrushBtn.title = `${t("toolPanel.softBrush")} · ${t("softBrush.dblclickHint")}`;
    const eraserMode = sessionStore.getState().eraserMode ?? "part";
    eraserBtn.title =
      eraserMode === "zone"
        ? `${t("toolPanel.eraser")} · ${t("toolPanel.eraserModeZone")}`
        : `${t("toolPanel.eraser")} · ${t("toolPanel.eraserModePart")}`;
    panBtn.title = `${t("toolPanel.pan")} (H)`;
    cropBtn.title = `${t("toolPanel.crop")} (C)`;
    gradientBtn.title = t("toolPanel.gradient");
    fillBtn.title = `${t("toolPanel.fill")} (G)`;
    zoneBrushBtn.title = `${t("toolPanel.zoneBrush")} (Z)`;
    sizeLabelEl.textContent = t("toolPanel.size");
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
    softBrushBtn.classList.toggle("btn-primary", activeTool === "softBrush");
    eraserBtn.classList.toggle("btn-primary", activeTool === "eraser");
    panBtn.classList.toggle("btn-primary", activeTool === "pan");
    cropBtn.classList.toggle("btn-primary", activeTool === "crop");
    cropBtn.disabled = currentPartId === null;
    gradientBtn.classList.toggle("btn-primary", activeTool === "gradient");
    fillBtn.classList.toggle("btn-primary", activeTool === "fill");
    zoneBrushBtn.classList.toggle("btn-primary", activeTool === "zoneBrush");
    sizeValEl.textContent = String(brushSize);
    sizeDecBtn.disabled = brushSize <= BRUSH_MIN;
    sizeIncBtn.disabled = brushSize >= BRUSH_MAX;
    undoBtn.disabled = currentPartId === null;
    redoBtn.disabled = currentPartId === null;
    saveBtn.disabled = savingNow || currentPartId === null;
    applyTexts();
  }

  brushBtn.addEventListener("click", () => sessionStore.setState({ activeTool: "brush" }));
  softBrushBtn.addEventListener("click", () => sessionStore.setState({ activeTool: "softBrush" }));
  softBrushBtn.addEventListener("dblclick", () => openSoftBrushDialog(workspacePath));
  eraserBtn.addEventListener("click", () => {
    const state = sessionStore.getState();
    if (state.activeTool !== "eraser") {
      sessionStore.setState({ activeTool: "eraser" });
    } else {
      const next = state.eraserMode === "zone" ? "part" : "zone";
      sessionStore.setState({ eraserMode: next });
      applyTexts();
    }
  });
  panBtn.addEventListener("click", () => sessionStore.setState({ activeTool: "pan" }));
  cropBtn.addEventListener("click", () => {
    if (sessionStore.getState().currentPartId) {
      sessionStore.setState({ activeTool: "crop" });
    }
  });
  gradientBtn.addEventListener("click", () => sessionStore.setState({ activeTool: "gradient" }));
  fillBtn.addEventListener("click", () => sessionStore.setState({ activeTool: "fill" }));
  zoneBrushBtn.addEventListener("click", () => sessionStore.setState({ activeTool: "zoneBrush" }));

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
        // 将 diff 与画布尺寸版本号合并在单次 setState 内，避免预览区因连续通知重复合成。
        const resizedPatch =
          diff.resized && diff.canvasWidth && diff.canvasHeight
            ? {
                canvasSizeVersion: (sessionStore.getState().canvasSizeVersion ?? 0) + 1,
                lastResizedCanvas: {
                  partId: currentPartId,
                  width: diff.canvasWidth,
                  height: diff.canvasHeight,
                },
              }
            : {};
        sessionStore.setState({
          lastAppliedDiff: {
            partId: currentPartId,
            diff,
            phase: kind === "undo" ? "before" : "after",
          },
          ...resizedPatch,
        });
        markPartDirty(currentPartId);
        pushHistoryRecord({
          partId: currentPartId,
          tool: kind,
          rectW: diff.canvasWidth ?? diff.width,
          rectH: diff.canvasHeight ?? diff.height,
        });
      })
      .catch((e: ApiError) => {
        console.warn(`[toolPanel] ${kind} failed: ${e?.message ?? String(e)}`);
      });
  }

  undoBtn.addEventListener("click", () => runHistory("undo"));
  redoBtn.addEventListener("click", () => runHistory("redo"));

  const historyPopover = mountHistoryPopover(historyToggleBtn);
  const settingsPopover = mountSettingsPopover(settingsBtn, workspacePath);
  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    settingsPopover.toggle();
  });

  function runSave(): void {
    if (savingNow) return;
    const { currentPartId } = sessionStore.getState();
    if (!currentPartId) return;
    const parsed = parsePartId(currentPartId);
    const target = partIdToTargetPath(skinRoot, currentPartId);
    if (!parsed || !target) return;
    const rev = getPartDirtyRevision(currentPartId);
    savingNow = true;
    renderFromState();
    savePart(currentPartId, target)
      .then(() => {
        markPartClean(currentPartId, rev);
        showToast(`✓ ${parsed.partName}.png`, "info");
      })
      .catch((e: ApiError) => showToast(e?.message ?? String(e), "error"))
      .finally(() => {
        savingNow = false;
        renderFromState();
      });
  }
  saveBtn.addEventListener("click", runSave);

  const unregActions: Array<() => void> = [
    registerAction("undo", () => runHistory("undo")),
    registerAction("redo", () => runHistory("redo")),
    registerAction("save", runSave),
    registerAction("tool.brush", () => sessionStore.setState({ activeTool: "brush" })),
    registerAction("tool.softBrush", () => sessionStore.setState({ activeTool: "softBrush" })),
    registerAction("tool.eraser", () => sessionStore.setState({ activeTool: "eraser" })),
    registerAction("tool.gradient", () => sessionStore.setState({ activeTool: "gradient" })),
    registerAction("tool.fill", () => sessionStore.setState({ activeTool: "fill" })),
    registerAction("tool.zoneBrush", () => sessionStore.setState({ activeTool: "zoneBrush" })),
    registerAction("tool.crop", () => {
      if (sessionStore.getState().currentPartId) {
        sessionStore.setState({ activeTool: "crop" });
      }
    }),
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

  const zipFilters = [{ name: "Zip", extensions: ["zip"] }];
  exportBtn.addEventListener("click", async () => {
    const skinName = sessionStore.getState().currentSkinName;
    if (!skinName) {
      showToast(t("toolPanel.exportNoSkin"), "warn");
      return;
    }
    const opts = await pickExportOptions();
    if (opts === null) return;
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
      if (getRuntimeMode() === "tauri") return;
      path = window.prompt(t("toolPanel.exportPrompt"), def);
    }
    if (!path) return;
    exportBtn.disabled = true;
    exportSkinPack(skinDir, path, opts.layout, opts.includeBlood)
      .then((r) => {
        showToast(t("toolPanel.exportSuccess").replace("{n}", String(r.fileCount)), "info");
      })
      .catch((e: ApiError) => showToast(e?.message ?? String(e), "error"))
      .finally(() => {
        exportBtn.disabled = false;
      });
  });

  importBtn.addEventListener("click", () => {
    guardUnsavedCurrentPart(skinRoot, () => {
      void runImportFlow();
    });
  });

  async function runImportFlow(): Promise<void> {
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
    const baseName = zipPath.split(/[\\/]/).pop() ?? "";
    const newSkinName = baseName.replace(/\.zip$/i, "") || "imported";
    const skinDir = `${skinRoot}/${newSkinName}`;
    importBtn.disabled = true;
    importSkinPack(skinDir, zipPath, true)
      .then((r) => {
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
  }

  resetLayoutBtn.addEventListener("click", () => {
    guardUnsavedCurrentPart(skinRoot, () => {
      resetLayoutBtn.disabled = true;
      resetLayout()
        .then((ws) => {
          replaceWorkspaceCache(ws.layout, ws.theme);
          return flushWorkspace(workspacePath);
        })
        .then(() => {
          window.setTimeout(() => window.location.reload(), 200);
        })
        .catch((e: ApiError) => {
          console.warn(`[toolPanel] resetLayout failed: ${e?.message ?? String(e)}`);
          showToast(e?.message ?? String(e), "error");
          resetLayoutBtn.disabled = false;
        });
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

function mountHistoryPopover(triggerBtn: HTMLElement): () => void {
  const popover = document.createElement("div");
  popover.className = "panel history-popover";
  popover.hidden = true;
  popover.style.cssText =
    "position:fixed;z-index:1200;min-width:260px;max-height:320px;overflow:auto;" +
    "padding:6px 0;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.2);";
  document.body.appendChild(popover);

  function render(): void {
    const { history, currentPartId } = sessionStore.getState();
    const filtered = currentPartId ? history.filter((h) => h.partId === currentPartId) : history;
    popover.innerHTML = "";
    if (filtered.length === 0) {
      const empty = document.createElement("div");
      empty.style.cssText = "padding:8px 12px;opacity:0.6;";
      empty.textContent = t("toolPanel.historyEmpty");
      popover.appendChild(empty);
      return;
    }
    for (let i = filtered.length - 1; i >= 0; i--) {
      const r = filtered[i];
      const row = document.createElement("div");
      row.style.cssText = "padding:4px 12px;display:flex;gap:8px;align-items:center;";
      const time = new Date(r.timestamp);
      const hh = String(time.getHours()).padStart(2, "0");
      const mm = String(time.getMinutes()).padStart(2, "0");
      const ss = String(time.getSeconds()).padStart(2, "0");
      const timeSpan = document.createElement("span");
      timeSpan.className = "mono";
      timeSpan.style.cssText = "opacity:0.6;min-width:6ch;";
      timeSpan.textContent = `${hh}:${mm}:${ss}`;

      const toolSpan = document.createElement("span");
      toolSpan.style.flex = "1";
      const parsed = parsePartId(r.partId);
      const suffix = !currentPartId && parsed ? ` (${parsed.partName})` : "";
      toolSpan.textContent = `${t(`toolPanel.historyTool_${r.tool}`)}${suffix}`;

      const rectSpan = document.createElement("span");
      rectSpan.className = "mono";
      rectSpan.style.cssText = "opacity:0.5;font-size:11px;";
      rectSpan.textContent = `${r.rectW}×${r.rectH}`;

      row.append(timeSpan, toolSpan, rectSpan);
      popover.appendChild(row);
    }
  }

  function position(): void {
    const rect = triggerBtn.getBoundingClientRect();
    popover.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
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

function pickExportOptions(): Promise<{ layout: "flat" | "categorized"; includeBlood: boolean } | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.dataset.modalOpen = "true";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000;display:flex;align-items:center;justify-content:center;";

    const card = document.createElement("div");
    card.className = "panel";
    card.style.cssText =
      "min-width:320px;max-width:480px;padding:16px 20px;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.3);font-size:13px;";
    overlay.appendChild(card);

    const title = document.createElement("div");
    title.textContent = t("toolPanel.exportLayoutPrompt");
    title.style.cssText = "font-weight:600;margin-bottom:10px;";
    card.appendChild(title);

    const radioGroup = document.createElement("div");
    radioGroup.style.cssText = "display:flex;flex-direction:column;gap:6px;margin-bottom:12px;";
    const groupName = `export-layout-${Date.now()}`;
    for (const [val, labelKey] of [
      ["categorized", "toolPanel.exportLayoutCategorized"],
      ["flat", "toolPanel.exportLayoutFlat"],
    ] as const) {
      const row = document.createElement("label");
      row.style.cssText = "display:flex;gap:8px;align-items:center;cursor:pointer;";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = groupName;
      radio.value = val;
      if (val === "categorized") radio.checked = true;
      const span = document.createElement("span");
      span.textContent = t(labelKey);
      row.append(radio, span);
      radioGroup.appendChild(row);
    }
    card.appendChild(radioGroup);

    const bloodRow = document.createElement("label");
    bloodRow.style.cssText = "display:flex;gap:8px;align-items:center;cursor:pointer;margin-bottom:14px;";
    const bloodCb = document.createElement("input");
    bloodCb.type = "checkbox";
    const bloodSpan = document.createElement("span");
    bloodSpan.textContent = t("toolPanel.exportIncludeBloodPrompt");
    bloodRow.append(bloodCb, bloodSpan);
    card.appendChild(bloodRow);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn";
    cancelBtn.textContent = t("toolPanel.exportCancelBtn");
    const confirmBtn = document.createElement("button");
    confirmBtn.type = "button";
    confirmBtn.className = "btn btn-primary";
    confirmBtn.textContent = t("toolPanel.exportConfirmBtn");
    btnRow.append(cancelBtn, confirmBtn);
    card.appendChild(btnRow);

    function close(result: { layout: "flat" | "categorized"; includeBlood: boolean } | null): void {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(result);
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        close(null);
      } else if (e.key === "Enter") {
        confirmBtn.click();
      }
    }
    cancelBtn.addEventListener("click", () => close(null));
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close(null);
    });
    confirmBtn.addEventListener("click", () => {
      const checkedRadio = card.querySelector<HTMLInputElement>('input[type="radio"]:checked');
      const picked: "flat" | "categorized" =
        checkedRadio?.value === "flat" ? "flat" : "categorized";
      close({ layout: picked, includeBlood: bloodCb.checked });
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    confirmBtn.focus();
  });
}
