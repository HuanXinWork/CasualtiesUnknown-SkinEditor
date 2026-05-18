// langSettings：toolPanel 工具栏中的语言切换按钮（zh / en）。
// 单按钮显示当前语言短标（"中" / "EN"），title 文案随语言变化。点击在两种语言间切换，
// 写到 sessionStore.lang；订阅同 store 反向同步外部变更。会话级、不持久化。

import { sessionStore } from "../stateStore";
import { currentLang, t } from "../i18n";
import { ICON_LANG } from "../toolPanel/toolIcons";

export function mountLangButton(container: HTMLElement): () => void {
  container.style.display = "inline-flex";
  container.innerHTML = `<button class="btn cp-tool-btn" data-role="lang-toggle" type="button"></button>`;

  const btn = container.querySelector<HTMLButtonElement>('[data-role="lang-toggle"]')!;

  function render(): void {
    const lang = currentLang();
    // 仅显示图标；当前语言通过 hover title 提示，避免与图标按钮视觉冲突。
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
