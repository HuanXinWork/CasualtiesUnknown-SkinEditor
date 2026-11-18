// 主题预设与 CSS 变量注入（自动根据背景亮度同步深浅色边框对比度与原生控件配色）。

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

function isDarkHex(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const n = Number.parseInt(m[1], 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum < 128;
}

export function applyTheme(theme: ThemeConfig): void {
  const root = document.documentElement;
  const dark = isDarkHex(theme.background);
  root.style.colorScheme = dark ? "dark" : "light";
  root.style.setProperty("--primary", theme.primary);
  root.style.setProperty("--background", theme.background);
  root.style.setProperty("--surface", theme.surface);
  root.style.setProperty("--on-primary", theme.onPrimary);
  root.style.setProperty("--on-background", theme.onBackground);
  root.style.setProperty("--border-opacity", String(theme.borderOpacity));
  root.style.setProperty("--border-rgb", dark ? "255, 255, 255" : "0, 0, 0");
  window.dispatchEvent(new CustomEvent("themeApplied", { detail: theme }));
}
