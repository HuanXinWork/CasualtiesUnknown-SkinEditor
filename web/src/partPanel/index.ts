// 部件列表与皮肤切换。

import { listSkins, listParts, type ApiError } from "../apiClient";
import { sessionStore } from "../stateStore";
import type { PartCategory, PartInfo, Skin } from "../stateStore/types";
import { subscribeLang, t } from "../i18n";
import { localizePartName } from "../i18n/partNames";

export function mountPartPanel(container: HTMLElement, skinRoot: string): () => void {
  // 启动 fetch 完成前 cachedSkinNames 为空，切换器与 parts 都为空。
  let cachedSkinNames: string[] = [];
  let cachedSkins: Skin[] = [];
  let lastSkinName = sessionStore.getState().currentSkinName;
  let lastSelectedPart = sessionStore.getState().selectedPartName;
  let lastSelectedCat = sessionStore.getState().selectedCategory;

  container.classList.add("panel");
  container.innerHTML =
    `<div class="part-panel-skins" style="display:flex;gap:4px;flex-wrap:wrap;padding:8px;"></div>` +
    `<section data-cat="Body" style="padding:0 8px 8px;"><h4 data-role="body-title" style="margin:8px 0 4px;"></h4><ul style="list-style:none;padding:0;margin:0;"></ul></section>` +
    `<section data-cat="Head" style="padding:0 8px 8px;"><h4 data-role="head-title" style="margin:8px 0 4px;"></h4><ul style="list-style:none;padding:0;margin:0;"></ul></section>` +
    `<section data-cat="Wings" style="padding:0 8px 8px;"><h4 data-role="wings-title" style="margin:8px 0 4px;"></h4><ul style="list-style:none;padding:0;margin:0;"></ul></section>` +
    `<section data-cat="Expression" style="padding:0 8px 8px;"><h4 data-role="expression-title" style="margin:8px 0 4px;"></h4><ul style="list-style:none;padding:0;margin:0;"></ul></section>`;

  const skinsEl = container.querySelector<HTMLDivElement>(".part-panel-skins")!;
  const bodyTitle = container.querySelector<HTMLHeadingElement>('[data-role="body-title"]')!;
  const headTitle = container.querySelector<HTMLHeadingElement>('[data-role="head-title"]')!;
  const wingsTitle = container.querySelector<HTMLHeadingElement>('[data-role="wings-title"]')!;
  const expressionTitle = container.querySelector<HTMLHeadingElement>('[data-role="expression-title"]')!;
  const bodyUl = container.querySelector<HTMLUListElement>('section[data-cat="Body"] ul')!;
  const headUl = container.querySelector<HTMLUListElement>('section[data-cat="Head"] ul')!;
  const wingsUl = container.querySelector<HTMLUListElement>('section[data-cat="Wings"] ul')!;
  const expressionUl = container.querySelector<HTMLUListElement>('section[data-cat="Expression"] ul')!;

  function applyTexts(): void {
    bodyTitle.textContent = t("partPanel.bodyGroup");
    headTitle.textContent = t("partPanel.headGroup");
    wingsTitle.textContent = t("partPanel.wingsGroup");
    expressionTitle.textContent = t("partPanel.expressionGroup");
  }
  applyTexts();

  function isSkinEmpty(name: string): boolean {
    const s = cachedSkins.find((x) => x.name === name);
    return !s || (s.body.length === 0 && s.head.length === 0 && (s.wings?.length ?? 0) === 0);
  }

  function renderSkins(): void {
    const currentName = sessionStore.getState().currentSkinName;
    skinsEl.innerHTML = "";
    for (const name of cachedSkinNames) {
      const btn = document.createElement("button");
      btn.textContent = name;
      btn.className = name === currentName ? "btn btn-primary" : "btn";
      if (isSkinEmpty(name)) btn.style.opacity = "0.5";
      btn.addEventListener("click", () => onSelectSkin(name));
      skinsEl.appendChild(btn);
    }
  }

  // 表情部件命名约定：Head 目录里所有以 Eye / Mouth 开头的部件视为"表情"。
  // 仅 UI 拆分显示，后端 PartCategory 仍是 Head，selectedCategory / API 调用不变。
  function isExpressionPart(name: string): boolean {
    return /^(Eye|Mouth|Nose)/i.test(name) ||
      // experimentEye*/experimentMouth* 这类带前缀命名也算
      /(Eye|Mouth|Nose)/i.test(name.replace(/^[a-z]+/, ""));
  }

  function renderParts(): void {
    const { currentSkinName, selectedPartName, selectedCategory } = sessionStore.getState();
    const skin = cachedSkins.find((s) => s.name === currentSkinName);
    const headParts = skin?.head ?? [];
    const expressionParts = headParts.filter((p) => isExpressionPart(p.name));
    const headOnlyParts = headParts.filter((p) => !isExpressionPart(p.name));
    renderCategoryList(bodyUl, skin?.body ?? [], "Body", selectedPartName, selectedCategory);
    renderCategoryList(headUl, headOnlyParts, "Head", selectedPartName, selectedCategory);
    renderCategoryList(wingsUl, skin?.wings ?? [], "Wings", selectedPartName, selectedCategory);
    // 表情部件 UI 分组的 cat 仍传 "Head"——后端 Body/Head/Wings 三分类，表情纳入 Head 字典。
    renderCategoryList(expressionUl, expressionParts, "Head", selectedPartName, selectedCategory);
  }

  function renderCategoryList(
    ul: HTMLUListElement,
    parts: PartInfo[],
    cat: PartCategory,
    selPart: string | null,
    selCat: PartCategory | null,
  ): void {
    ul.innerHTML = "";
    for (const p of parts) {
      const li = document.createElement("li");
      const isSel = selCat === cat && selPart === p.name;
      li.style.cssText = `padding:2px 6px;cursor:pointer;border-radius:4px;${isSel ? "background:rgba(0,0,0,0.08);" : ""}`;
      // p.name 是 PNG 文件名（无扩展），直接当作选中态/后端调用的稳定 ID；
      // UI 只把它替换为本地化短名，便于中文用户辨识。
      li.textContent = `${localizePartName(p.name)} ${p.width}×${p.height}`;
      if (p.corrupted) {
        const tag = document.createElement("span");
        tag.textContent = ` ${t("partPanel.corruptedTag")}`;
        tag.style.color = "#c00";
        li.appendChild(tag);
      }
      li.addEventListener("click", () => {
        sessionStore.setState({ selectedPartName: p.name, selectedCategory: cat });
      });
      ul.appendChild(li);
    }
  }

  function showError(msg: string): void {
    container.innerHTML = `<div style="padding:8px;color:#c00;">${t("partPanel.loadFailed")}：${msg}</div>`;
  }

  function onSelectSkin(skinName: string): void {
    sessionStore.setState({
      currentSkinName: skinName,
      selectedPartName: null,
      selectedCategory: null,
    });
    listParts(skinRoot, skinName)
      .then((skin) => {
        const idx = cachedSkins.findIndex((s) => s.name === skin.name);
        if (idx >= 0) cachedSkins[idx] = skin;
        else cachedSkins.push(skin);
        renderSkins();
        renderParts();
      })
      .catch((e: ApiError) => showError(e.message ?? String(e)));
  }

  const unsubscribe = sessionStore.subscribe((s) => {
    if (
      s.currentSkinName !== lastSkinName ||
      s.selectedPartName !== lastSelectedPart ||
      s.selectedCategory !== lastSelectedCat
    ) {
      lastSkinName = s.currentSkinName;
      lastSelectedPart = s.selectedPartName;
      lastSelectedCat = s.selectedCategory;
      renderSkins();
      renderParts();
    }
  });

  // 首次拉取皮肤名列表；data/skin 不存在或空目录由后端返回空数组。
  // 缺 activeSkin 时回落到字典序首项。
  listSkins(skinRoot)
    .then((names) => {
      cachedSkinNames = names;
      cachedSkins = names.map((name) => ({ name, body: [], head: [], wings: [] }));
      // 自动选中首个皮肤——无 currentSkinName 时直接触发 listParts 加载部件。
      if (sessionStore.getState().currentSkinName === null && names.length > 0) {
        onSelectSkin(names[0]);
      } else {
        renderSkins();
        renderParts();
      }
    })
    .catch((e: ApiError) => showError(e.message ?? String(e)));

  renderSkins();
  renderParts();

  // lang 切换：仅刷新分组标题与列表（损坏 tag 跟随 renderParts 重渲染）。
  const unsubLang = subscribeLang(() => {
    applyTexts();
    renderParts();
  });

  return () => {
    unsubscribe();
    unsubLang();
  };
}
