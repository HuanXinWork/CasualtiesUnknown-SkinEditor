// 血液粒子面板：编辑当前皮肤的 blood.json，切皮肤拉新值，改值 300ms debounce 写盘。

import { sessionStore } from "../stateStore";
import { subscribeLang, t } from "../i18n";
import { loadBloodConfig, saveBloodConfig } from "../apiClient";
import type { BloodConfig } from "../stateStore/types";

type SaveStatus = "idle" | "saving" | "saved" | "failed";

type Rgba = [number, number, number, number];

const DEFAULT_RGBA: Rgba = [200, 30, 30, 255];

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number): string => {
    const v = Math.max(0, Math.min(255, Math.round(n))).toString(16);
    return v.length === 1 ? `0${v}` : v;
  };
  return `#${h(r)}${h(g)}${h(b)}`;
}

function hexToRgb(hex: string): [number, number, number] {
  const s = hex.startsWith("#") ? hex.slice(1) : hex;
  const n = parseInt(s, 16);
  if (s.length !== 6 || Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

export function mountBloodPanel(container: HTMLElement, skinRoot: string): () => void {
  container.classList.add("panel");
  let config: BloodConfig = {};
  let currentSkin: string | null = null;
  // suspendSave：reload 回填时阻止 render 触发的"刚读回又立即写回"循环。
  let suspendSave = false;
  let saveStatus: SaveStatus = "idle";
  let saveTimer: number | null = null;
  let statusTimer: number | null = null;

  const root = document.createElement("div");
  root.style.cssText =
    "padding:8px 10px;display:flex;flex-direction:column;gap:6px;font-size:12px;overflow:auto;height:100%;box-sizing:border-box;";
  container.appendChild(root);

  function setStatus(next: SaveStatus): void {
    saveStatus = next;
    if (statusTimer !== null) {
      window.clearTimeout(statusTimer);
      statusTimer = null;
    }
    if (next === "saved" || next === "failed") {
      // saved/failed 是瞬态：1.5s 后回 idle 让"已保存"标签自然消退。
      statusTimer = window.setTimeout(() => {
        saveStatus = "idle";
        statusTimer = null;
        renderStatus();
      }, 1500);
    }
    renderStatus();
  }

  function statusEl(): HTMLElement | null {
    return root.querySelector<HTMLElement>("[data-role='blood-status']");
  }

  function renderStatus(): void {
    const el = statusEl();
    if (!el) return;
    if (currentSkin === null) {
      el.textContent = t("bloodPanel.notSelected");
      el.style.color = "var(--on-background, #888)";
      el.style.opacity = "0.7";
      return;
    }
    if (saveStatus === "saving") {
      el.textContent = t("bloodPanel.saving");
      el.style.color = "var(--on-background, #888)";
      el.style.opacity = "0.8";
    } else if (saveStatus === "saved") {
      el.textContent = t("bloodPanel.saved");
      el.style.color = "#3a8a3a";
      el.style.opacity = "1";
    } else if (saveStatus === "failed") {
      el.textContent = t("bloodPanel.saveFailed");
      el.style.color = "#c33";
      el.style.opacity = "1";
    } else {
      el.textContent = "";
      el.style.opacity = "0";
    }
  }

  function scheduleSave(): void {
    if (suspendSave) return;
    if (currentSkin === null) return;
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      const skin = currentSkin;
      if (!skin) return;
      setStatus("saving");
      saveBloodConfig(skinRoot, skin, config)
        .then(() => setStatus("saved"))
        .catch((e) => {
          console.warn("[bloodPanel] saveBloodConfig failed", e);
          setStatus("failed");
        });
    }, 300);
  }

  async function reloadForSkin(skinName: string | null): Promise<void> {
    suspendSave = true;
    currentSkin = skinName;
    if (skinName === null) {
      config = {};
      render();
      suspendSave = false;
      return;
    }
    try {
      config = await loadBloodConfig(skinRoot, skinName);
    } catch (e) {
      console.warn("[bloodPanel] loadBloodConfig failed", e);
      config = {};
    }
    render();
    suspendSave = false;
  }

  function render(): void {
    root.innerHTML = "";

    const title = document.createElement("h3");
    title.textContent = t("bloodPanel.title");
    title.style.cssText = "margin:0;font-size:14px;";
    root.appendChild(title);

    const hint = document.createElement("p");
    hint.textContent = t("bloodPanel.hint");
    hint.style.cssText = "margin:0;opacity:0.7;font-size:11px;line-height:1.4;";
    root.appendChild(hint);

    const status = document.createElement("div");
    status.dataset.role = "blood-status";
    status.style.cssText = "min-height:14px;font-size:11px;transition:opacity 0.2s;";
    root.appendChild(status);
    renderStatus();

    if (currentSkin === null) {
      // 没选皮肤时不渲染控件，避免误以为可改全局默认。
      return;
    }

    // 粒子起止色
    const secParticle = buildSection(t("bloodPanel.sectionParticle"));
    secParticle.appendChild(buildColorField(
      t("bloodPanel.particleStartColor"),
      () => config.particleStartColor ?? null,
      (v) => { config.particleStartColor = v; },
    ));
    secParticle.appendChild(buildColorField(
      t("bloodPanel.particleEndColor"),
      () => config.particleEndColor ?? null,
      (v) => { config.particleEndColor = v; },
    ));
    secParticle.appendChild(buildNumberField(
      t("bloodPanel.particleSize"),
      0.05, 5, 0.05, 0.5,
      () => config.particleSize ?? null,
      (v) => { config.particleSize = v; },
    ));
    secParticle.appendChild(buildNumberField(
      t("bloodPanel.particleLifetime"),
      0.05, 5, 0.05, 0.5,
      () => config.particleLifetime ?? null,
      (v) => { config.particleLifetime = v; },
    ));
    secParticle.appendChild(buildSelectField(
      t("bloodPanel.fadeCurve"),
      [
        ["linear", t("bloodPanel.fadeCurveLinear")],
        ["easeOut", t("bloodPanel.fadeCurveEaseOut")],
        ["blink", t("bloodPanel.fadeCurveBlink")],
        ["constant", t("bloodPanel.fadeCurveConstant")],
      ],
      "linear",
      () => config.fadeCurve ?? null,
      (v) => { config.fadeCurve = v; },
    ));
    root.appendChild(secParticle);

    // Limb shader 暗 / 亮血色
    const secShader = buildSection(t("bloodPanel.sectionLimbShader"));
    secShader.appendChild(buildColorField(
      t("bloodPanel.bloodDark"),
      () => config.bloodDark ?? null,
      (v) => { config.bloodDark = v; },
    ));
    secShader.appendChild(buildColorField(
      t("bloodPanel.bloodLight"),
      () => config.bloodLight ?? null,
      (v) => { config.bloodLight = v; },
    ));
    root.appendChild(secShader);

    // 光影 + 帧动画
    const secVisual = buildSection(t("bloodPanel.sectionVisual"));
    secVisual.appendChild(buildBooleanField(
      t("bloodPanel.glow"),
      () => config.glow ?? null,
      (v) => { config.glow = v; },
    ));
    secVisual.appendChild(buildNumberField(
      t("bloodPanel.glowIntensity"),
      0, 4, 0.1, 1.5,
      () => config.glowIntensity ?? null,
      (v) => { config.glowIntensity = v; },
    ));
    secVisual.appendChild(buildBooleanField(
      t("bloodPanel.animated"),
      () => config.animated ?? null,
      (v) => { config.animated = v; },
    ));
    secVisual.appendChild(buildNumberField(
      t("bloodPanel.animFrames"),
      1, 64, 1, 4,
      () => config.animFrames ?? null,
      (v) => { config.animFrames = v; },
      true,
    ));
    secVisual.appendChild(buildNumberField(
      t("bloodPanel.animFps"),
      1, 60, 1, 12,
      () => config.animFps ?? null,
      (v) => { config.animFps = v; },
      true,
    ));
    root.appendChild(secVisual);

    // 随机配色列表：非空时 mod 端走 ParticleSystemGradientMode.RandomColor。
    root.appendChild(buildRandomColorsSection());

    const resetBtn = document.createElement("button");
    resetBtn.className = "btn";
    resetBtn.textContent = t("bloodPanel.reset");
    resetBtn.style.cssText = "align-self:flex-start;font-size:11px;margin-top:4px;";
    resetBtn.addEventListener("click", () => {
      config = {};
      render();
      scheduleSave();
    });
    root.appendChild(resetBtn);
  }

  function buildSection(titleText: string): HTMLElement {
    const sec = document.createElement("section");
    sec.style.cssText =
      "border-top:1px solid var(--border-soft, rgba(0,0,0,0.12));padding:6px 0 4px;display:flex;flex-direction:column;gap:6px;";
    const h = document.createElement("h4");
    h.textContent = titleText;
    h.style.cssText = "margin:0;font-size:12px;opacity:0.85;";
    sec.appendChild(h);
    return sec;
  }

  // 颜色字段：override 三态 + color picker + alpha slider；未覆盖时控件 disabled。
  function buildColorField(
    labelText: string,
    getter: () => Rgba | null,
    setter: (v: Rgba | null) => void,
  ): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText =
      "display:grid;grid-template-columns:90px auto 1fr 64px;gap:6px;align-items:center;";

    const label = document.createElement("span");
    label.textContent = labelText;
    label.style.cssText = "font-size:11px;";
    row.appendChild(label);

    const cur = getter();
    const overridden = cur !== null && cur !== undefined;
    // 编辑控件初值：override on 用当前值；off 用默认色让用户一眼就能看到点开后是什么。
    const editing: Rgba = overridden ? [...cur] as Rgba : [...DEFAULT_RGBA];

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "btn";
    toggleBtn.textContent = overridden ? t("bloodPanel.overrideOn") : t("bloodPanel.overrideOff");
    toggleBtn.title = overridden ? t("bloodPanel.overrideOnHint") : t("bloodPanel.overrideOffHint");
    toggleBtn.style.cssText = "font-size:10px;padding:2px 6px;";
    if (overridden) toggleBtn.classList.add("btn-primary");
    toggleBtn.addEventListener("click", () => {
      if (getter() !== null && getter() !== undefined) {
        setter(null);
      } else {
        setter([...editing] as Rgba);
      }
      scheduleSave();
      render();
    });
    row.appendChild(toggleBtn);

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = rgbToHex(editing[0], editing[1], editing[2]);
    colorInput.disabled = !overridden;
    colorInput.style.cssText = "width:100%;height:24px;padding:0;cursor:pointer;";
    colorInput.addEventListener("input", () => {
      const [r, g, b] = hexToRgb(colorInput.value);
      editing[0] = r;
      editing[1] = g;
      editing[2] = b;
      if (overridden) {
        setter([editing[0], editing[1], editing[2], editing[3]]);
        scheduleSave();
      }
    });
    row.appendChild(colorInput);

    const alphaInput = document.createElement("input");
    alphaInput.type = "number";
    alphaInput.min = "0";
    alphaInput.max = "255";
    alphaInput.step = "1";
    alphaInput.value = String(editing[3]);
    alphaInput.disabled = !overridden;
    alphaInput.title = t("bloodPanel.alpha");
    alphaInput.style.cssText = "width:100%;font-size:11px;";
    alphaInput.addEventListener("input", () => {
      const v = parseInt(alphaInput.value, 10);
      if (!Number.isFinite(v)) return;
      editing[3] = Math.max(0, Math.min(255, v));
      if (overridden) {
        setter([editing[0], editing[1], editing[2], editing[3]]);
        scheduleSave();
      }
    });
    row.appendChild(alphaInput);

    return row;
  }

  // 数值字段：integer 控件用 step=1 + Math.round；其余按 step。
  function buildNumberField(
    labelText: string,
    min: number,
    max: number,
    step: number,
    defaultValue: number,
    getter: () => number | null,
    setter: (v: number | null) => void,
    integer = false,
  ): HTMLElement {
    const row = makeOverrideRow(labelText);
    const cur = getter();
    const overridden = cur !== null && cur !== undefined;
    let editing = overridden ? cur : defaultValue;

    bindToggle(row.toggle, overridden, () => {
      if (getter() !== null && getter() !== undefined) setter(null);
      else setter(integer ? Math.round(editing) : editing);
    });

    const input = document.createElement("input");
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(editing);
    input.disabled = !overridden;
    input.style.cssText = "grid-column:3 / span 2;width:100%;font-size:11px;";
    input.addEventListener("input", () => {
      const v = integer ? parseInt(input.value, 10) : parseFloat(input.value);
      if (!Number.isFinite(v)) return;
      editing = Math.max(min, Math.min(max, v));
      if (overridden) {
        setter(integer ? Math.round(editing) : editing);
        scheduleSave();
      }
    });
    row.el.appendChild(input);

    return row.el;
  }

  // 选择字段（如 fadeCurve）：第一项为默认值，override on 时写选中值。
  function buildSelectField(
    labelText: string,
    options: Array<[string, string]>,
    defaultValue: string,
    getter: () => string | null,
    setter: (v: string | null) => void,
  ): HTMLElement {
    const row = makeOverrideRow(labelText);
    const cur = getter();
    const overridden = cur !== null && cur !== undefined;
    let editing = overridden ? cur : defaultValue;

    bindToggle(row.toggle, overridden, () => {
      if (getter() !== null && getter() !== undefined) setter(null);
      else setter(editing);
    });

    const select = document.createElement("select");
    select.disabled = !overridden;
    select.style.cssText = "grid-column:3 / span 2;width:100%;font-size:11px;";
    for (const [val, label] of options) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      if (val === editing) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      editing = select.value;
      if (overridden) {
        setter(editing);
        scheduleSave();
      }
    });
    row.el.appendChild(select);

    return row.el;
  }

  // 布尔字段：override 启用后用 checkbox 选 true/false。
  function buildBooleanField(
    labelText: string,
    getter: () => boolean | null,
    setter: (v: boolean | null) => void,
  ): HTMLElement {
    const row = makeOverrideRow(labelText);
    const cur = getter();
    const overridden = cur !== null && cur !== undefined;
    let editing = overridden ? cur : false;

    bindToggle(row.toggle, overridden, () => {
      if (getter() !== null && getter() !== undefined) setter(null);
      else setter(editing);
    });

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = editing;
    cb.disabled = !overridden;
    cb.style.cssText = "grid-column:3 / span 2;justify-self:start;";
    cb.addEventListener("change", () => {
      editing = cb.checked;
      if (overridden) {
        setter(editing);
        scheduleSave();
      }
    });
    row.el.appendChild(cb);

    return row.el;
  }

  // 通用三列 grid 头：label + override 切换按钮 + 子控件占余下列；
  // 数值/选择/布尔字段共享，避免重复布局代码。
  function makeOverrideRow(labelText: string): { el: HTMLElement; toggle: HTMLButtonElement } {
    const el = document.createElement("div");
    el.style.cssText =
      "display:grid;grid-template-columns:90px auto 1fr 64px;gap:6px;align-items:center;";
    const label = document.createElement("span");
    label.textContent = labelText;
    label.style.cssText = "font-size:11px;";
    el.appendChild(label);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "btn";
    toggle.style.cssText = "font-size:10px;padding:2px 6px;";
    el.appendChild(toggle);

    return { el, toggle };
  }

  function bindToggle(btn: HTMLButtonElement, overridden: boolean, onClick: () => void): void {
    btn.textContent = overridden ? t("bloodPanel.overrideOn") : t("bloodPanel.overrideOff");
    btn.title = overridden ? t("bloodPanel.overrideOnHint") : t("bloodPanel.overrideOffHint");
    btn.classList.toggle("btn-primary", overridden);
    btn.addEventListener("click", () => {
      onClick();
      scheduleSave();
      render();
    });
  }

  // 随机配色列表：每行 1 个 RGBA + 删除按钮；尾部"添加颜色"按钮 push 一个深红到列表。
  // 整组用 override 三态：列表为 null/undefined 时显示"启用"按钮一键创建空数组。
  function buildRandomColorsSection(): HTMLElement {
    const sec = buildSection(t("bloodPanel.sectionRandomColors"));

    const hint = document.createElement("p");
    hint.textContent = t("bloodPanel.randomColorsHint");
    hint.style.cssText = "margin:0;opacity:0.7;font-size:10px;line-height:1.4;";
    sec.appendChild(hint);

    const list = config.randomColors;
    const overridden = Array.isArray(list);

    const headerRow = makeOverrideRow("");
    bindToggle(headerRow.toggle, overridden, () => {
      if (Array.isArray(config.randomColors)) config.randomColors = null;
      else config.randomColors = [];
    });
    sec.appendChild(headerRow.el);

    if (overridden && Array.isArray(config.randomColors)) {
      const arr = config.randomColors;
      arr.forEach((color, idx) => {
        sec.appendChild(buildRandomColorRow(idx, color));
      });

      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn";
      addBtn.textContent = t("bloodPanel.randomColorAdd");
      addBtn.style.cssText = "align-self:flex-start;font-size:11px;";
      addBtn.addEventListener("click", () => {
        if (!Array.isArray(config.randomColors)) config.randomColors = [];
        config.randomColors.push([200, 30, 30, 255]);
        scheduleSave();
        render();
      });
      sec.appendChild(addBtn);
    }

    return sec;
  }

  function buildRandomColorRow(idx: number, color: Rgba): HTMLElement {
    const row = document.createElement("div");
    row.style.cssText =
      "display:grid;grid-template-columns:24px auto 1fr 64px auto;gap:6px;align-items:center;";

    const idxLabel = document.createElement("span");
    idxLabel.textContent = `#${idx + 1}`;
    idxLabel.style.cssText = "font-size:11px;opacity:0.7;";
    row.appendChild(idxLabel);

    // 站位让网格左侧与其他 override 行视觉对齐：第 2 列空占位。
    const spacer = document.createElement("span");
    row.appendChild(spacer);

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = rgbToHex(color[0], color[1], color[2]);
    colorInput.style.cssText = "width:100%;height:24px;padding:0;cursor:pointer;";
    colorInput.addEventListener("input", () => {
      const [r, g, b] = hexToRgb(colorInput.value);
      const arr = config.randomColors;
      if (!Array.isArray(arr) || !arr[idx]) return;
      arr[idx] = [r, g, b, arr[idx][3]];
      scheduleSave();
    });
    row.appendChild(colorInput);

    const alphaInput = document.createElement("input");
    alphaInput.type = "number";
    alphaInput.min = "0";
    alphaInput.max = "255";
    alphaInput.step = "1";
    alphaInput.value = String(color[3]);
    alphaInput.title = t("bloodPanel.alpha");
    alphaInput.style.cssText = "width:100%;font-size:11px;";
    alphaInput.addEventListener("input", () => {
      const v = parseInt(alphaInput.value, 10);
      if (!Number.isFinite(v)) return;
      const arr = config.randomColors;
      if (!Array.isArray(arr) || !arr[idx]) return;
      arr[idx] = [arr[idx][0], arr[idx][1], arr[idx][2], Math.max(0, Math.min(255, v))];
      scheduleSave();
    });
    row.appendChild(alphaInput);

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn";
    removeBtn.textContent = t("bloodPanel.randomColorRemove");
    removeBtn.style.cssText = "font-size:10px;padding:2px 6px;";
    removeBtn.addEventListener("click", () => {
      const arr = config.randomColors;
      if (!Array.isArray(arr)) return;
      arr.splice(idx, 1);
      scheduleSave();
      render();
    });
    row.appendChild(removeBtn);

    return row;
  }

  render();

  void reloadForSkin(sessionStore.getState().currentSkinName);
  let lastSkin = sessionStore.getState().currentSkinName;
  const unsubSession = sessionStore.subscribe((s) => {
    if (s.currentSkinName !== lastSkin) {
      lastSkin = s.currentSkinName;
      void reloadForSkin(s.currentSkinName);
    }
  });

  const unsubLang = subscribeLang(() => render());

  return () => {
    unsubLang();
    unsubSession();
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    if (statusTimer !== null) window.clearTimeout(statusTimer);
    container.innerHTML = "";
  };
}
