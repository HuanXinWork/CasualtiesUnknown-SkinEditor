// toolPanel 工具栏中的主题切换入口。
// 暴露 primary / background / surface 三个 picker + 浅色/深色两组预设；
// onPrimary / onBackground / borderOpacity 沿用当前 theme，不让用户单独调。
//
// 持久化通道：每次主题字段变化 → sessionStore.setState + applyTheme +
// 拉 workspace 当前 layout 后 saveWorkspace 写回（避免覆盖 layout）。

import { getWorkspace, saveWorkspace, type ApiError } from "../apiClient";
import { sessionStore } from "../stateStore";
import { applyTheme, darkTheme, defaultTheme } from "../stateStore/theme";
import type { ThemeConfig } from "../stateStore/types";
import { subscribeLang, t } from "../i18n";
import { ICON_THEME } from "../toolPanel/toolIcons";

export function mountThemeButton(container: HTMLElement, workspacePath: string): () => void {
  container.style.position = "relative";
  container.innerHTML =
    `<button class="btn cp-tool-btn" data-role="theme-toggle"></button>` +
    `<div class="panel theme-popover" data-role="theme-popover" hidden>` +
    `<div class="theme-popover-row">` +
    `<button class="btn" data-preset="light"></button>` +
    `<button class="btn" data-preset="dark"></button>` +
    `</div>` +
    `<label class="theme-popover-row"><span data-role="lbl-primary"></span>` +
    `<input type="color" data-field="primary" /></label>` +
    `<label class="theme-popover-row"><span data-role="lbl-background"></span>` +
    `<input type="color" data-field="background" /></label>` +
    `<label class="theme-popover-row"><span data-role="lbl-surface"></span>` +
    `<input type="color" data-field="surface" /></label>` +
    `<div class="theme-popover-row" style="justify-content:flex-end;">` +
    `<button class="btn" data-role="theme-close"></button>` +
    `</div>` +
    `</div>`;

  const toggleBtn = container.querySelector<HTMLButtonElement>('[data-role="theme-toggle"]')!;
  const popover = container.querySelector<HTMLDivElement>('[data-role="theme-popover"]')!;
  const closeBtn = container.querySelector<HTMLButtonElement>('[data-role="theme-close"]')!;
  const lightBtn = container.querySelector<HTMLButtonElement>('[data-preset="light"]')!;
  const darkBtn = container.querySelector<HTMLButtonElement>('[data-preset="dark"]')!;
  const lblPrimary = container.querySelector<HTMLSpanElement>('[data-role="lbl-primary"]')!;
  const lblBackground = container.querySelector<HTMLSpanElement>('[data-role="lbl-background"]')!;
  const lblSurface = container.querySelector<HTMLSpanElement>('[data-role="lbl-surface"]')!;
  const primaryInput = container.querySelector<HTMLInputElement>('[data-field="primary"]')!;
  const backgroundInput = container.querySelector<HTMLInputElement>('[data-field="background"]')!;
  const surfaceInput = container.querySelector<HTMLInputElement>('[data-field="surface"]')!;

  function applyTexts(): void {
    // 主题按钮：图标 + 主题二字提示，保持视觉对齐工具栏其它图标按钮
    toggleBtn.innerHTML = ICON_THEME;
    toggleBtn.title = t("themeSettings.title");
    lightBtn.textContent = t("themeSettings.light");
    darkBtn.textContent = t("themeSettings.dark");
    lblPrimary.textContent = t("themeSettings.primary");
    lblBackground.textContent = t("themeSettings.background");
    lblSurface.textContent = t("themeSettings.surface");
    closeBtn.textContent = t("common.close");
  }
  applyTexts();

  function syncPickers(theme: ThemeConfig): void {
    primaryInput.value = theme.primary;
    backgroundInput.value = theme.background;
    surfaceInput.value = theme.surface;
  }

  function persist(theme: ThemeConfig): void {
    // 改色频率低，先 getWorkspace 拿当前 layout 再写回，避免覆盖面板状态。
    getWorkspace(workspacePath)
      .then((ws) => saveWorkspace(workspacePath, ws.layout, theme))
      .catch((e: ApiError) => {
        console.warn(`[themeSettings] saveWorkspace failed: ${e?.message ?? String(e)}`);
      });
  }

  function updateTheme(next: ThemeConfig): void {
    sessionStore.setState({ theme: next });
    applyTheme(next);
    persist(next);
  }

  toggleBtn.addEventListener("click", () => {
    popover.hidden = !popover.hidden;
  });
  closeBtn.addEventListener("click", () => {
    popover.hidden = true;
  });

  // 点击 popover / 触发按钮以外的区域时自动收起，避免占据视觉焦点。
  function onDocumentClick(event: MouseEvent): void {
    if (popover.hidden) return;
    const target = event.target as Node;
    if (popover.contains(target) || toggleBtn.contains(target)) return;
    popover.hidden = true;
  }
  document.addEventListener("mousedown", onDocumentClick);

  lightBtn.addEventListener("click", () => updateTheme(defaultTheme()));
  darkBtn.addEventListener("click", () => updateTheme(darkTheme()));

  function bindField(input: HTMLInputElement, field: "primary" | "background" | "surface"): void {
    input.addEventListener("input", () => {
      const cur = sessionStore.getState().theme;
      updateTheme({ ...cur, [field]: input.value });
    });
  }
  bindField(primaryInput, "primary");
  bindField(backgroundInput, "background");
  bindField(surfaceInput, "surface");

  const unsubscribe = sessionStore.subscribe((s) => syncPickers(s.theme));
  syncPickers(sessionStore.getState().theme);

  const unsubLang = subscribeLang(applyTexts);

  return () => {
    unsubscribe();
    unsubLang();
    document.removeEventListener("mousedown", onDocumentClick);
  };
}
