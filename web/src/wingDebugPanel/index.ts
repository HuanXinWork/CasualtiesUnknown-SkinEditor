// 翼调试面板：4 部件（wingUL/wingUR/wingDL/wingDR）的位置 / 旋转 / zOrder 实时调
// 切皮肤时拉 wings.json 回填；改值即调 setAssemblyOverride（运行时覆盖 entry，预览实时刷新），
// 同时 debounce 写盘到 <skin>/wings.json，供 SkinSync mod 复用。

import { setAssemblyOverride, loadWingsConfig, saveWingsConfig, type WingsConfig } from "../apiClient";
import { sessionStore, bumpAssemblyOverrideVersion } from "../stateStore";
import { subscribeLang, t } from "../i18n";

interface WingState {
  x: number;
  y: number;
  rotation: number;
  zOrder: number;
}

const WING_NAMES = ["wingUL", "wingUR", "wingDL", "wingDR"] as const;
type WingName = typeof WING_NAMES[number];

// 默认值取自 huanxin 实测，作为单皮肤 wings.json 缺失时的 fallback
const DEFAULTS: Record<WingName, WingState> = {
  wingUL: { x: -2, y: -8, rotation: 314, zOrder: 5 },
  wingDL: { x: -1, y: -10, rotation: 0, zOrder: 4 },
  wingUR: { x: -2, y: -9, rotation: 318, zOrder: 5 },
  wingDR: { x: 0, y: -12, rotation: 0, zOrder: 4 },
};

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
  let states: Record<WingName, WingState> = {
    wingUL: { ...DEFAULTS.wingUL },
    wingUR: { ...DEFAULTS.wingUR },
    wingDL: { ...DEFAULTS.wingDL },
    wingDR: { ...DEFAULTS.wingDR },
  };
  let currentSkin: string | null = null;
  // 切皮肤时由 loadWingsConfig 决定状态：避免初始默认覆盖 wings.json。
  let suspendSave = true;

  const root = document.createElement("div");
  root.style.padding = "8px";
  root.style.fontSize = "12px";
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

  // 持久化到 <skin>/wings.json：300ms debounce 合并连续滑动。
  let saveTimer: number | null = null;
  function scheduleSave(): void {
    if (suspendSave || !currentSkin) return;
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      const skin = currentSkin;
      if (!skin) return;
      saveWingsConfig(skinRoot, skin, toWingsConfig(states))
        .catch((e) => console.warn("[wingDebug] saveWingsConfig failed", e));
    }, 300);
  }

  async function reloadForSkin(skinName: string | null): Promise<void> {
    suspendSave = true;
    currentSkin = skinName;
    if (!skinName) {
      // 没选皮肤时回归默认值，UI 仅展示但不写盘。
      states = {
        wingUL: { ...DEFAULTS.wingUL },
        wingUR: { ...DEFAULTS.wingUR },
        wingDL: { ...DEFAULTS.wingDL },
        wingDR: { ...DEFAULTS.wingDR },
      };
      render();
      return;
    }
    try {
      const cfg = await loadWingsConfig(skinRoot, skinName);
      states = fromWingsConfig(cfg);
    } catch (e) {
      console.warn("[wingDebug] loadWingsConfig failed", e);
      states = {
        wingUL: { ...DEFAULTS.wingUL },
        wingUR: { ...DEFAULTS.wingUR },
        wingDL: { ...DEFAULTS.wingDL },
        wingDR: { ...DEFAULTS.wingDR },
      };
    }
    render();
    pushOverrideAll();
    suspendSave = false;
  }

  function buildPart(name: WingName): HTMLElement {
    const sec = document.createElement("section");
    sec.style.borderTop = "1px solid var(--border-soft, #444)";
    sec.style.padding = "8px 0";
    const h = document.createElement("h4");
    h.textContent = `${t(`wingDebugPanel.${name}`)}（${name}）`;
    h.style.margin = "0 0 4px";
    h.style.fontSize = "13px";
    sec.appendChild(h);

    function row(label: string, min: number, max: number, step: number,
                 get: () => number, set: (v: number) => void): HTMLElement {
      const wrap = document.createElement("div");
      wrap.style.display = "flex";
      wrap.style.alignItems = "center";
      wrap.style.gap = "6px";
      wrap.style.marginTop = "2px";
      const lab = document.createElement("span");
      lab.textContent = label;
      lab.style.minWidth = "44px";
      const num = document.createElement("input");
      num.type = "number";
      num.value = get().toString();
      num.step = step.toString();
      num.style.width = "56px";
      const range = document.createElement("input");
      range.type = "range";
      range.min = min.toString();
      range.max = max.toString();
      range.step = step.toString();
      range.value = get().toString();
      range.style.flex = "1";
      function commit(v: number): void {
        set(v);
        num.value = v.toString();
        range.value = v.toString();
        pushOverrideOne(name);
        scheduleSave();
      }
      range.addEventListener("input", () => commit(Number(range.value)));
      num.addEventListener("change", () => commit(Number(num.value)));
      wrap.appendChild(lab);
      wrap.appendChild(num);
      wrap.appendChild(range);
      return wrap;
    }

    sec.appendChild(row(t("wingDebugPanel.x"), -50, 50, 1,
      () => states[name].x, (v) => states[name].x = v));
    sec.appendChild(row(t("wingDebugPanel.y"), -50, 50, 1,
      () => states[name].y, (v) => states[name].y = v));
    sec.appendChild(row(t("wingDebugPanel.rotation"), 0, 360, 1,
      () => states[name].rotation, (v) => states[name].rotation = v));
    sec.appendChild(row(t("wingDebugPanel.zOrder"), -200, 200, 1,
      () => states[name].zOrder, (v) => states[name].zOrder = v));
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
    help.style.margin = "0 0 8px";
    help.style.opacity = "0.7";
    help.style.fontSize = "11px";
    root.appendChild(help);

    const resetBtn = document.createElement("button");
    resetBtn.className = "btn";
    resetBtn.textContent = t("wingDebugPanel.reset");
    resetBtn.addEventListener("click", () => {
      states = {
        wingUL: { ...DEFAULTS.wingUL },
        wingUR: { ...DEFAULTS.wingUR },
        wingDL: { ...DEFAULTS.wingDL },
        wingDR: { ...DEFAULTS.wingDR },
      };
      render();
      pushOverrideAll();
      scheduleSave();
    });
    root.appendChild(resetBtn);

    for (const n of WING_NAMES) root.appendChild(buildPart(n));
  }

  render();

  // 初始 + 切皮肤时拉 wings.json 回填。
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
    container.innerHTML = "";
  };
}
