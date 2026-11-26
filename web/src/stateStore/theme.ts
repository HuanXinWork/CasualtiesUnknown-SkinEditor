// 主题预设与 CSS 变量注入（自动根据背景亮度同步深浅色边框对比度、原生控件与棋盘格配色）。

import type { ThemeConfig } from "./types";

const LIGHT_CHECKER_LIGHT = "#FFFFFF";
const LIGHT_CHECKER_DARK = "#E5E5E5";
const DARK_CHECKER_LIGHT = "#2C2C32";
const DARK_CHECKER_DARK = "#1E1E22";
const HEX6_RE = /^#[0-9a-f]{6}$/i;

export function defaultTheme(): ThemeConfig {
  return {
    primary: "#000000",
    background: "#FFFFFF",
    surface: "#F5F5F5",
    onPrimary: "#FFFFFF",
    onBackground: "#000000",
    borderOpacity: 0.16,
    checkerLight: LIGHT_CHECKER_LIGHT,
    checkerDark: LIGHT_CHECKER_DARK,
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
    checkerLight: DARK_CHECKER_LIGHT,
    checkerDark: DARK_CHECKER_DARK,
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

function validHex(value?: string): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return HEX6_RE.test(trimmed) ? trimmed : null;
}

/** 解析透明背景棋盘格配色；旧配置缺少字段时按当前背景亮度回退，避免深色主题被浅色格子刺眼覆盖。 */
export function resolveCheckerColors(theme: ThemeConfig): { light: string; dark: string } {
  const dark = isDarkHex(theme.background);
  return {
    light: validHex(theme.checkerLight) ?? (dark ? DARK_CHECKER_LIGHT : LIGHT_CHECKER_LIGHT),
    dark: validHex(theme.checkerDark) ?? (dark ? DARK_CHECKER_DARK : LIGHT_CHECKER_DARK),
  };
}

export function applyTheme(theme: ThemeConfig): void {
  const root = document.documentElement;
  const dark = isDarkHex(theme.background);
  const checker = resolveCheckerColors(theme);
  root.style.colorScheme = dark ? "dark" : "light";
  root.style.setProperty("--primary", theme.primary);
  root.style.setProperty("--background", theme.background);
  root.style.setProperty("--surface", theme.surface);
  root.style.setProperty("--on-primary", theme.onPrimary);
  root.style.setProperty("--on-background", theme.onBackground);
  root.style.setProperty("--border-opacity", String(theme.borderOpacity));
  root.style.setProperty("--border-rgb", dark ? "255, 255, 255" : "0, 0, 0");
  root.style.setProperty("--checker-light", checker.light);
  root.style.setProperty("--checker-dark", checker.dark);
  window.dispatchEvent(new CustomEvent("themeApplied", { detail: theme }));
}
