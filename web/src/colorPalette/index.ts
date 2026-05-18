// 仿 SAI2 调色盘。
// UI 自上而下：色相环（外圈，hue 选择）+ 饱和度/明度方块（中间内嵌）→
// 当前色预览块 + RGB/HEX/Alpha 输入 → 预设色组（多组 ×8 色）→ 取色历史。
// 用户在任一控件上修改即写回 sessionStore.color / .alpha。
// 订阅 sessionStore 反向同步外部变更（如最近色按钮点击）。
//
// 不引第三方色彩库——HSV↔RGB 公式走 colorMath.ts；预设色组走 swatches.ts。

import { sessionStore } from "../stateStore";
import { subscribeLang, t } from "../i18n";
import { ICON_DROPPER } from "../toolPanel/toolIcons";
import { pickImagePixelByScreenCoord, getCursorScreenPos, isMouseLeftDown, setPickActive } from "../apiClient";
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
const HUE_WHEEL_SIZE = 140;
const HUE_WHEEL_INNER = 50;
const HUE_WHEEL_OUTER = 68;
const SV_BOX_SIZE = 88;

export function mountColorPalette(container: HTMLElement): () => void {
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
    `<div data-role="cur-preview" style="flex:1;height:24px;border:1px solid rgba(0,0,0,0.2);"></div>` +
    `<button class="btn cp-tool-btn" data-role="dropper" type="button" style="width:24px;height:24px;padding:0;flex:none;">${ICON_DROPPER}</button>` +
    `</div>` +
    `<label style="display:flex;align-items:center;gap:4px;"><span style="width:30px;">HEX</span>` +
    `<input type="text" data-role="hex" maxlength="7" style="flex:1;font-family:ui-monospace,monospace;"></label>` +
    `<label style="display:flex;align-items:center;gap:4px;"><span style="width:30px;">R</span>` +
    `<input type="number" data-role="r" min="0" max="255" style="flex:1;"></label>` +
    `<label style="display:flex;align-items:center;gap:4px;"><span style="width:30px;">G</span>` +
    `<input type="number" data-role="g" min="0" max="255" style="flex:1;"></label>` +
    `<label style="display:flex;align-items:center;gap:4px;"><span style="width:30px;">B</span>` +
    `<input type="number" data-role="b" min="0" max="255" style="flex:1;"></label>` +
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

  // 内部状态。curHsv 是用户操作的权威源——所有颜色变化都先改 HSV，
  // 再算 RGB 写 sessionStore，避免 RGB↔HSV 来回换算时 Hue 因饱和度=0 丢失。
  // recent 是会话级最近用色 FIFO。
  let curHsv: Hsv = rgbToHsv(sessionStore.getState().color);
  const recent: Rgb[] = [];

  function pushRecent(rgb: Rgb): void {
    const idx = recent.findIndex((c) => rgbEqual(c, rgb));
    if (idx >= 0) recent.splice(idx, 1);
    recent.unshift(rgb);
    if (recent.length > RECENT_LIMIT) recent.length = RECENT_LIMIT;
  }

  function renderRecent(): void {
    recentListEl.innerHTML = "";
    for (const rgb of recent) {
      const sw = document.createElement("button");
      sw.className = "btn cp-swatch";
      sw.title = rgbToHex(rgb);
      sw.style.cssText = `width:18px;height:18px;padding:0;background:${rgbToHex(rgb)};border:1px solid rgba(0,0,0,0.2);`;
      sw.addEventListener("click", () => {
        applyRgb(rgb);
      });
      recentListEl.appendChild(sw);
    }
  }

  // 由 swatch / recent / hex / rgb 输入触发的"以 RGB 为权威值"应用路径。
  // 同步 curHsv（保持 hue 一致）+ 写 sessionStore + 推 recent + 重绘 hue/sv canvas。
  function applyRgb(rgb: Rgb): void {
    curHsv = rgbToHsv(rgb);
    pushRecent(rgb);
    sessionStore.setState({ color: rgb });
    renderRecent();
    drawHueWheel();
    drawSvBox();
  }

  // 色相环渲染 + 拖拽取 Hue。
  // 画法：1° × 360 扇形铺满外圆 → destination-out 抠掉内圆做成圆环 → 画指示标记。
  // 拖拽：mousedown 进入，mousemove 算光标极角 = hue。
  const wheelCenter = HUE_WHEEL_SIZE / 2;
  function drawHueWheel(): void {
    hueCtx.clearRect(0, 0, HUE_WHEEL_SIZE, HUE_WHEEL_SIZE);
    // 360 扇形
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
    // 抠中心
    hueCtx.save();
    hueCtx.globalCompositeOperation = "destination-out";
    hueCtx.beginPath();
    hueCtx.arc(wheelCenter, wheelCenter, HUE_WHEEL_INNER, 0, Math.PI * 2);
    hueCtx.fill();
    hueCtx.restore();
    // 指示器：当前 hue 角的圆环外侧 + 内侧之间画一条短线
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

  let huePicking = false;
  function pickHue(e: MouseEvent): void {
    const rect = hueCanvas.getBoundingClientRect();
    const x = e.clientX - rect.left - wheelCenter;
    const y = e.clientY - rect.top - wheelCenter;
    let h = (Math.atan2(y, x) * 180) / Math.PI + 90;
    if (h < 0) h += 360;
    curHsv = { ...curHsv, h };
    const rgb = hsvToRgb(curHsv);
    pushRecent(rgb);
    sessionStore.setState({ color: rgb });
    drawHueWheel();
    drawSvBox();
    renderRecent();
  }
  hueCanvas.addEventListener("mousedown", (e) => {
    huePicking = true;
    pickHue(e);
  });
  document.addEventListener("mousemove", (e) => {
    if (huePicking) pickHue(e);
  });
  document.addEventListener("mouseup", () => {
    huePicking = false;
  });

  // SV 方块渲染 + 拖拽取饱和度/明度。
  // 用两层 linearGradient 叠加合成：先画顶色横条（左白到右纯色 hue），
  // 再叠一层垂直黑色渐变（上透明到下不透明）。视觉等同于逐像素 HSV 填充。
  // 拖拽：mousedown 进入，mousemove 算 (x,y)→(s,v)。
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
    // 指示器：当前 (s, v) 处画双圈
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

  let svPicking = false;
  function pickSv(e: MouseEvent): void {
    const rect = svCanvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(SV_BOX_SIZE, e.clientX - rect.left));
    const y = Math.max(0, Math.min(SV_BOX_SIZE, e.clientY - rect.top));
    curHsv = { ...curHsv, s: x / SV_BOX_SIZE, v: 1 - y / SV_BOX_SIZE };
    const rgb = hsvToRgb(curHsv);
    pushRecent(rgb);
    sessionStore.setState({ color: rgb });
    drawSvBox();
    renderRecent();
  }
  svCanvas.addEventListener("mousedown", (e) => {
    svPicking = true;
    pickSv(e);
  });
  document.addEventListener("mousemove", (e) => {
    if (svPicking) pickSv(e);
  });
  document.addEventListener("mouseup", () => {
    svPicking = false;
  });

  // 当前色预览 + RGB/HEX/Alpha 输入双向同步。
  function renderInputs(): void {
    const { color, alpha } = sessionStore.getState();
    previewEl.style.background = rgbToHex(color);
    if (hexInput.value.toLowerCase() !== rgbToHex(color))
      hexInput.value = rgbToHex(color);
    if (rInput.value !== String(color[0])) rInput.value = String(color[0]);
    if (gInput.value !== String(color[1])) gInput.value = String(color[1]);
    if (bInput.value !== String(color[2])) bInput.value = String(color[2]);
    if (alphaInput.value !== String(alpha)) alphaInput.value = String(alpha);
    alphaValEl.textContent = String(alpha);
  }

  hexInput.addEventListener("change", () => {
    const rgb = hexToRgb(hexInput.value);
    if (rgb) applyRgb(rgb);
    else renderInputs(); // 非法回退到当前值
  });
  function readRgbInputs(): void {
    const r = Math.max(0, Math.min(255, Number(rInput.value) || 0));
    const g = Math.max(0, Math.min(255, Number(gInput.value) || 0));
    const b = Math.max(0, Math.min(255, Number(bInput.value) || 0));
    applyRgb([r, g, b]);
  }
  rInput.addEventListener("change", readRgbInputs);
  gInput.addEventListener("change", readRgbInputs);
  bInput.addEventListener("change", readRgbInputs);
  alphaInput.addEventListener("input", () => {
    const v = Number(alphaInput.value);
    if (Number.isFinite(v)) sessionStore.setState({ alpha: v });
  });

  // 预设色组渲染（每组一行 ×8 swatch）+ i18n 文案 + sessionStore 订阅。
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
        sw.style.cssText = `width:18px;height:18px;padding:0;background:${rgbToHex(rgb)};border:1px solid rgba(0,0,0,0.2);`;
        sw.addEventListener("click", () => applyRgb(rgb));
        list.appendChild(sw);
      }
      row.appendChild(list);
      swatchesEl.appendChild(row);
    }
  }

  function applyTexts(): void {
    alphaLabelEl.textContent = t("colorPalette.alpha");
    recentLabelEl.textContent = t("colorPalette.recent");
    dropperBtn.title = t("colorPalette.pickFromCanvas");
    renderSwatches(); // group 标签随 lang 变
  }

  // sessionStore 订阅：外部修改 color/alpha 时同步输入框 + curHsv。
  // 注意：本模块自己 setState 时也会回调；renderInputs 用值比较避免回环写。
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

  // 取色针：点击进入取色模式，鼠标移到画布上实时取色，点击确认 / Esc 取消。
  // 工作目标是 webview 内的 <canvas>（编辑画布、预览画布等），用 elementsFromPoint
  // 找到首张 canvas → getImageData(1,1) 读 RGBA。不跨进程取屏幕色。
  const detachDropper = attachDropper(dropperBtn, applyRgb);

  const unsubLang = subscribeLang(applyTexts);

  return () => {
    unsubscribe();
    unsubLang();
    detachDropper();
  };
}

// 取色针：激活后用 50ms setInterval 轮询光标的屏幕坐标 + 左键状态（Tauri 模式）。
// 鼠标在主窗口内时优先用 elementsFromPoint 取本窗口 canvas 像素；
// 鼠标在主窗口外（包括图片子窗口、浏览器、桌面）时调 Rust 后端按屏幕坐标查命中
// `image_*` 子窗口取色。左键从未按 → 按下的边沿即视为确认。Esc 取消恢复原色。
const TOOLBAR_HEIGHT = 28;
const POLL_INTERVAL_MS = 50;

function attachDropper(btn: HTMLButtonElement, applyRgb: (rgb: Rgb) => void): () => void {
  let active = false;
  let originalColor: Rgb = sessionStore.getState().color;
  let pollTimer: number | null = null;
  let lastMouseDown = false; // 上一帧左键状态——边沿检测用
  let inflight = false; // 后端取色还在路上时跳过本帧避免堆积

  function start(): void {
    if (active) return;
    active = true;
    originalColor = sessionStore.getState().color;
    document.body.classList.add("cp-picking");
    btn.classList.add("btn-primary");
    document.addEventListener("keydown", onKey, true);
    void setPickActive(true);
    // 先 sample 一次当前左键状态：避免点击滴管按钮的 mouseup 残留触发"立即确认"。
    isMouseLeftDown().then((down) => {
      lastMouseDown = down;
    });
    pollTimer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
  }

  function stop(commit: boolean): void {
    if (!active) return;
    active = false;
    document.body.classList.remove("cp-picking");
    btn.classList.remove("btn-primary");
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

  async function poll(): Promise<void> {
    if (!active || inflight) return;
    inflight = true;
    try {
      const pos = await getCursorScreenPos();
      if (!active) return;
      let rgb: Rgb | null = null;
      if (pos) {
        // 屏幕坐标 → 主窗口客户区坐标。鼠标在主窗口内则走本窗口 elementsFromPoint。
        const cx = pos.x - window.screenX;
        const cy = pos.y - window.screenY;
        if (cx >= 0 && cy >= 0 && cx < window.innerWidth && cy < window.innerHeight) {
          rgb = pickAt(cx, cy);
        }
        if (!rgb) {
          // 鼠标在主窗口外（含图片子窗口）：让 Rust 按屏幕坐标查命中子窗口。
          rgb = await pickImagePixelByScreenCoord(pos.x, pos.y, TOOLBAR_HEIGHT);
        }
      }
      if (!active) return;
      if (rgb) {
        sessionStore.setState({ color: rgb });
      }
      // 左键边沿检测：未按 → 按下 视为确认。
      const down = await isMouseLeftDown();
      if (!active) return;
      if (down && !lastMouseDown) {
        // 用最后一次取到的颜色提交（rgb 可能为 null，此时取当前 sessionStore.color）。
        const finalRgb = rgb ?? sessionStore.getState().color;
        applyRgb(finalRgb);
        stop(true);
        return;
      }
      lastMouseDown = down;
    } finally {
      inflight = false;
    }
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      stop(false);
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
  // 优先 canvas；canvas 不在时尝试 <img>（图片子窗口的 <img>）。
  const els = document.elementsFromPoint(clientX, clientY);
  for (const el of els) {
    if (el instanceof HTMLCanvasElement) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const sx = (clientX - rect.left) * (el.width / rect.width);
      const sy = (clientY - rect.top) * (el.height / rect.height);
      const cx = Math.max(0, Math.min(el.width - 1, Math.floor(sx)));
      const cy = Math.max(0, Math.min(el.height - 1, Math.floor(sy)));
      try {
        const ctx = el.getContext("2d");
        if (!ctx) continue;
        const data = ctx.getImageData(cx, cy, 1, 1).data;
        return [data[0], data[1], data[2]];
      } catch {
        // tainted canvas（跨域 img 绘入）会抛 SecurityError，跳过继续找下一层。
        continue;
      }
    }
    if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0) {
      // 把 img 暂时画到离屏 canvas 取色。仅命中 same-origin / dataURL 时成功。
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
        const data = ctx.getImageData(cx, cy, 1, 1).data;
        return [data[0], data[1], data[2]];
      } catch {
        continue;
      }
    }
  }
  return null;
}
