// 画笔/橡皮工具下按住 Alt 的临时吸色与滴管光标切换。
import { sessionStore } from "../stateStore";

export type Rgb = [number, number, number];

export function sampleCanvasRgb(
  ctx: CanvasRenderingContext2D | null,
  cx: number,
  cy: number,
  width: number,
  height: number,
): Rgb | null {
  if (!ctx) return null;
  if (cx < 0 || cy < 0 || cx >= width || cy >= height) return null;
  const d = ctx.getImageData(cx, cy, 1, 1).data;
  if (d[3] === 0) return null;
  return [d[0], d[1], d[2]];
}

export function attachAltCursor(target: HTMLElement): () => void {
  let on = false;
  function evaluate(alt: boolean): void {
    const tool = sessionStore.getState().activeTool;
    const next = alt && (tool === "brush" || tool === "eraser" || tool === "softBrush");
    if (next === on) return;
    on = next;
    target.classList.toggle("canvas-eyedrop", on);
  }
  function onKeyDown(e: KeyboardEvent): void {
    if (e.key === "Alt") evaluate(true);
  }
  function onKeyUp(e: KeyboardEvent): void {
    if (e.key === "Alt") evaluate(false);
  }
  function onBlur(): void {
    evaluate(false);
  }
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    target.classList.remove("canvas-eyedrop");
  };
}
