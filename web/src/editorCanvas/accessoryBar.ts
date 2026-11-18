// 编辑画布底部配件启用开关与高级偏移/旋转/层级/穿戴槽参数栏。

import {
  listParts,
  saveAccessoryConfig,
  setAccessoryEnabled,
} from "../apiClient";
import { bumpAccessoriesVersion, parsePartId, sessionStore } from "../stateStore";
import type { AccessoryEntry } from "../stateStore/types";
import { t } from "../i18n";
import { mountSlotDropdown } from "./slotDropdown";

export interface AccessoryBarElements {
  toggleWrap: HTMLLabelElement;
  toggleText: HTMLSpanElement;
  toggleTrack: HTMLSpanElement;
  toggleKnob: HTMLSpanElement;
  advBtn: HTMLButtonElement;
  advPanel: HTMLDivElement;
  offXInput: HTMLInputElement;
  offYInput: HTMLInputElement;
  rotInput: HTMLInputElement;
  zInput: HTMLInputElement;
  statusEl: HTMLSpanElement;
  offXLabel: HTMLSpanElement;
  offYLabel: HTMLSpanElement;
  rotLabel: HTMLSpanElement;
  zLabel: HTMLSpanElement;
  slotLabel: HTMLSpanElement;
  slotHost: HTMLSpanElement;
}

export interface AccessoryBarHandle {
  refresh(partId: string | null, partName: string | null): void;
  refreshLang(): void;
  destroy(): void;
}

export function mountAccessoryBar(els: AccessoryBarElements, skinRoot: string): AccessoryBarHandle {
  let currentPartId: string | null = null;
  let currentEntry: AccessoryEntry | null = null;
  let advancedOpen = false;
  let currentSlotValue = "";
  let querySeq = 0;
  let saveTimer: number | null = null;

  const slotDropdown = mountSlotDropdown(els.slotHost, "", (slot) => {
    currentSlotValue = slot;
    scheduleSave();
  });

  function hideAll(): void {
    els.toggleWrap.style.display = "none";
    els.advBtn.style.display = "none";
    els.advPanel.style.display = "none";
    currentEntry = null;
  }

  function applyToggleVisual(enabled: boolean): void {
    els.toggleText.textContent = enabled
      ? t("editorCanvas.accessoryEnabledLabel")
      : t("editorCanvas.accessoryDisabledLabel");
    els.toggleTrack.style.background = enabled ? "#2ea043" : "#999";
    els.toggleKnob.style.left = enabled ? "20px" : "2px";
  }

  function applyAdvancedVisible(): void {
    els.advPanel.style.display = advancedOpen && currentEntry ? "flex" : "none";
    els.advBtn.textContent = advancedOpen
      ? t("editorCanvas.accessoryAdvancedHide")
      : t("editorCanvas.accessoryAdvancedShow");
  }

  function fillAdvancedInputs(entry: AccessoryEntry): void {
    els.offXInput.value = String(entry.offX);
    els.offYInput.value = String(entry.offY);
    els.rotInput.value = String(entry.rot);
    els.zInput.value = String(entry.z);
    els.offXLabel.textContent = t("editorCanvas.accessoryOffsetX");
    els.offYLabel.textContent = t("editorCanvas.accessoryOffsetY");
    els.rotLabel.textContent = t("editorCanvas.accessoryRotation");
    els.zLabel.textContent = t("editorCanvas.accessoryZOrder");
    els.slotLabel.textContent = t("editorCanvas.accessoryRequireSlot");
    currentSlotValue = entry.requireWornSlot ?? "";
    slotDropdown.setValue(currentSlotValue);
  }

  function refresh(partId: string | null, partName: string | null): void {
    currentPartId = partId;
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    const { selectedCategory } = sessionStore.getState();
    const parsed = partId ? parsePartId(partId) : null;
    if (selectedCategory !== "Accessories" || !partName || !parsed) {
      hideAll();
      return;
    }
    const seq = ++querySeq;
    const stripped = partName.replace(/^R_/, "");
    listParts(skinRoot, parsed.skinName)
      .then((skin) => {
        if (seq !== querySeq || currentPartId !== partId) return;
        const cfg = skin.accessoryConfigs.find((c) => c.id === stripped || c.sprite === stripped);
        if (!cfg) {
          hideAll();
          return;
        }
        currentEntry = cfg;
        els.toggleWrap.style.display = "inline-flex";
        applyToggleVisual(cfg.enabled);
        els.advBtn.style.display = "";
        fillAdvancedInputs(cfg);
        applyAdvancedVisible();
      })
      .catch(() => {
        if (seq === querySeq) hideAll();
      });
  }

  els.toggleWrap.addEventListener("click", () => {
    if (!currentEntry || !currentPartId) return;
    const parsed = parsePartId(currentPartId);
    if (!parsed) return;
    const entry = currentEntry;
    const next = !entry.enabled;
    setAccessoryEnabled(skinRoot, parsed.skinName, entry.id, next)
      .then(() => {
        if (currentEntry?.id === entry.id) {
          currentEntry.enabled = next;
          applyToggleVisual(next);
        }
        bumpAccessoriesVersion();
      })
      .catch((e) => console.error("setAccessoryEnabled failed", e));
  });

  els.advBtn.addEventListener("click", () => {
    advancedOpen = !advancedOpen;
    applyAdvancedVisible();
  });

  function scheduleSave(): void {
    if (!currentEntry || !currentPartId) return;
    const parsed = parsePartId(currentPartId);
    if (!parsed) return;
    const skinName = parsed.skinName;
    const baseEntry = currentEntry;
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    els.statusEl.textContent = t("editorCanvas.accessoryAdvancedSaving");
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      const offX = Number.parseInt(els.offXInput.value, 10);
      const offY = Number.parseInt(els.offYInput.value, 10);
      const rot = Number.parseFloat(els.rotInput.value);
      const z = Number.parseInt(els.zInput.value, 10);
      const entry: AccessoryEntry = {
        ...baseEntry,
        offX: Number.isFinite(offX) ? offX : 0,
        offY: Number.isFinite(offY) ? offY : 0,
        rot: Number.isFinite(rot) ? rot : 0,
        z: Number.isFinite(z) ? z : 0,
        requireWornSlot: currentSlotValue === "" ? undefined : currentSlotValue,
      };
      saveAccessoryConfig(skinRoot, skinName, entry)
        .then(() => {
          if (currentEntry?.id === entry.id) {
            currentEntry = entry;
            els.statusEl.textContent = t("editorCanvas.accessoryAdvancedSaved");
          }
          bumpAccessoriesVersion();
        })
        .catch((e) => {
          els.statusEl.textContent = "";
          console.error("saveAccessoryConfig failed", e);
        });
    }, 200);
  }

  for (const el of [els.offXInput, els.offYInput, els.rotInput, els.zInput]) {
    el.addEventListener("change", scheduleSave);
    el.addEventListener("input", scheduleSave);
  }

  return {
    refresh,
    refreshLang(): void {
      if (currentEntry) {
        applyToggleVisual(currentEntry.enabled);
        fillAdvancedInputs(currentEntry);
        applyAdvancedVisible();
      } else {
        els.slotLabel.textContent = t("editorCanvas.accessoryRequireSlot");
        slotDropdown.setValue(currentSlotValue);
      }
    },
    destroy(): void {
      if (saveTimer !== null) {
        window.clearTimeout(saveTimer);
        saveTimer = null;
      }
      slotDropdown.destroy();
    },
  };
}
