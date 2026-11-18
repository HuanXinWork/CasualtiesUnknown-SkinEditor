// 翅膀调试面板：实时调节 4 片翅膀的位置、旋转与层级，并持久化到 `<skin>/wings.json`。

import {
  loadWingsConfig,
  saveWingsConfig,
  setAssemblyOverride,
  type WingsConfig,
} from "../apiClient";
import { bumpAssemblyOverrideVersion, sessionStore } from "../stateStore";
import { subscribeLang, t } from "../i18n";

interface WingState {
  x: number;
  y: number;
  rotation: number;
  zOrder: number;
}

const WING_NAMES = ["wingUL", "wingUR", "wingDL", "wingDR"] as const;
type WingName = (typeof WING_NAMES)[number];

const DEFAULTS: Record<WingName, WingState> = {
  wingUL: { x: -2, y: -8, rotation: 314, zOrder: 5 },
  wingDL: { x: -1, y: -10, rotation: 0, zOrder: 4 },
  wingUR: { x: -2, y: -9, rotation: 318, zOrder: 5 },
  wingDR: { x: 0, y: -12, rotation: 0, zOrder: 4 },
};

function cloneDefaults(): Record<WingName, WingState> {
  return {
    wingUL: { ...DEFAULTS.wingUL },
    wingUR: { ...DEFAULTS.wingUR },
    wingDL: { ...DEFAULTS.wingDL },
    wingDR: { ...DEFAULTS.wingDR },
  };
}

function toWingsConfig(states: Record<WingName, WingState>): WingsConfig {
  return {
    wingUL: { ...states.wingUL },
    wingDL: { ...states.wingDL },
    wingUR: { ...states.wingUR },
    wingDR: { ...states.wingDR },
  };
}

function fromWingsConfig(cfg: WingsConfig): Record<WingName, WingState> {
  return {
    wingUL: { ...cfg.wingUL },
    wingDL: { ...cfg.wingDL },
    wingUR: { ...cfg.wingUR },
    wingDR: { ...cfg.wingDR },
  };
}

export function mountWingDebugPanel(container: HTMLElement, skinRoot: string): () => void {
  container.classList.add("panel");
  let states: Record<WingName, WingState> = cloneDefaults();
  let currentSkin: string | null = null;
  let suspendSave = true;
  let saveTimer: number | null = null;
  let loadSeq = 0;

  const root = document.createElement("div");
  root.style.cssText = "padding:8px;font-size:12px;overflow:auto;height:100%;box-sizing:border-box;";
  container.appendChild(root);

  function pushOverrideOne(name: WingName): void {
    setAssemblyOverride({
      partName: name,
      category: "Wings",
      position: { x: states[name].x, y: states[name].y },
      rotation: states[name].rotation,
      zOrder: states[name].zOrder,
    })
      .then(() => bumpAssemblyOverrideVersion())
      .catch((e) => console.warn("[wingDebug] setAssemblyOverride failed", e));
  }

  function pushOverrideAll(): void {
    Promise.all(
      WING_NAMES.map((name) =>
        setAssemblyOverride({
          partName: name,
          category: "Wings",
          position: { x: states[name].x, y: states[name].y },
          rotation: states[name].rotation,
          zOrder: states[name].zOrder,
        }),
      ),
    )
      .then(() => bumpAssemblyOverrideVersion())
      .catch((e) => console.warn("[wingDebug] setAssemblyOverride failed", e));
  }

  function flushPendingSave(): void {
    if (saveTimer === null) return;
    window.clearTimeout(saveTimer);
    saveTimer = null;
    if (!currentSkin) return;
    const skin = currentSkin;
    const snapshot = toWingsConfig(states);
    void saveWingsConfig(skinRoot, skin, snapshot).catch((e) =>
      console.warn("[wingDebug] flush saveWingsConfig failed", e),
    );
  }

  function scheduleSave(): void {
    if (suspendSave || !currentSkin) return;
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    const targetSkin = currentSkin;
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      if (currentSkin !== targetSkin) return;
      saveWingsConfig(skinRoot, targetSkin, toWingsConfig(states)).catch((e) =>
        console.warn("[wingDebug] saveWingsConfig failed", e),
      );
    }, 300);
  }

  async function reloadForSkin(skinName: string | null): Promise<void> {
    flushPendingSave();
    const seq = ++loadSeq;
    suspendSave = true;
    currentSkin = skinName;
    if (!skinName) {
      states = cloneDefaults();
      render();
      return;
    }
    try {
      const cfg = await loadWingsConfig(skinRoot, skinName);
      if (seq !== loadSeq) return;
      states = fromWingsConfig(cfg);
    } catch (e) {
      if (seq !== loadSeq) return;
      console.warn("[wingDebug] loadWingsConfig failed", e);
      states = cloneDefaults();
    }
    render();
    pushOverrideAll();
    suspendSave = false;
  }

  function buildPart(name: WingName): HTMLElement {
    const sec = document.createElement("section");
    sec.style.borderTop = "1px solid rgba(var(--border-rgb),0.15)";
    sec.style.padding = "8px 0";
    const h = document.createElement("h4");
    h.textContent = `${t(`wingDebugPanel.${name}`)} (${name})`;
    h.style.margin = "0 0 4px";
    h.style.fontSize = "13px";
    sec.appendChild(h);

    function row(
      label: string,
      min: number,
      max: number,
      step: number,
      integer: boolean,
      get: () => number,
      set: (v: number) => void,
    ): HTMLElement {
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;align-items:center;gap:6px;margin-top:2px;";
      const lab = document.createElement("span");
      lab.textContent = label;
      lab.style.minWidth = "44px";
      const num = document.createElement("input");
      num.type = "number";
      num.min = String(min);
      num.max = String(max);
      num.step = String(step);
      num.value = String(get());
      num.style.width = "56px";
      const range = document.createElement("input");
      range.type = "range";
      range.min = String(min);
      range.max = String(max);
      range.step = String(step);
      range.value = String(get());
      range.style.flex = "1";

      function commit(raw: number): void {
        if (!Number.isFinite(raw)) {
          num.value = String(get());
          return;
        }
        const clamped = Math.max(min, Math.min(max, integer ? Math.round(raw) : raw));
        set(clamped);
        num.value = String(clamped);
        range.value = String(clamped);
        pushOverrideOne(name);
        scheduleSave();
      }
      range.addEventListener("input", () => commit(Number(range.value)));
      num.addEventListener("change", () => commit(Number(num.value)));
      wrap.append(lab, num, range);
      return wrap;
    }

    sec.appendChild(row(t("wingDebugPanel.x"), -50, 50, 1, true, () => states[name].x, (v) => { states[name].x = v; }));
    sec.appendChild(row(t("wingDebugPanel.y"), -50, 50, 1, true, () => states[name].y, (v) => { states[name].y = v; }));
    sec.appendChild(row(t("wingDebugPanel.rotation"), 0, 360, 1, false, () => states[name].rotation, (v) => { states[name].rotation = v; }));
    sec.appendChild(row(t("wingDebugPanel.zOrder"), -200, 200, 1, true, () => states[name].zOrder, (v) => { states[name].zOrder = v; }));
    return sec;
  }

  function render(): void {
    root.innerHTML = "";
    const title = document.createElement("h3");
    title.textContent = t("wingDebugPanel.title");
    title.style.margin = "0 0 4px";
    title.style.fontSize = "14px";
    root.appendChild(title);

    const help = document.createElement("p");
    help.textContent = t("wingDebugPanel.hint");
    help.style.cssText = "margin:0 0 8px;opacity:0.7;font-size:11px;line-height:1.4;";
    root.appendChild(help);

    const resetBtn = document.createElement("button");
    resetBtn.className = "btn";
    resetBtn.textContent = t("wingDebugPanel.reset");
    resetBtn.addEventListener("click", () => {
      states = cloneDefaults();
      render();
      pushOverrideAll();
      scheduleSave();
    });
    root.appendChild(resetBtn);

    for (const n of WING_NAMES) root.appendChild(buildPart(n));
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
    flushPendingSave();
    unsubLang();
    unsubSession();
    container.innerHTML = "";
  };
}
