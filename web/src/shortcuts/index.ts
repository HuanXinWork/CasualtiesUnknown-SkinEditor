// 集中管理快捷键。所有动作通过统一注册表执行，绑定保存在 sessionStore.shortcuts 中。
// 默认绑定参考主流绘画软件（SAI2 / Photoshop / Krita）的通用约定。

import { sessionStore } from "../stateStore";

/// 全部可绑定的动作 ID。新增时同步更新 DEFAULT_SHORTCUTS、actionHandlers、i18n.shortcuts.label。
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

/// 默认快捷键绑定。键格式：可选 Ctrl+/Shift+/Alt+ 修饰符 + 单键名。
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

/// 注册某个动作的执行器；约定单 handler，重复注册覆盖旧值。
export function registerAction(id: ActionId, handler: () => void): () => void {
  handlers[id] = handler;
  return () => {
    if (handlers[id] === handler) delete handlers[id];
  };
}

/// 提供 popover 控制方法；toolPanel 内两个 popover 在 mount 后注入。
export function setShortcutContext(ctx: ActionContext): void {
  context = ctx;
}

export function getActionHandler(id: ActionId): (() => void) | undefined {
  if (id === "panel.history") return context?.triggerHistoryPanel;
  if (id === "panel.settings") return context?.triggerSettingsPanel;
  return handlers[id];
}

/// 把 KeyboardEvent 编码为标准化字符串，与 DEFAULT_SHORTCUTS 中的格式一致。
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

/// 当前生效的绑定表：用户自定义合并默认绑定。
export function currentBindings(): Record<ActionId, string> {
  const overrides = sessionStore.getState().shortcuts ?? {};
  return { ...DEFAULT_SHORTCUTS, ...overrides };
}

/// 输入控件中击键不触发快捷键，避免文本输入被吞。
function shouldIgnoreEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  return false;
}

/// 启动全局 keydown 监听，返回卸载函数。
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
