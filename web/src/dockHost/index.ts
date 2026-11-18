// 可停靠面板容器：支持折叠、四边缩放、槽位间拖拽移位，以及分离为 Tauri 独立子窗口或页面内浮动卡片。

import { getRuntimeMode } from "../runtimeMode";
import { bumpLayerSnapshotVersion, bumpPartListVersion } from "../stateStore";
import { showContextMenu } from "../contextMenu";
import { showToast } from "../toast";
import { subscribeLang, t } from "../i18n";
import { ICON_CHEVRON_DOWN, ICON_CHEVRON_RIGHT, ICON_PIN } from "../toolPanel/toolIcons";

const MIN_WIDTH = 160;
const MIN_HEIGHT = 120;
const TITLE_HEIGHT = 24;
const DRAG_START_PX = 4;
const DRAG_DOCK_ZONE_HEIGHT = 48;
const DRAG_POLL_MS = 150;
const DRAG_STABLE_TICKS = 2;

export interface DockableOptions {
  title: string;
  initialSize: { width: number; height: number };
  collapsible?: boolean;
  resizable?: boolean;
  panelId?: string;
}

export interface DockableHandle {
  rootEl: HTMLElement;
  contentEl: HTMLElement;
  setSize(width: number, height: number): void;
  setTitle(text: string): void;
  setTitleBadge(text: string, variant?: "default" | "ok" | "warn"): void;
  collapse(): void;
  expand(): void;
  toggle(): void;
  isCollapsed(): boolean;
  onCollapsedChange(cb: (collapsed: boolean) => void): () => void;
  getState(): "docked" | "floating";
  floatAt(x: number, y: number): void;
  dockTo(host: HTMLElement): void;
  setAlwaysOnTop(value: boolean): void;
  isAlwaysOnTop(): boolean;
  destroy(): void;
}

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
    if (r.width === 0 || r.height === 0) continue;
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return host;
  }
  return null;
}

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

function isOutsideViewport(x: number, y: number): boolean {
  const w = document.documentElement.clientWidth;
  const h = document.documentElement.clientHeight;
  return x < 0 || y < 0 || x > w || y > h;
}

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
      await invoke("plugin:webview|webview_position", { label: `panel_${panelId}` });
    } catch {
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

// 监测独立子窗口拖至主窗口顶部停靠带，位置稳定后自动关闭子窗口触发嵌回。
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
      const childPos = (await invoke("plugin:window|outer_position", {
        label: `panel_${panelId}`,
      })) as { x: number; y: number };
      const childSize = (await invoke("plugin:window|outer_size", {
        label: `panel_${panelId}`,
      })) as { width: number; height: number };
      const mainPos = (await invoke("plugin:window|outer_position", { label: "main" })) as {
        x: number;
        y: number;
      };
      const mainSize = (await invoke("plugin:window|outer_size", { label: "main" })) as {
        width: number;
        height: number;
      };
      const childCenterX = childPos.x + childSize.width / 2;
      const inMainHorizontal =
        childCenterX >= mainPos.x && childCenterX <= mainPos.x + mainSize.width;
      const inMainTopBand =
        childPos.y >= mainPos.y && childPos.y <= mainPos.y + DRAG_DOCK_ZONE_HEIGHT * 2;
      if (inMainHorizontal && inMainTopBand) {
        if (!inZone) {
          inZone = true;
          showMainTopHighlight();
        }
        if (childPos.x === lastChildLeft && childPos.y === lastChildTop) {
          stableTicks += 1;
          if (stableTicks >= DRAG_STABLE_TICKS) {
            stopped = true;
            window.clearInterval(timer);
            hideMainTopHighlight();
            try {
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
    if (collapsed) {
      root.style.width = `${width}px`;
      root.style.height = "auto";
      root.style.alignSelf = "flex-start";
      return;
    }
    root.style.width = `${width}px`;
    root.style.height = `${height}px`;
    root.style.alignSelf = "";
  }

  let savedContentDisplay: string = contentEl.style.display;
  function applyCollapsedState(): void {
    if (collapsed) {
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

  const cleanups: Array<() => void> = [];

  function attachResize(handle: HTMLDivElement, edge: Edge): void {
    handle.addEventListener("mousedown", (event) => {
      if (event.button !== 0 || collapsed || !resizable) return;
      event.preventDefault();
      const startX = event.clientX;
      const startY = event.clientY;
      const rect = root.getBoundingClientRect();
      const startW = rect.width;
      const startH = rect.height;
      width = Math.max(MIN_WIDTH, Math.round(startW));
      height = Math.max(MIN_HEIGHT, Math.round(startH));
      document.body.style.cursor = EDGE_CURSOR[edge];
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
      attachResize(h, h.dataset.edge as Edge);
    }
  }

  let state: "docked" | "floating" = "docked";
  let floatX = 0;
  let floatY = 0;
  let alwaysOnTop = false;
  let detachedFromHost: HTMLElement | null = null;
  let detaching = false;
  let stopWatchClosed: (() => void) | null = null;
  let stopWatchDrag: (() => void) | null = null;

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
    const startRect = root.getBoundingClientRect();
    let dragging = false;
    let dragLifted = false;
    let highlights: Map<HTMLElement, HTMLDivElement> | null = null;
    let restoredHosts: HTMLElement[] = [];
    titleEl.style.cursor = "grabbing";

    function showHighlights(): void {
      if (highlights) return;
      highlights = new Map();
      for (const host of dockHosts) {
        const r = host.getBoundingClientRect();
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

    function onMove(e: MouseEvent): void {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) > DRAG_START_PX) {
        dragging = true;
        restoredHosts = revealDetachedHostsForDrag();
      }
      if (!dragging) return;
      if (state === "floating") {
        floatX = startFloatX + dx;
        floatY = startFloatY + dy;
        root.style.left = `${floatX}px`;
        root.style.top = `${floatY}px`;
      } else {
        dragLifted = true;
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
        if (hit) dockTo(hit);
        rehideDetachedHostsAfterDrag(restoredHosts);
        return;
      }
      if (hit) {
        if (dragLifted) clearLiftStyle();
        dockTo(hit);
      } else if (isOutsideViewport(e.clientX, e.clientY)) {
        const targetX = startRect.left + (e.clientX - startX);
        const targetY = startRect.top + (e.clientY - startY);
        if (dragLifted) clearLiftStyle();
        void detach(targetX, targetY);
      } else if (dragLifted) {
        clearLiftStyle();
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
        disabled: detaching || stopWatchClosed !== null,
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

  function clearWatchers(): void {
    if (stopWatchClosed) {
      stopWatchClosed();
      stopWatchClosed = null;
    }
    if (stopWatchDrag) {
      stopWatchDrag();
      stopWatchDrag = null;
    }
  }

  async function detach(x: number, y: number): Promise<void> {
    if (detaching) return;
    detaching = true;
    try {
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
          titleTextEl.textContent || options.title,
          Math.round(x),
          Math.round(y),
          width,
          height,
        );
        if (ok) {
          clearWatchers();
          stopWatchClosed = watchPanelClosed(options.panelId, () => {
            clearWatchers();
            if (detachedFromHost) {
              dockTo(detachedFromHost);
            }
            // 子窗口运行期间可能修改了后端内存或磁盘状态，嵌回后触发主窗口刷新。
            bumpLayerSnapshotVersion();
            bumpPartListVersion();
          });
          stopWatchDrag = watchPanelDragOverMainTop(options.panelId, () => {
            stopWatchDrag = null;
          });
          return;
        }
        showToast(t("common.detachFallbackToast"), "warn");
      }
      floatAt(x, y);
    } finally {
      detaching = false;
    }
  }

  function floatAt(x: number, y: number): void {
    floatX = x;
    floatY = y;
    state = "floating";
    document.body.appendChild(root);
    applyFloatingStyle();
  }

  function dockTo(host: HTMLElement): void {
    const hostStillDetached = host.dataset.detached === "1";
    if (state === "docked" && root.parentElement === host && !hostStillDetached) {
      clearLiftStyle();
      return;
    }
    state = "docked";
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
    clearWatchers();
    for (const fn of cleanups) fn();
    unsubLang();
    root.remove();
  }

  applyCollapsedState();
  applyFloatingStyle();
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
