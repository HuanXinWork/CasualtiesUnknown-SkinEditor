// dockable panel 框架。内嵌 dock 区行为：
// 标题栏（双击折叠/展开 + 拖拽移位 + 右键上下文菜单）+ 4 边 resize 把手 + 最小尺寸 160×120。
//
// 拖拽语义：
//   - docked 拖拽 = 在已注册 dock host 之间移位（实时跟光标 + 高亮槽）；
//     mouseup 命中 host → dockTo；viewport 内未命中 → 回原 host；
//     拖出 viewport（client 坐标越界）→ detach。
//   - 右键标题栏弹上下文菜单"在新窗口打开"作显式 detach 入口。
//   - detach 后原 host 加 dataset.detached + display:none 释放占位；attach 时清掉。
//
// state ∈ {"docked", "floating"}，floating 是页面内 position:fixed 浮动卡片；
// 高亮槽 .dock-zone-highlight 由 main.ts registerDockHost 登记后渲染。
//
// Tauri 子窗口：detach 入口先尝试 plugin:webview|create_webview_window，
// 失败时 toast.warn 后回退浮动卡片。

import { getRuntimeMode } from "../runtimeMode";
import { showToast } from "../toast";
import { subscribeLang, t } from "../i18n";
import { ICON_PIN, ICON_CHEVRON_DOWN, ICON_CHEVRON_RIGHT } from "../toolPanel/toolIcons";

const MIN_WIDTH = 160;
const MIN_HEIGHT = 120;
const TITLE_HEIGHT = 24;
const DRAG_START_PX = 4;

export interface DockableOptions {
  title: string;
  initialSize: { width: number; height: number };
  collapsible?: boolean;
  resizable?: boolean;
  /** 子窗口对应的面板 ID，传给 Tauri 子窗口 URL `?panel=<id>`。
   *  Web 模式与 Tauri 创建失败回退浮动卡片时不使用。 */
  panelId?: string;
}

export interface DockableHandle {
  rootEl: HTMLElement;
  contentEl: HTMLElement;
  setSize(width: number, height: number): void;
  setTitle(text: string): void;
  /** 在标题文字右侧显示一个状态徽标。text 为空字符串时隐藏。
   *  variant 控制颜色（默认/正常/警告），与 toast 同色板复用 CSS class。 */
  setTitleBadge(text: string, variant?: "default" | "ok" | "warn"): void;
  collapse(): void;
  expand(): void;
  toggle(): void;
  isCollapsed(): boolean;
  /** 折叠状态变化（collapse/expand/toggle 均触发，初次状态不触发）；返回解订阅函数。 */
  onCollapsedChange(cb: (collapsed: boolean) => void): () => void;
  getState(): "docked" | "floating";
  floatAt(x: number, y: number): void;
  dockTo(host: HTMLElement): void;
  setAlwaysOnTop(value: boolean): void;
  isAlwaysOnTop(): boolean;
  destroy(): void;
}

// 已注册 dock host 集合。main.ts 在创建内嵌 host 后逐个登记，
// 拖拽 floating dockable 时遍历命中以决定释放目标与高亮槽。
const dockHosts = new Set<HTMLElement>();

export function registerDockHost(host: HTMLElement, _label?: string): () => void {
  dockHosts.add(host);
  return () => {
    dockHosts.delete(host);
  };
}

function hitDockHost(x: number, y: number): HTMLElement | null {
  for (const host of dockHosts) {
    const r = host.getBoundingClientRect();
    // 零矩形（detach 后 display:none）跳过，避免被 0,0,0,0 矩形误命中。
    if (r.width === 0 || r.height === 0) continue;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return host;
  }
  return null;
}

// 拖拽期间临时恢复所有 detached host 的显示，让用户能把卡片拖回 detach 留下的空槽
// （高亮槽 + getBoundingClientRect 都需要 host 实际可见）。
// mouseup 后由 rehideDetachedHostsAfterDrag 把仍是 detached 的恢复隐藏；
// 已被 dockTo 命中的由 clearHostPlaceholder 自然清掉。
function revealDetachedHostsForDrag(): HTMLElement[] {
  const restored: HTMLElement[] = [];
  for (const host of dockHosts) {
    if (host.dataset.detached === "1") {
      host.style.display = "";
      restored.push(host);
    }
  }
  return restored;
}

function rehideDetachedHostsAfterDrag(restored: HTMLElement[]): void {
  for (const host of restored) {
    if (host.dataset.detached === "1") {
      host.style.display = "none";
    }
  }
}

// viewport 越界判定：mouseup 时鼠标超出主窗口可视区即 detach。
// 用 documentElement.clientWidth/Height 而非 window.innerWidth，与 getBoundingClientRect 同坐标系。
function isOutsideViewport(x: number, y: number): boolean {
  const w = document.documentElement.clientWidth;
  const h = document.documentElement.clientHeight;
  return x < 0 || y < 0 || x > w || y > h;
}

// 极简右键菜单：position:fixed <ul>，z-index 1600。
// 点击外部 / 选中条目 / Esc 自动关闭。同时只允许存在一个菜单。
let activeContextMenu: HTMLElement | null = null;
function showContextMenu(
  x: number,
  y: number,
  items: Array<{ label: string; action: () => void }>,
): void {
  if (activeContextMenu) {
    activeContextMenu.remove();
    activeContextMenu = null;
  }
  const ul = document.createElement("ul");
  ul.className = "dock-context-menu";
  ul.style.left = `${x}px`;
  ul.style.top = `${y}px`;
  for (const it of items) {
    const li = document.createElement("li");
    li.textContent = it.label;
    li.addEventListener("mousedown", (e) => {
      e.stopPropagation();
      e.preventDefault();
      close();
      it.action();
    });
    ul.appendChild(li);
  }
  document.body.appendChild(ul);
  activeContextMenu = ul;

  function close(): void {
    if (activeContextMenu === ul) activeContextMenu = null;
    ul.remove();
    document.removeEventListener("mousedown", onOutside, true);
    document.removeEventListener("keydown", onKey, true);
  }
  function onOutside(e: MouseEvent): void {
    if (!ul.contains(e.target as Node)) close();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
  document.addEventListener("mousedown", onOutside, true);
  document.addEventListener("keydown", onKey, true);
}

// 通过 Tauri v2 内置命令创建子窗口。capabilities 已授予 create-webview-window 权限。
// 失败时返回 false，由调用方走回退浮动卡片路径。
async function tryCreateTauriWindow(
  panelId: string,
  title: string,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<boolean> {
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
  }).__TAURI_INTERNALS__;
  const invoke = internals?.invoke;
  if (typeof invoke !== "function") return false;
  try {
    await invoke("plugin:webview|create_webview_window", {
      options: {
        label: `panel_${panelId}`,
        url: `index.html?panel=${panelId}`,
        title,
        x,
        y,
        width: w,
        height: h,
        decorations: true,
        alwaysOnTop: false,
      },
    });
    return true;
  } catch {
    return false;
  }
}

// 子窗口关闭后回归主窗口：detach 后定时（800ms）查询子窗口是否还存在，
// 通过 plugin:webview|webview_position 在窗口已销毁时 reject 来判断。
// 检测到关闭则触发回归回调，由调用方 dockTo 原 host。
function watchPanelClosed(panelId: string, cb: () => void): () => void {
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
  }).__TAURI_INTERNALS__;
  const invoke = internals?.invoke;
  if (typeof invoke !== "function") return () => {};
  let stopped = false;
  const timer = window.setInterval(async () => {
    if (stopped) return;
    try {
      // 注意：这里 label 必须与 tryCreateTauriWindow 里一致（panel_<id>）。
      await invoke("plugin:webview|webview_position", { label: `panel_${panelId}` });
    } catch {
      // 子窗口不存在 → 已关闭，触发回归。
      stopped = true;
      window.clearInterval(timer);
      cb();
    }
  }, 800);
  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

// 拖到主窗口顶栏自动嵌回——主窗口端轮询。
// 子窗口拖拽期间用 OS start_dragging 接管，子窗口前端拿不到 mouseup；
// 主窗口侧每 150ms 查询子窗口位置 + 主窗口位置，子窗口标题中点进入主窗口
// 顶栏 dock zone 时高亮提示；位置稳定 ≥ 2 个 tick 仍在 zone 内则关闭子窗口
// （触发 watchPanelClosed → 自动 dock 回原 host）。
// 与 watchPanelClosed 互不冲突——后者监测窗口消失才 cb。
const DRAG_DOCK_ZONE_HEIGHT = 48; // 主窗口顶栏 px 高度
const DRAG_POLL_MS = 150;
const DRAG_STABLE_TICKS = 2;
let dragHighlightEl: HTMLElement | null = null;
function showMainTopHighlight(): void {
  if (dragHighlightEl) return;
  dragHighlightEl = document.createElement("div");
  dragHighlightEl.className = "dock-zone-highlight active";
  dragHighlightEl.style.left = "0px";
  dragHighlightEl.style.top = "0px";
  dragHighlightEl.style.width = "100%";
  dragHighlightEl.style.height = `${DRAG_DOCK_ZONE_HEIGHT}px`;
  dragHighlightEl.style.pointerEvents = "none";
  document.body.appendChild(dragHighlightEl);
}
function hideMainTopHighlight(): void {
  if (!dragHighlightEl) return;
  dragHighlightEl.remove();
  dragHighlightEl = null;
}

function watchPanelDragOverMainTop(panelId: string, onDocked: () => void): () => void {
  const internals = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
  }).__TAURI_INTERNALS__;
  const invoke = internals?.invoke;
  if (typeof invoke !== "function") return () => {};
  let stopped = false;
  let lastChildTop = -1;
  let lastChildLeft = -1;
  let stableTicks = 0;
  let inZone = false;
  const timer = window.setInterval(async () => {
    if (stopped) return;
    try {
      // 主窗口位置 + 尺寸，子窗口位置 + 尺寸——位置以屏幕坐标。
      const childPos = (await invoke("plugin:window|outer_position", { label: `panel_${panelId}` })) as { x: number; y: number };
      const childSize = (await invoke("plugin:window|outer_size", { label: `panel_${panelId}` })) as { width: number; height: number };
      const mainPos = (await invoke("plugin:window|outer_position", { label: "main" })) as { x: number; y: number };
      const mainSize = (await invoke("plugin:window|outer_size", { label: "main" })) as { width: number; height: number };
      const childCenterX = childPos.x + childSize.width / 2;
      const childTopY = childPos.y;
      const inMainHorizontal = childCenterX >= mainPos.x && childCenterX <= mainPos.x + mainSize.width;
      const inMainTopBand = childTopY >= mainPos.y && childTopY <= mainPos.y + DRAG_DOCK_ZONE_HEIGHT * 2;
      const hit = inMainHorizontal && inMainTopBand;
      if (hit) {
        if (!inZone) {
          inZone = true;
          showMainTopHighlight();
        }
        // 位置稳定计数：连续 N tick 没动 → 视为用户已松手，自动关闭。
        if (childPos.x === lastChildLeft && childPos.y === lastChildTop) {
          stableTicks += 1;
          if (stableTicks >= DRAG_STABLE_TICKS) {
            stopped = true;
            window.clearInterval(timer);
            hideMainTopHighlight();
            try {
              // 自定义 Rust command 关子窗口；plugin:window|close 不支持 label。
              await invoke("api_closeSubwindow", { label: `panel_${panelId}` });
            } catch (e) {
              console.warn("[dock] close child failed", e);
            }
            onDocked();
            return;
          }
        } else {
          stableTicks = 0;
        }
      } else {
        if (inZone) {
          inZone = false;
          hideMainTopHighlight();
        }
        stableTicks = 0;
      }
      lastChildLeft = childPos.x;
      lastChildTop = childPos.y;
    } catch {
      // 子窗口已关闭或查询失败：安静停掉自身轮询，watchPanelClosed 会处理 close 回调。
      stopped = true;
      window.clearInterval(timer);
      hideMainTopHighlight();
    }
  }, DRAG_POLL_MS);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    hideMainTopHighlight();
  };
}

type Edge = "l" | "r" | "t" | "b";

const EDGE_CURSOR: Record<Edge, string> = {
  l: "ew-resize",
  r: "ew-resize",
  t: "ns-resize",
  b: "ns-resize",
};

export function createDockable(options: DockableOptions): DockableHandle {
  const collapsible = options.collapsible !== false;
  const resizable = options.resizable !== false;

  const root = document.createElement("div");
  root.className = "dockable panel";
  let width = Math.max(MIN_WIDTH, options.initialSize.width);
  let height = Math.max(MIN_HEIGHT, options.initialSize.height);
  let collapsed = false;

  root.innerHTML =
    `<div class="dockable-title" data-role="title">` +
    `<span class="dockable-title-text" data-role="title-text"></span>` +
    `<span class="dockable-title-badge" data-role="title-badge" hidden></span>` +
    `<button class="dockable-pin-btn" data-role="pin" type="button">${ICON_PIN}</button>` +
    `<button class="dockable-collapse-btn" data-role="collapse" type="button">${ICON_CHEVRON_DOWN}</button>` +
    `</div>` +
    `<div class="dockable-content" data-role="content"></div>` +
    `<div class="dockable-resize dockable-resize-l" data-edge="l"></div>` +
    `<div class="dockable-resize dockable-resize-r" data-edge="r"></div>` +
    `<div class="dockable-resize dockable-resize-t" data-edge="t"></div>` +
    `<div class="dockable-resize dockable-resize-b" data-edge="b"></div>`;

  const titleEl = root.querySelector<HTMLDivElement>('[data-role="title"]')!;
  const titleTextEl = root.querySelector<HTMLSpanElement>('[data-role="title-text"]')!;
  const titleBadgeEl = root.querySelector<HTMLSpanElement>('[data-role="title-badge"]')!;
  const pinBtn = root.querySelector<HTMLButtonElement>('[data-role="pin"]')!;
  const collapseBtn = root.querySelector<HTMLButtonElement>('[data-role="collapse"]')!;
  const contentEl = root.querySelector<HTMLDivElement>('[data-role="content"]')!;
  const handles = Array.from(root.querySelectorAll<HTMLDivElement>(".dockable-resize"));

  function applyTooltips(): void {
    pinBtn.title = t("common.alwaysOnTop");
    collapseBtn.title = t("common.toggleCollapse");
  }
  applyTooltips();
  const unsubLang = subscribeLang(applyTooltips);

  titleTextEl.textContent = options.title;
  if (!collapsible) collapseBtn.style.display = "none";
  if (!resizable) for (const h of handles) h.style.display = "none";

  function applySize(): void {
    // 折叠：高度收到只剩标题栏，宽度保持当前数值；align-self:flex-start 防 host
    // 父级 flex 容器把 height:auto 拉伸为 stretch 又涨回去。
    if (collapsed) {
      root.style.width = `${width}px`;
      root.style.height = "auto";
      root.style.alignSelf = "flex-start";
      return;
    }
    // 未折叠：按自身 width/height 渲染；max-width/max-height: 100% 在 CSS 限制溢出。
    root.style.width = `${width}px`;
    root.style.height = `${height}px`;
    root.style.alignSelf = "";
  }

  // 记录折叠前 contentEl 的 inline display 值，展开时恢复——避免 main.ts 等外部
  // 设的 display="flex"（flexContent=true 配合 editor/preview 子面板）被清成空字符串后
  // 退回 CSS 默认 block，导致子元素 flex 布局失效。
  let savedContentDisplay: string = contentEl.style.display;

  function applyCollapsedState(): void {
    if (collapsed) {
      // 折叠前记一次当前 display，避免覆盖 none 后丢失 flex 等外部设值。
      if (contentEl.style.display !== "none") {
        savedContentDisplay = contentEl.style.display;
      }
      contentEl.style.display = "none";
    } else {
      contentEl.style.display = savedContentDisplay;
    }
    for (const h of handles) h.style.display = collapsed || !resizable ? "none" : "";
    collapseBtn.innerHTML = collapsed ? ICON_CHEVRON_RIGHT : ICON_CHEVRON_DOWN;
    applySize();
  }

  // resize：mousedown 起 → document mousemove 改 width/height（含 min 边界）→ mouseup 解除。
  const cleanups: Array<() => void> = [];

  function attachResize(handle: HTMLDivElement, edge: Edge): void {
    handle.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || collapsed || !resizable) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      // 起始尺寸以 boundingClientRect 为准，避免 width/height 变量与实际渲染不一致。
      const rect = root.getBoundingClientRect();
      const startW = rect.width;
      const startH = rect.height;
      width = Math.max(MIN_WIDTH, Math.round(startW));
      height = Math.max(MIN_HEIGHT, Math.round(startH));
      const cursor = EDGE_CURSOR[edge];
      document.body.style.cursor = cursor;
      document.body.style.userSelect = "none";

      function onMove(e: MouseEvent): void {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        if (edge === "r") width = Math.max(MIN_WIDTH, Math.round(startW + dx));
        else if (edge === "l") width = Math.max(MIN_WIDTH, Math.round(startW - dx));
        else if (edge === "b") height = Math.max(MIN_HEIGHT, Math.round(startH + dy));
        else if (edge === "t") height = Math.max(MIN_HEIGHT, Math.round(startH - dy));
        applySize();
      }

      function onUp(): void {
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  if (resizable) {
    for (const h of handles) {
      const edge = h.dataset.edge as Edge;
      attachResize(h, edge);
    }
  }

  // 标题栏：mousedown 起点 → 移动距离 > DRAG_START_PX 进入"拖拽中"。
  // 拖拽语义：
  //   - docked 拖拽用 transform: translate 做视觉跟随（保持 flex 流，
  //     host bbox 不塌；state 仍是 docked，rootEl 仍挂 originHost）；
  //     mouseup 命中 host → dockTo；viewport 内未命中 → 清 transform 回原位；
  //     viewport 外（client 坐标越界）→ detach。
  //   - floating 拖拽中实时更新 floatX/floatY；mouseup 命中则 dockTo。
  // 折叠按钮 / 置顶按钮 click 与拖拽互斥（target.closest 过滤）。
  let state: "docked" | "floating" = "docked";
  let floatX = 0;
  let floatY = 0;
  let alwaysOnTop = false;
  // detach 时记录的来源 host：dockTo 回到不同 host 时一并清掉旧 host 的占位标记。
  let detachedFromHost: HTMLElement | null = null;

  function setHostPlaceholder(host: HTMLElement): void {
    host.dataset.detached = "1";
    host.style.display = "none";
  }

  function clearHostPlaceholder(host: HTMLElement): void {
    delete host.dataset.detached;
    host.style.display = "";
  }

  function clearLiftStyle(): void {
    root.style.transform = "";
  }

  function applyFloatingStyle(): void {
    if (state === "floating") {
      root.classList.add("floating");
      root.style.position = "fixed";
      root.style.left = `${floatX}px`;
      root.style.top = `${floatY}px`;
      root.style.zIndex = alwaysOnTop ? "1500" : "1000";
      pinBtn.style.display = "";
      pinBtn.classList.toggle("btn-primary", alwaysOnTop);
    } else {
      root.classList.remove("floating");
      root.style.position = "";
      root.style.left = "";
      root.style.top = "";
      root.style.zIndex = "";
      pinBtn.style.display = "none";
    }
    // state 变化时 applySize 重算（floating 与 docked 都走自身 width/height）。
    applySize();
  }

  function onTitleMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-role="collapse"]')) return;
    if ((event.target as HTMLElement).closest('[data-role="pin"]')) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startFloatX = floatX;
    const startFloatY = floatY;
    // docked 拖拽视觉反馈基准：startRect 用于 detach 兜底初始位置估算。
    const startRect = root.getBoundingClientRect();
    let dragging = false;
    let dragLifted = false;
    let highlights: Map<HTMLElement, HTMLDivElement> | null = null;
    // 拖拽进入时临时恢复 detached host 显示，让 floating 卡片能拖回空槽。
    let restoredHosts: HTMLElement[] = [];
    titleEl.style.cursor = "grabbing";

    function showHighlights(): void {
      if (highlights) return;
      highlights = new Map();
      for (const host of dockHosts) {
        const r = host.getBoundingClientRect();
        // 跳过零矩形 host：原本 detached 的已在 onMove 进入 dragging 时
        // 临时恢复显示（floating 卡片需要可回填空槽）；仍为零矩形的是真不可见。
        if (r.width === 0 || r.height === 0) continue;
        const el = document.createElement("div");
        el.className = "dock-zone-highlight";
        el.style.left = `${r.left}px`;
        el.style.top = `${r.top}px`;
        el.style.width = `${r.width}px`;
        el.style.height = `${r.height}px`;
        document.body.appendChild(el);
        highlights.set(host, el);
      }
    }

    function updateHighlights(x: number, y: number): void {
      if (!highlights) return;
      const hit = hitDockHost(x, y);
      for (const [host, el] of highlights) {
        el.classList.toggle("active", host === hit);
      }
    }

    function clearHighlights(): void {
      if (!highlights) return;
      for (const el of highlights.values()) el.remove();
      highlights = null;
    }

    function liftDocked(): void {
      // 用 translate 做视觉跟随：保持 flex 流（host bbox 不塌）的同时让卡片
      // 视觉上跟光标。state 仍是 docked，无需 z-index / 不切 fixed。
      dragLifted = true;
    }

    function onMove(e: MouseEvent): void {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) > DRAG_START_PX) {
        dragging = true;
        // 进入 dragging 立即恢复所有 detached host 显示（host 可见后
        // getBoundingClientRect 才有非零矩形，hitDockHost 才能命中）。
        restoredHosts = revealDetachedHostsForDrag();
      }
      if (!dragging) return;
      if (state === "floating") {
        floatX = startFloatX + dx;
        floatY = startFloatY + dy;
        root.style.left = `${floatX}px`;
        root.style.top = `${floatY}px`;
      } else {
        if (!dragLifted) liftDocked();
        root.style.transform = `translate(${dx}px, ${dy}px)`;
      }
      showHighlights();
      updateHighlights(e.clientX, e.clientY);
    }

    function onUp(e: MouseEvent): void {
      titleEl.style.cursor = "";
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const hit = dragging ? hitDockHost(e.clientX, e.clientY) : null;
      clearHighlights();
      if (!dragging) return;
      if (state === "floating") {
        if (hit) {
          // dockTo 内部会清掉命中 host 的 detached 占位；其余 restored host
          // 仍是 detached 状态，需重新隐藏。
          dockTo(hit);
        }
        rehideDetachedHostsAfterDrag(restoredHosts);
        return;
      }
      // docked 拖拽 mouseup 三分支：命中 host → 移位；越界 → detach；
      // viewport 内未命中 → 取消，恢复 inline style 回原 host。
      if (hit) {
        if (dragLifted) clearLiftStyle();
        dockTo(hit);
      } else if (isOutsideViewport(e.clientX, e.clientY)) {
        // 浮动卡片初始位置 = 拖拽中卡片当前的视觉位置（startRect + delta）。
        const targetX = startRect.left + (e.clientX - startX);
        const targetY = startRect.top + (e.clientY - startY);
        if (dragLifted) clearLiftStyle();
        void detach(targetX, targetY);
      } else {
        // 取消移动：清 lift style，rootEl 一直是 originHost 的子节点（translate
        // 不脱离 flex 流），所以无需重新 appendChild。
        if (dragLifted) clearLiftStyle();
      }
      rehideDetachedHostsAfterDrag(restoredHosts);
    }

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  function onTitleContextMenu(event: MouseEvent): void {
    event.preventDefault();
    const rect = root.getBoundingClientRect();
    showContextMenu(event.clientX, event.clientY, [
      {
        label: t("dockHost.menu.openInNewWindow"),
        action: () => {
          void detach(rect.left, rect.top);
        },
      },
      { label: t("dockHost.menu.cancel"), action: () => {} },
    ]);
  }

  function onTitleDblClick(): void {
    if (collapsible) toggle();
  }

  function onCollapseClick(event: MouseEvent): void {
    event.stopPropagation();
    if (collapsible) toggle();
  }

  function onPinClick(event: MouseEvent): void {
    event.stopPropagation();
    setAlwaysOnTop(!alwaysOnTop);
  }

  titleEl.addEventListener("mousedown", onTitleMouseDown);
  titleEl.addEventListener("dblclick", onTitleDblClick);
  titleEl.addEventListener("contextmenu", onTitleContextMenu);
  collapseBtn.addEventListener("click", onCollapseClick);
  pinBtn.addEventListener("click", onPinClick);
  cleanups.push(() => {
    titleEl.removeEventListener("mousedown", onTitleMouseDown);
    titleEl.removeEventListener("dblclick", onTitleDblClick);
    titleEl.removeEventListener("contextmenu", onTitleContextMenu);
    collapseBtn.removeEventListener("click", onCollapseClick);
    pinBtn.removeEventListener("click", onPinClick);
  });

  function setSize(w: number, h: number): void {
    width = Math.max(MIN_WIDTH, w);
    height = Math.max(MIN_HEIGHT, h);
    if (!collapsed) applySize();
  }

  function setTitle(text: string): void {
    titleTextEl.textContent = text;
  }

  function setTitleBadge(text: string, variant: "default" | "ok" | "warn" = "default"): void {
    if (!text) {
      titleBadgeEl.hidden = true;
      titleBadgeEl.textContent = "";
      titleBadgeEl.dataset.variant = "";
      return;
    }
    titleBadgeEl.hidden = false;
    titleBadgeEl.textContent = text;
    titleBadgeEl.dataset.variant = variant;
  }

  function collapse(): void {
    if (collapsed || !collapsible) return;
    collapsed = true;
    applyCollapsedState();
    notifyCollapseListeners();
  }

  function expand(): void {
    if (!collapsed) return;
    collapsed = false;
    applyCollapsedState();
    notifyCollapseListeners();
  }

  function toggle(): void {
    if (collapsed) expand();
    else collapse();
  }

  function isCollapsed(): boolean {
    return collapsed;
  }

  const collapseListeners = new Set<(c: boolean) => void>();
  function notifyCollapseListeners(): void {
    for (const fn of collapseListeners) fn(collapsed);
  }
  function onCollapsedChange(cb: (collapsed: boolean) => void): () => void {
    collapseListeners.add(cb);
    return () => {
      collapseListeners.delete(cb);
    };
  }

  function getState(): "docked" | "floating" {
    return state;
  }

  function setAlwaysOnTop(value: boolean): void {
    if (alwaysOnTop === value) return;
    alwaysOnTop = value;
    applyFloatingStyle();
  }

  function isAlwaysOnTop(): boolean {
    return alwaysOnTop;
  }

  // 从 docked 进入 detach 的统一入口。Tauri 模式下先尝试创建子窗口，
  // 失败 toast.warn 后回退浮动卡片；Web 模式直接走浮动卡片。
  // panelId 缺省时不尝试 Tauri 通路。
  // detach 前在原 host 上加 dataset.detached + display:none 释放主窗口布局占位；
  // attach 时由 dockTo 清掉。
  // 子窗口创建成功后挂 watchPanelClosed，子窗口关闭即 dockTo 原 host 自动回归。
  let stopWatchClosed: (() => void) | null = null;
  // 同时启动拖拽-顶栏检测，命中主窗口顶栏即关闭子窗口触发回归。
  let stopWatchDrag: (() => void) | null = null;
  async function detach(x: number, y: number): Promise<void> {
    if (state === "docked") {
      const host = root.parentElement;
      if (host && dockHosts.has(host)) {
        detachedFromHost = host;
        setHostPlaceholder(host);
      }
    }
    if (options.panelId && getRuntimeMode() === "tauri") {
      const ok = await tryCreateTauriWindow(
        options.panelId,
        options.title,
        Math.round(x),
        Math.round(y),
        width,
        height,
      );
      if (ok) {
        if (stopWatchClosed) stopWatchClosed();
        stopWatchClosed = watchPanelClosed(options.panelId, () => {
          stopWatchClosed = null;
          // 回归原 host；若已被用户操作 dock 到别处则忽略。
          if (detachedFromHost) {
            dockTo(detachedFromHost);
          }
        });
        // 拖拽-顶栏检测：命中即触发关闭子窗口，watchPanelClosed 收到窗口消失
        // 跑到 dockTo 路径自然回归。
        if (stopWatchDrag) stopWatchDrag();
        stopWatchDrag = watchPanelDragOverMainTop(options.panelId, () => {
          stopWatchDrag = null;
        });
        return;
      }
      showToast(t("common.detachFallbackToast"), "warn");
    }
    floatAt(x, y);
  }

  function floatAt(x: number, y: number): void {
    floatX = x;
    floatY = y;
    state = "floating";
    document.body.appendChild(root);
    applyFloatingStyle();
  }

  function dockTo(host: HTMLElement): void {
    // 子窗口关闭回归路径上 detach 时 root 没真挪走（仅 host 设 display:none），
    // 所以 parentEl 仍是 host。原短路 return 会让 dockable 仍处于"占位隐藏"状态，
    // 视觉上"消失"。host 仍带 detached 标记时强制走完整 dockTo 路径。
    const hostStillDetached = host.dataset.detached === "1";
    if (state === "docked" && root.parentElement === host && !hostStillDetached) {
      clearLiftStyle();
      return;
    }
    state = "docked";
    // 清掉新 host 的 detached 占位（若有），并清掉旧 origin host 的占位（若不同）。
    clearHostPlaceholder(host);
    if (detachedFromHost && detachedFromHost !== host) {
      clearHostPlaceholder(detachedFromHost);
    }
    detachedFromHost = null;
    host.appendChild(root);
    clearLiftStyle();
    applyFloatingStyle();
  }

  function destroy(): void {
    for (const fn of cleanups) fn();
    unsubLang();
    root.remove();
  }

  applyCollapsedState();
  applyFloatingStyle();
  // 标题栏与圆角靠 CSS 控制；这里只把高度标量暴露成自定义属性，便于 theme.css 复用。
  root.style.setProperty("--dockable-title-height", `${TITLE_HEIGHT}px`);

  return {
    rootEl: root,
    contentEl,
    setSize,
    setTitle,
    setTitleBadge,
    collapse,
    expand,
    toggle,
    isCollapsed,
    onCollapsedChange,
    getState,
    floatAt,
    dockTo,
    setAlwaysOnTop,
    isAlwaysOnTop,
    destroy,
  };
}
