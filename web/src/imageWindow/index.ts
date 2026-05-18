// imageWindow：图片查看子窗口。
// 主窗口拖入图片时把 base64 字节通过 invoke api_storeImage 存进 Rust 端进程内存；
// 子窗口启动后用同 token invoke api_loadImage 拿 RGBA 渲染到 canvas；
// 主题通过 getWorkspace 拉取 workspace.json 再 applyTheme，保持与主窗口一致。
// 取色由 Rust 直接按屏幕坐标命中本窗口找回 RGB——不在前端做跨窗口通信。

import { applyTheme, defaultTheme } from "../stateStore/theme";
import { getWorkspace, loadImage, releaseImage, isPickActive } from "../apiClient";
import { sessionStore } from "../stateStore";
import { t, subscribeLang } from "../i18n";
import { ICON_PIN, ICON_PIN_OFF, ICON_CLOSE } from "../toolPanel/toolIcons";

const TOOLBAR_HEIGHT = 28;

export async function mountImageWindow(token: string): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  document.documentElement.style.height = "100%";
  document.body.style.height = "100%";
  document.body.style.margin = "0";
  root.style.cssText =
    "display:flex;flex-direction:column;height:100vh;width:100vw;overflow:hidden;";

  // 与 mountSinglePanel 子窗口风格一致：边框分隔、左侧标题、整条作 OS 拖拽热区。
  // 顶栏物理高度必须与后端 toolbarHeight 参数对齐（Rust 算 stage 区时减掉这个高度）。
  const toolbar = document.createElement("div");
  toolbar.className = "subwindow-toolbar";
  toolbar.style.cssText =
    `flex:none;height:${TOOLBAR_HEIGHT}px;box-sizing:border-box;` +
    `display:flex;align-items:center;gap:8px;padding:4px 8px;` +
    `border-bottom:1px solid rgba(0,0,0,var(--border-opacity));font-size:12px;`;
  const titleEl = document.createElement("span");
  titleEl.style.cssText =
    "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:0.8;";
  titleEl.textContent = t("imageWindow.title");
  const pinBtn = document.createElement("button");
  pinBtn.className = "btn cp-tool-btn";
  pinBtn.type = "button";
  pinBtn.innerHTML = ICON_PIN;
  pinBtn.title = t("common.alwaysOnTop");
  const closeBtn = document.createElement("button");
  closeBtn.className = "btn cp-tool-btn";
  closeBtn.type = "button";
  closeBtn.innerHTML = ICON_CLOSE;
  closeBtn.title = t("common.close");
  toolbar.appendChild(titleEl);
  toolbar.appendChild(pinBtn);
  toolbar.appendChild(closeBtn);

  const stage = document.createElement("div");
  stage.style.cssText =
    "flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:auto;background:var(--background);";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;image-rendering:auto;";
  stage.appendChild(canvas);

  root.appendChild(toolbar);
  root.appendChild(stage);

  document.title = t("imageWindow.title");

  // 主题：和主窗口共享同一份 workspace 主题，避免子窗口暗色背景看着像"加载失败"。
  try {
    const ws = await getWorkspace("data/workspace.json");
    applyTheme(ws.theme);
    sessionStore.setState({ theme: ws.theme });
  } catch (e) {
    console.warn("[imageWindow] getWorkspace failed", e);
    applyTheme(defaultTheme());
  }

  // 拿图片字节渲染到 canvas。失败时 stage 显示提示。
  try {
    const result = await loadImage(token);
    canvas.width = result.width;
    canvas.height = result.height;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      const data = new ImageData(
        new Uint8ClampedArray(result.pixels),
        result.width,
        result.height,
      );
      ctx.putImageData(data, 0, 0);
    }
  } catch (e) {
    console.warn("[imageWindow] loadImage failed", e);
    stage.innerHTML = "";
    const tip = document.createElement("div");
    tip.style.cssText = "color:var(--on-background);opacity:0.6;font-size:12px;";
    tip.textContent = t("imageWindow.notFound");
    stage.appendChild(tip);
  }

  // 窗口关闭时通知 Rust 释放字节缓存。
  window.addEventListener("beforeunload", () => {
    void releaseImage(token);
  });

  const tauri = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
  }).__TAURI_INTERNALS__;
  const invoke = tauri?.invoke;

  // 工具栏拖拽 = OS 窗口拖动。按钮区按下不拖。
  toolbar.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    if (typeof invoke === "function") {
      invoke("plugin:window|start_dragging").catch(() => {});
    }
  });
  toolbar.style.cursor = "grab";
  toolbar.addEventListener("mousedown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    toolbar.style.cursor = "grabbing";
  });
  document.addEventListener("mouseup", () => {
    toolbar.style.cursor = "grab";
  });

  // 置顶按钮：切换 alwaysOnTop，激活态加 .btn-primary 视觉提示，图标在 PIN/PIN_OFF 间切换。
  let alwaysOnTop = false;
  function syncPinBtn(): void {
    pinBtn.innerHTML = alwaysOnTop ? ICON_PIN_OFF : ICON_PIN;
    pinBtn.title = alwaysOnTop ? t("common.unpinFromTop") : t("common.alwaysOnTop");
    pinBtn.classList.toggle("btn-primary", alwaysOnTop);
  }
  pinBtn.addEventListener("click", () => {
    if (typeof invoke !== "function") {
      alwaysOnTop = !alwaysOnTop;
      syncPinBtn();
      return;
    }
    const next = !alwaysOnTop;
    invoke("plugin:window|set_always_on_top", { value: next })
      .then(() => {
        alwaysOnTop = next;
        syncPinBtn();
      })
      .catch((e) => console.warn("[imageWindow] set_always_on_top failed", e));
  });

  closeBtn.addEventListener("click", () => {
    if (typeof invoke === "function") {
      invoke("plugin:window|close").catch(() => window.close());
    } else {
      window.close();
    }
  });

  subscribeLang(() => {
    titleEl.textContent = t("imageWindow.title");
    document.title = t("imageWindow.title");
    pinBtn.title = alwaysOnTop ? t("common.unpinFromTop") : t("common.alwaysOnTop");
    closeBtn.title = t("common.close");
  });

  // 轮询主窗口取色态，决定本子窗口 cursor 是否变滴管。
  // 250ms 间隔够用：取色器进入退出本就是用户主动操作，不需要每帧响应。
  let lastPicking = false;
  window.setInterval(async () => {
    const picking = await isPickActive();
    if (picking !== lastPicking) {
      lastPicking = picking;
      document.body.classList.toggle("cp-picking", picking);
    }
  }, 250);
}
