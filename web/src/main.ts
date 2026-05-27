import "./styles/theme.css";
import "./styles/motion.css";
import { applyTheme, defaultTheme } from "./stateStore/theme";
import { sessionStore } from "./stateStore";
import { mountPartPanel } from "./partPanel";
import { mountEditorCanvas } from "./editorCanvas";
import { mountLayerPanel } from "./layerPanel";
import { mountToolPanel } from "./toolPanel";
import { mountColorPalette } from "./colorPalette";
import { mountPreviewCanvas } from "./previewCanvas";
import { mountWingDebugPanel } from "./wingDebugPanel";
import { mountBloodPanel } from "./bloodPanel";
import { createDockable, registerDockHost, type DockableHandle } from "./dockHost";
import { getWorkspace } from "./apiClient";
import { saveWorkspace } from "./apiClient";
import { hydrateFromWorkspace, makeDragHandle, getSize, setPersistContext } from "./layoutEngine";
import type { PanelLayout } from "./stateStore/types";
import { subscribeLang, t } from "./i18n";
import { attachCloseGuard } from "./closeGuard";
import { mountImageWindow } from "./imageWindow";
import { storeImage, releaseImage } from "./apiClient";
import { startUpdateChecker } from "./updateChecker";

// 与 src-tauri/Cargo.toml `version` / settingsPanel APP_META.version 保持一致。
const APP_VERSION = "1.0.2";
import {
  ICON_PIN,
  ICON_PIN_OFF,
  ICON_REATTACH,
  ICON_CLOSE,
} from "./toolPanel/toolIcons";

// 全局错误兜底：万一 mountApp 抛异常或异步 reject，把错误显示在 #app 内而非
// 留下空白窗口让用户误判为"加载失败"。Tauri 桌面壳与 Web 模式都生效。
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

const DEFAULT_SKIN_ROOT = "data/skin";
// workspace.json 默认与 assembly.json 同级，便于皮肤目录整体迁移。
export const DEFAULT_WORKSPACE_PATH = "data/workspace.json";

applyTheme(defaultTheme());

// 子窗口启动时通过 URL `?panel=<id>` 仅渲染单个面板，独占整个 webview。
// 每个 webview 独立 JS heap，子窗口的 sessionStore 与主窗口不共享。
const panelIdParam = new URLSearchParams(location.search).get("panel");
const imageTokenParam = new URLSearchParams(location.search).get("image");

// 启动时拉 workspace.json，按 panelId 把持久化 size 覆盖到下面的 dockable initialSize；
// theme 同步写到 CSS 变量。失败 / fallback 都用默认值，不阻塞挂载。
// vite build 默认目标不支持 top-level await，挂载逻辑包在 async 函数内。
const workspaceSizeByPanelId = new Map<string, { width: number; height: number }>();
const workspaceCollapsedByPanelId = new Map<string, boolean>();
// 4 个 mainPane.* size 持久化到 workspace.json 的 sizes 字段。
let lastLoadedPanels: PanelLayout[] = [];

// panelId → 挂载函数 + 标题 i18n key。
// SINGLE_PANEL_CONFIG 必须在 mountSinglePanel 同步调用之前声明：const 表只提升声明
// 不提升初始化，子窗口入口 `?panel=xxx` 同步走 mountSinglePanel，进入 await 之前
// 就读取 SINGLE_PANEL_CONFIG[id]，否则触发 TDZ。
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
  mountImageWindow(imageTokenParam);
} else {
  void mountMainWindow();
}

async function mountMainWindow(): Promise<void> {
  try {
    const ws = await getWorkspace(DEFAULT_WORKSPACE_PATH);
    applyTheme(ws.theme);
    // 同步到 sessionStore，让主题 popover 在刷新后能回显持久化颜色。
    sessionStore.setState({
      theme: ws.theme,
      showMotionDebugPanel: ws.layout.settings?.showMotionDebugPanel ?? true,
      showWingDebugPanel: ws.layout.settings?.showWingDebugPanel ?? false,
      showBloodPanel: ws.layout.settings?.showBloodPanel ?? false,
    });
    if (ws.source === "file") {
      lastLoadedPanels = ws.layout.panels as PanelLayout[];
      for (const p of ws.layout.panels as PanelLayout[]) {
        workspaceSizeByPanelId.set(p.id, { width: p.size.width, height: p.size.height });
        workspaceCollapsedByPanelId.set(p.id, p.collapsed === true);
      }
      // 列宽 / 行高交给 layoutEngine 反序列化（含 splitRatios → sizes 兼容）。
      hydrateFromWorkspace(ws.layout);
    }
  } catch (e) {
    console.warn("[main] getWorkspace failed, fallback to defaults", e);
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
  // 子窗口尺寸自适应：viewport 占满，根容器 flex column 撑开整个面板。
  document.documentElement.style.height = "100%";
  document.body.style.height = "100%";
  root.style.cssText = "display:flex;flex-direction:column;height:100vh;width:100vw;overflow:hidden;";
  // 子窗口顶部自渲染工具栏：置顶 / 嵌回主窗口 / 关闭。
  // 系统标题栏仍由 Tauri 默认 decorations 提供。
  const toolbar = document.createElement("div");
  toolbar.className = "subwindow-toolbar";
  toolbar.style.cssText =
    "flex:none;display:flex;justify-content:flex-end;gap:4px;padding:4px 8px;" +
    "border-bottom:1px solid rgba(0,0,0,var(--border-opacity));";
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
  toolbar.appendChild(pinBtn);
  toolbar.appendChild(reattachBtn);
  toolbar.appendChild(closeBtn);
  const panelHost = document.createElement("div");
  panelHost.style.cssText = "flex:1;min-height:0;display:flex;flex-direction:column;overflow:auto;";
  root.appendChild(toolbar);
  root.appendChild(panelHost);
  // i18n tooltip 跟主窗口的 dockable 工具栏一致。
  const applyToolbarText = (): void => {
    pinBtn.title = t("common.alwaysOnTop");
    reattachBtn.title = t("common.reattachToMain");
    closeBtn.title = t("common.close");
  };
  applyToolbarText();
  // 子窗口主题尽量与主窗口一致：拉 workspace 失败则保留 defaultTheme()，不阻塞渲染。
  try {
    const ws = await getWorkspace(DEFAULT_WORKSPACE_PATH);
    applyTheme(ws.theme);
    sessionStore.setState({
      theme: ws.theme,
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

  // 三个按钮统一通过 Tauri invoke 落地；非 Tauri（dev 浏览器单开页）下仅前端 close。
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
        // 失败回退按钮态，避免 UI 误判
        alwaysOnTop = !alwaysOnTop;
        pinBtn.classList.toggle("btn-primary", alwaysOnTop);
        pinBtn.innerHTML = alwaysOnTop ? ICON_PIN_OFF : ICON_PIN;
      });
    }
  });
  // "嵌回主窗口"与关闭等价——主窗口的 watchPanelClosed 探测到子窗口消失会
  // 自动 dockTo 原 host。比让前端跨窗口 emit 复杂事件简单得多。
  const closeSelf = (): void => {
    if (typeof invoke === "function") {
      invoke("plugin:window|close").catch(() => window.close());
    } else {
      window.close();
    }
  };
  reattachBtn.addEventListener("click", closeSelf);
  closeBtn.addEventListener("click", closeSelf);

  // 拖到主窗口顶栏自动嵌回：工具栏空白区作拖拽热区，mousedown 立刻调
  // plugin:window|start_dragging 让 OS 接管窗口拖动；主窗口端轮询子窗口位置，
  // 命中顶栏 dock zone 即关闭子窗口。
  // 子窗口侧只需触发 OS 拖拽，无需自己跟踪坐标。
  toolbar.addEventListener("mousedown", (e) => {
    // 按钮区按下不拖：用 closest 过滤 button。
    if ((e.target as HTMLElement).closest("button")) return;
    if (typeof invoke === "function") {
      invoke("plugin:window|start_dragging").catch((err) => {
        console.warn("[subwindow] start_dragging failed", err);
      });
    }
  });
  toolbar.style.cursor = "grab";
  toolbar.addEventListener("mousedown", () => { toolbar.style.cursor = "grabbing"; });
  document.addEventListener("mouseup", () => { toolbar.style.cursor = "grab"; });
}

function mountApp(): void {
  const root = document.getElementById("app");
  if (!root) return;
  // 自适应布局：所有 sidebar host 用 flex basis 分配；canvas 中列弹性；
  // dockable 在 host 内按自身 width/height 渲染，画布与其他容器互不遮挡。
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
    `<aside id="app-sidebar-right" style="flex:0 0 ${getSize("mainPane.right") ?? 280}px;min-width:0;display:flex;"></aside>` +
    `</div>` +
    `</div>`;

  mountToolPanel(
    document.getElementById("app-tool-panel") as HTMLElement,
    DEFAULT_SKIN_ROOT,
    DEFAULT_WORKSPACE_PATH,
  );

  // 收集 DockableHandle 备用。app-shell 是单例 SPA，不会重新挂载，无需主动 destroy。
  const dockables: DockableHandle[] = [];
  const panels: Array<{
    host: string;
    titleKey: string;
    panelId: string;
    initialSize: { width: number; height: number };
    mount: (el: HTMLElement, dock: DockableHandle) => unknown;
    // previewCanvas 内部依赖外层 flex column 才能让 stage 区占据剩余空间。
    flexContent?: boolean;
  }> = [
    {
      host: "app-sidebar-left",
      titleKey: "partPanel.title",
      panelId: "partPanel",
      initialSize: { width: 240, height: 600 },
      mount: (el) => mountPartPanel(el, DEFAULT_SKIN_ROOT),
    },
    {
      host: "app-editor-canvas",
      titleKey: "editorCanvas.title",
      panelId: "editorCanvas",
      initialSize: { width: 480, height: 480 },
      mount: (el, dock) => mountEditorCanvas(el, DEFAULT_SKIN_ROOT, dock),
      flexContent: true,
    },
    {
      host: "app-sidebar-preview",
      titleKey: "previewCanvas.title",
      panelId: "previewCanvas",
      initialSize: { width: 320, height: 360 },
      mount: (el) => mountPreviewCanvas(el, DEFAULT_SKIN_ROOT),
      flexContent: true,
    },
    {
      host: "app-bottom-layers",
      titleKey: "layerPanel.title",
      panelId: "layerPanel",
      initialSize: { width: 480, height: 200 },
      mount: (el) => mountLayerPanel(el, DEFAULT_SKIN_ROOT),
    },
    {
      host: "app-sidebar-right",
      titleKey: "colorPalette.title",
      panelId: "colorPalette",
      initialSize: { width: 280, height: 600 },
      mount: (el) => mountColorPalette(el),
    },
    {
      host: "app-sidebar-right",
      titleKey: "wingDebugPanel.title",
      panelId: "wingDebugPanel",
      initialSize: { width: 280, height: 600 },
      mount: (el) => mountWingDebugPanel(el, DEFAULT_SKIN_ROOT),
    },
    {
      host: "app-sidebar-right",
      titleKey: "bloodPanel.title",
      panelId: "bloodPanel",
      initialSize: { width: 280, height: 600 },
      mount: (el) => mountBloodPanel(el, DEFAULT_SKIN_ROOT),
    },
  ];
  // dock 与 titleKey 映射：lang 切换时遍历重写每个 dockable 的标题。
  const dockTitleKeys: Array<{ dock: DockableHandle; titleKey: string }> = [];
  let wingDebugDock: DockableHandle | null = null;
  let bloodPanelDock: DockableHandle | null = null;

  // dock 折叠状态写盘：300ms debounce，按 collapsed map 覆盖现有 panels 整体写回。
  let collapsedSaveTimer: number | null = null;
  function schedulePersistCollapsed(): void {
    if (collapsedSaveTimer !== null) window.clearTimeout(collapsedSaveTimer);
    collapsedSaveTimer = window.setTimeout(() => {
      collapsedSaveTimer = null;
      void getWorkspace(DEFAULT_WORKSPACE_PATH).then((ws) => {
        const panels = ws.layout.panels.map((p) => {
          const c = workspaceCollapsedByPanelId.get(p.id);
          return c === undefined ? p : { ...p, collapsed: c };
        });
        return saveWorkspace(DEFAULT_WORKSPACE_PATH, { ...ws.layout, panels }, ws.theme);
      }).catch((e) => console.warn("[main] persist collapsed failed", e));
    }, 300);
  }
  for (const cfg of panels) {
    const host = document.getElementById(cfg.host) as HTMLElement;
    const persisted = workspaceSizeByPanelId.get(cfg.panelId);
    const dock = createDockable({
      title: t(cfg.titleKey),
      panelId: cfg.panelId,
      initialSize: persisted ?? cfg.initialSize,
      // dockable 不再强制 fill 100%——按自身 width/height 渲染让边把手能自由 resize；
      // CSS 上加 max-width/max-height: 100% 防溢出遮挡邻居 host。
    });
    if (cfg.flexContent) {
      dock.contentEl.style.display = "flex";
      dock.contentEl.style.flexDirection = "column";
    }
    host.appendChild(dock.rootEl);
    registerDockHost(host, t(cfg.titleKey));
    cfg.mount(dock.contentEl, dock);
    dockables.push(dock);
    dockTitleKeys.push({ dock, titleKey: cfg.titleKey });
    if (cfg.panelId === "wingDebugPanel") wingDebugDock = dock;
    if (cfg.panelId === "bloodPanel") bloodPanelDock = dock;
    if (workspaceCollapsedByPanelId.get(cfg.panelId)) {
      dock.collapse();
    }
    dock.onCollapsedChange((collapsed) => {
      workspaceCollapsedByPanelId.set(cfg.panelId, collapsed);
      schedulePersistCollapsed();
    });
    // 启动时让 dockable 视觉填满 host：取 host 实际尺寸塞回 dockable 自身 width/height，
    // 后续用户拖边把手按数值自由调节，max-width/max-height: 100% 防溢出邻居。
    queueMicrotask(() => {
      const r = host.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) dock.setSize(Math.round(r.width), Math.round(r.height));
    });
  }

  // 翼调试面板默认隐藏；订阅 sessionStore.showWingDebugPanel 切 display。
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

  // 血液粒子面板默认隐藏；与 wing debug 同模式。
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

  // lang 切换时仅刷新 dockable 标题，不重新挂载面板，保留交互状态。
  subscribeLang(() => {
    for (const { dock, titleKey } of dockTitleKeys) dock.setTitle(t(titleKey));
  });
  // 4 个 layout-divider 由 layoutEngine 接管：拖动改 flex-basis + debounce 写盘。
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

  // 主窗口启动后挂关闭守卫：未保存退出确认。
  attachCloseGuard({ skinRoot: DEFAULT_SKIN_ROOT });

  // 图片拖入：HTML5 dragover/drop 监听，常见格式 → dataURL → localStorage → 子窗口。
  attachImageDropHandler();
}

const IMAGE_MIME_RE = /^image\/(png|jpe?g|gif|webp|bmp|svg\+xml)$/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB；dataURL 编码后约 10.7MB，留 localStorage 配额余量

function attachImageDropHandler(): void {
  // dragover 必须 preventDefault 才能触发 drop。监听 window 全局，覆盖任何子区域。
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
        showDropToast(`${file.name}: ${t("imageWindow.tooLarge")}`, "error");
        continue;
      }
      try {
        const base64 = await readAsBase64(file);
        const token = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        // 把字节存到 Rust 端进程内存，子窗口通过同 token 取回，主窗口取色也用 token 找像素。
        await storeImage(token, base64);
        await openImageWindow(token, file.name);
      } catch (err) {
        console.warn("[main] image drop failed", err);
        showDropToast(`${file.name}: ${(err as Error)?.message ?? String(err)}`, "error");
      }
    }
  });
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      // dataURL 形如 "data:image/png;base64,..."；后端会自己识别前缀。
      resolve(result);
    };
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
    // Web 模式无法开真窗口：降级为新标签页。
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
        // parent 让子窗口与主窗口建立 OS 级 owner 关系：主窗口最小化时子窗口跟随。
        parent: "main",
      },
    });
  } catch (e) {
    console.warn("[main] create image window failed", e);
    // 创建失败回收 token 释放内存
    void releaseImage(token);
  }
}

function showDropToast(message: string, kind: "info" | "warn" | "error"): void {
  // 内联 toast 避免 main.ts 反向依赖 toolPanel。复用 .toast 样式族。
  import("./toast").then(({ showToast }) => showToast(message, kind));
}
