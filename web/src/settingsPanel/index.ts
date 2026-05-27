// settingsPanel：toolbar 上"设置"按钮的弹出面板。当前承载快捷键编辑 + 关于弹窗。
// 设计上独立于 toolPanel，避免那个文件继续膨胀；与 themeSettings popover 同范式。

import { sessionStore } from "../stateStore";
import { subscribeLang, t } from "../i18n";
import { getWorkspace, saveWorkspace } from "../apiClient";
import {
  ACTION_IDS,
  DEFAULT_SHORTCUTS,
  currentBindings,
  encodeKeyCombo,
  type ActionId,
} from "../shortcuts";

// 关于面板的元数据。version 与 src-tauri/Cargo.toml / tauri.conf.json 保持一致。
const APP_META = {
  // 与 src-tauri/Cargo.toml `version` 保持一致；版权字符串与 tauri.conf.json bundle.copyright 同步。
  name: "CasualtiesUnknown-SkinEditor",
  version: "1.0.4",
  authorName: "huanxin996",
  authorUrl: "https://github.com/huanxin996",
  repo: "https://github.com/huanxin996/CasualtiesUnknown-SkinEditor",
  copyright: "Copyright (c) 2026 huanxin996",
};

/** 把 popover 挂到 trigger 按钮下方。返回控制句柄：toggle / close / destroy。 */
export interface SettingsPopoverHandle {
  toggle(): void;
  close(): void;
  destroy(): void;
}

// 关于弹窗。半透明遮罩 + 居中卡片，含版本 / 作者 / 仓库链接 / 免责声明。
// 复用 panel 样式，按 Esc 或点遮罩关闭；同一时刻只允许一个实例。
let activeAboutModal: HTMLElement | null = null;
function showAboutModal(): void {
  if (activeAboutModal) return;
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1500;" +
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
  verRow.innerHTML = `<span style="opacity:0.6;">${t("settings.aboutVersion")}：</span><span class="mono">${APP_META.version}</span>`;

  // 作者名做成可点击元素调 tauri-plugin-opener 唤起系统浏览器；
  // Tauri webview 内 `<a target="_blank">` 默认不会跳系统浏览器（会被吞）。
  // Web 模式下回落到 window.open。
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
  authorRow.appendChild(authorLabel);
  authorRow.appendChild(authorLink);

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
  repoRow.appendChild(repoLabel);
  repoRow.appendChild(repoLink);
  meta.appendChild(verRow);
  meta.appendChild(authorRow);
  meta.appendChild(repoRow);
  const copyrightRow = document.createElement("div");
  copyrightRow.style.cssText = "opacity:0.55;font-size:12px;margin-top:2px;";
  copyrightRow.textContent = APP_META.copyright;
  meta.appendChild(copyrightRow);
  card.appendChild(meta);

  const disclaimer = document.createElement("div");
  disclaimer.style.cssText = "padding:8px 10px;background:rgba(0,0,0,0.04);border-radius:4px;font-size:12px;opacity:0.85;margin-bottom:12px;";
  disclaimer.textContent = t("settings.aboutDisclaimer");
  card.appendChild(disclaimer);

  // Star 求好评条：点击跳仓库。
  const starPlea = document.createElement("div");
  starPlea.style.cssText = "padding:8px 10px;background:rgba(255,196,0,0.10);border:1px solid rgba(255,196,0,0.35);border-radius:4px;font-size:12px;margin-bottom:12px;cursor:pointer;line-height:1.5;";
  starPlea.title = APP_META.repo;
  starPlea.textContent = t("settings.aboutStarPlea");
  starPlea.addEventListener("click", () => {
    openExternalUrl(APP_META.repo);
  });
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
  // 卡片内点击不冒泡到 overlay 关闭；不阻止链接默认行为。
  card.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("keydown", onKey, true);
}

// 调系统默认浏览器打开 URL。Tauri 走 plugin:opener；Web / fallback 走 window.open。
function openExternalUrl(url: string): void {
  if (!url) return;
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
  }).__TAURI_INTERNALS__;
  const invoke = internals?.invoke;
  if (typeof invoke === "function") {
    invoke("plugin:opener|open_url", { url }).catch((e) => {
      console.warn(`[settingsPanel] open_url failed: ${String(e)}`);
      // Tauri 调用失败时退回浏览器 window.open，至少给用户一次机会。
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
    "overflow:auto;padding:8px 0;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.15);";
  document.body.appendChild(popover);

  // 当前正在录制快捷键的 action id；null 表示未在录制。
  let recordingId: ActionId | null = null;

  function position(): void {
    const rect = triggerBtn.getBoundingClientRect();
    popover.style.right = `${window.innerWidth - rect.right}px`;
    popover.style.top = `${rect.bottom + 4}px`;
    popover.style.left = "auto";
  }

  function render(): void {
    const bindings = currentBindings();
    popover.innerHTML = "";

    const debugHeader = document.createElement("div");
    debugHeader.style.cssText = "padding:6px 12px;font-weight:600;border-bottom:1px solid rgba(0,0,0,var(--border-opacity));margin-bottom:4px;";
    debugHeader.textContent = t("settings.debugTitle");
    popover.appendChild(debugHeader);

    const debugRow = document.createElement("label");
    debugRow.style.cssText = "padding:8px 12px;display:flex;gap:8px;align-items:center;cursor:pointer;";
    const debugCb = document.createElement("input");
    debugCb.type = "checkbox";
    debugCb.checked = sessionStore.getState().showMotionDebugPanel;
    const debugLabel = document.createElement("span");
    debugLabel.style.cssText = "flex:1;";
    debugLabel.textContent = t("settings.showMotionDebugPanel");
    debugCb.addEventListener("change", () => {
      const checked = debugCb.checked;
      sessionStore.setState({ showMotionDebugPanel: checked });
      void getWorkspace(workspacePath)
        .then((ws) => saveWorkspace(workspacePath, {
          ...ws.layout,
          settings: {
            ...(ws.layout.settings ?? { showMotionDebugPanel: true, showWingDebugPanel: false, showBloodPanel: false }),
            showMotionDebugPanel: checked,
          },
        }, ws.theme))
        .catch((e) => {
          console.warn(`[settingsPanel] persist showMotionDebugPanel failed: ${String(e)}`);
        });
    });
    debugRow.appendChild(debugCb);
    debugRow.appendChild(debugLabel);
    popover.appendChild(debugRow);

    // 翼装配调试面板开关：默认关闭，勾选后右栏显示翅膀调试面板。
    const wingRow = document.createElement("label");
    wingRow.style.cssText = "padding:8px 12px;display:flex;gap:8px;align-items:center;cursor:pointer;";
    const wingCb = document.createElement("input");
    wingCb.type = "checkbox";
    wingCb.checked = sessionStore.getState().showWingDebugPanel;
    const wingLabel = document.createElement("span");
    wingLabel.style.cssText = "flex:1;";
    wingLabel.textContent = t("settings.showWingDebugPanel");
    wingCb.addEventListener("change", () => {
      const checked = wingCb.checked;
      sessionStore.setState({ showWingDebugPanel: checked });
      void getWorkspace(workspacePath)
        .then((ws) => saveWorkspace(workspacePath, {
          ...ws.layout,
          settings: {
            ...(ws.layout.settings ?? { showMotionDebugPanel: true, showWingDebugPanel: false, showBloodPanel: false }),
            showWingDebugPanel: checked,
          },
        }, ws.theme))
        .catch((e) => {
          console.warn(`[settingsPanel] persist showWingDebugPanel failed: ${String(e)}`);
        });
    });
    wingRow.appendChild(wingCb);
    wingRow.appendChild(wingLabel);
    popover.appendChild(wingRow);

    // 血液粒子面板开关：默认关闭，勾选后右栏显示 BloodPanel。
    const bloodRow = document.createElement("label");
    bloodRow.style.cssText = "padding:8px 12px;display:flex;gap:8px;align-items:center;cursor:pointer;";
    const bloodCb = document.createElement("input");
    bloodCb.type = "checkbox";
    bloodCb.checked = sessionStore.getState().showBloodPanel;
    const bloodLabel = document.createElement("span");
    bloodLabel.style.cssText = "flex:1;";
    bloodLabel.textContent = t("settings.showBloodPanel");
    bloodCb.addEventListener("change", () => {
      const checked = bloodCb.checked;
      sessionStore.setState({ showBloodPanel: checked });
      void getWorkspace(workspacePath)
        .then((ws) => saveWorkspace(workspacePath, {
          ...ws.layout,
          settings: {
            ...(ws.layout.settings ?? { showMotionDebugPanel: true, showWingDebugPanel: false, showBloodPanel: false }),
            showBloodPanel: checked,
          },
        }, ws.theme))
        .catch((e) => {
          console.warn(`[settingsPanel] persist showBloodPanel failed: ${String(e)}`);
        });
    });
    bloodRow.appendChild(bloodCb);
    bloodRow.appendChild(bloodLabel);
    popover.appendChild(bloodRow);

    const header = document.createElement("div");
    header.style.cssText = "padding:6px 12px;font-weight:600;border-top:1px solid rgba(0,0,0,var(--border-opacity));border-bottom:1px solid rgba(0,0,0,var(--border-opacity));margin:4px 0;";
    header.textContent = t("settings.shortcutsTitle");
    popover.appendChild(header);

    for (const id of ACTION_IDS) {
      const row = document.createElement("div");
      row.style.cssText = "padding:4px 12px;display:flex;gap:8px;align-items:center;";

      const label = document.createElement("span");
      label.style.cssText = "flex:1;";
      label.textContent = t(`settings.action_${id.replace(".", "_")}`);

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
      row.appendChild(label);
      row.appendChild(cell);

      // 仅当用户改过默认值时显示"重置"小按钮，避免每行都堆 UI。
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
          sessionStore.setState({ shortcuts: overrides });
        });
        row.appendChild(resetBtn);
      }
      popover.appendChild(row);
    }

    const footer = document.createElement("div");
    footer.style.cssText = "padding:6px 12px;display:flex;gap:8px;justify-content:space-between;align-items:center;border-top:1px solid rgba(0,0,0,var(--border-opacity));margin-top:4px;";
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
      sessionStore.setState({ shortcuts: {} });
    });
    footer.appendChild(resetAllBtn);
    popover.appendChild(footer);
  }

  // 录制态全局监听一次按键：写入 sessionStore.shortcuts；Esc 取消。
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
    const overrides = { ...(sessionStore.getState().shortcuts ?? {}) };
    overrides[recordingId] = combo;
    recordingId = null;
    sessionStore.setState({ shortcuts: overrides });
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

  // sessionStore.shortcuts 变化时重渲染（用户改键 / 重置 都即时反映）。
  const unsubStore = sessionStore.subscribe(() => {
    if (!popover.hidden) render();
  });
  // 语言切换时刷新 label。
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
