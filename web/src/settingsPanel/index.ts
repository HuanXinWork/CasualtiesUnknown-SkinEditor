// 工具栏设置弹出面板（调试面板开关、自动保存、切部件策略、快捷键录制与关于弹窗）。

import { sessionStore } from "../stateStore";
import { updateWorkspaceSettings } from "../stateStore/workspacePersist";
import { subscribeLang, t } from "../i18n";
import {
  ACTION_IDS,
  DEFAULT_SHORTCUTS,
  currentBindings,
  encodeKeyCombo,
  type ActionId,
} from "../shortcuts";
import { showToast } from "../toast";

const APP_META = {
  name: "CasualtiesUnknown-SkinEditor",
  version: "1.1.0",
  authorName: "huanxin886",
  authorUrl: "https://github.com/huanxin886",
  repo: "https://github.com/HuanXinWork/CasualtiesUnknown-SkinEditor",
  copyright: "Copyright (c) 2026 huanxin886",
};

export interface SettingsPopoverHandle {
  toggle(): void;
  close(): void;
  destroy(): void;
}

let activeAboutModal: HTMLElement | null = null;

function showAboutModal(): void {
  if (activeAboutModal) return;
  const overlay = document.createElement("div");
  overlay.dataset.modalOpen = "true";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:1500;" +
    "display:flex;align-items:center;justify-content:center;";
  const card = document.createElement("div");
  card.className = "panel";
  card.style.cssText =
    "min-width:320px;max-width:480px;padding:16px 20px;font-size:13px;line-height:1.5;";
  const title = document.createElement("div");
  title.style.cssText = "font-size:15px;font-weight:600;margin-bottom:8px;";
  title.textContent = APP_META.name;
  card.appendChild(title);

  const meta = document.createElement("div");
  meta.style.cssText = "display:flex;flex-direction:column;gap:4px;margin-bottom:12px;";
  const verRow = document.createElement("div");
  const verLabel = document.createElement("span");
  verLabel.style.opacity = "0.6";
  verLabel.textContent = `${t("settings.aboutVersion")}：`;
  const verVal = document.createElement("span");
  verVal.className = "mono";
  verVal.textContent = APP_META.version;
  verRow.append(verLabel, verVal);

  const authorRow = document.createElement("div");
  const authorLabel = document.createElement("span");
  authorLabel.style.opacity = "0.6";
  authorLabel.textContent = `${t("settings.aboutAuthor")}：`;
  const authorLink = document.createElement("a");
  authorLink.href = APP_META.authorUrl;
  authorLink.textContent = APP_META.authorName;
  authorLink.style.cssText = "color:var(--primary);cursor:pointer;text-decoration:underline;";
  authorLink.addEventListener("click", (e) => {
    e.preventDefault();
    openExternalUrl(APP_META.authorUrl);
  });
  authorRow.append(authorLabel, authorLink);

  const repoRow = document.createElement("div");
  const repoLabel = document.createElement("span");
  repoLabel.style.opacity = "0.6";
  repoLabel.textContent = `${t("settings.aboutRepo")}：`;
  const repoLink = document.createElement("a");
  repoLink.href = APP_META.repo;
  repoLink.textContent = APP_META.repo;
  repoLink.style.cssText = "color:var(--primary);cursor:pointer;text-decoration:underline;";
  repoLink.addEventListener("click", (e) => {
    e.preventDefault();
    openExternalUrl(APP_META.repo);
  });
  repoRow.append(repoLabel, repoLink);
  meta.append(verRow, authorRow, repoRow);

  const copyrightRow = document.createElement("div");
  copyrightRow.style.cssText = "opacity:0.55;font-size:12px;margin-top:2px;";
  copyrightRow.textContent = APP_META.copyright;
  meta.appendChild(copyrightRow);
  card.appendChild(meta);

  const disclaimer = document.createElement("div");
  disclaimer.style.cssText =
    "padding:8px 10px;background:rgba(var(--border-rgb),0.06);border-radius:4px;font-size:12px;opacity:0.85;margin-bottom:12px;";
  disclaimer.textContent = t("settings.aboutDisclaimer");
  card.appendChild(disclaimer);

  const starPlea = document.createElement("div");
  starPlea.style.cssText =
    "padding:8px 10px;background:rgba(255,196,0,0.12);border:1px solid rgba(255,196,0,0.4);border-radius:4px;font-size:12px;margin-bottom:12px;cursor:pointer;line-height:1.5;";
  starPlea.title = APP_META.repo;
  starPlea.textContent = t("settings.aboutStarPlea");
  starPlea.addEventListener("click", () => openExternalUrl(APP_META.repo));
  card.appendChild(starPlea);

  const footer = document.createElement("div");
  footer.style.cssText = "display:flex;justify-content:flex-end;";
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn";
  closeBtn.type = "button";
  closeBtn.textContent = t("common.close");
  footer.appendChild(closeBtn);
  card.appendChild(footer);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  activeAboutModal = overlay;

  function close(): void {
    if (activeAboutModal === overlay) activeAboutModal = null;
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  card.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("keydown", onKey, true);
}

function openExternalUrl(url: string): void {
  if (!url) return;
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
  }).__TAURI_INTERNALS__;
  const invoke = internals?.invoke;
  if (typeof invoke === "function") {
    invoke("plugin:opener|open_url", { url }).catch((e) => {
      console.warn(`[settingsPanel] open_url failed: ${String(e)}`);
      window.open(url, "_blank", "noopener,noreferrer");
    });
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function mountSettingsPopover(triggerBtn: HTMLElement, workspacePath: string): SettingsPopoverHandle {
  const popover = document.createElement("div");
  popover.className = "panel settings-popover";
  popover.hidden = true;
  popover.style.cssText =
    "position:fixed;z-index:1200;min-width:280px;max-width:360px;max-height:60vh;" +
    "overflow:auto;padding:8px 0;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.2);";
  document.body.appendChild(popover);

  let recordingId: ActionId | null = null;

  function persistShortcuts(overrides: Record<string, string>): void {
    sessionStore.setState({ shortcuts: overrides });
    updateWorkspaceSettings(workspacePath, { shortcuts: { ...overrides } });
  }

  function persistAutoSave(patch: { autoSaveEnabled?: boolean; autoSaveIntervalSec?: number }): void {
    sessionStore.setState(patch);
    const st = sessionStore.getState();
    updateWorkspaceSettings(workspacePath, {
      autoSaveEnabled: st.autoSaveEnabled,
      autoSaveIntervalSec: st.autoSaveIntervalSec,
    });
  }

  function persistSwitchBehavior(behavior: "ask" | "save" | "auto"): void {
    sessionStore.setState({ switchSaveBehavior: behavior === "ask" ? "" : behavior });
    updateWorkspaceSettings(workspacePath, { switchSaveBehavior: behavior });
  }

  function position(): void {
    const rect = triggerBtn.getBoundingClientRect();
    popover.style.right = `${Math.max(8, window.innerWidth - rect.right)}px`;
    popover.style.top = `${rect.bottom + 4}px`;
    popover.style.left = "auto";
  }

  function actionLabel(id: ActionId): string {
    return t(`settings.action_${id.replace(".", "_")}`);
  }

  function render(): void {
    const bindings = currentBindings();
    popover.innerHTML = "";

    const debugHeader = document.createElement("div");
    debugHeader.style.cssText =
      "padding:6px 12px;font-weight:600;border-bottom:1px solid rgba(var(--border-rgb),var(--border-opacity));margin-bottom:4px;";
    debugHeader.textContent = t("settings.debugTitle");
    popover.appendChild(debugHeader);

    const makeToggleRow = (
      checked: boolean,
      labelKey: string,
      onChange: (next: boolean) => void,
    ): HTMLLabelElement => {
      const row = document.createElement("label");
      row.style.cssText = "padding:8px 12px;display:flex;gap:8px;align-items:center;cursor:pointer;";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked;
      const lbl = document.createElement("span");
      lbl.style.cssText = "flex:1;";
      lbl.textContent = t(labelKey);
      cb.addEventListener("change", () => onChange(cb.checked));
      row.append(cb, lbl);
      return row;
    };

    const st = sessionStore.getState();
    popover.appendChild(
      makeToggleRow(st.showMotionDebugPanel, "settings.showMotionDebugPanel", (checked) => {
        sessionStore.setState({ showMotionDebugPanel: checked });
        updateWorkspaceSettings(workspacePath, { showMotionDebugPanel: checked });
      }),
    );
    popover.appendChild(
      makeToggleRow(st.showWingDebugPanel, "settings.showWingDebugPanel", (checked) => {
        sessionStore.setState({ showWingDebugPanel: checked });
        updateWorkspaceSettings(workspacePath, { showWingDebugPanel: checked });
      }),
    );
    popover.appendChild(
      makeToggleRow(st.showBloodPanel, "settings.showBloodPanel", (checked) => {
        sessionStore.setState({ showBloodPanel: checked });
        updateWorkspaceSettings(workspacePath, { showBloodPanel: checked });
      }),
    );
    popover.appendChild(
      makeToggleRow(st.autoSaveEnabled, "settings.autoSaveEnabled", (checked) => {
        persistAutoSave({ autoSaveEnabled: checked });
      }),
    );

    const intervalRow = document.createElement("div");
    intervalRow.style.cssText = "padding:4px 12px 8px;display:flex;gap:8px;align-items:center;";
    const intervalLabel = document.createElement("span");
    intervalLabel.style.cssText = "flex:1;opacity:0.85;";
    intervalLabel.textContent = t("settings.autoSaveInterval");
    const intervalInput = document.createElement("input");
    intervalInput.type = "number";
    intervalInput.min = "10";
    intervalInput.step = "5";
    intervalInput.className = "input";
    intervalInput.style.cssText = "width:72px;";
    intervalInput.value = String(st.autoSaveIntervalSec);
    intervalInput.addEventListener("change", () => {
      const parsed = Number.parseInt(intervalInput.value, 10);
      const v = Number.isFinite(parsed) ? Math.max(10, parsed) : 60;
      intervalInput.value = String(v);
      persistAutoSave({ autoSaveIntervalSec: v });
    });
    intervalRow.append(intervalLabel, intervalInput);
    popover.appendChild(intervalRow);

    const switchRow = document.createElement("div");
    switchRow.style.cssText = "padding:4px 12px 8px;display:flex;gap:8px;align-items:center;";
    const switchLabel = document.createElement("span");
    switchLabel.style.cssText = "flex:1;opacity:0.85;";
    switchLabel.textContent = t("settings.switchSaveBehavior");
    const switchSel = document.createElement("select");
    switchSel.className = "input";
    switchSel.style.cssText = "flex:none;";
    for (const [val, key] of [
      ["ask", "settings.switchSaveAsk"],
      ["save", "settings.switchSaveSave"],
      ["auto", "settings.switchSaveAuto"],
    ] as const) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = t(key);
      switchSel.appendChild(opt);
    }
    switchSel.value = st.switchSaveBehavior === "" ? "ask" : st.switchSaveBehavior;
    switchSel.addEventListener("change", () => {
      persistSwitchBehavior(switchSel.value as "ask" | "save" | "auto");
    });
    switchRow.append(switchLabel, switchSel);
    popover.appendChild(switchRow);

    const header = document.createElement("div");
    header.style.cssText =
      "padding:6px 12px;font-weight:600;border-top:1px solid rgba(var(--border-rgb),var(--border-opacity));border-bottom:1px solid rgba(var(--border-rgb),var(--border-opacity));margin:4px 0;";
    header.textContent = t("settings.shortcutsTitle");
    popover.appendChild(header);

    for (const id of ACTION_IDS) {
      const row = document.createElement("div");
      row.style.cssText = "padding:4px 12px;display:flex;gap:8px;align-items:center;";

      const label = document.createElement("span");
      label.style.cssText = "flex:1;";
      label.textContent = actionLabel(id);

      const cell = document.createElement("button");
      cell.className = "btn";
      cell.style.cssText = "min-width:90px;font-family:ui-monospace,Consolas,monospace;font-size:11px;";
      cell.type = "button";
      const isRecording = recordingId === id;
      cell.textContent = isRecording ? t("settings.recordingHint") : bindings[id];
      cell.classList.toggle("btn-primary", isRecording);
      cell.title = isRecording ? t("settings.recordingHint") : t("settings.clickToRecord");
      cell.addEventListener("click", (e) => {
        e.stopPropagation();
        recordingId = recordingId === id ? null : id;
        render();
      });
      row.append(label, cell);

      if (bindings[id] !== DEFAULT_SHORTCUTS[id]) {
        const resetBtn = document.createElement("button");
        resetBtn.className = "btn";
        resetBtn.type = "button";
        resetBtn.textContent = "↺";
        resetBtn.title = t("settings.resetThis");
        resetBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const overrides = { ...(sessionStore.getState().shortcuts ?? {}) };
          delete overrides[id];
          persistShortcuts(overrides);
        });
        row.appendChild(resetBtn);
      }
      popover.appendChild(row);
    }

    const footer = document.createElement("div");
    footer.style.cssText =
      "padding:6px 12px;display:flex;gap:8px;justify-content:space-between;align-items:center;border-top:1px solid rgba(var(--border-rgb),var(--border-opacity));margin-top:4px;";
    const aboutBtn = document.createElement("button");
    aboutBtn.className = "btn";
    aboutBtn.type = "button";
    aboutBtn.textContent = t("settings.aboutBtn");
    aboutBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      showAboutModal();
    });
    footer.appendChild(aboutBtn);

    const resetAllBtn = document.createElement("button");
    resetAllBtn.className = "btn";
    resetAllBtn.type = "button";
    resetAllBtn.textContent = t("settings.resetAll");
    resetAllBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      persistShortcuts({});
    });
    footer.appendChild(resetAllBtn);
    popover.appendChild(footer);
  }

  function onKey(e: KeyboardEvent): void {
    if (recordingId === null) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      recordingId = null;
      render();
      return;
    }
    const combo = encodeKeyCombo(e);
    if (!combo) return;
    e.preventDefault();
    e.stopPropagation();

    const bindings = currentBindings();
    const conflictId = ACTION_IDS.find((other) => other !== recordingId && bindings[other] === combo);
    if (conflictId) {
      showToast(
        t("settings.shortcutConflict")
          .replace("{combo}", combo)
          .replace("{action}", actionLabel(conflictId)),
        "warn",
      );
      recordingId = null;
      render();
      return;
    }

    const overrides = { ...(sessionStore.getState().shortcuts ?? {}) };
    if (combo === DEFAULT_SHORTCUTS[recordingId]) {
      delete overrides[recordingId];
    } else {
      overrides[recordingId] = combo;
    }
    recordingId = null;
    persistShortcuts(overrides);
  }
  document.addEventListener("keydown", onKey, true);

  function onDocClick(e: MouseEvent): void {
    if (popover.hidden) return;
    const target = e.target as Node;
    if (popover.contains(target) || triggerBtn.contains(target)) return;
    popover.hidden = true;
    recordingId = null;
  }
  document.addEventListener("mousedown", onDocClick);

  const unsubStore = sessionStore.subscribe(() => {
    if (!popover.hidden) render();
  });
  const unsubLang = subscribeLang(() => {
    if (!popover.hidden) render();
  });

  return {
    toggle(): void {
      if (popover.hidden) {
        recordingId = null;
        render();
        position();
        popover.hidden = false;
      } else {
        popover.hidden = true;
        recordingId = null;
      }
    },
    close(): void {
      popover.hidden = true;
      recordingId = null;
    },
    destroy(): void {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDocClick);
      unsubStore();
      unsubLang();
      popover.remove();
    },
  };
}
