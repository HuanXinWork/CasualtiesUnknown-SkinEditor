// 部件列表与皮肤切换；分组（身体 / 头部 / 翅膀 / 表情 / 配件）支持折叠。

import { listSkins, listParts, type ApiError } from "../apiClient";
import { getWorkspace, saveWorkspace } from "../apiClient";
import { sessionStore } from "../stateStore";
import type { PartCategory, PartInfo, Skin } from "../stateStore/types";
import { subscribeLang, t } from "../i18n";
import { localizePartName } from "../i18n/partNames";
import { categorySupportsCreate, categoryFullyCreated } from "../editorCanvas/partCatalog";
import { openAddPartDialog } from "../editorCanvas/addPartDialog";
import { requestSwitchPart } from "./partSwitchGuard";
import { showContextMenu } from "../contextMenu";
import { openCopyPartDialog, deletePartWithConfirm } from "./partClipboard";

interface GroupSpec {
  key: string;
  cat: PartCategory;
  titleKey: string;
}

const GROUPS: GroupSpec[] = [
  { key: "body", cat: "Body", titleKey: "partPanel.bodyGroup" },
  { key: "head", cat: "Head", titleKey: "partPanel.headGroup" },
  { key: "expression", cat: "Head", titleKey: "partPanel.expressionGroup" },
  { key: "wings", cat: "Wings", titleKey: "partPanel.wingsGroup" },
  { key: "accessories", cat: "Accessories", titleKey: "partPanel.accessoriesGroup" },
  { key: "blood", cat: "Blood", titleKey: "partPanel.bloodGroup" },
];

// 分组折叠态保留在本模块作用域：lang 切换 / 选 part / 切皮肤都不重置。
const collapsed: Record<string, boolean> = {
  body: false,
  head: false,
  expression: true,
  wings: true,
  accessories: true,
  blood: true,
};

export function mountPartPanel(container: HTMLElement, skinRoot: string): () => void {
  let cachedSkinNames: string[] = [];
  let cachedSkins: Skin[] = [];
  let lastSkinName = sessionStore.getState().currentSkinName;
  let lastSelectedPart = sessionStore.getState().selectedPartName;
  let lastSelectedCat = sessionStore.getState().selectedCategory;

  container.classList.add("panel");
  container.innerHTML =
    `<div class="part-panel-skins" style="display:flex;gap:4px;flex-wrap:wrap;padding:8px;"></div>` +
    GROUPS.map((g) =>
      `<section data-group="${g.key}" style="padding:0 8px 8px;">` +
        `<h4 data-role="title" style="margin:8px 0 4px;cursor:pointer;user-select:none;display:flex;align-items:center;gap:4px;">` +
          `<span data-role="caret" style="display:inline-block;width:10px;text-align:center;">▶</span>` +
          `<span data-role="text"></span>` +
        `</h4>` +
        `<ul style="list-style:none;padding:0;margin:0;"></ul>` +
      `</section>`,
    ).join("");

  const skinsEl = container.querySelector<HTMLDivElement>(".part-panel-skins")!;
  const sections = new Map<string, { ul: HTMLUListElement; titleText: HTMLSpanElement; caret: HTMLSpanElement }>();
  for (const g of GROUPS) {
    const sec = container.querySelector<HTMLElement>(`section[data-group="${g.key}"]`)!;
    const ul = sec.querySelector<HTMLUListElement>("ul")!;
    const titleText = sec.querySelector<HTMLSpanElement>('[data-role="text"]')!;
    const caret = sec.querySelector<HTMLSpanElement>('[data-role="caret"]')!;
    const title = sec.querySelector<HTMLHeadingElement>('[data-role="title"]')!;
    title.addEventListener("click", () => {
      collapsed[g.key] = !collapsed[g.key];
      applyCollapse(g.key);
      schedulePersistCollapsed();
    });
    sections.set(g.key, { ul, titleText, caret });
  }

  // 启动时从 workspace 加载；与 main.ts 的 DEFAULT_WORKSPACE_PATH 保持一致。
  const WORKSPACE_PATH = "data/workspace.json";
  void getWorkspace(WORKSPACE_PATH).then((ws) => {
    const stored = ws.layout.settings?.partGroupsCollapsed;
    if (stored && typeof stored === "object") {
      for (const g of GROUPS) {
        if (typeof stored[g.key] === "boolean") collapsed[g.key] = stored[g.key];
      }
      for (const g of GROUPS) applyCollapse(g.key);
    }
  }).catch((e) => console.warn("[partPanel] load partGroupsCollapsed failed", e));

  // 折叠状态变化 300ms debounce 写盘。
  let saveTimer: number | null = null;
  function schedulePersistCollapsed(): void {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void getWorkspace(WORKSPACE_PATH).then((ws) => {
        const settings = ws.layout.settings ?? {
          showMotionDebugPanel: true,
          showWingDebugPanel: false,
          showBloodPanel: false,
        };
        const next = {
          ...ws.layout,
          settings: {
            ...settings,
            partGroupsCollapsed: { ...collapsed },
          },
        };
        return saveWorkspace(WORKSPACE_PATH, next, ws.theme);
      }).catch((e) => console.warn("[partPanel] persist partGroupsCollapsed failed", e));
    }, 300);
  }

  function applyCollapse(key: string): void {
    const s = sections.get(key);
    if (!s) return;
    s.ul.style.display = collapsed[key] ? "none" : "";
    s.caret.textContent = collapsed[key] ? "▶" : "▼";
  }

  function applyTexts(): void {
    for (const g of GROUPS) {
      const s = sections.get(g.key);
      if (s) s.titleText.textContent = t(g.titleKey);
    }
  }
  applyTexts();
  for (const g of GROUPS) applyCollapse(g.key);

  function isSkinEmpty(name: string): boolean {
    const s = cachedSkins.find((x) => x.name === name);
    if (!s) return true;
    const total = s.body.length + s.head.length + (s.wings?.length ?? 0) + (s.accessories?.length ?? 0) + (s.blood?.length ?? 0);
    return total === 0;
  }

  function renderSkins(): void {
    const currentName = sessionStore.getState().currentSkinName;
    skinsEl.innerHTML = "";
    if (cachedSkinNames.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.style.padding = "8px";
      empty.textContent = t("partPanel.noSkin");
      skinsEl.appendChild(empty);
      return;
    }
    for (const name of cachedSkinNames) {
      const btn = document.createElement("button");
      btn.textContent = name;
      btn.className = name === currentName ? "btn btn-primary" : "btn";
      if (isSkinEmpty(name)) btn.style.opacity = "0.5";
      btn.addEventListener("click", () => onSelectSkin(name));
      skinsEl.appendChild(btn);
    }
  }

  // 表情判定：Head 目录里以 Eye / Mouth / Nose 开头或包含这些词的部件。
  function isExpressionPart(name: string): boolean {
    return /^(Eye|Mouth|Nose)/i.test(name) || /(Eye|Mouth|Nose)/i.test(name.replace(/^[a-z]+/, ""));
  }

  function renderParts(): void {
    const { currentSkinName, selectedPartName, selectedCategory } = sessionStore.getState();
    const skin = cachedSkins.find((s) => s.name === currentSkinName);
    const headParts = skin?.head ?? [];
    const expressionParts = headParts.filter((p) => isExpressionPart(p.name));
    const headOnlyParts = headParts.filter((p) => !isExpressionPart(p.name));
    const lists: Record<string, PartInfo[]> = {
      body: skin?.body ?? [],
      head: headOnlyParts,
      expression: expressionParts,
      wings: skin?.wings ?? [],
      accessories: skin?.accessories ?? [],
      blood: skin?.blood ?? [],
    };
    for (const g of GROUPS) {
      const s = sections.get(g.key);
      if (!s) continue;
      renderCategoryList(s.ul, lists[g.key], g.cat, g.key, selectedPartName, selectedCategory, skin);
    }
  }

  function renderCategoryList(
    ul: HTMLUListElement,
    parts: PartInfo[],
    cat: PartCategory,
    groupKey: string,
    selPart: string | null,
    selCat: PartCategory | null,
    skin: Skin | undefined,
  ): void {
    ul.innerHTML = "";
    for (const p of parts) {
      const li = document.createElement("li");
      const isSel = selCat === cat && selPart === p.name;
      li.style.cssText = `padding:2px 6px;cursor:pointer;border-radius:4px;${isSel ? "background:rgba(0,0,0,0.08);" : ""}`;
      li.textContent = `${localizePartName(p.name)} ${p.width}×${p.height}`;
      // 配件分组在名称后追加 enabled 状态点：● 已启用 / ○ 未启用。
      if (groupKey === "accessories" && skin) {
        const cfg = skin.accessoryConfigs.find((c) => c.id === p.name || c.sprite === p.name);
        const dot = document.createElement("span");
        dot.textContent = cfg?.enabled ? "  ●" : "  ○";
        dot.style.color = cfg?.enabled ? "#0a0" : "#999";
        li.appendChild(dot);
      }
      if (p.corrupted) {
        const tag = document.createElement("span");
        tag.textContent = ` ${t("partPanel.corruptedTag")}`;
        tag.style.color = "#c00";
        li.appendChild(tag);
      }
      li.addEventListener("click", () => {
        requestSwitchPart(skinRoot, { partName: p.name, category: cat });
      });
      li.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const skinName = sessionStore.getState().currentSkinName;
        if (!skinName) return;
        showContextMenu(e.clientX, e.clientY, [
          { label: t("partClipboard.copy"), action: () => openCopyPartDialog(skinRoot, skinName, cat, p.name, parts.map((x) => x.name)) },
          { label: t("partClipboard.delete"), action: () => deletePartWithConfirm(skinRoot, skinName, cat, p.name) },
        ]);
      });
      ul.appendChild(li);
    }
    if (categorySupportsCreate(cat)) {
      const skinName = sessionStore.getState().currentSkinName;
      const existingNames = listCategoryNames(skin, cat);
      if (skinName && !categoryFullyCreated(cat, existingNames)) {
        const addLi = document.createElement("li");
        addLi.style.cssText = "padding:4px 6px;";
        const addBtn = document.createElement("button");
        addBtn.className = "btn";
        addBtn.style.cssText = "width:100%;font-size:12px;";
        addBtn.textContent = t("addPart.button");
        addBtn.addEventListener("click", () => {
          openAddPartDialog({
            skinRoot,
            skinName,
            category: cat,
            existingNames,
            onCreated: () => {
              const cur = sessionStore.getState().partListVersion ?? 0;
              sessionStore.setState({ partListVersion: cur + 1 });
            },
          });
        });
        addLi.appendChild(addBtn);
        ul.appendChild(addLi);
      }
    }
  }

  function listCategoryNames(skin: Skin | undefined, cat: PartCategory): string[] {
    if (!skin) return [];
    switch (cat) {
      case "Body":
        return skin.body.map((x) => x.name);
      case "Head":
        return skin.head.map((x) => x.name);
      case "Wings":
        return skin.wings.map((x) => x.name);
      case "Accessories":
        return skin.accessories.map((x) => x.name);
      case "Blood":
        return skin.blood.map((x) => x.name);
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

  /// 仅刷新当前皮肤的部件列表数据，不清选中态、不切皮肤；用于 partListVersion / accessoriesVersion bump 后的刷新。
  function refreshCurrentSkinList(skinName: string): void {
    listParts(skinRoot, skinName)
      .then((skin) => {
        const idx = cachedSkins.findIndex((s) => s.name === skin.name);
        if (idx >= 0) cachedSkins[idx] = skin;
        else cachedSkins.push(skin);
        renderParts();
      })
      .catch((e: ApiError) => showError(e.message ?? String(e)));
  }

  let lastPartListVersion = sessionStore.getState().partListVersion ?? 0;
  let lastAccVersion = sessionStore.getState().accessoriesVersion ?? 0;

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
    const ver = s.partListVersion ?? 0;
    if (ver !== lastPartListVersion) {
      lastPartListVersion = ver;
      if (s.currentSkinName) refreshCurrentSkinList(s.currentSkinName);
    }
    const accVer = s.accessoriesVersion ?? 0;
    if (accVer !== lastAccVersion) {
      lastAccVersion = accVer;
      if (s.currentSkinName) refreshCurrentSkinList(s.currentSkinName);
    }
  });

  listSkins(skinRoot)
    .then((names) => {
      cachedSkinNames = names;
      cachedSkins = names.map((name) => ({
        name,
        body: [],
        head: [],
        wings: [],
        accessories: [],
        accessoryConfigs: [],
        blood: [],
      }));
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

  const unsubLang = subscribeLang(() => {
    applyTexts();
    renderSkins();
    renderParts();
  });

  return () => {
    unsubscribe();
    unsubLang();
  };
}
