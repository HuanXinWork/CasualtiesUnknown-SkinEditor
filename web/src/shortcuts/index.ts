// 全局快捷键注册与按键派发；输入框聚焦或模态弹窗打开时自动屏蔽。

import { sessionStore } from "../stateStore";

export type ActionId =
  | "undo"
  | "redo"
  | "save"
  | "tool.brush"
  | "tool.eraser"
  | "tool.gradient"
  | "tool.pan"
  | "brush.larger"
  | "brush.smaller"
  | "panel.history"
  | "panel.settings";

export const ACTION_IDS: readonly ActionId[] = [
  "undo",
  "redo",
  "save",
  "tool.brush",
  "tool.eraser",
  "tool.gradient",
  "tool.pan",
  "brush.larger",
  "brush.smaller",
  "panel.history",
  "panel.settings",
] as const;

export const DEFAULT_SHORTCUTS: Readonly<Record<ActionId, string>> = Object.freeze({
  undo: "Ctrl+Z",
  redo: "Ctrl+Y",
  save: "Ctrl+S",
  "tool.brush": "B",
  "tool.eraser": "E",
  "tool.gradient": "G",
  "tool.pan": "H",
  "brush.larger": "]",
  "brush.smaller": "[",
  "panel.history": "Ctrl+H",
  "panel.settings": "Ctrl+,",
});

interface ActionContext {
  triggerHistoryPanel: () => void;
  triggerSettingsPanel: () => void;
}

const handlers: Partial<Record<ActionId, () => void>> = {};
let context: ActionContext | null = null;

export function registerAction(id: ActionId, handler: () => void): () => void {
  handlers[id] = handler;
  return () => {
    if (handlers[id] === handler) delete handlers[id];
  };
}

export function setShortcutContext(ctx: ActionContext): void {
  context = ctx;
}

export function getActionHandler(id: ActionId): (() => void) | undefined {
  if (id === "panel.history") return context?.triggerHistoryPanel;
  if (id === "panel.settings") return context?.triggerSettingsPanel;
  return handlers[id];
}

export function encodeKeyCombo(e: KeyboardEvent): string | null {
  if (e.key === "Control" || e.key === "Shift" || e.key === "Alt" || e.key === "Meta") {
    return null;
  }
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
  if (e.shiftKey) parts.push("Shift");
  if (e.altKey) parts.push("Alt");
  let key = e.key;
  if (key.length === 1 && key >= "a" && key <= "z") key = key.toUpperCase();
  parts.push(key);
  return parts.join("+");
}

export function currentBindings(): Record<ActionId, string> {
  const overrides = sessionStore.getState().shortcuts ?? {};
  return { ...DEFAULT_SHORTCUTS, ...overrides };
}

function shouldIgnoreEventTarget(target: EventTarget | null): boolean {
  if (document.querySelector('[data-modal-open="true"]')) return true;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

export function attachGlobalShortcuts(): () => void {
  function onKeyDown(e: KeyboardEvent): void {
    if (shouldIgnoreEventTarget(e.target)) return;
    const combo = encodeKeyCombo(e);
    if (!combo) return;
    const bindings = currentBindings();
    for (const id of ACTION_IDS) {
      if (bindings[id] === combo) {
        const handler = getActionHandler(id);
        if (handler) {
          e.preventDefault();
          handler();
        }
        return;
      }
    }
  }
  document.addEventListener("keydown", onKeyDown);
  return () => document.removeEventListener("keydown", onKeyDown);
}
