// 前端主入口：根据 URL 查询参数分派主工作台、独立面板子窗口或参考图片子窗口。

import "./styles/theme.css";
import "./styles/motion.css";
import { applyTheme, defaultTheme } from "./stateStore/theme";
import { sessionStore } from "./stateStore";
import {
  initWorkspaceCache,
  updateWorkspace,
  upsertPanelCollapsed,
} from "./stateStore/workspacePersist";
import { mountPartPanel } from "./partPanel";
import { mountEditorCanvas } from "./editorCanvas";
import { mountLayerPanel } from "./layerPanel";
import { mountToolPanel } from "./toolPanel";
import { mountColorPalette } from "./colorPalette";
import { mountPreviewCanvas } from "./previewCanvas";
import { mountWingDebugPanel } from "./wingDebugPanel";
import { mountBloodPanel } from "./bloodPanel";
import { createDockable, registerDockHost, type DockableHandle } from "./dockHost";
import { getWorkspace, releaseImage, storeImage } from "./apiClient";
import { getSize, hydrateFromWorkspace, makeDragHandle, setPersistContext } from "./layoutEngine";
import type { PanelLayout } from "./stateStore/types";
import { subscribeLang, t } from "./i18n";
import { attachCloseGuard } from "./closeGuard";
import { mountImageWindow } from "./imageWindow";
import { startUpdateChecker } from "./updateChecker";
import { mountAutoSave } from "./autoSave";
import { showToast } from "./toast";
import { ICON_CLOSE, ICON_PIN, ICON_PIN_OFF, ICON_REATTACH } from "./toolPanel/toolIcons";

const APP_VERSION = "1.0.8";
const DEFAULT_SKIN_ROOT = "data/skin";
export const DEFAULT_WORKSPACE_PATH = "data/workspace.json";

window.addEventListener("error", (e) => reportError(e.message, e.error));
window.addEventListener("unhandledrejection", (e) => {
  const r = (e as PromiseRejectionEvent).reason;
  reportError(typeof r === "object" && r ? (r as { message?: string }).message ?? String(r) : String(r), r);
});

function reportError(msg: string, err: unknown): void {
  console.error("[main] runtime error", err);
  const root = document.getElementById("app");
  if (!root) return;
  const banner = document.createElement("div");
  banner.style.cssText =
    "position:fixed;left:8px;right:8px;top:8px;padding:8px 12px;" +
    "background:#fff5f5;border:1px solid #c00;color:#c00;border-radius:4px;" +
    "font:12px ui-monospace,Consolas,monospace;z-index:9999;white-space:pre-wrap;";
  banner.textContent = `运行时错误：${msg}\n详情见控制台（按 F12 打开开发者工具）`;
  root.appendChild(banner);
}

applyTheme(defaultTheme());

const panelIdParam = new URLSearchParams(location.search).get("panel");
const imageTokenParam = new URLSearchParams(location.search).get("image");

const workspaceSizeByPanelId = new Map<string, { width: number; height: number }>();
const workspaceCollapsedByPanelId = new Map<string, boolean>();
let lastLoadedPanels: PanelLayout[] = [];

const SINGLE_PANEL_CONFIG: Record<
  string,
  { titleKey: string; mount: (el: HTMLElement) => unknown }
> = {
  partPanel: { titleKey: "partPanel.title", mount: (el) => mountPartPanel(el, DEFAULT_SKIN_ROOT) },
  previewCanvas: { titleKey: "previewCanvas.title", mount: (el) => mountPreviewCanvas(el, DEFAULT_SKIN_ROOT) },
  layerPanel: { titleKey: "layerPanel.title", mount: (el) => mountLayerPanel(el, DEFAULT_SKIN_ROOT) },
  colorPalette: { titleKey: "colorPalette.title", mount: (el) => mountColorPalette(el) },
  editorCanvas: { titleKey: "editorCanvas.title", mount: (el) => mountEditorCanvas(el, DEFAULT_SKIN_ROOT) },
  wingDebugPanel: { titleKey: "wingDebugPanel.title", mount: (el) => mountWingDebugPanel(el, DEFAULT_SKIN_ROOT) },
  bloodPanel: { titleKey: "bloodPanel.title", mount: (el) => mountBloodPanel(el, DEFAULT_SKIN_ROOT) },
};

if (panelIdParam) {
  void mountSinglePanel(panelIdParam);
} else if (imageTokenParam) {
  void mountImageWindow(imageTokenParam);
} else {
  void mountMainWindow();
}

async function mountMainWindow(): Promise<void> {
  try {
    const ws = await initWorkspaceCache(DEFAULT_WORKSPACE_PATH);
    applyTheme(ws.theme);
    sessionStore.setState({
      theme: ws.theme,
      shortcuts: ws.layout.settings?.shortcuts,
      showMotionDebugPanel: ws.layout.settings?.showMotionDebugPanel ?? true,
      showWingDebugPanel: ws.layout.settings?.showWingDebugPanel ?? false,
      showBloodPanel: ws.layout.settings?.showBloodPanel ?? false,
      autoSaveEnabled: ws.layout.settings?.autoSaveEnabled ?? false,
      autoSaveIntervalSec: ws.layout.settings?.autoSaveIntervalSec ?? 60,
      switchSaveBehavior: ws.layout.settings?.switchSaveBehavior ?? "",
      softBrushHardness: ws.layout.settings?.softBrushHardness ?? 128,
    });
    if (ws.source === "file") {
      lastLoadedPanels = ws.layout.panels as PanelLayout[];
      for (const p of ws.layout.panels as PanelLayout[]) {
        workspaceSizeByPanelId.set(p.id, { width: p.size.width, height: p.size.height });
        workspaceCollapsedByPanelId.set(p.id, p.collapsed === true);
      }
      hydrateFromWorkspace(ws.layout);
    }
  } catch (e) {
    console.warn("[main] initWorkspaceCache failed, fallback to defaults", e);
  }
  mountApp();
  startUpdateChecker(APP_VERSION);
}

async function mountSinglePanel(id: string): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  const cfg = SINGLE_PANEL_CONFIG[id];
  if (!cfg) {
    root.textContent = `Unknown panel: ${id}`;
    return;
  }
  document.documentElement.style.height = "100%";
  document.body.style.height = "100%";
  root.style.cssText = "display:flex;flex-direction:column;height:100vh;width:100vw;overflow:hidden;";

  const toolbar = document.createElement("div");
  toolbar.className = "subwindow-toolbar";
  toolbar.style.cssText =
    "flex:none;display:flex;justify-content:flex-end;gap:4px;padding:4px 8px;" +
    "border-bottom:1px solid rgba(var(--border-rgb),var(--border-opacity));";
  const pinBtn = document.createElement("button");
  pinBtn.className = "btn cp-tool-btn";
  pinBtn.type = "button";
  pinBtn.innerHTML = ICON_PIN;
  const reattachBtn = document.createElement("button");
  reattachBtn.className = "btn cp-tool-btn";
  reattachBtn.type = "button";
  reattachBtn.innerHTML = ICON_REATTACH;
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn cp-tool-btn";
  closeBtn.type = "button";
  closeBtn.innerHTML = ICON_CLOSE;
  toolbar.append(pinBtn, reattachBtn, closeBtn);

  const panelHost = document.createElement("div");
  panelHost.style.cssText = "flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto;";
  root.append(toolbar, panelHost);

  const applyToolbarText = (): void => {
    pinBtn.title = t("common.alwaysOnTop");
    reattachBtn.title = t("common.reattachToMain");
    closeBtn.title = t("common.close");
  };
  applyToolbarText();

  try {
    const ws = await getWorkspace(DEFAULT_WORKSPACE_PATH);
    applyTheme(ws.theme);
    sessionStore.setState({
      theme: ws.theme,
      shortcuts: ws.layout.settings?.shortcuts,
      showMotionDebugPanel: ws.layout.settings?.showMotionDebugPanel ?? true,
      showWingDebugPanel: ws.layout.settings?.showWingDebugPanel ?? false,
      showBloodPanel: ws.layout.settings?.showBloodPanel ?? false,
    });
  } catch (e) {
    console.warn("[main] getWorkspace failed (single panel)", e);
  }
  cfg.mount(panelHost);
  document.title = t(cfg.titleKey);
  subscribeLang(() => {
    document.title = t(cfg.titleKey);
    applyToolbarText();
  });

  const tauri = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
  }).__TAURI_INTERNALS__;
  const invoke = tauri?.invoke;
  let alwaysOnTop = false;
  pinBtn.addEventListener("click", () => {
    alwaysOnTop = !alwaysOnTop;
    pinBtn.classList.toggle("btn-primary", alwaysOnTop);
    pinBtn.innerHTML = alwaysOnTop ? ICON_PIN_OFF : ICON_PIN;
    pinBtn.title = alwaysOnTop ? t("common.unpinFromTop") : t("common.alwaysOnTop");
    if (typeof invoke === "function") {
      invoke("plugin:window|set_always_on_top", { value: alwaysOnTop }).catch((e) => {
        console.warn("[subwindow] set_always_on_top failed", e);
        alwaysOnTop = !alwaysOnTop;
        pinBtn.classList.toggle("btn-primary", alwaysOnTop);
        pinBtn.innerHTML = alwaysOnTop ? ICON_PIN_OFF : ICON_PIN;
      });
    }
  });

  const closeSelf = (): void => {
    if (typeof invoke === "function") {
      invoke("plugin:window|close").catch(() => window.close());
    } else {
      window.close();
    }
  };
  reattachBtn.addEventListener("click", closeSelf);
  closeBtn.addEventListener("click", closeSelf);

  toolbar.style.cursor = "grab";
  toolbar.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    toolbar.style.cursor = "grabbing";
    if (typeof invoke === "function") {
      invoke("plugin:window|start_dragging").catch((err) => {
        console.warn("[subwindow] start_dragging failed", err);
      });
    }
  });
  document.addEventListener("mouseup", () => {
    toolbar.style.cursor = "grab";
  });
}

function mountApp(): void {
  const root = document.getElementById("app");
  if (!root) return;
  root.innerHTML =
    `<div id="app-shell" style="display:flex;flex-direction:column;height:100vh;box-sizing:border-box;overflow:hidden;">` +
    `<header id="app-tool-panel" style="flex:none;height:48px;margin:8px 8px 0;"></header>` +
    `<div style="flex:1;min-height:0;display:flex;gap:0;padding:8px;overflow:hidden;">` +
    `<aside id="app-sidebar-left" style="flex:0 0 ${getSize("mainPane.left") ?? 220}px;min-width:0;display:flex;"></aside>` +
    `<div class="layout-divider layout-divider-v" data-role="divider-left"></div>` +
    `<main id="app-editor" style="flex:1;min-width:0;display:flex;flex-direction:column;overflow:hidden;">` +
    `<div id="app-editor-canvas" style="flex:1;min-height:0;display:flex;overflow:hidden;"></div>` +
    `<div class="layout-divider layout-divider-h" data-role="divider-bottom"></div>` +
    `<div id="app-bottom-layers" style="flex:0 0 ${getSize("mainPane.bottom") ?? 200}px;min-height:0;display:flex;"></div>` +
    `</main>` +
    `<div class="layout-divider layout-divider-v" data-role="divider-preview"></div>` +
    `<section id="app-sidebar-preview" style="flex:0 0 ${getSize("mainPane.preview") ?? 320}px;min-width:0;display:flex;"></section>` +
    `<div class="layout-divider layout-divider-v" data-role="divider-right"></div>` +
    `<aside id="app-sidebar-right" style="flex:0 0 ${getSize("mainPane.right") ?? 280}px;min-width:0;display:flex;flex-direction:column;gap:8px;overflow-y:auto;overflow-x:hidden;"></aside>` +
    `</div>` +
    `</div>`;

  mountToolPanel(
    document.getElementById("app-tool-panel") as HTMLElement,
    DEFAULT_SKIN_ROOT,
    DEFAULT_WORKSPACE_PATH,
  );

  const panels: Array<{
    host: string;
    titleKey: string;
    panelId: string;
    initialSize: { width: number; height: number };
    mount: (el: HTMLElement, dock: DockableHandle) => unknown;
    flexContent?: boolean;
    fillHostHeight?: boolean;
  }> = [
    {
      host: "app-sidebar-left",
      titleKey: "partPanel.title",
      panelId: "partPanel",
      initialSize: { width: 240, height: 600 },
      mount: (el) => mountPartPanel(el, DEFAULT_SKIN_ROOT),
      fillHostHeight: true,
    },
    {
      host: "app-editor-canvas",
      titleKey: "editorCanvas.title",
      panelId: "editorCanvas",
      initialSize: { width: 480, height: 480 },
      mount: (el, dock) => mountEditorCanvas(el, DEFAULT_SKIN_ROOT, dock),
      flexContent: true,
      fillHostHeight: true,
    },
    {
      host: "app-sidebar-preview",
      titleKey: "previewCanvas.title",
      panelId: "previewCanvas",
      initialSize: { width: 320, height: 360 },
      mount: (el) => mountPreviewCanvas(el, DEFAULT_SKIN_ROOT),
      flexContent: true,
      fillHostHeight: true,
    },
    {
      host: "app-bottom-layers",
      titleKey: "layerPanel.title",
      panelId: "layerPanel",
      initialSize: { width: 480, height: 200 },
      mount: (el) => mountLayerPanel(el, DEFAULT_SKIN_ROOT),
      fillHostHeight: true,
    },
    {
      host: "app-sidebar-right",
      titleKey: "colorPalette.title",
      panelId: "colorPalette",
      initialSize: { width: 280, height: 520 },
      mount: (el) => mountColorPalette(el),
    },
    {
      host: "app-sidebar-right",
      titleKey: "wingDebugPanel.title",
      panelId: "wingDebugPanel",
      initialSize: { width: 280, height: 360 },
      mount: (el) => mountWingDebugPanel(el, DEFAULT_SKIN_ROOT),
    },
    {
      host: "app-sidebar-right",
      titleKey: "bloodPanel.title",
      panelId: "bloodPanel",
      initialSize: { width: 280, height: 420 },
      mount: (el) => mountBloodPanel(el, DEFAULT_SKIN_ROOT),
    },
  ];

  const dockTitleKeys: Array<{ dock: DockableHandle; titleKey: string }> = [];
  let wingDebugDock: DockableHandle | null = null;
  let bloodPanelDock: DockableHandle | null = null;

  for (const cfg of panels) {
    const host = document.getElementById(cfg.host) as HTMLElement;
    const persisted = workspaceSizeByPanelId.get(cfg.panelId);
    const dock = createDockable({
      title: t(cfg.titleKey),
      panelId: cfg.panelId,
      initialSize: persisted ?? cfg.initialSize,
    });
    if (cfg.host === "app-sidebar-right") {
      dock.rootEl.style.flex = "0 0 auto";
    }
    if (cfg.flexContent) {
      dock.contentEl.style.display = "flex";
      dock.contentEl.style.flexDirection = "column";
    }
    host.appendChild(dock.rootEl);
    registerDockHost(host, t(cfg.titleKey));
    cfg.mount(dock.contentEl, dock);
    dockTitleKeys.push({ dock, titleKey: cfg.titleKey });
    if (cfg.panelId === "wingDebugPanel") wingDebugDock = dock;
    if (cfg.panelId === "bloodPanel") bloodPanelDock = dock;
    if (workspaceCollapsedByPanelId.get(cfg.panelId)) {
      dock.collapse();
    }
    dock.onCollapsedChange((collapsed) => {
      workspaceCollapsedByPanelId.set(cfg.panelId, collapsed);
      updateWorkspace(
        DEFAULT_WORKSPACE_PATH,
        (draft) => {
          draft.layout.panels = upsertPanelCollapsed(
            draft.layout.panels,
            cfg.panelId,
            collapsed,
            cfg.initialSize,
          );
          lastLoadedPanels = draft.layout.panels;
        },
        300,
      );
    });
    queueMicrotask(() => {
      const r = host.getBoundingClientRect();
      if (r.width <= 0) return;
      if (cfg.fillHostHeight && r.height > 0) {
        dock.setSize(Math.round(r.width), Math.round(r.height));
      } else {
        dock.setSize(Math.round(r.width), (persisted ?? cfg.initialSize).height);
      }
    });
  }

  function applyWingDebugVisible(): void {
    if (!wingDebugDock) return;
    wingDebugDock.rootEl.style.display = sessionStore.getState().showWingDebugPanel ? "" : "none";
  }
  applyWingDebugVisible();
  let lastShowWing = sessionStore.getState().showWingDebugPanel;
  sessionStore.subscribe((s) => {
    if (s.showWingDebugPanel !== lastShowWing) {
      lastShowWing = s.showWingDebugPanel;
      applyWingDebugVisible();
    }
  });

  function applyBloodPanelVisible(): void {
    if (!bloodPanelDock) return;
    bloodPanelDock.rootEl.style.display = sessionStore.getState().showBloodPanel ? "" : "none";
  }
  applyBloodPanelVisible();
  let lastShowBlood = sessionStore.getState().showBloodPanel;
  sessionStore.subscribe((s) => {
    if (s.showBloodPanel !== lastShowBlood) {
      lastShowBlood = s.showBloodPanel;
      applyBloodPanelVisible();
    }
  });

  subscribeLang(() => {
    for (const { dock, titleKey } of dockTitleKeys) dock.setTitle(t(titleKey));
  });

  setPersistContext({
    workspacePath: DEFAULT_WORKSPACE_PATH,
    getPanels: () => lastLoadedPanels,
    getTheme: () => sessionStore.getState().theme,
  });

  const sidebarLeft = document.getElementById("app-sidebar-left") as HTMLElement;
  const sidebarPreview = document.getElementById("app-sidebar-preview") as HTMLElement;
  const sidebarRight = document.getElementById("app-sidebar-right") as HTMLElement;
  const bottomLayers = document.getElementById("app-bottom-layers") as HTMLElement;
  const dividerPlaceholders: Array<{ role: string; element: HTMLElement }> = [
    { role: "divider-left", element: makeDragHandle({ orientation: "vertical", key: "mainPane.left", host: sidebarLeft, sign: 1, getMin: () => 160, getMax: () => 600 }) },
    { role: "divider-preview", element: makeDragHandle({ orientation: "vertical", key: "mainPane.preview", host: sidebarPreview, sign: -1, getMin: () => 160, getMax: () => 600 }) },
    { role: "divider-right", element: makeDragHandle({ orientation: "vertical", key: "mainPane.right", host: sidebarRight, sign: -1, getMin: () => 160, getMax: () => 600 }) },
    { role: "divider-bottom", element: makeDragHandle({ orientation: "horizontal", key: "mainPane.bottom", host: bottomLayers, sign: -1, getMin: () => 100, getMax: () => 600 }) },
  ];
  for (const { role, element } of dividerPlaceholders) {
    const placeholder = document.querySelector<HTMLElement>(`[data-role="${role}"]`);
    if (placeholder) placeholder.replaceWith(element);
  }

  attachCloseGuard({ skinRoot: DEFAULT_SKIN_ROOT });
  mountAutoSave(DEFAULT_SKIN_ROOT);
  attachImageDropHandler();
}

const IMAGE_MIME_RE = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function attachImageDropHandler(): void {
  window.addEventListener("dragover", (e) => {
    if (e.dataTransfer && Array.from(e.dataTransfer.items).some((it) => it.kind === "file")) {
      e.preventDefault();
    }
  });
  window.addEventListener("drop", async (e) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => IMAGE_MIME_RE.test(f.type));
    if (files.length === 0) return;
    for (const file of files) {
      if (file.size > MAX_IMAGE_BYTES) {
        showToast(`${file.name}: ${t("imageWindow.tooLarge")}`, "error");
        continue;
      }
      try {
        const base64 = await readAsBase64(file);
        const token = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await storeImage(token, base64);
        await openImageWindow(token, file.name);
      } catch (err) {
        console.warn("[main] image drop failed", err);
        showToast(`${file.name}: ${(err as Error)?.message ?? String(err)}`, "error");
      }
    }
  });
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

async function openImageWindow(token: string, fileName: string): Promise<void> {
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
  }).__TAURI_INTERNALS__;
  const invoke = internals?.invoke;
  if (typeof invoke !== "function") {
    window.open(`?image=${encodeURIComponent(token)}`, "_blank");
    return;
  }
  try {
    await invoke("plugin:webview|create_webview_window", {
      options: {
        label: `image_${token}`,
        url: `index.html?image=${encodeURIComponent(token)}`,
        title: fileName,
        width: 480,
        height: 480,
        decorations: true,
        alwaysOnTop: false,
        parent: "main",
      },
    });
  } catch (e) {
    console.warn("[main] create image window failed", e);
    void releaseImage(token);
  }
}
