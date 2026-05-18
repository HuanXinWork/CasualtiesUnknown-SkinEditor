// 运行时形态判定：通过 Tauri 注入到 window 的内部对象判断当前是桌面壳还是浏览器。
// 后续 detach、文件 IO 适配等平台差异化逻辑都通过此标志分发。

export type RuntimeMode = "tauri" | "web";

export function getRuntimeMode(): RuntimeMode {
  if (typeof window === "undefined") return "web";
  // Tauri v2 在 window 上挂 __TAURI_INTERNALS__；v1 时代是 __TAURI__。
  const w = window as unknown as Record<string, unknown>;
  return w.__TAURI_INTERNALS__ !== undefined || w.__TAURI__ !== undefined
    ? "tauri"
    : "web";
}
