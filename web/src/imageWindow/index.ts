// 参考图片独立查看窗口：从后端进程内存读取 RGBA 渲染，支持置顶与主窗口跨进程吸管取色。

import { applyTheme, defaultTheme } from "../stateStore/theme";
import { getWorkspace, isPickActive, loadImage, releaseImage } from "../apiClient";
import { sessionStore } from "../stateStore";
import { subscribeLang, t } from "../i18n";
import { ICON_CLOSE, ICON_PIN, ICON_PIN_OFF } from "../toolPanel/toolIcons";

// 必须与 `colorPalette` 传给 `pickImagePixelByScreenCoord` 的 `toolbarHeight` 严格一致。
const TOOLBAR_HEIGHT = 28;

export async function mountImageWindow(token: string): Promise<void> {
  const root = document.getElementById("app");
  if (!root) return;
  document.documentElement.style.height = "100%";
  document.body.style.height = "100%";
  document.body.style.margin = "0";
  root.style.cssText =
    "display:flex;flex-direction:column;height:100vh;width:100vw;overflow:hidden;";

  const toolbar = document.createElement("div");
  toolbar.className = "subwindow-toolbar";
  toolbar.style.cssText =
    `flex:none;height:${TOOLBAR_HEIGHT}px;box-sizing:border-box;` +
    `display:flex;align-items:center;gap:8px;padding:4px 8px;` +
    `border-bottom:1px solid rgba(var(--border-rgb),var(--border-opacity));font-size:12px;`;
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
  toolbar.append(titleEl, pinBtn, closeBtn);

  const stage = document.createElement("div");
  stage.style.cssText =
    "flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:auto;background:var(--background);";
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;image-rendering:auto;";
  stage.appendChild(canvas);

  root.append(toolbar, stage);
  document.title = t("imageWindow.title");

  try {
    const ws = await getWorkspace("data/workspace.json");
    applyTheme(ws.theme);
    sessionStore.setState({ theme: ws.theme });
  } catch (e) {
    console.warn("[imageWindow] getWorkspace failed", e);
    applyTheme(defaultTheme());
  }

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

  let pickPollTimer = 0;
  window.addEventListener("beforeunload", () => {
    if (pickPollTimer) window.clearInterval(pickPollTimer);
    void releaseImage(token);
  });

  const tauri = (window as unknown as {
    __TAURI_INTERNALS__?: { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };
  }).__TAURI_INTERNALS__;
  const invoke = tauri?.invoke;

  toolbar.style.cursor = "grab";
  toolbar.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    toolbar.style.cursor = "grabbing";
    if (typeof invoke === "function") {
      invoke("plugin:window|start_dragging").catch(() => {});
    }
  });
  document.addEventListener("mouseup", () => {
    toolbar.style.cursor = "grab";
  });

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

  let lastPicking = false;
  pickPollTimer = window.setInterval(async () => {
    const picking = await isPickActive();
    if (picking !== lastPicking) {
      lastPicking = picking;
      document.body.classList.toggle("cp-picking", picking);
    }
  }, 250);
}
