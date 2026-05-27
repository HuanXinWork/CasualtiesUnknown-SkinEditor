// 当前部件的图层列表与图层操作 UI。
// 订阅 sessionStore.currentPartId（由 editorCanvas 在 loadPartImage 后写入），
// 非空时调 apiClient.getLayers 拉取 LayersSnapshot；操作走 apiClient 的 7 个图层接口。
// 每次操作返回的新 snapshot 整体替换本地缓存并重渲染。
//
// UI 排布：layers[0] 为底，layers[N-1] 为顶；面板从上到下显示反向（顶层在最上方）。
// opacity 为 0 的图层在面板中保持可见、可选中。

import {
  addLayer,
  getLayers,
  removeLayer,
  reorderLayers,
  setActiveLayer,
  setLayerOpacity,
  setLayerVisibility,
  saveZones,
  type ApiError,
  type LayerMeta,
  type LayersSnapshot,
} from "../apiClient";
import { sessionStore } from "../stateStore";
import { zonesStore, nextFreeZoneId } from "../stateStore/zonesStore";
import type { PartCategory, ZoneEntry } from "../stateStore/types";
import { subscribeLang, t } from "../i18n";

export function mountLayerPanel(container: HTMLElement, skinRoot: string): () => void {
  let snapshot: LayersSnapshot | null = null;
  let lastPartId = sessionStore.getState().currentPartId;
  // pendingPartId：用于忽略过期的异步响应（用户快速切换部件时）。
  let pendingPartId: string | null = lastPartId;

  container.classList.add("panel");
  container.style.display = "flex";
  container.style.flexDirection = "column";
  container.innerHTML =
    `<div class="layer-panel-toolbar" style="display:flex;align-items:center;gap:4px;padding:8px;border-bottom:1px solid rgba(0,0,0,var(--border-opacity));">` +
    `<button class="btn" data-role="add">+</button>` +
    `<button class="btn" data-role="up">↑</button>` +
    `<button class="btn" data-role="down">↓</button>` +
    `<span class="mono" data-role="meta" style="margin-left:auto;opacity:0.7;"></span>` +
    `</div>` +
    `<div data-role="error" style="display:none;padding:6px 8px;color:#c00;border-bottom:1px solid rgba(0,0,0,var(--border-opacity));"></div>` +
    `<ul data-role="list" style="flex:1;min-height:0;overflow:auto;list-style:none;padding:0;margin:0;"></ul>`;

  const addBtn = container.querySelector<HTMLButtonElement>('[data-role="add"]')!;
  const upBtn = container.querySelector<HTMLButtonElement>('[data-role="up"]')!;
  const downBtn = container.querySelector<HTMLButtonElement>('[data-role="down"]')!;
  const metaEl = container.querySelector<HTMLSpanElement>('[data-role="meta"]')!;
  const errorEl = container.querySelector<HTMLDivElement>('[data-role="error"]')!;
  const listEl = container.querySelector<HTMLUListElement>('[data-role="list"]')!;

  function applyToolbarTexts(): void {
    addBtn.title = t("layerPanel.addLayer");
    upBtn.title = t("layerPanel.moveUp");
    downBtn.title = t("layerPanel.moveDown");
  }
  applyToolbarTexts();

  function clearError(): void {
    errorEl.style.display = "none";
    errorEl.textContent = "";
  }

  function showError(msg: string): void {
    errorEl.style.display = "block";
    errorEl.textContent = msg;
  }

  function applySnapshot(next: LayersSnapshot): void {
    snapshot = next;
    clearError();
    render();
    // 通知 editorCanvas 刷新 flatten 视图（删图层 / 切 active / 改 opacity 等）。
    const cur = sessionStore.getState().layerSnapshotVersion ?? 0;
    sessionStore.setState({ layerSnapshotVersion: cur + 1 });
  }

  // 把后端调用的失败统一收敛到面板内：保留旧 snapshot，顶部红字提示，console.warn 留痕。
  function handleApiError(prefix: string, e: ApiError): void {
    const msg = e?.message ?? String(e);
    console.warn(`[layerPanel] ${prefix} failed: ${msg}`);
    showError(`${prefix}：${msg}`);
  }

  function render(): void {
    if (sessionStore.getState().activeTool === "zoneBrush") {
      renderZonesMode();
      return;
    }
    listEl.innerHTML = "";
    const partId = sessionStore.getState().currentPartId;
    if (!partId || !snapshot) {
      metaEl.textContent = "";
      addBtn.disabled = true;
      upBtn.disabled = true;
      downBtn.disabled = true;
      const li = document.createElement("li");
      li.style.cssText = "padding:8px;opacity:0.6;";
      li.textContent = partId ? t("layerPanel.loading") : t("layerPanel.notSelected");
      listEl.appendChild(li);
      return;
    }
    addBtn.disabled = snapshot.layers.length >= 8;
    upBtn.disabled = snapshot.activeLayerIndex >= snapshot.layers.length - 1;
    downBtn.disabled = snapshot.activeLayerIndex <= 0;
    metaEl.textContent = `${snapshot.layers.length}/8`;
    addBtn.title = t("layerPanel.addLayer");
    addBtn.textContent = "+";
    upBtn.style.display = "";
    downBtn.style.display = "";
    // 顶层在前展示：倒序遍历 layers，但点击时仍传后端的真实索引（layers[i] 的 i）。
    for (let i = snapshot.layers.length - 1; i >= 0; i--) {
      listEl.appendChild(renderRow(partId, snapshot.layers[i], i, i === snapshot.activeLayerIndex));
    }
  }

  // 区块详情展开态（zoneId）；切部件不重置——同 ID 持续展开。
  const expandedZoneIds = new Set<number>();

  /// 不重建 DOM，仅刷新所有区块行的色块背景；用于颜色 picker 输入时的实时回显，
  /// 避免 render() 销毁节点导致颜色选择器弹层关闭。
  function refreshZoneSwatches(): void {
    const data = zonesStore.get().data;
    if (!data) return;
    for (const z of data.config.zones) {
      const el = listEl.querySelector<HTMLSpanElement>(`[data-zone-swatch="${z.id}"]`);
      if (!el) continue;
      const [r, g, b] = z.displayColor ?? zoneAutoColor(z.id);
      el.style.background = `rgb(${r},${g},${b})`;
    }
  }

  function renderZonesMode(): void {
    listEl.innerHTML = "";
    upBtn.style.display = "none";
    downBtn.style.display = "none";
    addBtn.title = t("layerPanel.addZone");
    addBtn.textContent = "+";
    const partId = sessionStore.getState().currentPartId;
    const data = zonesStore.get().data;
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
      listEl.appendChild(renderZoneRow(partId, z, z.id === activeId));
    }
  }

  function zoneAutoColor(id: number): [number, number, number] {
    const h = ((id * 47) % 360 + 360) % 360;
    const s = 0.85;
    const l = 0.55;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    let r1 = 0, g1 = 0, b1 = 0;
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

  function renderZoneRow(partId: string, entry: ZoneEntry, isActive: boolean): HTMLLIElement {
    const li = document.createElement("li");
    li.style.cssText = "display:flex;flex-direction:column;gap:0;";
    const row = document.createElement("div");
    row.style.cssText =
      `display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;` +
      (isActive ? "background:rgba(0,0,0,0.08);" : "");
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
    nameInput.addEventListener("blur", () => flushZonesNow(partId, zonesStore.get().data!));
    row.appendChild(nameInput);
    const advBtn = document.createElement("button");
    advBtn.className = "btn";
    advBtn.style.cssText = "padding:0 6px;flex:0 0 auto;font-size:11px;";
    const expanded = expandedZoneIds.has(entry.id);
    advBtn.textContent = expanded
      ? t("editorCanvas.accessoryAdvancedHide")
      : t("editorCanvas.accessoryAdvancedShow");
    advBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (expandedZoneIds.has(entry.id)) expandedZoneIds.delete(entry.id);
      else expandedZoneIds.add(entry.id);
      render();
    });
    row.appendChild(advBtn);
    const delBtn = document.createElement("button");
    delBtn.className = "btn";
    delBtn.textContent = "×";
    delBtn.title = t("layerPanel.removeZone");
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      expandedZoneIds.delete(entry.id);
      removeZone(partId, entry.id);
    });
    row.appendChild(delBtn);
    row.addEventListener("click", () => {
      if (isActive) return;
      sessionStore.setState({ activeZoneId: entry.id });
    });
    li.appendChild(row);
    if (expanded) {
      const detail = document.createElement("div");
      renderZoneDetails(partId, entry, detail);
      li.appendChild(detail);
    }
    return li;
  }

  function renderZoneDetails(partId: string, entry: ZoneEntry, container: HTMLElement): void {
    container.innerHTML = "";
    container.style.cssText = "display:flex;flex-direction:column;gap:4px;padding:4px 8px 6px 36px;font-size:11px;background:rgba(0,0,0,0.04);";

    const flushBlur = (): void => flushZonesNow(partId, zonesStore.get().data!);

    function makeNumberInput(label: string, value: number, step: number, min: number, onChange: (v: number) => void): HTMLLabelElement {
      const lab = document.createElement("label");
      lab.style.cssText = "display:inline-flex;align-items:center;gap:4px;";
      const span = document.createElement("span"); span.textContent = label;
      const inp = document.createElement("input");
      inp.type = "number"; inp.step = String(step); inp.min = String(min); inp.value = String(value);
      inp.style.width = "56px";
      inp.addEventListener("input", () => { onChange(Number.parseFloat(inp.value) || 0); zonesStore.bump(); });
      inp.addEventListener("blur", flushBlur);
      lab.appendChild(span); lab.appendChild(inp);
      return lab;
    }
    function makeColorInput(label: string, hex: string, onChange: (h: string) => void): HTMLLabelElement {
      const lab = document.createElement("label");
      lab.style.cssText = "display:inline-flex;align-items:center;gap:4px;";
      const span = document.createElement("span"); span.textContent = label;
      const inp = document.createElement("input");
      inp.type = "color"; inp.value = hex;
      inp.addEventListener("input", () => { onChange(inp.value); zonesStore.bump(); });
      inp.addEventListener("change", flushBlur);
      lab.appendChild(span); lab.appendChild(inp);
      return lab;
    }
    function makeCheckbox(label: string, checked: boolean, onChange: (b: boolean) => void): HTMLLabelElement {
      const lab = document.createElement("label");
      lab.style.cssText = "display:inline-flex;align-items:center;gap:4px;";
      const inp = document.createElement("input"); inp.type = "checkbox"; inp.checked = checked;
      inp.addEventListener("change", () => { onChange(inp.checked); zonesStore.bump(); flushBlur(); });
      const span = document.createElement("span"); span.textContent = label;
      lab.appendChild(inp); lab.appendChild(span);
      return lab;
    }
    function makeTextInput(label: string, value: string, ph: string, onChange: (v: string) => void): HTMLLabelElement {
      const lab = document.createElement("label");
      lab.style.cssText = "display:inline-flex;align-items:center;gap:4px;";
      const span = document.createElement("span"); span.textContent = label;
      const inp = document.createElement("input");
      inp.type = "text"; inp.value = value; inp.placeholder = ph;
      inp.style.width = "160px";
      inp.addEventListener("input", () => { onChange(inp.value); zonesStore.bump(); });
      inp.addEventListener("blur", flushBlur);
      lab.appendChild(span); lab.appendChild(inp);
      return lab;
    }
    function makeSelect(label: string, options: { value: string; text: string }[], current: string, onChange: (v: string) => void): HTMLLabelElement {
      const lab = document.createElement("label");
      lab.style.cssText = "display:inline-flex;align-items:center;gap:4px;";
      const span = document.createElement("span"); span.textContent = label;
      const sel = document.createElement("select");
      for (const o of options) {
        const opt = document.createElement("option");
        opt.value = o.value; opt.textContent = o.text;
        if (o.value === current) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.addEventListener("change", () => { onChange(sel.value); zonesStore.bump(); flushBlur(); });
      lab.appendChild(span); lab.appendChild(sel);
      return lab;
    }

    const colorRow = document.createElement("div");
    colorRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;";
    const dispHex = rgb255ToHex(entry.displayColor ?? zoneAutoColor(entry.id));
    colorRow.appendChild(makeColorInput(t("editorCanvas.zoneDisplayColor"), dispHex, (h) => {
      entry.displayColor = hexToRgb255(h);
    }));
    container.appendChild(colorRow);

    const lightRow = document.createElement("div");
    lightRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;border-top:1px dashed rgba(0,0,0,0.08);padding-top:4px;";
    const lightOn = entry.light != null;
    lightRow.appendChild(makeCheckbox(t("editorCanvas.accessoryLight"), lightOn, (b) => {
      if (b) entry.light = entry.light ?? { color: [255, 220, 120, 255], intensity: 1.0, outerRadius: 3.0, innerRadius: 0.5 };
      else delete entry.light;
      render();
    }));
    if (lightOn && entry.light) {
      const li = entry.light;
      lightRow.appendChild(makeColorInput("", rgbaHex(li.color, "#ffeec0"), (h) => { li.color = hexToRgba255(h, 255); }));
      lightRow.appendChild(makeNumberInput(t("editorCanvas.accessoryLightIntensity"), li.intensity, 0.1, 0, (v) => { li.intensity = v; }));
      lightRow.appendChild(makeNumberInput(t("editorCanvas.accessoryLightOuter"), li.outerRadius, 0.1, 0, (v) => { li.outerRadius = v; }));
      lightRow.appendChild(makeNumberInput(t("editorCanvas.accessoryLightInner"), li.innerRadius, 0.1, 0, (v) => { li.innerRadius = v; }));
      // 渐变末端色（缺省时与 color 等同）。
      const c2Hex = li.color2 ? rgbaHex(li.color2, "#ffeec0") : rgbaHex(li.color, "#ffeec0");
      lightRow.appendChild(makeColorInput(t("editorCanvas.zoneLightColor2"), c2Hex, (h) => { li.color2 = hexToRgba255(h, 255); }));
      lightRow.appendChild(makeSelect(t("editorCanvas.zoneLightMode"), [
        { value: "radial", text: t("editorCanvas.zoneLightModeRadial") },
        { value: "directional", text: t("editorCanvas.zoneLightModeDirectional") },
        { value: "scatter", text: t("editorCanvas.zoneLightModeScatter") },
      ], li.mode ?? "radial", (v) => { li.mode = v; }));
      const isDirectional = (li.mode ?? "radial") !== "radial";
      if (isDirectional) {
        lightRow.appendChild(makeNumberInput(t("editorCanvas.zoneLightDirection"), li.direction ?? 0, 5, -360, (v) => { li.direction = v; }));
        lightRow.appendChild(makeNumberInput(t("editorCanvas.zoneLightSpread"), li.spread ?? 60, 5, 0, (v) => { li.spread = v; }));
      }
      lightRow.appendChild(makeNumberInput(t("editorCanvas.zoneLightFalloff"), li.falloffPower ?? 2, 0.1, 0.1, (v) => { li.falloffPower = v; }));
      lightRow.appendChild(makeCheckbox(t("editorCanvas.zoneLightBreathing"), !!li.breathing, (b) => { li.breathing = b; render(); }));
      if (li.breathing) {
        lightRow.appendChild(makeNumberInput(t("editorCanvas.zoneLightBreathSpeed"), li.breathSpeed ?? 1, 0.1, 0, (v) => { li.breathSpeed = v; }));
        lightRow.appendChild(makeNumberInput(t("editorCanvas.zoneLightBreathAmp"), li.breathAmplitude ?? 0.5, 0.05, 0, (v) => { li.breathAmplitude = v; }));
      }
    }
    container.appendChild(lightRow);

    const particleRow = document.createElement("div");
    particleRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;border-top:1px dashed rgba(0,0,0,0.08);padding-top:4px;";
    const particleOn = entry.particle != null;
    particleRow.appendChild(makeCheckbox(t("editorCanvas.accessoryParticle"), particleOn, (b) => {
      if (b) entry.particle = entry.particle ?? { rate: 5, lifetime: 1, startSize: 0.05, startColor: [255, 255, 255, 255], gravity: 0, shape: "circle", shapeRadius: 0.2 };
      else delete entry.particle;
      render();
    }));
    if (particleOn && entry.particle) {
      const p = entry.particle;
      particleRow.appendChild(makeColorInput("", rgbaHex(p.startColor, "#ffffff"), (h) => { p.startColor = hexToRgba255(h, 255); }));
      const endHex = p.endColor ? rgbaHex(p.endColor, "#ffffff") : rgbaHex(p.startColor, "#ffffff");
      particleRow.appendChild(makeColorInput(t("editorCanvas.zoneParticleEndColor"), endHex, (h) => { p.endColor = hexToRgba255(h, 0); }));
      particleRow.appendChild(makeSelect(t("editorCanvas.zoneParticleMode"), [
        { value: "gravity", text: t("editorCanvas.zoneParticleModeGravity") },
        { value: "star", text: t("editorCanvas.zoneParticleModeStar") },
        { value: "fire", text: t("editorCanvas.zoneParticleModeFire") },
        { value: "water", text: t("editorCanvas.zoneParticleModeWater") },
        { value: "orbit", text: t("editorCanvas.zoneParticleModeOrbit") },
      ], p.mode ?? "gravity", (v) => {
        p.mode = v;
        // 切到典型预设方向：fire 向上、water 向下、其他保持原值。
        if (v === "fire" && (p.direction ?? 0) === 0) p.direction = 90;
        if (v === "water" && (p.direction ?? 0) === 0) p.direction = 270;
        render();
      }));
      particleRow.appendChild(makeNumberInput(t("editorCanvas.accessoryParticleRate"), p.rate, 1, 0, (v) => { p.rate = v; }));
      particleRow.appendChild(makeNumberInput(t("editorCanvas.accessoryParticleLifetime"), p.lifetime, 0.1, 0, (v) => { p.lifetime = v; }));
      particleRow.appendChild(makeNumberInput(t("editorCanvas.accessoryParticleSize"), p.startSize, 0.01, 0, (v) => { p.startSize = v; }));
      particleRow.appendChild(makeNumberInput(t("editorCanvas.zoneParticleSpeed"), p.speed ?? 0, 0.1, 0, (v) => { p.speed = v; }));
      particleRow.appendChild(makeNumberInput(t("editorCanvas.zoneParticleDirection"), p.direction ?? 0, 5, -360, (v) => { p.direction = v; }));
      particleRow.appendChild(makeNumberInput(t("editorCanvas.zoneParticleSpread"), p.spread ?? 360, 5, 0, (v) => { p.spread = v; }));
      particleRow.appendChild(makeNumberInput(t("editorCanvas.zoneParticleEndScale"), p.endSizeScale ?? 1, 0.1, 0.01, (v) => { p.endSizeScale = v; }));
      particleRow.appendChild(makeSelect(t("editorCanvas.zoneParticleFadeCurve"), [
        { value: "linear", text: t("editorCanvas.zoneParticleFadeLinear") },
        { value: "easeOut", text: t("editorCanvas.zoneParticleFadeEaseOut") },
        { value: "blink", text: t("editorCanvas.zoneParticleFadeBlink") },
        { value: "constant", text: t("editorCanvas.zoneParticleFadeConstant") },
      ], p.fadeCurve ?? "linear", (v) => { p.fadeCurve = v; }));
    }
    container.appendChild(particleRow);

    const animRow = document.createElement("div");
    animRow.style.cssText = "display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;border-top:1px dashed rgba(0,0,0,0.08);padding-top:4px;";
    const animOn = entry.animation != null;
    animRow.appendChild(makeCheckbox(t("editorCanvas.accessoryAnimation"), animOn, (b) => {
      if (b) entry.animation = entry.animation ?? { frames: [], fps: 6, loop: true };
      else delete entry.animation;
      render();
    }));
    if (animOn && entry.animation) {
      const a = entry.animation;
      animRow.appendChild(makeTextInput(t("editorCanvas.accessoryAnimationFrames"), a.frames.join(","), "frame0,frame1,frame2", (v) => {
        a.frames = v.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
      }));
      animRow.appendChild(makeNumberInput(t("editorCanvas.accessoryAnimationFps"), a.fps, 1, 1, (v) => { a.fps = Math.max(1, v); }));
      animRow.appendChild(makeCheckbox(t("editorCanvas.accessoryAnimationLoop"), a.loop, (b) => { a.loop = b; }));
    }
    container.appendChild(animRow);
  }

  function removeZone(partId: string, id: number): void {
    const data = zonesStore.get().data;
    if (!data) return;
    for (let i = 0; i < data.ids.length; i++) {
      if (data.ids[i] === id) data.ids[i] = 0;
    }
    data.config.zones = data.config.zones.filter((z) => z.id !== id);
    zonesStore.bump();
    flushZonesNow(partId, data);
  }

  function flushZonesNow(partId: string, data: NonNullable<ReturnType<typeof zonesStore.get>["data"]>): void {
    const parts = partId.split("::");
    if (parts.length !== 3) return;
    const [skinName, categoryDir, partName] = parts;
    saveZones(skinRoot, skinName, categoryDir as PartCategory, partName, data)
      .then(() => {
        // 通知 previewCanvas 重拉合成预览，让光 / 区块改动即时反映。
        sessionStore.setState({
          accessoriesVersion: (sessionStore.getState().accessoriesVersion ?? 0) + 1,
        });
      })
      .catch((e: ApiError) => console.warn(`[layerPanel] saveZones failed: ${e?.message ?? String(e)}`));
  }

  function createZone(partId: string): void {
    const data = zonesStore.get().data;
    if (!data) return;
    const newId = nextFreeZoneId(data.config.zones);
    if (newId === 0) return;
    data.config.zones.push({ id: newId });
    sessionStore.setState({ activeZoneId: newId, activeTool: "zoneBrush" });
    zonesStore.bump();
    flushZonesNow(partId, data);
  }

  function renderRow(partId: string, layer: LayerMeta, index: number, isActive: boolean): HTMLLIElement {
    const li = document.createElement("li");
    li.style.cssText =
      `display:flex;align-items:center;gap:6px;padding:4px 8px;cursor:pointer;` +
      (isActive ? "background:rgba(0,0,0,0.08);" : "");

    const visibleCb = document.createElement("input");
    visibleCb.type = "checkbox";
    visibleCb.checked = layer.visible;
    visibleCb.title = t("layerPanel.toggleVisible");
    visibleCb.addEventListener("click", (e) => e.stopPropagation());
    visibleCb.addEventListener("change", () => {
      setLayerVisibility(partId, layer.id, visibleCb.checked)
        .then(applySnapshot)
        .catch((err: ApiError) => handleApiError(t("layerPanel.errSetVisible"), err));
    });

    const nameEl = document.createElement("span");
    nameEl.textContent = layer.name;
    nameEl.style.cssText = "flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

    const opacityRange = document.createElement("input");
    opacityRange.type = "range";
    opacityRange.min = "0";
    opacityRange.max = "255";
    opacityRange.value = String(layer.opacity);
    opacityRange.style.width = "70px";
    // opacity 用百分比展示更直观。
    const pctText = `${Math.round((layer.opacity / 255) * 100)}%`;
    opacityRange.title = `${t("layerPanel.opacityHint")} ${pctText}`;

    const opacityLabel = document.createElement("span");
    opacityLabel.textContent = pctText;
    opacityLabel.style.cssText = "min-width:3.5ch;text-align:right;opacity:0.7;font-size:11px;";
    opacityLabel.title = opacityRange.title;

    opacityRange.addEventListener("click", (e) => e.stopPropagation());
    opacityRange.addEventListener("input", () => {
      const v = Number(opacityRange.value);
      // 即时更新展示，不等后端回包；后端 confirm 后 applySnapshot 重渲染会再覆盖一次。
      const pct = `${Math.round((v / 255) * 100)}%`;
      opacityLabel.textContent = pct;
      opacityRange.title = `${t("layerPanel.opacityHint")} ${pct}`;
      setLayerOpacity(partId, layer.id, v)
        .then(applySnapshot)
        .catch((err: ApiError) => handleApiError(t("layerPanel.errSetOpacity"), err));
    });

    const delBtn = document.createElement("button");
    delBtn.className = "btn";
    delBtn.textContent = "×";
    delBtn.title = t("layerPanel.removeLayer");
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      removeLayer(partId, layer.id)
        .then(applySnapshot)
        .catch((err: ApiError) => handleApiError(t("layerPanel.errRemoveLayer"), err));
    });

    li.addEventListener("click", () => {
      if (isActive) return;
      setActiveLayer(partId, index)
        .then(applySnapshot)
        .catch((err: ApiError) => handleApiError(t("layerPanel.errSetActive"), err));
    });

    li.appendChild(visibleCb);
    li.appendChild(nameEl);
    li.appendChild(opacityRange);
    li.appendChild(opacityLabel);
    li.appendChild(delBtn);
    return li;
  }

  function moveActive(delta: number): void {
    const partId = sessionStore.getState().currentPartId;
    if (!partId || !snapshot) return;
    const target = snapshot.activeLayerIndex + delta;
    if (target < 0 || target >= snapshot.layers.length) return;
    // 构造新 order：交换 active 与 target 位置的图层 id。
    const order = snapshot.layers.map((l) => l.id);
    [order[snapshot.activeLayerIndex], order[target]] = [order[target], order[snapshot.activeLayerIndex]];
    reorderLayers(partId, order)
      .then(applySnapshot)
      .catch((err: ApiError) => handleApiError(t("layerPanel.errReorder"), err));
  }

  addBtn.addEventListener("click", () => {
    const partId = sessionStore.getState().currentPartId;
    if (!partId) return;
    if (sessionStore.getState().activeTool === "zoneBrush") {
      createZone(partId);
      return;
    }
    addLayer(partId)
      .then(applySnapshot)
      .catch((err: ApiError) => handleApiError(t("layerPanel.errAddLayer"), err));
  });
  upBtn.addEventListener("click", () => moveActive(1));
  downBtn.addEventListener("click", () => moveActive(-1));

  function fetchSnapshot(partId: string): void {
    pendingPartId = partId;
    getLayers(partId)
      .then((next) => {
        if (pendingPartId !== partId) return;
        applySnapshot(next);
      })
      .catch((err: ApiError) => {
        if (pendingPartId !== partId) return;
        handleApiError(t("layerPanel.errLoad"), err);
        snapshot = null;
        render();
      });
  }

  function onSessionChange(): void {
    const state = sessionStore.getState();
    const partId = state.currentPartId;
    // 工具切换 / activeZoneId 改变都需要重渲染区块面板。
    if (state.activeTool === "zoneBrush") {
      render();
    }
    if (partId === lastPartId) return;
    lastPartId = partId;
    clearError();
    if (partId === null) {
      pendingPartId = null;
      snapshot = null;
      render();
      return;
    }
    snapshot = null;
    render();
    fetchSnapshot(partId);
  }

  const unsubscribe = sessionStore.subscribe(onSessionChange);
  // 区块面板内部签名：count 变化才重建整个列表；其余 bump（如颜色 picker 输入）
  // 只更新对应区块行的色块与画布 overlay，不重建 DOM —— 否则 input[type=color] 会因
  // 节点销毁而立即关闭弹层。
  let lastZonesSig = "";
  const unsubZones = zonesStore.subscribe(() => {
    if (sessionStore.getState().activeTool !== "zoneBrush") return;
    const data = zonesStore.get().data;
    const sig = data
      ? data.config.zones.map((z) => z.id).join(",")
      : "";
    if (sig !== lastZonesSig) {
      lastZonesSig = sig;
      render();
      return;
    }
    refreshZoneSwatches();
  });
  // 首次挂载若已有 currentPartId（不太可能，但保持幂等），立即拉取。
  if (lastPartId) fetchSnapshot(lastPartId);
  render();

  // lang 切换：刷新工具栏 title 并重渲染列表（图层 row title 等都在 render 内）。
  const unsubLang = subscribeLang(() => {
    applyToolbarTexts();
    render();
  });

  return () => {
    unsubscribe();
    unsubZones();
    unsubLang();
    pendingPartId = null;
  };
}
