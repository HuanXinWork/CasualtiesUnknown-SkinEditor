// 工具栏语言切换按钮（中/英双向即时切换）。

import { sessionStore } from "../stateStore";
import { currentLang, t } from "../i18n";
import { ICON_LANG } from "../toolPanel/toolIcons";

export function mountLangButton(container: HTMLElement): () => void {
  container.style.display = "inline-flex";
  container.innerHTML = `<button class="btn cp-tool-btn" data-role="lang-toggle" type="button"></button>`;

  const btn = container.querySelector<HTMLButtonElement>('[data-role="lang-toggle"]')!;

  function render(): void {
    const lang = currentLang();
    btn.innerHTML = ICON_LANG;
    btn.title = `${t("langSettings.title")} · ${lang === "zh" ? "中文" : "English"}`;
  }

  btn.addEventListener("click", () => {
    const next = currentLang() === "zh" ? "en" : "zh";
    sessionStore.setState({ lang: next });
  });

  const unsubscribe = sessionStore.subscribe(render);
  render();

  return () => {
    unsubscribe();
  };
}
