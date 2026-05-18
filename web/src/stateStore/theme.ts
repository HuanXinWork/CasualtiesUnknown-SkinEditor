// 把 ThemeConfig 字段写入 :root 上的 CSS 变量。
// 浅色：黑前景 / 白背景；深色：白前景 / 黑背景，primary 与 background 互换。

import type { ThemeConfig } from "./types";

export function defaultTheme(): ThemeConfig {
  return {
    primary: "#000000",
    background: "#FFFFFF",
    surface: "#F5F5F5",
    onPrimary: "#FFFFFF",
    onBackground: "#000000",
    borderOpacity: 0.16,
  };
}

export function darkTheme(): ThemeConfig {
  return {
    primary: "#FFFFFF",
    background: "#000000",
    surface: "#1A1A1A",
    onPrimary: "#000000",
    onBackground: "#FFFFFF",
    borderOpacity: 0.24,
  };
}

export function applyTheme(theme: ThemeConfig): void {
  const root = document.documentElement;
  root.style.setProperty("--primary", theme.primary);
  root.style.setProperty("--background", theme.background);
  root.style.setProperty("--surface", theme.surface);
  root.style.setProperty("--on-primary", theme.onPrimary);
  root.style.setProperty("--on-background", theme.onBackground);
  root.style.setProperty("--border-opacity", String(theme.borderOpacity));
  // 通知外部模块主题已应用，便于重算依赖 CSS 变量的派生色。
  window.dispatchEvent(new CustomEvent("themeApplied", { detail: theme }));
}
