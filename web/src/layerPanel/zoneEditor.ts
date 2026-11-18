// 区块列表与灯光/粒子/帧动画参数编辑器（魔法笔激活时挂载于图层面板）。

import { saveZones, type ApiError } from "../apiClient";
import { bumpAccessoriesVersion, parsePartId, sessionStore } from "../stateStore";
import { nextFreeZoneId, zonesStore } from "../stateStore/zonesStore";
import type { ZoneEntry, ZonesData } from "../stateStore/types";
import { t } from "../i18n";

export function zoneAutoColor(id: number): [number, number, number] {
  const h = (((id * 47) % 360) + 360) % 360;
  const s = 0.85;
  const l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (h < 60) [r1, g1, b1] = [c, x, 0];
  else if (h < 120) [r1, g1, b1] = [x, c, 0];
  else if (h < 180) [r1, g1, b1] = [0, c, x];
  else if (h < 240) [r1, g1, b1] = [0, x, c];
  else if (h < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

function rgb255ToHex(rgb: [number, number, number]): string {
  return `#${rgb[0].toString(16).padStart(2, "0")}${rgb[1].toString(16).padStart(2, "0")}${rgb[2].toString(16).padStart(2, "0")}`;
}

function hexToRgb255(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [
    Number.parseInt(h.substring(0, 2), 16) || 0,
    Number.parseInt(h.substring(2, 4), 16) || 0,
    Number.parseInt(h.substring(4, 6), 16) || 0,
  ];
}

function rgbaHex(rgba: [number, number, number, number] | undefined, fb: string): string {
  if (!rgba) return fb;
  return rgb255ToHex([rgba[0], rgba[1], rgba[2]]);
}

function hexToRgba255(hex: string, alpha: number): [number, number, number, number] {
  const [r, g, b] = hexToRgb255(hex);
  return [r, g, b, alpha];
}

export function flushZonesForPart(skinRoot: string, partId: string, data: ZonesData): void {
  const parsed = parsePartId(partId);
  if (!parsed) return;
  saveZones(skinRoot, parsed.skinName, parsed.category, parsed.partName, data)
    .then(() => bumpAccessoriesVersion())
    .catch((e: ApiError) => console.warn(`[layerPanel] saveZones failed: ${e?.message ?? String(e)}`));
}

export function createZoneInStore(skinRoot: string, partId: string): void {
  const snap = zonesStore.get();
  if (!snap.data || snap.partId !== partId) return;
  const newId = nextFreeZoneId(snap.data.config.zones);
  if (newId === 0) return;
  snap.data.config.zones.push({ id: newId });
  sessionStore.setState({ activeZoneId: newId, activeTool: "zoneBrush" });
  zonesStore.bump();
  flushZonesForPart(skinRoot, partId, snap.data);
}

export interface ZoneListContext {
  skinRoot: string;
  listEl: HTMLUListElement;
  metaEl: HTMLSpanElement;
  addBtn: HTMLButtonElement;
  upBtn: HTMLButtonElement;
  downBtn: HTMLButtonElement;
  expandedZoneIds: Set<number>;
  requestRender: () => void;
}

/** 仅刷新色块背景，避免 `input[type=color]` 拖动时重建 DOM 关闭系统拾色器。 */
export function refreshZoneSwatches(listEl: HTMLUListElement): void {
  const data = zonesStore.get().data;
  if (!data) return;
  for (const z of data.config.zones) {
    const el = listEl.querySelector<HTMLSpanElement>(`[data-zone-swatch="${z.id}"]`);
    if (!el) continue;
    const [r, g, b] = z.displayColor ?? zoneAutoColor(z.id);
    el.style.background = `rgb(${r},${g},${b})`;
  }
}

export function renderZonesList(ctx: ZoneListContext): void {
  const { listEl, metaEl, addBtn, upBtn, downBtn } = ctx;
  listEl.innerHTML = "";
  upBtn.style.display = "none";
  downBtn.style.display = "none";
  addBtn.title = t("layerPanel.addZone");
  addBtn.textContent = "+";

  const partId = sessionStore.getState().currentPartId;
  const snap = zonesStore.get();
  const data = snap.partId === partId ? snap.data : null;
  if (!partId || !data) {
    metaEl.textContent = "";
    addBtn.disabled = true;
    const li = document.createElement("li");
    li.style.cssText = "padding:8px;opacity:0.6;";
    li.textContent = partId ? t("layerPanel.zonesEmpty") : t("layerPanel.notSelected");
    listEl.appendChild(li);
    return;
  }

  const zones = data.config.zones;
  metaEl.textContent = `${zones.length}/255`;
  addBtn.disabled = zones.length >= 255;
  const activeId = sessionStore.getState().activeZoneId;
  if (zones.length === 0) {
    const li = document.createElement("li");
    li.style.cssText = "padding:8px;opacity:0.6;";
    li.textContent = t("layerPanel.zonesEmpty");
    listEl.appendChild(li);
    return;
  }
  for (const z of zones) {
    listEl.appendChild(renderZoneRow(ctx, partId, data, z, z.id === activeId));
  }
}

function renderZoneRow(
  ctx: ZoneListContext,
  partId: string,
  data: ZonesData,
  entry: ZoneEntry,
  isActive: boolean,
): HTMLLIElement {
  const li = document.createElement("li");
  li.style.cssText = "display:flex;flex-direction:column;gap:0;";
  const row = document.createElement("div");
  row.style.cssText =
    `display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;` +
    (isActive ? "background:rgba(var(--border-rgb),0.12);" : "");

  const [r, g, b] = entry.displayColor ?? zoneAutoColor(entry.id);
  const swatch = document.createElement("span");
  swatch.dataset.zoneSwatch = String(entry.id);
  swatch.style.cssText = `display:inline-block;width:14px;height:14px;border-radius:2px;background:rgb(${r},${g},${b});flex:0 0 auto;`;
  row.appendChild(swatch);

  const idLabel = document.createElement("span");
  idLabel.textContent = `#${entry.id}`;
  idLabel.style.cssText = "min-width:28px;font-family:monospace;opacity:0.7;";
  row.appendChild(idLabel);

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.value = entry.name ?? "";
  nameInput.placeholder = t("editorCanvas.zoneNamePlaceholder");
  nameInput.style.cssText = "flex:1;min-width:0;font-size:12px;";
  nameInput.addEventListener("click", (e) => e.stopPropagation());
  nameInput.addEventListener("input", () => {
    entry.name = nameInput.value;
    zonesStore.bump();
  });
  nameInput.addEventListener("blur", () => flushZonesForPart(ctx.skinRoot, partId, data));
  row.appendChild(nameInput);

  const advBtn = document.createElement("button");
  advBtn.className = "btn";
  advBtn.style.cssText = "padding:0 6px;flex:0 0 auto;font-size:11px;";
  const expanded = ctx.expandedZoneIds.has(entry.id);
  advBtn.textContent = expanded
    ? t("editorCanvas.accessoryAdvancedHide")
    : t("editorCanvas.accessoryAdvancedShow");
  advBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (ctx.expandedZoneIds.has(entry.id)) ctx.expandedZoneIds.delete(entry.id);
    else ctx.expandedZoneIds.add(entry.id);
    ctx.requestRender();
  });
  row.appendChild(advBtn);

  const delBtn = document.createElement("button");
  delBtn.className = "btn";
  delBtn.textContent = "×";
  delBtn.title = t("layerPanel.removeZone");
  delBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    ctx.expandedZoneIds.delete(entry.id);
    for (let i = 0; i < data.ids.length; i++) {
      if (data.ids[i] === entry.id) data.ids[i] = 0;
    }
    data.config.zones = data.config.zones.filter((z) => z.id !== entry.id);
    zonesStore.bump();
    flushZonesForPart(ctx.skinRoot, partId, data);
  });
  row.appendChild(delBtn);

  row.addEventListener("click", () => {
    if (isActive) return;
    sessionStore.setState({ activeZoneId: entry.id });
  });
  li.appendChild(row);

  if (expanded) {
    const detail = document.createElement("div");
    renderZoneDetails(ctx, partId, data, entry, detail);
    li.appendChild(detail);
  }
  return li;
}

function renderZoneDetails(
  ctx: ZoneListContext,
  partId: string,
  data: ZonesData,
  entry: ZoneEntry,
  container: HTMLElement,
): void {
  container.innerHTML = "";
  container.style.cssText =
    "display:flex;flex-direction:column;gap:4px;padding:4px 8px 6px 36px;font-size:11px;background:rgba(var(--border-rgb),0.05);";

  const flushBlur = (): void => flushZonesForPart(ctx.skinRoot, partId, data);

  function makeNumberInput(
    label: string,
    value: number,
    step: number,
    min: number,
    onChange: (v: number) => void,
  ): HTMLLabelElement {
    const lab = document.createElement("label");
    lab.style.cssText = "display:inline-flex;align-items:center;gap:4px;";
    const span = document.createElement("span");
    span.textContent = label;
    const inp = document.createElement("input");
    inp.type = "number";
    inp.step = String(step);
    inp.min = String(min);
    inp.value = String(value);
    inp.style.width = "56px";
    inp.addEventListener("input", () => {
      const parsed = Number.parseFloat(inp.value);
      if (Number.isFinite(parsed)) {
        onChange(Math.max(min, parsed));
        zonesStore.bump();
      }
    });
    inp.addEventListener("blur", flushBlur);
    lab.append(span, inp);
    return lab;
  }

  function makeColorInput(label: string, hex: string, onChange: (h: string) => void): HTMLLabelElement {
    const lab = document.createElement("label");
    lab.style.cssText = "display:inline-flex;align-items:center;gap:4px;";
    const span = document.createElement("span");
    span.textContent = label;
    const inp = document.createElement("input");
    inp.type = "color";
    inp.value = hex;
    inp.addEventListener("input", () => {
      onChange(inp.value);
      zonesStore.bump();
    });
    inp.addEventListener("change", flushBlur);
    lab.append(span, inp);
    return lab;
  }

  function makeCheckbox(label: string, checked: boolean, onChange: (b: boolean) => void): HTMLLabelElement {
    const lab = document.createElement("label");
    lab.style.cssText = "display:inline-flex;align-items:center;gap:4px;";
    const inp = document.createElement("input");
    inp.type = "checkbox";
    inp.checked = checked;
    inp.addEventListener("change", () => {
      onChange(inp.checked);
      zonesStore.bump();
      flushBlur();
    });
    const span = document.createElement("span");
    span.textContent = label;
    lab.append(inp, span);
    return lab;
  }

  function makeTextInput(label: string, value: string, ph: string, onChange: (v: string) => void): HTMLLabelElement {
    const lab = document.createElement("label");
    lab.style.cssText = "display:inline-flex;align-items:center;gap:4px;";
    const span = document.createElement("span");
    span.textContent = label;
    const inp = document.createElement("input");
    inp.type = "text";
    inp.value = value;
    inp.placeholder = ph;
    inp.style.width = "160px";
    inp.addEventListener("input", () => {
      onChange(inp.value);
      zonesStore.bump();
    });
    inp.addEventListener("blur", flushBlur);
    lab.append(span, inp);
    return lab;
  }

  function makeSelect(
    label: string,
    options: { value: string; text: string }[],
    current: string,
    onChange: (v: string) => void,
  ): HTMLLabelElement {
    const lab = document.createElement("label");
    lab.style.cssText = "display:inline-flex;align-items:center;gap:4px;";
    const span = document.createElement("span");
    span.textContent = label;
    const sel = document.createElement("select");
    for (const o of options) {
      const opt = document.createElement("option");
      opt.value = o.value;
      opt.textContent = o.text;
      if (o.value === current) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", () => {
      onChange(sel.value);
      zonesStore.bump();
      flushBlur();
    });
    lab.append(span, sel);
    return lab;
  }

  const colorRow = document.createElement("div");
  colorRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;";
  const dispHex = rgb255ToHex(entry.displayColor ?? zoneAutoColor(entry.id));
  colorRow.appendChild(
    makeColorInput(t("editorCanvas.zoneDisplayColor"), dispHex, (h) => {
      entry.displayColor = hexToRgb255(h);
    }),
  );
  container.appendChild(colorRow);

  const dashedDivider =
    "display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;border-top:1px dashed rgba(var(--border-rgb),0.15);padding-top:4px;";

  const lightRow = document.createElement("div");
  lightRow.style.cssText = dashedDivider;
  const lightOn = entry.light != null;
  lightRow.appendChild(
    makeCheckbox(t("editorCanvas.accessoryLight"), lightOn, (b) => {
      if (b) {
        entry.light = entry.light ?? {
          color: [255, 220, 120, 255],
          intensity: 1.0,
          outerRadius: 3.0,
          innerRadius: 0.5,
        };
      } else {
        delete entry.light;
      }
      ctx.requestRender();
    }),
  );
  if (lightOn && entry.light) {
    const li = entry.light;
    lightRow.appendChild(makeColorInput("", rgbaHex(li.color, "#ffeec0"), (h) => { li.color = hexToRgba255(h, 255); }));
    lightRow.appendChild(makeNumberInput(t("editorCanvas.accessoryLightIntensity"), li.intensity, 0.1, 0, (v) => { li.intensity = v; }));
    lightRow.appendChild(makeNumberInput(t("editorCanvas.accessoryLightOuter"), li.outerRadius, 0.1, 0, (v) => { li.outerRadius = v; }));
    lightRow.appendChild(makeNumberInput(t("editorCanvas.accessoryLightInner"), li.innerRadius, 0.1, 0, (v) => { li.innerRadius = v; }));
    const c2Hex = li.color2 ? rgbaHex(li.color2, "#ffeec0") : rgbaHex(li.color, "#ffeec0");
    lightRow.appendChild(makeColorInput(t("editorCanvas.zoneLightColor2"), c2Hex, (h) => { li.color2 = hexToRgba255(h, 255); }));
    lightRow.appendChild(
      makeSelect(
        t("editorCanvas.zoneLightMode"),
        [
          { value: "radial", text: t("editorCanvas.zoneLightModeRadial") },
          { value: "directional", text: t("editorCanvas.zoneLightModeDirectional") },
          { value: "scatter", text: t("editorCanvas.zoneLightModeScatter") },
        ],
        li.mode ?? "radial",
        (v) => {
          li.mode = v;
          ctx.requestRender();
        },
      ),
    );
    if ((li.mode ?? "radial") !== "radial") {
      lightRow.appendChild(makeNumberInput(t("editorCanvas.zoneLightDirection"), li.direction ?? 0, 5, -360, (v) => { li.direction = v; }));
      lightRow.appendChild(makeNumberInput(t("editorCanvas.zoneLightSpread"), li.spread ?? 60, 5, 0, (v) => { li.spread = v; }));
    }
    lightRow.appendChild(makeNumberInput(t("editorCanvas.zoneLightFalloff"), li.falloffPower ?? 2, 0.1, 0.1, (v) => { li.falloffPower = v; }));
    lightRow.appendChild(makeCheckbox(t("editorCanvas.zoneLightBreathing"), !!li.breathing, (b) => { li.breathing = b; ctx.requestRender(); }));
    if (li.breathing) {
      lightRow.appendChild(makeNumberInput(t("editorCanvas.zoneLightBreathSpeed"), li.breathSpeed ?? 1, 0.1, 0, (v) => { li.breathSpeed = v; }));
      lightRow.appendChild(makeNumberInput(t("editorCanvas.zoneLightBreathAmp"), li.breathAmplitude ?? 0.5, 0.05, 0, (v) => { li.breathAmplitude = v; }));
    }
  }
  container.appendChild(lightRow);

  const particleRow = document.createElement("div");
  particleRow.style.cssText = dashedDivider;
  const particleOn = entry.particle != null;
  particleRow.appendChild(
    makeCheckbox(t("editorCanvas.accessoryParticle"), particleOn, (b) => {
      if (b) {
        entry.particle = entry.particle ?? {
          rate: 5,
          lifetime: 1,
          startSize: 0.05,
          startColor: [255, 255, 255, 255],
          gravity: 0,
          shape: "circle",
          shapeRadius: 0.2,
        };
      } else {
        delete entry.particle;
      }
      ctx.requestRender();
    }),
  );
  if (particleOn && entry.particle) {
    const p = entry.particle;
    particleRow.appendChild(makeColorInput("", rgbaHex(p.startColor, "#ffffff"), (h) => { p.startColor = hexToRgba255(h, 255); }));
    const endHex = p.endColor ? rgbaHex(p.endColor, "#ffffff") : rgbaHex(p.startColor, "#ffffff");
    particleRow.appendChild(makeColorInput(t("editorCanvas.zoneParticleEndColor"), endHex, (h) => { p.endColor = hexToRgba255(h, 0); }));
    particleRow.appendChild(
      makeSelect(
        t("editorCanvas.zoneParticleMode"),
        [
          { value: "gravity", text: t("editorCanvas.zoneParticleModeGravity") },
          { value: "star", text: t("editorCanvas.zoneParticleModeStar") },
          { value: "fire", text: t("editorCanvas.zoneParticleModeFire") },
          { value: "water", text: t("editorCanvas.zoneParticleModeWater") },
          { value: "orbit", text: t("editorCanvas.zoneParticleModeOrbit") },
        ],
        p.mode ?? "gravity",
        (v) => {
          p.mode = v;
          if (v === "fire" && (p.direction ?? 0) === 0) p.direction = 90;
          if (v === "water" && (p.direction ?? 0) === 0) p.direction = 270;
          ctx.requestRender();
        },
      ),
    );
    particleRow.appendChild(makeNumberInput(t("editorCanvas.accessoryParticleRate"), p.rate, 1, 0, (v) => { p.rate = v; }));
    particleRow.appendChild(makeNumberInput(t("editorCanvas.accessoryParticleLifetime"), p.lifetime, 0.1, 0, (v) => { p.lifetime = v; }));
    particleRow.appendChild(makeNumberInput(t("editorCanvas.accessoryParticleSize"), p.startSize, 0.01, 0, (v) => { p.startSize = v; }));
    particleRow.appendChild(makeNumberInput(t("editorCanvas.zoneParticleSpeed"), p.speed ?? 0, 0.1, 0, (v) => { p.speed = v; }));
    particleRow.appendChild(makeNumberInput(t("editorCanvas.zoneParticleDirection"), p.direction ?? 0, 5, -360, (v) => { p.direction = v; }));
    particleRow.appendChild(makeNumberInput(t("editorCanvas.zoneParticleSpread"), p.spread ?? 360, 5, 0, (v) => { p.spread = v; }));
    particleRow.appendChild(makeNumberInput(t("editorCanvas.zoneParticleEndScale"), p.endSizeScale ?? 1, 0.1, 0.01, (v) => { p.endSizeScale = v; }));
    particleRow.appendChild(
      makeSelect(
        t("editorCanvas.zoneParticleFadeCurve"),
        [
          { value: "linear", text: t("editorCanvas.zoneParticleFadeLinear") },
          { value: "easeOut", text: t("editorCanvas.zoneParticleFadeEaseOut") },
          { value: "blink", text: t("editorCanvas.zoneParticleFadeBlink") },
          { value: "constant", text: t("editorCanvas.zoneParticleFadeConstant") },
        ],
        p.fadeCurve ?? "linear",
        (v) => { p.fadeCurve = v; },
      ),
    );
  }
  container.appendChild(particleRow);

  const animRow = document.createElement("div");
  animRow.style.cssText = dashedDivider;
  const animOn = entry.animation != null;
  animRow.appendChild(
    makeCheckbox(t("editorCanvas.accessoryAnimation"), animOn, (b) => {
      if (b) entry.animation = entry.animation ?? { frames: [], fps: 6, loop: true };
      else delete entry.animation;
      ctx.requestRender();
    }),
  );
  if (animOn && entry.animation) {
    const a = entry.animation;
    animRow.appendChild(
      makeTextInput(t("editorCanvas.accessoryAnimationFrames"), a.frames.join(","), "frame0,frame1,frame2", (v) => {
        a.frames = v.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      }),
    );
    animRow.appendChild(makeNumberInput(t("editorCanvas.accessoryAnimationFps"), a.fps, 1, 1, (v) => { a.fps = Math.max(1, Math.round(v)); }));
    animRow.appendChild(makeCheckbox(t("editorCanvas.accessoryAnimationLoop"), a.loop, (b) => { a.loop = b; }));
  }
  container.appendChild(animRow);
}
