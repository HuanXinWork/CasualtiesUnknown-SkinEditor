// 配件依赖装备槽下拉选择器（深浅色主题自适应对比度 + 视口边界防溢出）。
import { t } from "../i18n";
import { localizeWearSlot, WEAR_SLOT_IDS } from "../i18n/wearSlots";

export interface SlotDropdownHandle {
  setValue(slot: string): void;
  destroy(): void;
}

export function mountSlotDropdown(
  host: HTMLElement,
  initial: string,
  onChange: (slot: string) => void,
): SlotDropdownHandle {
  let value = initial ?? "";

  const trigger = document.createElement("button");
  trigger.type = "button";
  trigger.className = "btn slot-dd-trigger";
  trigger.style.cssText =
    "min-width:120px;display:inline-flex;align-items:center;justify-content:space-between;gap:6px;padding:2px 8px;";
  host.appendChild(trigger);

  const menu = document.createElement("div");
  menu.className = "panel slot-dd-menu";
  menu.hidden = true;
  menu.style.cssText =
    "position:fixed;z-index:1300;min-width:140px;max-height:260px;overflow:auto;" +
    "padding:4px 0;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.25);";
  document.body.appendChild(menu);

  function labelOf(slot: string): string {
    return slot === "" ? t("editorCanvas.accessorySlotNone") : localizeWearSlot(slot);
  }

  function refreshTrigger(): void {
    trigger.textContent = "";
    const text = document.createElement("span");
    text.textContent = labelOf(value);
    const arrow = document.createElement("span");
    arrow.textContent = "▾";
    arrow.style.opacity = "0.6";
    trigger.append(text, arrow);
  }

  function renderMenu(): void {
    menu.innerHTML = "";
    const ids = ["", ...WEAR_SLOT_IDS];
    for (const id of ids) {
      const item = document.createElement("div");
      item.className = "slot-dd-item";
      item.textContent = labelOf(id);
      item.style.cssText =
        "padding:6px 12px;cursor:pointer;" +
        (id === value ? "background:rgba(var(--border-rgb),0.14);font-weight:600;" : "");
      item.addEventListener("mouseenter", () => {
        item.style.background = "rgba(var(--border-rgb),0.2)";
      });
      item.addEventListener("mouseleave", () => {
        item.style.background = id === value ? "rgba(var(--border-rgb),0.14)" : "";
      });
      item.addEventListener("click", () => {
        if (id !== value) {
          value = id;
          refreshTrigger();
          onChange(value);
        }
        close();
      });
      menu.appendChild(item);
    }
  }

  function position(): void {
    const rect = trigger.getBoundingClientRect();
    menu.style.minWidth = `${rect.width}px`;
    const menuW = Math.max(rect.width, 140);
    const left = Math.max(8, Math.min(window.innerWidth - menuW - 8, rect.left));
    menu.style.left = `${left}px`;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    if (spaceBelow < 180 && rect.top > spaceBelow) {
      menu.style.bottom = `${window.innerHeight - rect.top + 2}px`;
      menu.style.top = "auto";
    } else {
      menu.style.top = `${rect.bottom + 2}px`;
      menu.style.bottom = "auto";
    }
  }

  function open(): void {
    renderMenu();
    menu.hidden = false;
    position();
  }
  function close(): void {
    menu.hidden = true;
  }

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) open();
    else close();
  });

  function onDocClick(e: MouseEvent): void {
    if (menu.hidden) return;
    const target = e.target as Node;
    if (menu.contains(target) || trigger.contains(target)) return;
    close();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }
  document.addEventListener("mousedown", onDocClick);
  document.addEventListener("keydown", onKey);

  refreshTrigger();

  return {
    setValue(slot: string): void {
      value = slot ?? "";
      refreshTrigger();
      if (!menu.hidden) renderMenu();
    },
    destroy(): void {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
      menu.remove();
      trigger.remove();
    },
  };
}
