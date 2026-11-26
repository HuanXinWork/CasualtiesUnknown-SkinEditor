// 调色盘面板：HSV 色相环与明度/饱和度方块、RGB/HEX/Alpha 输入、预设色组、24 格自定义色卡及跨窗口取色针。

import { sessionStore } from "../stateStore";
import {
  getCachedWorkspace,
  initWorkspaceCache,
  updateWorkspaceSettings,
} from "../stateStore/workspacePersist";
import type { WorkspaceSettings } from "../stateStore/types";
import { subscribeLang, t } from "../i18n";
import { ICON_DROPPER } from "../toolPanel/toolIcons";
import {
  getCursorScreenPos,
  isMouseLeftDown,
  pickImagePixelByScreenCoord,
  setPickActive,
} from "../apiClient";
import {
  hexToRgb,
  hsvToRgb,
  rgbEqual,
  rgbToHex,
  rgbToHsv,
  type Hsv,
  type Rgb,
} from "./colorMath";
import { SWATCH_GROUPS } from "./swatches";

const RECENT_LIMIT = 12;
const CUSTOM_SLOT_COUNT = 24;
const HUE_WHEEL_SIZE = 160;
const HUE_WHEEL_INNER = 48;
const HUE_WHEEL_OUTER = 76;
const SV_BOX_SIZE = 96;
const WORKSPACE_PATH = "data/workspace.json";

export function mountColorPalette(container: HTMLElement): () => void {
  const borderCss = "1px solid rgba(var(--border-rgb),0.25)";
  container.classList.add("color-palette");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.style.gap = "8px";
  container.style.padding = "8px";
  container.style.overflow = "auto";
  container.innerHTML =
    `<div class="cp-pickers" style="display:flex;gap:8px;align-items:flex-start;">` +
    `<div class="cp-wheel-wrap" style="position:relative;width:${HUE_WHEEL_SIZE}px;height:${HUE_WHEEL_SIZE}px;flex:none;">` +
    `<canvas data-role="hue-wheel" width="${HUE_WHEEL_SIZE}" height="${HUE_WHEEL_SIZE}" style="display:block;cursor:crosshair;"></canvas>` +
    `<canvas data-role="sv-box" width="${SV_BOX_SIZE}" height="${SV_BOX_SIZE}" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);cursor:crosshair;"></canvas>` +
    `</div>` +
    `<div class="cp-side" style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;font-size:11px;">` +
    `<div style="display:flex;align-items:center;gap:4px;">` +
    `<div data-role="cur-preview" style="flex:1;height:24px;border:${borderCss};"></div>` +
    `<button class="btn cp-tool-btn" data-role="dropper" type="button" style="width:24px;height:24px;padding:0;flex:none;">${ICON_DROPPER}</button>` +
    `</div>` +
    `<label style="display:flex;align-items:center;gap:4px;"><span style="width:30px;">HEX</span>` +
    `<input class="input" type="text" data-role="hex" maxlength="7" style="flex:1;min-width:0;padding:2px 6px;font-family:ui-monospace,monospace;"></label>` +
    `<label style="display:flex;align-items:center;gap:4px;"><span style="width:30px;">R</span>` +
    `<input class="input" type="number" data-role="r" min="0" max="255" style="flex:1;min-width:0;padding:2px 6px;"></label>` +
    `<label style="display:flex;align-items:center;gap:4px;"><span style="width:30px;">G</span>` +
    `<input class="input" type="number" data-role="g" min="0" max="255" style="flex:1;min-width:0;padding:2px 6px;"></label>` +
    `<label style="display:flex;align-items:center;gap:4px;"><span style="width:30px;">B</span>` +
    `<input class="input" type="number" data-role="b" min="0" max="255" style="flex:1;min-width:0;padding:2px 6px;"></label>` +
    `<label style="display:flex;align-items:center;gap:4px;"><span data-role="alpha-label" style="width:30px;"></span>` +
    `<input type="range" data-role="alpha" min="0" max="255" style="flex:1;">` +
    `<span class="mono" data-role="alpha-val" style="min-width:3ch;text-align:right;"></span></label>` +
    `</div>` +
    `</div>` +
    `<div data-role="swatches" style="display:flex;flex-direction:column;gap:4px;"></div>` +
    `<div data-role="recent" style="display:flex;flex-direction:column;gap:2px;">` +
    `<span data-role="recent-label" style="opacity:0.6;font-size:11px;"></span>` +
    `<div data-role="recent-list" style="display:flex;flex-wrap:wrap;gap:2px;"></div>` +
    `</div>`;

  const hueCanvas = container.querySelector<HTMLCanvasElement>('[data-role="hue-wheel"]')!;
  const svCanvas = container.querySelector<HTMLCanvasElement>('[data-role="sv-box"]')!;
  const previewEl = container.querySelector<HTMLDivElement>('[data-role="cur-preview"]')!;
  const hexInput = container.querySelector<HTMLInputElement>('[data-role="hex"]')!;
  const rInput = container.querySelector<HTMLInputElement>('[data-role="r"]')!;
  const gInput = container.querySelector<HTMLInputElement>('[data-role="g"]')!;
  const bInput = container.querySelector<HTMLInputElement>('[data-role="b"]')!;
  const alphaInput = container.querySelector<HTMLInputElement>('[data-role="alpha"]')!;
  const alphaValEl = container.querySelector<HTMLSpanElement>('[data-role="alpha-val"]')!;
  const alphaLabelEl = container.querySelector<HTMLSpanElement>('[data-role="alpha-label"]')!;
  const swatchesEl = container.querySelector<HTMLDivElement>('[data-role="swatches"]')!;
  const recentLabelEl = container.querySelector<HTMLSpanElement>('[data-role="recent-label"]')!;
  const recentListEl = container.querySelector<HTMLDivElement>('[data-role="recent-list"]')!;
  const dropperBtn = container.querySelector<HTMLButtonElement>('[data-role="dropper"]')!;

  const hueCtx = hueCanvas.getContext("2d")!;
  const svCtx = svCanvas.getContext("2d")!;

  // 以 `curHsv` 为内部权威源，避免饱和度为 0 时 RGB↔HSV 往返丢失色相角。
  let curHsv: Hsv = rgbToHsv(sessionStore.getState().color);
  const recent: Rgb[] = [];
  const customSwatches: Array<Rgb | null> = new Array(CUSTOM_SLOT_COUNT).fill(null);

  function clampByte(n: number): number {
    return Math.max(0, Math.min(255, Math.round(n)));
  }

  function applySettingsFromWorkspace(settings?: WorkspaceSettings): void {
    if (!settings) return;
    if (Array.isArray(settings.colorPaletteRecent)) {
      recent.length = 0;
      for (const c of settings.colorPaletteRecent) {
        if (Array.isArray(c) && c.length >= 3) {
          recent.push([clampByte(c[0]), clampByte(c[1]), clampByte(c[2])]);
          if (recent.length >= RECENT_LIMIT) break;
        }
      }
      renderRecent();
    }
    if (Array.isArray(settings.colorPaletteCustom)) {
      for (let i = 0; i < CUSTOM_SLOT_COUNT && i < settings.colorPaletteCustom.length; i++) {
        const c = settings.colorPaletteCustom[i];
        customSwatches[i] =
          Array.isArray(c) && c.length >= 3 ? [clampByte(c[0]), clampByte(c[1]), clampByte(c[2])] : null;
      }
      renderSwatches();
    }
  }

  const cachedWs = getCachedWorkspace();
  if (cachedWs) {
    applySettingsFromWorkspace(cachedWs.layout.settings);
  } else {
    void initWorkspaceCache(WORKSPACE_PATH)
      .then((ws) => applySettingsFromWorkspace(ws.layout.settings))
      .catch((e) => console.warn("[colorPalette] load recent/custom failed", e));
  }

  function persistRecent(): void {
    updateWorkspaceSettings(
      WORKSPACE_PATH,
      { colorPaletteRecent: recent.map((c): [number, number, number] => [c[0], c[1], c[2]]) },
      500,
    );
  }

  function persistCustom(): void {
    updateWorkspaceSettings(
      WORKSPACE_PATH,
      {
        colorPaletteCustom: customSwatches.map((c) =>
          c ? ([c[0], c[1], c[2]] as [number, number, number]) : null,
        ),
      },
      200,
    );
  }

  function pushRecent(rgb: Rgb): void {
    const idx = recent.findIndex((c) => rgbEqual(c, rgb));
    if (idx >= 0) recent.splice(idx, 1);
    recent.unshift(rgb);
    if (recent.length > RECENT_LIMIT) recent.length = RECENT_LIMIT;
    persistRecent();
  }

  function renderRecent(): void {
    recentListEl.innerHTML = "";
    for (const rgb of recent) {
      const sw = document.createElement("button");
      sw.className = "btn cp-swatch";
      sw.title = rgbToHex(rgb);
      sw.style.cssText = `width:18px;height:18px;padding:0;background:${rgbToHex(rgb)};border:${borderCss};`;
      sw.addEventListener("click", () => applyRgb(rgb));
      recentListEl.appendChild(sw);
    }
  }

  function applyRgb(rgb: Rgb): void {
    curHsv = rgbToHsv(rgb);
    pushRecent(rgb);
    sessionStore.setState({ color: rgb });
    renderRecent();
    drawHueWheel();
    drawSvBox();
  }

  const wheelCenter = HUE_WHEEL_SIZE / 2;
  function drawHueWheel(): void {
    hueCtx.clearRect(0, 0, HUE_WHEEL_SIZE, HUE_WHEEL_SIZE);
    for (let deg = 0; deg < 360; deg++) {
      const start = ((deg - 0.6) * Math.PI) / 180 - Math.PI / 2;
      const end = ((deg + 0.6) * Math.PI) / 180 - Math.PI / 2;
      hueCtx.beginPath();
      hueCtx.moveTo(wheelCenter, wheelCenter);
      hueCtx.arc(wheelCenter, wheelCenter, HUE_WHEEL_OUTER, start, end);
      hueCtx.closePath();
      const rgb = hsvToRgb({ h: deg, s: 1, v: 1 });
      hueCtx.fillStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
      hueCtx.fill();
    }
    hueCtx.save();
    hueCtx.globalCompositeOperation = "destination-out";
    hueCtx.beginPath();
    hueCtx.arc(wheelCenter, wheelCenter, HUE_WHEEL_INNER, 0, Math.PI * 2);
    hueCtx.fill();
    hueCtx.restore();

    const ang = (curHsv.h * Math.PI) / 180 - Math.PI / 2;
    const x1 = wheelCenter + Math.cos(ang) * (HUE_WHEEL_INNER + 1);
    const y1 = wheelCenter + Math.sin(ang) * (HUE_WHEEL_INNER + 1);
    const x2 = wheelCenter + Math.cos(ang) * (HUE_WHEEL_OUTER - 1);
    const y2 = wheelCenter + Math.sin(ang) * (HUE_WHEEL_OUTER - 1);
    hueCtx.lineWidth = 2;
    hueCtx.strokeStyle = "#fff";
    hueCtx.beginPath();
    hueCtx.moveTo(x1, y1);
    hueCtx.lineTo(x2, y2);
    hueCtx.stroke();
    hueCtx.lineWidth = 1;
    hueCtx.strokeStyle = "#000";
    hueCtx.stroke();
  }

  function drawSvBox(): void {
    svCtx.clearRect(0, 0, SV_BOX_SIZE, SV_BOX_SIZE);
    const hueRgb = hsvToRgb({ h: curHsv.h, s: 1, v: 1 });
    const horiz = svCtx.createLinearGradient(0, 0, SV_BOX_SIZE, 0);
    horiz.addColorStop(0, "#fff");
    horiz.addColorStop(1, `rgb(${hueRgb[0]},${hueRgb[1]},${hueRgb[2]})`);
    svCtx.fillStyle = horiz;
    svCtx.fillRect(0, 0, SV_BOX_SIZE, SV_BOX_SIZE);
    const vert = svCtx.createLinearGradient(0, 0, 0, SV_BOX_SIZE);
    vert.addColorStop(0, "rgba(0,0,0,0)");
    vert.addColorStop(1, "rgba(0,0,0,1)");
    svCtx.fillStyle = vert;
    svCtx.fillRect(0, 0, SV_BOX_SIZE, SV_BOX_SIZE);

    const cx = curHsv.s * SV_BOX_SIZE;
    const cy = (1 - curHsv.v) * SV_BOX_SIZE;
    svCtx.lineWidth = 2;
    svCtx.strokeStyle = "#fff";
    svCtx.beginPath();
    svCtx.arc(cx, cy, 4, 0, Math.PI * 2);
    svCtx.stroke();
    svCtx.lineWidth = 1;
    svCtx.strokeStyle = "#000";
    svCtx.stroke();
  }

  let huePicking = false;
  let svPicking = false;

  function pickHue(e: MouseEvent): void {
    const rect = hueCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left - wheelCenter;
    const y = e.clientY - rect.top - wheelCenter;
    let h = (Math.atan2(y, x) * 180) / Math.PI + 90;
    if (h < 0) h += 360;
    curHsv = { ...curHsv, h };
    sessionStore.setState({ color: hsvToRgb(curHsv) });
    drawHueWheel();
    drawSvBox();
  }

  function pickSv(e: MouseEvent): void {
    const rect = svCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(SV_BOX_SIZE, e.clientX - rect.left));
    const y = Math.max(0, Math.min(SV_BOX_SIZE, e.clientY - rect.top));
    curHsv = { ...curHsv, s: x / SV_BOX_SIZE, v: 1 - y / SV_BOX_SIZE };
    sessionStore.setState({ color: hsvToRgb(curHsv) });
    drawSvBox();
  }

  hueCanvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    huePicking = true;
    pickHue(e);
  });
  svCanvas.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    svPicking = true;
    pickSv(e);
  });

  const onDocMouseMove = (e: MouseEvent): void => {
    if (huePicking) pickHue(e);
    if (svPicking) pickSv(e);
  };
  const onDocMouseUp = (): void => {
    if (huePicking || svPicking) {
      huePicking = false;
      svPicking = false;
      pushRecent(sessionStore.getState().color);
      renderRecent();
    }
  };
  document.addEventListener("mousemove", onDocMouseMove);
  document.addEventListener("mouseup", onDocMouseUp);

  function renderInputs(): void {
    const { color, alpha } = sessionStore.getState();
    previewEl.style.background = rgbToHex(color);
    if (hexInput.value.toLowerCase() !== rgbToHex(color)) hexInput.value = rgbToHex(color);
    if (rInput.value !== String(color[0])) rInput.value = String(color[0]);
    if (gInput.value !== String(color[1])) gInput.value = String(color[1]);
    if (bInput.value !== String(color[2])) bInput.value = String(color[2]);
    if (alphaInput.value !== String(alpha)) alphaInput.value = String(alpha);
    alphaValEl.textContent = String(alpha);
  }

  hexInput.addEventListener("change", () => {
    const rgb = hexToRgb(hexInput.value);
    if (rgb) applyRgb(rgb);
    else renderInputs();
  });

  function readRgbInputs(): void {
    const r = clampByte(Number(rInput.value) || 0);
    const g = clampByte(Number(gInput.value) || 0);
    const b = clampByte(Number(bInput.value) || 0);
    applyRgb([r, g, b]);
  }
  rInput.addEventListener("change", readRgbInputs);
  gInput.addEventListener("change", readRgbInputs);
  bInput.addEventListener("change", readRgbInputs);
  alphaInput.addEventListener("input", () => {
    const v = Number(alphaInput.value);
    if (Number.isFinite(v)) sessionStore.setState({ alpha: clampByte(v) });
  });

  function renderSwatches(): void {
    swatchesEl.innerHTML = "";
    for (const group of SWATCH_GROUPS) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:4px;";
      const label = document.createElement("span");
      label.style.cssText = "opacity:0.6;font-size:10px;width:48px;flex:none;";
      label.textContent = t(`colorPalette.swatchGroup_${group.key}`);
      row.appendChild(label);
      const list = document.createElement("div");
      list.style.cssText = "display:flex;gap:2px;flex-wrap:wrap;";
      for (const rgb of group.colors) {
        const sw = document.createElement("button");
        sw.className = "btn cp-swatch";
        sw.title = rgbToHex(rgb);
        sw.style.cssText = `width:18px;height:18px;padding:0;background:${rgbToHex(rgb)};border:${borderCss};`;
        sw.addEventListener("click", () => applyRgb(rgb));
        list.appendChild(sw);
      }
      row.appendChild(list);
      swatchesEl.appendChild(row);
    }

    const customLabel = document.createElement("span");
    customLabel.style.cssText = "opacity:0.6;font-size:10px;margin-top:6px;";
    customLabel.textContent = t("colorPalette.swatchGroup_custom");
    swatchesEl.appendChild(customLabel);
    for (let row = 0; row < 3; row++) {
      const rowEl = document.createElement("div");
      rowEl.style.cssText = "display:flex;gap:2px;";
      for (let col = 0; col < 8; col++) {
        const idx = row * 8 + col;
        const slot = customSwatches[idx];
        const sw = document.createElement("button");
        sw.className = "btn cp-swatch";
        sw.dataset.role = "custom-swatch";
        sw.dataset.idx = String(idx);
        sw.title = slot ? rgbToHex(slot) : t("colorPalette.customSlotEmpty");
        const bg = slot ? rgbToHex(slot) : "transparent";
        const cross = slot
          ? ""
          : "background-image:linear-gradient(45deg,rgba(var(--border-rgb),0.2) 25%,transparent 25%,transparent 75%,rgba(var(--border-rgb),0.2) 75%),linear-gradient(45deg,rgba(var(--border-rgb),0.2) 25%,transparent 25%,transparent 75%,rgba(var(--border-rgb),0.2) 75%);background-size:6px 6px;background-position:0 0,3px 3px;";
        sw.style.cssText = `width:22px;height:22px;padding:0;background:${bg};border:${borderCss};${cross}`;
        attachCustomSwatchHandlers(sw, idx);
        rowEl.appendChild(sw);
      }
      swatchesEl.appendChild(rowEl);
    }
  }

  function attachCustomSwatchHandlers(sw: HTMLButtonElement, idx: number): void {
    let pressTimer: number | null = null;
    let longPressFired = false;
    const clearTimer = (): void => {
      if (pressTimer !== null) {
        window.clearTimeout(pressTimer);
        pressTimer = null;
      }
    };
    sw.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      longPressFired = false;
      pressTimer = window.setTimeout(() => {
        longPressFired = true;
        openCustomSwatchEditor(idx);
      }, 600);
    });
    sw.addEventListener("mouseup", clearTimer);
    sw.addEventListener("mouseleave", clearTimer);
    sw.addEventListener("click", (e) => {
      if (longPressFired) {
        e.preventDefault();
        return;
      }
      const slot = customSwatches[idx];
      if (slot) applyRgb(slot);
      else openCustomSwatchEditor(idx);
    });
    sw.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      openCustomSwatchEditor(idx);
    });
  }

  function openCustomSwatchEditor(idx: number): void {
    const overlay = document.createElement("div");
    overlay.dataset.modalOpen = "true";
    overlay.style.cssText =
      "position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:10000;display:flex;align-items:center;justify-content:center;";

    const card = document.createElement("div");
    card.className = "panel";
    card.style.cssText =
      "min-width:280px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;font-size:12px;";
    overlay.appendChild(card);

    const title = document.createElement("div");
    title.textContent = t("colorPalette.customSlotEditTitle");
    title.style.cssText = "font-weight:600;";
    card.appendChild(title);

    const slot = customSwatches[idx];
    const initialHex = slot ? rgbToHex(slot) : rgbToHex(sessionStore.getState().color);

    const previewRow = document.createElement("div");
    previewRow.style.cssText = "display:flex;align-items:center;gap:8px;";
    const previewBox = document.createElement("div");
    previewBox.style.cssText = `width:40px;height:24px;background:${initialHex};border:${borderCss};`;
    const hexInputEl = document.createElement("input");
    hexInputEl.className = "input";
    hexInputEl.type = "text";
    hexInputEl.value = initialHex;
    hexInputEl.maxLength = 7;
    hexInputEl.style.cssText = "flex:1;font-family:ui-monospace,monospace;";
    hexInputEl.addEventListener("input", () => {
      const rgb = hexToRgb(hexInputEl.value);
      if (rgb) previewBox.style.background = rgbToHex(rgb);
    });
    previewRow.append(previewBox, hexInputEl);
    card.appendChild(previewRow);

    const useCurrentBtn = document.createElement("button");
    useCurrentBtn.type = "button";
    useCurrentBtn.className = "btn";
    useCurrentBtn.textContent = t("colorPalette.customSlotUseCurrent");
    useCurrentBtn.addEventListener("click", () => {
      const cur = sessionStore.getState().color;
      hexInputEl.value = rgbToHex(cur);
      previewBox.style.background = rgbToHex(cur);
    });
    card.appendChild(useCurrentBtn);

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;justify-content:space-between;gap:8px;";
    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "btn";
    clearBtn.textContent = t("colorPalette.customSlotClear");
    clearBtn.disabled = slot === null;
    const rightGroup = document.createElement("div");
    rightGroup.style.cssText = "display:flex;gap:8px;";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "btn";
    cancelBtn.textContent = t("colorPalette.customSlotCancel");
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "btn btn-primary";
    okBtn.textContent = t("colorPalette.customSlotSave");
    rightGroup.append(cancelBtn, okBtn);
    btnRow.append(clearBtn, rightGroup);
    card.appendChild(btnRow);

    function close(): void {
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "Enter") {
        okBtn.click();
      }
    }
    cancelBtn.addEventListener("click", close);
    overlay.addEventListener("mousedown", (e) => {
      if (e.target === overlay) close();
    });
    clearBtn.addEventListener("click", () => {
      customSwatches[idx] = null;
      persistCustom();
      renderSwatches();
      close();
    });
    okBtn.addEventListener("click", () => {
      const rgb = hexToRgb(hexInputEl.value);
      if (!rgb) return;
      customSwatches[idx] = rgb;
      persistCustom();
      renderSwatches();
      close();
    });
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlay);
    hexInputEl.focus();
    hexInputEl.select();
  }

  function applyTexts(): void {
    alphaLabelEl.textContent = t("colorPalette.alpha");
    recentLabelEl.textContent = t("colorPalette.recent");
    dropperBtn.title = t("colorPalette.pickFromCanvas");
    renderSwatches();
  }

  const unsubscribe = sessionStore.subscribe(() => {
    const c = sessionStore.getState().color;
    if (!rgbEqual(c, hsvToRgb(curHsv))) {
      curHsv = rgbToHsv(c);
      drawSvBox();
      drawHueWheel();
    }
    renderInputs();
  });

  applyTexts();
  renderInputs();
  drawHueWheel();
  drawSvBox();
  renderRecent();

  const detachDropper = attachDropper(dropperBtn, applyRgb);
  const unsubLang = subscribeLang(applyTexts);

  return () => {
    unsubscribe();
    unsubLang();
    detachDropper();
    document.removeEventListener("mousemove", onDocMouseMove);
    document.removeEventListener("mouseup", onDocMouseUp);
  };
}

const TOOLBAR_HEIGHT = 28;
const POLL_INTERVAL_MS = 40;

// 主窗口内直接用浏览器 CSS 坐标采样，零高 DPI 偏差；光标移出主窗口时轮询后端采样图片子窗口。
function attachDropper(btn: HTMLButtonElement, applyRgb: (rgb: Rgb) => void): () => void {
  let active = false;
  let originalColor: Rgb = sessionStore.getState().color;
  let pollTimer: number | null = null;
  let cursorInMainWindow = true;
  let externalDragging = false;
  let inflight = false;

  function onWinMouseMove(e: MouseEvent): void {
    if (!active) return;
    cursorInMainWindow = true;
    const rgb = pickAt(e.clientX, e.clientY);
    if (rgb) sessionStore.setState({ color: rgb });
  }

  function onWinMouseLeave(): void {
    cursorInMainWindow = false;
  }

  function onWinMouseDown(e: MouseEvent): void {
    if (!active) return;
    if (btn.contains(e.target as Node)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.button !== 0) {
      stop(false);
      return;
    }
    const rgb = pickAt(e.clientX, e.clientY) ?? sessionStore.getState().color;
    applyRgb(rgb);
    stop(true);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      stop(false);
    }
  }

  function start(): void {
    if (active) return;
    active = true;
    cursorInMainWindow = true;
    externalDragging = false;
    originalColor = sessionStore.getState().color;
    document.body.classList.add("cp-picking");
    btn.classList.add("btn-primary");
    window.addEventListener("mousemove", onWinMouseMove, true);
    document.documentElement.addEventListener("mouseleave", onWinMouseLeave);
    window.addEventListener("mousedown", onWinMouseDown, true);
    document.addEventListener("keydown", onKey, true);
    void setPickActive(true);
    pollTimer = window.setInterval(() => void pollExternal(), POLL_INTERVAL_MS);
  }

  function stop(commit: boolean): void {
    if (!active) return;
    active = false;
    externalDragging = false;
    document.body.classList.remove("cp-picking");
    btn.classList.remove("btn-primary");
    window.removeEventListener("mousemove", onWinMouseMove, true);
    document.documentElement.removeEventListener("mouseleave", onWinMouseLeave);
    window.removeEventListener("mousedown", onWinMouseDown, true);
    document.removeEventListener("keydown", onKey, true);
    void setPickActive(false);
    if (pollTimer !== null) {
      window.clearInterval(pollTimer);
      pollTimer = null;
    }
    if (!commit) {
      sessionStore.setState({ color: originalColor });
    }
  }

  async function pollExternal(): Promise<void> {
    if (!active || cursorInMainWindow || inflight) return;
    inflight = true;
    try {
      const pos = await getCursorScreenPos();
      if (!active || cursorInMainWindow || !pos) return;
      const rgb = await pickImagePixelByScreenCoord(pos.x, pos.y, TOOLBAR_HEIGHT);
      if (!active || cursorInMainWindow) return;
      if (rgb) sessionStore.setState({ color: rgb });
      const down = await isMouseLeftDown();
      if (!active || cursorInMainWindow) return;
      if (!down && externalDragging) {
        applyRgb(rgb ?? sessionStore.getState().color);
        stop(true);
        return;
      }
      if (down) externalDragging = true;
    } finally {
      inflight = false;
    }
  }

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (active) stop(false);
    else start();
  });

  return () => stop(false);
}

function pickAt(clientX: number, clientY: number): Rgb | null {
  const els = document.elementsFromPoint(clientX, clientY);
  for (const el of els) {
    if (el instanceof HTMLCanvasElement) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0 || el.width === 0 || el.height === 0) continue;
      const sx = (clientX - rect.left) * (el.width / rect.width);
      const sy = (clientY - rect.top) * (el.height / rect.height);
      const cx = Math.max(0, Math.min(el.width - 1, Math.floor(sx)));
      const cy = Math.max(0, Math.min(el.height - 1, Math.floor(sy)));
      try {
        const ctx = el.getContext("2d");
        if (!ctx) continue;
        const sampled = sampleNonTransparent(ctx, cx, cy);
        if (sampled) return sampled;
      } catch {
        continue;
      }
    }
    if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0 && el.naturalHeight > 0) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const off = document.createElement("canvas");
      off.width = el.naturalWidth;
      off.height = el.naturalHeight;
      const ctx = off.getContext("2d");
      if (!ctx) continue;
      try {
        ctx.drawImage(el, 0, 0);
        const sx = ((clientX - rect.left) / rect.width) * el.naturalWidth;
        const sy = ((clientY - rect.top) / rect.height) * el.naturalHeight;
        const cx = Math.max(0, Math.min(el.naturalWidth - 1, Math.floor(sx)));
        const cy = Math.max(0, Math.min(el.naturalHeight - 1, Math.floor(sy)));
        const sampled = sampleNonTransparent(ctx, cx, cy);
        if (sampled) return sampled;
      } catch {
        continue;
      }
    }
  }
  return null;
}

// 透明像素返回 `null`，以便穿透空的叠加画布读取下层像素。
function sampleNonTransparent(ctx: CanvasRenderingContext2D, cx: number, cy: number): Rgb | null {
  const data = ctx.getImageData(cx, cy, 1, 1).data;
  if (data[3] === 0) return null;
  return [data[0], data[1], data[2]];
}
