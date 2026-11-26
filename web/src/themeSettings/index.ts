// 主题切换弹出面板（浅色/深色预设与主色、背景色、表面色及透明网格配色实时调节）。

import { sessionStore } from "../stateStore";
import { applyTheme, darkTheme, defaultTheme, resolveCheckerColors } from "../stateStore/theme";
import { updateWorkspace } from "../stateStore/workspacePersist";
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
    `<label class="theme-popover-row"><span data-role="lbl-checker-light"></span>` +
    `<input type="color" data-field="checkerLight" /></label>` +
    `<label class="theme-popover-row"><span data-role="lbl-checker-dark"></span>` +
    `<input type="color" data-field="checkerDark" /></label>` +
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
  const lblCheckerLight = container.querySelector<HTMLSpanElement>('[data-role="lbl-checker-light"]')!;
  const lblCheckerDark = container.querySelector<HTMLSpanElement>('[data-role="lbl-checker-dark"]')!;
  const primaryInput = container.querySelector<HTMLInputElement>('[data-field="primary"]')!;
  const backgroundInput = container.querySelector<HTMLInputElement>('[data-field="background"]')!;
  const surfaceInput = container.querySelector<HTMLInputElement>('[data-field="surface"]')!;
  const checkerLightInput = container.querySelector<HTMLInputElement>('[data-field="checkerLight"]')!;
  const checkerDarkInput = container.querySelector<HTMLInputElement>('[data-field="checkerDark"]')!;

  function applyTexts(): void {
    toggleBtn.innerHTML = ICON_THEME;
    toggleBtn.title = t("themeSettings.title");
    lightBtn.textContent = t("themeSettings.light");
    darkBtn.textContent = t("themeSettings.dark");
    lblPrimary.textContent = t("themeSettings.primary");
    lblBackground.textContent = t("themeSettings.background");
    lblSurface.textContent = t("themeSettings.surface");
    lblCheckerLight.textContent = t("themeSettings.checkerLight");
    lblCheckerDark.textContent = t("themeSettings.checkerDark");
    closeBtn.textContent = t("common.close");
  }
  applyTexts();

  function syncPickers(theme: ThemeConfig): void {
    const checker = resolveCheckerColors(theme);
    primaryInput.value = theme.primary;
    backgroundInput.value = theme.background;
    surfaceInput.value = theme.surface;
    checkerLightInput.value = checker.light.toLowerCase();
    checkerDarkInput.value = checker.dark.toLowerCase();
  }

  function updateTheme(next: ThemeConfig): void {
    sessionStore.setState({ theme: next });
    applyTheme(next);
    updateWorkspace(workspacePath, (draft) => {
      draft.theme = { ...next };
    });
  }

  toggleBtn.addEventListener("click", () => {
    popover.hidden = !popover.hidden;
  });
  closeBtn.addEventListener("click", () => {
    popover.hidden = true;
  });

  function onDocumentClick(event: MouseEvent): void {
    if (popover.hidden) return;
    const target = event.target as Node;
    if (popover.contains(target) || toggleBtn.contains(target)) return;
    popover.hidden = true;
  }
  document.addEventListener("mousedown", onDocumentClick);

  lightBtn.addEventListener("click", () => updateTheme(defaultTheme()));
  darkBtn.addEventListener("click", () => updateTheme(darkTheme()));

  type ColorField = "primary" | "background" | "surface" | "checkerLight" | "checkerDark";
  function bindField(input: HTMLInputElement, field: ColorField): void {
    input.addEventListener("input", () => {
      const cur = sessionStore.getState().theme;
      updateTheme({ ...cur, [field]: input.value });
    });
  }
  bindField(primaryInput, "primary");
  bindField(backgroundInput, "background");
  bindField(surfaceInput, "surface");
  bindField(checkerLightInput, "checkerLight");
  bindField(checkerDarkInput, "checkerDark");

  const unsubscribe = sessionStore.subscribe((s) => syncPickers(s.theme));
  syncPickers(sessionStore.getState().theme);

  const unsubLang = subscribeLang(applyTexts);

  return () => {
    unsubscribe();
    unsubLang();
    document.removeEventListener("mousedown", onDocumentClick);
  };
}
