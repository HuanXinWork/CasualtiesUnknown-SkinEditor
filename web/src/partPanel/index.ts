// 角色选择与六类部件分组列表（身体 / 头部 / 表情 / 翅膀 / 配件 / 血液贴图）。

import { getWorkspace, listParts, listSkins, type ApiError } from "../apiClient";
import { bumpPartListVersion, sessionStore } from "../stateStore";
import { updateWorkspace, updateWorkspaceSettings } from "../stateStore/workspacePersist";
import type { PartCategory, PartInfo, Skin } from "../stateStore/types";
import { subscribeLang, t } from "../i18n";
import { localizePartName } from "../i18n/partNames";
import { categoryFullyCreated, categorySupportsCreate } from "../editorCanvas/partCatalog";
import { openAddPartDialog } from "../editorCanvas/addPartDialog";
import { guardUnsavedCurrentPart, requestSwitchPart } from "./partSwitchGuard";
import { showContextMenu } from "../contextMenu";
import { deletePartWithConfirm, openCopyPartDialog } from "./partClipboard";

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

const collapsed: Record<string, boolean> = {
  body: false,
  head: false,
  expression: true,
  wings: true,
  accessories: true,
  blood: true,
};

const WORKSPACE_PATH = "data/workspace.json";

export function mountPartPanel(container: HTMLElement, skinRoot: string): () => void {
  let cachedSkinNames: string[] = [];
  let cachedSkins: Skin[] = [];
  let lastSkinName = sessionStore.getState().currentSkinName;
  let lastSelectedPart = sessionStore.getState().selectedPartName;
  let lastSelectedCat = sessionStore.getState().selectedCategory;
  let loadSeq = 0;

  container.classList.add("panel");
  container.innerHTML =
    `<div class="part-panel-error" hidden style="margin:8px 8px 0;padding:6px 8px;border-radius:4px;background:rgba(220,53,69,0.12);color:#dc3545;font-size:12px;"></div>` +
    `<div class="part-panel-skins" style="display:flex;gap:4px;flex-wrap:wrap;padding:8px;"></div>` +
    GROUPS.map(
      (g) =>
        `<section data-group="${g.key}" style="padding:0 8px 8px;">` +
        `<h4 data-role="title" style="margin:8px 0 4px;cursor:pointer;user-select:none;display:flex;align-items:center;gap:4px;">` +
        `<span data-role="caret" style="display:inline-block;width:10px;text-align:center;">▶</span>` +
        `<span data-role="text"></span>` +
        `</h4>` +
        `<ul style="list-style:none;padding:0;margin:0;"></ul>` +
        `</section>`,
    ).join("");

  const errorEl = container.querySelector<HTMLDivElement>(".part-panel-error")!;
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
      updateWorkspaceSettings(WORKSPACE_PATH, { partGroupsCollapsed: { ...collapsed } }, 300);
    });
    sections.set(g.key, { ul, titleText, caret });
  }

  let preferredActiveSkin: string | undefined;
  void getWorkspace(WORKSPACE_PATH)
    .then((ws) => {
      preferredActiveSkin = ws.layout.activeSkin;
      const stored = ws.layout.settings?.partGroupsCollapsed;
      if (stored && typeof stored === "object") {
        for (const g of GROUPS) {
          if (typeof stored[g.key] === "boolean") collapsed[g.key] = stored[g.key];
        }
        for (const g of GROUPS) applyCollapse(g.key);
      }
    })
    .catch((e) => console.warn("[partPanel] load workspace preferences failed", e));

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

  function showError(msg: string | null): void {
    if (!msg) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = `${t("partPanel.loadFailed")}：${msg}`;
  }

  function isSkinEmpty(name: string): boolean {
    const s = cachedSkins.find((x) => x.name === name);
    if (!s) return true;
    const total =
      s.body.length +
      s.head.length +
      (s.wings?.length ?? 0) +
      (s.accessories?.length ?? 0) +
      (s.blood?.length ?? 0);
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
      btn.addEventListener("click", () => requestSelectSkin(name));
      skinsEl.appendChild(btn);
    }
  }

  function isExpressionPart(name: string): boolean {
    const clean = name.replace(/^R_/, "");
    return /^(eye|mouth|nose)/i.test(clean) || /^(experiment|milky|dune)(eye|nose)/i.test(clean);
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
      li.style.cssText = `padding:2px 6px;cursor:pointer;border-radius:4px;${
        isSel ? "background:rgba(var(--border-rgb),0.12);" : ""
      }`;
      li.textContent = `${localizePartName(p.name)} ${p.width}×${p.height}`;
      if (groupKey === "accessories" && skin) {
        const stripped = p.name.replace(/^R_/, "");
        const cfg = skin.accessoryConfigs.find((c) => c.id === stripped || c.sprite === stripped);
        const dot = document.createElement("span");
        dot.textContent = cfg?.enabled ? "  ●" : "  ○";
        dot.style.color = cfg?.enabled ? "#2ea043" : "#999";
        li.appendChild(dot);
      }
      if (p.corrupted) {
        const tag = document.createElement("span");
        tag.textContent = ` ${t("partPanel.corruptedTag")}`;
        tag.style.color = "#dc3545";
        li.appendChild(tag);
      }
      li.addEventListener("click", () => {
        requestSwitchPart(skinRoot, { partName: p.name, category: cat });
      });
      li.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const skinName = sessionStore.getState().currentSkinName;
        if (!skinName) return;
        const allCatNames = listCategoryNames(skin, cat);
        showContextMenu(e.clientX, e.clientY, [
          {
            label: t("partClipboard.copy"),
            action: () => openCopyPartDialog(skinRoot, skinName, cat, p.name, allCatNames),
          },
          {
            label: t("partClipboard.delete"),
            action: () => deletePartWithConfirm(skinRoot, skinName, cat, p.name),
          },
        ]);
      });
      ul.appendChild(li);
    }
    if (groupKey !== "expression" && categorySupportsCreate(cat)) {
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
            onCreated: () => bumpPartListVersion(),
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

  function applySelectSkin(skinName: string, persistActive = true): void {
    const seq = ++loadSeq;
    showError(null);
    sessionStore.setState({
      currentSkinName: skinName,
      selectedPartName: null,
      selectedCategory: null,
    });
    if (persistActive) {
      updateWorkspace(WORKSPACE_PATH, (draft) => {
        draft.layout.activeSkin = skinName;
      });
    }
    listParts(skinRoot, skinName)
      .then((skin) => {
        if (seq !== loadSeq) return;
        const idx = cachedSkins.findIndex((s) => s.name === skin.name);
        if (idx >= 0) cachedSkins[idx] = skin;
        else cachedSkins.push(skin);
        renderSkins();
        renderParts();
      })
      .catch((e: ApiError) => {
        if (seq !== loadSeq) return;
        showError(e.message ?? String(e));
      });
  }

  function requestSelectSkin(skinName: string): void {
    if (sessionStore.getState().currentSkinName === skinName) return;
    guardUnsavedCurrentPart(skinRoot, () => applySelectSkin(skinName, true));
  }

  function refreshCurrentSkinList(skinName: string): void {
    const seq = ++loadSeq;
    listParts(skinRoot, skinName)
      .then((skin) => {
        if (seq !== loadSeq) return;
        showError(null);
        const idx = cachedSkins.findIndex((s) => s.name === skin.name);
        if (idx >= 0) cachedSkins[idx] = skin;
        else cachedSkins.push(skin);
        renderSkins();
        renderParts();
      })
      .catch((e: ApiError) => {
        if (seq !== loadSeq) return;
        showError(e.message ?? String(e));
      });
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
    .then(async (names) => {
      cachedSkinNames = names;
      cachedSkins = await Promise.all(
        names.map((n) =>
          listParts(skinRoot, n).catch(() => ({
            name: n,
            body: [],
            head: [],
            wings: [],
            accessories: [],
            accessoryConfigs: [],
            blood: [],
          })),
        ),
      );
      const cur = sessionStore.getState().currentSkinName;
      if (cur === null && names.length > 0) {
        const initial =
          preferredActiveSkin && names.includes(preferredActiveSkin) ? preferredActiveSkin : names[0];
        applySelectSkin(initial, false);
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
