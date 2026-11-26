// 预览画布辅助逻辑：DOM 骨架、部件名映射、动作帧二分定位与捕捉菜单渲染。

import {
  getAssemblyTable,
  loadWingsConfig,
  type HeadVariant,
  type MotionCaptureFrame,
  type MotionCaptureMeta,
  type MotionCaptureResult,
} from "../apiClient";
import type { PartCategory } from "../stateStore/types";
import { t } from "../i18n";
import { ICON_REFRESH } from "../toolPanel/toolIcons";

export const COMPOSITE_W = 100;
export const COMPOSITE_H = 100;
export const EXPRESSION_COUNT = 8;
export const CAPTURE_ROOT = "captures";
const MAX_PREVIEW_DISPLAY_DIM = 2048;

/**
 * 将离屏合成源画布按当前缩放与 DPR 硬边缘绘制到显示画布；
 * 在 2D Context 内完成水平镜像与整数像素放大，避免父容器 CSS scale 触发 WebView2 GPU 合成层双线性渗色。
 */
export function renderPreviewDisplayCanvas(
  source: HTMLCanvasElement,
  target: HTMLCanvasElement,
  targetCtx: CanvasRenderingContext2D | null,
  zoom: number,
  mirror: boolean,
): void {
  if (!targetCtx || source.width <= 0 || source.height <= 0) return;
  const cssW = Math.max(1, Math.round(source.width * zoom));
  const cssH = Math.max(1, Math.round(source.height * zoom));
  target.style.width = `${cssW}px`;
  target.style.height = `${cssH}px`;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rawW = cssW * dpr;
  const rawH = cssH * dpr;
  const clamp = Math.min(1, MAX_PREVIEW_DISPLAY_DIM / Math.max(rawW, rawH));
  const bufW = Math.max(1, Math.round(rawW * clamp));
  const bufH = Math.max(1, Math.round(rawH * clamp));
  if (target.width !== bufW || target.height !== bufH) {
    target.width = bufW;
    target.height = bufH;
  }

  targetCtx.save();
  targetCtx.imageSmoothingEnabled = false;
  targetCtx.clearRect(0, 0, bufW, bufH);
  if (mirror) {
    targetCtx.translate(bufW, 0);
    targetCtx.scale(-1, 1);
  }
  targetCtx.drawImage(source, 0, 0, bufW, bufH);
  targetCtx.restore();
}

export const HEAD_VARIANTS: readonly HeadVariant[] = [
  "default",
  "mouthHalf",
  "mouth",
  "disfigured1",
  "disfigured2",
  "disfigured3",
  "disfigured1Healed",
  "disfigured2Healed",
  "disfigured3Healed",
];

export function buildPreviewCanvasHtml(): string {
  const borderCss = "1px solid rgba(var(--border-rgb),var(--border-opacity))";
  return (
    `<div class="preview-toolbar" style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:${borderCss};flex-wrap:wrap;">` +
    `<div data-role="orientation" style="display:flex;gap:4px;flex:none;"></div>` +
    `<label style="display:flex;align-items:center;gap:4px;font-size:11px;min-width:0;flex:1 1 110px;">` +
    `<span data-role="expression-label" style="opacity:0.7;flex:none;"></span>` +
    `<select class="input" data-role="expression-select" style="flex:1;min-width:0;padding:2px 6px;font-size:12px;"></select>` +
    `</label>` +
    `<label style="display:flex;align-items:center;gap:4px;font-size:11px;min-width:0;flex:1 1 130px;">` +
    `<span data-role="head-variant-label" style="opacity:0.7;flex:none;"></span>` +
    `<select class="input" data-role="head-variant-select" style="flex:1;min-width:0;padding:2px 6px;font-size:12px;"></select>` +
    `</label>` +
    `</div>` +
    `<div class="preview-toolbar" style="display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:${borderCss};flex-wrap:wrap;">` +
    `<div data-role="preview-mode" style="display:flex;gap:4px;"></div>` +
    `<div data-role="motion-capture-host" style="position:relative;min-width:180px;max-width:240px;display:none;">` +
    `<button class="btn" data-role="motion-capture-toggle" type="button" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;padding-right:8px;"></button>` +
    `<div class="panel" data-role="motion-capture-popover" hidden style="position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:20;max-height:240px;overflow:auto;padding:4px;"></div>` +
    `</div>` +
    `<button class="btn" data-role="motion-play" type="button"></button>` +
    `<input type="range" data-role="motion-frame-range" min="0" max="0" step="1" value="0" style="flex:1;min-width:80px;" />` +
    `<span data-role="motion-frame-label" class="mono" style="font-size:11px;opacity:0.7;"></span>` +
    `</div>` +
    `<div class="preview-zoom-bar" style="display:flex;align-items:center;gap:6px;padding:4px 8px;border-bottom:${borderCss};flex-wrap:wrap;">` +
    `<input type="range" data-role="zoom-range" min="10" max="800" step="1" value="200" style="flex:1;min-width:80px;" />` +
    `<input class="input" type="number" data-role="zoom-num" min="10" max="800" step="1" value="200" style="width:64px;padding:2px 6px;" />` +
    `<span class="mono" style="opacity:0.6;">%</span>` +
    `<button class="btn" data-role="reset-view" type="button"></button>` +
    `<label data-role="live-toggle" style="display:flex;align-items:center;gap:4px;font-size:11px;cursor:pointer;user-select:none;">` +
    `<input type="checkbox" data-role="live-cb" checked />` +
    `<span data-role="live-label"></span>` +
    `</label>` +
    `<button class="btn cp-tool-btn" data-role="refresh-now" type="button" style="display:none;">${ICON_REFRESH}</button>` +
    `</div>` +
    `<div class="preview-stage" data-role="stage" style="flex:1;min-height:0;display:flex;align-items:stretch;padding:0;overflow:hidden;position:relative;">` +
    `<div data-role="stage-main" style="flex:1;min-width:0;position:relative;display:flex;align-items:center;justify-content:center;padding:16px;overflow:hidden;">` +
    `<div data-role="viewport" style="position:absolute;left:50%;top:50%;">` +
    `<canvas data-role="canvas" width="${COMPOSITE_W}" height="${COMPOSITE_H}" style="display:none;image-rendering:pixelated;"></canvas>` +
    `</div>` +
    `<div data-role="placeholder" style="opacity:0.6;"></div>` +
    `</div>` +
    `<aside data-role="motion-side" style="width:240px;display:none;align-self:stretch;border-left:${borderCss};padding:8px;overflow:auto;background:rgba(var(--border-rgb),0.04);">` +
    `<div data-role="motion-side-title" style="font-size:12px;font-weight:600;margin-bottom:6px;"></div>` +
    `<div data-role="motion-side-meta" class="mono" style="font-size:11px;opacity:0.7;white-space:pre-wrap;margin-bottom:8px;"></div>` +
    `<div data-role="motion-parts" class="mono" style="font-size:11px;line-height:1.45;white-space:pre-wrap;"></div>` +
    `</aside>` +
    `</div>` +
    `<div data-role="footer" style="flex:0 0 14%;height:14%;min-height:56px;display:flex;flex-direction:column;border-top:${borderCss};overflow:hidden;">` +
    `<div data-role="footer-resize" style="flex:0 0 8px;height:8px;cursor:ns-resize;position:relative;user-select:none;">` +
    `<div style="position:absolute;left:0;right:0;top:0;height:1px;background:rgba(var(--border-rgb),var(--border-opacity));"></div>` +
    `</div>` +
    `<div data-role="meta" class="mono" style="flex:0 0 45%;min-height:0;padding:6px 8px 2px;opacity:0.7;overflow:auto;"></div>` +
    `<div data-role="hint" class="mono" style="flex:1 1 auto;min-height:0;padding:0 8px 6px;opacity:0.55;font-size:11px;overflow:auto;"></div>` +
    `</div>`
  );
}

export function syncExpressionSelect(
  labelEl: HTMLSpanElement,
  selectEl: HTMLSelectElement,
  currentIndex: number,
): void {
  labelEl.textContent = t("previewCanvas.expressionPrefix");
  if (selectEl.options.length !== EXPRESSION_COUNT) {
    selectEl.innerHTML = "";
    for (let i = 0; i < EXPRESSION_COUNT; i++) {
      const opt = document.createElement("option");
      opt.value = String(i);
      selectEl.appendChild(opt);
    }
  }
  for (let i = 0; i < EXPRESSION_COUNT; i++) {
    selectEl.options[i].textContent = `${i}: ${t(`previewCanvas.expression${i}`)}`;
  }
  const clamped = Math.max(0, Math.min(EXPRESSION_COUNT - 1, currentIndex));
  if (selectEl.value !== String(clamped)) selectEl.value = String(clamped);
}

export function syncHeadVariantSelect(
  labelEl: HTMLSpanElement,
  selectEl: HTMLSelectElement,
  currentVariant: HeadVariant,
): void {
  labelEl.textContent = t("previewCanvas.headVariantLabel");
  if (selectEl.options.length !== HEAD_VARIANTS.length) {
    selectEl.innerHTML = "";
    for (const hv of HEAD_VARIANTS) {
      const opt = document.createElement("option");
      opt.value = hv;
      selectEl.appendChild(opt);
    }
  }
  for (let i = 0; i < HEAD_VARIANTS.length; i++) {
    selectEl.options[i].textContent = t(`previewCanvas.headVariant_${HEAD_VARIANTS[i]}`);
  }
  if (selectEl.value !== currentVariant) selectEl.value = currentVariant;
}

const CROSS_CHAR_TO_EXPERIMENT: Readonly<Record<string, string>> = {
  milkytorso: "experimentUpTorso",
  milkydowntorso: "experimentDownTorso",
  milkyuparm: "experimentUpArm",
  mildownarm: "experimentDownArm",
  milkyhandf: "experimentHandF",
  milkyhandb: "experimentHandB",
  milkythigh: "experimentThigh",
  milkycrus: "experimentCrus",
  milkyfoot: "experimentFoot",
  milkytail: "experimentTail",
  milkyhead: "experimentHead",
  milkyheadback: "experimentHeadBack",
  milkyheadbackmouthopen: "experimentHeadBackMouth",
  milkyheadbackmouthhalfopen: "experimentHeadBackMouthMini",
  milkydisfigure1: "experimentHeadDisfigured1",
  milkydisfigure1healed: "experimentHeadDisfigured1Healed",
  milkydisfigure2: "experimentHeadDisfigured2",
  milkydisfigure2healed: "experimentHeadDisfigured2Healed",
  milkydisfigure3: "experimentHeadDisfigured3",
  milkydisfigure3healed: "experimentHeadDisfigured3Healed",
  milkyeyeopen: "experimentEyeOpen",
  milkyeyeopenback: "experimentEyeOpen",
  milkyeyehalfclosed: "experimentEyeHalfClosed",
  milkyeyehalfclosedback: "experimentEyeHalfClosedBack",
  milkyeyeclosed: "experimentEyeClosed",
  milkyeyegone: "experimentEyeGone",
  milkyeyegonehealed: "experimentEyeGoneHealed",
  milkyeyehappy: "experimentEyeHappy",
  milkyeyehappyback: "experimentEyeHappy",
  milkyeyelockedin: "experimentEyeLockedIn",
  milkyeyelockedinback: "experimentEyeLockedInBack",
  milkyeyepanic: "experimentEyePanic",
  milkyeyesad: "experimentEyeSad",
  milkyeyesadback: "experimentEyeSadBack",
  milkyeyescared: "experimentEyeScared",
  milkyeyescaredback: "experimentEyeScaredBack",
  duneuparmalt: "experimentUpArm",
  dunedownarmalt: "experimentDownArm",
  dunehand: "experimentHandF",
  dunehandalt: "experimentHandB",
  dunethighalt: "experimentThigh",
  duneheadmouth: "experimentHeadBackMouth",
  duneheadmouthhalf: "experimentHeadBackMouthMini",
  dunedisfigured: "experimentHeadDisfigured1",
  dunedisfiguredhealed: "experimentHeadDisfigured1Healed",
  duneeyelockedin: "experimentEyeLockedIn",
  dunetradereyes: "experimentEyeOpen",
  dunetradereyesangry: "experimentEyeSad",
  dunetradereyessleep: "experimentEyeClosed",
};

/** 将选中的皮肤部件文件名归一化为 `assembly.json` 内的标准条目名。 */
export function toAssemblyEntryName(category: PartCategory, partName: string): string | null {
  if (category === "Accessories" || category === "Blood") return null;
  let name = partName.replace(/^R_/, "");
  if (category === "Wings") return name;
  const lower = name.toLowerCase();
  if (CROSS_CHAR_TO_EXPERIMENT[lower]) {
    return CROSS_CHAR_TO_EXPERIMENT[lower];
  }
  if ((name.endsWith("F") || name.endsWith("B")) && lower !== "milkyhandf" && lower !== "milkyhandb") {
    const trimmedCross = CROSS_CHAR_TO_EXPERIMENT[lower.slice(0, -1)];
    if (trimmedCross) return trimmedCross;
  }
  name = name.replace(/^dune(?=[A-Z])/, "experiment");
  if (
    (category === "Body" || category === "Head") &&
    name !== "experimentHandF" &&
    name !== "experimentHandB" &&
    (name.endsWith("F") || name.endsWith("B"))
  ) {
    name = name.slice(0, -1);
  }
  return name;
}

export function findFrameIndexByTime(frames: MotionCaptureFrame[], targetTime: number): number {
  if (frames.length === 0) return 0;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (frames[mid].t <= targetTime) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function populateBasePartPositions(
  skinRoot: string,
  skinName: string | null,
  target: Map<string, { x: number; y: number }>,
): void {
  getAssemblyTable(`${skinRoot}/assembly.json`)
    .then((res) => {
      for (const entry of res.table.parts) {
        const key = `${entry.category}::${entry.partName}`;
        if (!target.has(key)) {
          target.set(key, { x: entry.position.x, y: entry.position.y });
        }
      }
    })
    .catch((e) => console.warn("[previewCanvas] load assembly table failed", e));

  if (!skinName) return;
  loadWingsConfig(skinRoot, skinName)
    .then((cfg) => {
      target.set("Wings::wingUL", { x: cfg.wingUL.x, y: cfg.wingUL.y });
      target.set("Wings::wingDL", { x: cfg.wingDL.x, y: cfg.wingDL.y });
      target.set("Wings::wingUR", { x: cfg.wingUR.x, y: cfg.wingUR.y });
      target.set("Wings::wingDR", { x: cfg.wingDR.x, y: cfg.wingDR.y });
    })
    .catch(() => {});
}

export function renderCaptureDropdown(
  toggleBtn: HTMLButtonElement,
  popoverEl: HTMLDivElement,
  captures: MotionCaptureMeta[],
  currentPath: string,
  loading: boolean,
  onSelect: (path: string) => void,
): void {
  toggleBtn.title = t("previewCanvas.motionCaptureLabel");
  toggleBtn.disabled = loading || captures.length === 0;
  const selectedCapture = captures.find((capture) => capture.path === currentPath);
  const captureLabel = loading
    ? t("previewCanvas.motionCaptureLoading")
    : selectedCapture?.fileName ??
      (captures.length === 0
        ? t("previewCanvas.motionCaptureEmpty")
        : t("previewCanvas.motionCaptureLabel"));

  toggleBtn.innerHTML = "";
  const labelSpan = document.createElement("span");
  labelSpan.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
  labelSpan.textContent = captureLabel;
  const caretSpan = document.createElement("span");
  caretSpan.setAttribute("aria-hidden", "true");
  caretSpan.style.cssText = "flex:none;opacity:0.7;";
  caretSpan.textContent = "▾";
  toggleBtn.append(labelSpan, caretSpan);

  popoverEl.innerHTML = "";
  if (loading || captures.length === 0) {
    const empty = document.createElement("div");
    empty.style.cssText = "padding:8px 10px;opacity:0.6;";
    empty.textContent = loading
      ? t("previewCanvas.motionCaptureLoading")
      : t("previewCanvas.motionCaptureEmpty");
    popoverEl.appendChild(empty);
    return;
  }
  for (const capture of captures) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = capture.path === currentPath ? "btn btn-primary" : "btn";
    item.style.cssText =
      "display:block;width:100%;margin:0 0 4px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";
    item.textContent = capture.fileName;
    item.title = capture.fileName;
    item.addEventListener("click", () => onSelect(capture.path));
    popoverEl.appendChild(item);
  }
}

export function renderMotionDebugSection(
  titleEl: HTMLElement,
  metaEl: HTMLElement,
  partsEl: HTMLElement,
  motionData: MotionCaptureResult | null,
  frame: MotionCaptureFrame | null,
): void {
  titleEl.textContent = t("previewCanvas.motionPanelTitle");
  if (!frame || !motionData) {
    metaEl.textContent = "";
    partsEl.textContent = t("previewCanvas.motionNoFrame");
    return;
  }
  metaEl.textContent = `${motionData.playerName}\nt=${frame.t.toFixed(3)}s\ndir=${frame.isRight ? "right" : "left"}\nexp=${frame.expression}`;
  const hasTail = frame.limbs.some(
    (limb) => limb.name === "Tail" || limb.name === "experimentTail" || limb.limbNum === -1,
  );
  const rows = frame.limbs
    .slice()
    .sort((a, b) => a.limbNum - b.limbNum)
    .map((limb) => {
      const x = Math.round(limb.px * 8);
      const y = Math.round(-limb.py * 8);
      const sprite = limb.spriteName ? ` ${limb.spriteName}` : "";
      return `${limb.name.padEnd(10)} x=${x.toString().padStart(3)} y=${y.toString().padStart(3)} rot=${Math.round(limb.rotZ).toString().padStart(3)} z=${limb.sortingOrder.toString().padStart(4)}${sprite}`;
    });
  if (!hasTail) {
    rows.push(`Tail      ${t("previewCanvas.motionTailFallback")}`);
  }
  partsEl.textContent = rows.join("\n");
}
