// 运行时宿主判定：区分 Tauri 桌面壳与纯浏览器 HTTP 模式。

export type RuntimeMode = "tauri" | "web";

export function getRuntimeMode(): RuntimeMode {
  if (typeof window === "undefined") return "web";
  const w = window as unknown as Record<string, unknown>;
  return w.__TAURI_INTERNALS__ !== undefined || w.__TAURI__ !== undefined
    ? "tauri"
    : "web";
}
