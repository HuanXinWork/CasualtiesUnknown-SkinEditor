// 新建标准部件对话框：选部件 + 前后/左右维度 + 尺寸，按勾选组合批量建黑块 PNG。
import type { PartCategory } from "../stateStore/types";
import { t } from "../i18n";
import { localizePartName } from "../i18n/partNames";
import { createPart, createPartFromTemplate, type ApiError } from "../apiClient";
import { showToast } from "../toast";
import { PART_CATALOG, inferPrefix, buildPartFileName, isPartFullyCreated, type PartDef } from "./partCatalog";

export interface AddPartDialogOptions {
  skinRoot: string;
  skinName: string;
  category: PartCategory;
  existingNames: string[];
  onCreated: () => void;
}

export function openAddPartDialog(opts: AddPartDialogOptions): void {
  const allDefs = PART_CATALOG[opts.category];
  if (!allDefs || allDefs.length === 0) return;
  const prefix = inferPrefix(opts.category, opts.existingNames);
  const existing = new Set(opts.existingNames);
  // 模板分类：贴图直接从内置 exp 复制（保持原尺寸/原像素），不再让用户手动改尺寸。
  const useTemplate = opts.category === "Accessories" || opts.category === "Blood";
  // 只列还没建齐全部维度组合的部件。
  const defs = allDefs.filter((d) => !isPartFullyCreated(d, prefix, existing));
  if (defs.length === 0) return;

  let selected: PartDef = defs[0];
  let wantF = true;
  let wantB = false;
  let wantLeft = true;
  let wantRight = false;
  let width = selected.width;
  let height = selected.height;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;";

  const dialog = document.createElement("div");
  dialog.className = "panel";
  dialog.style.cssText =
    "min-width:420px;max-width:520px;max-height:80vh;overflow:auto;padding:16px;display:flex;flex-direction:column;gap:12px;";
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const title = document.createElement("div");
  title.style.cssText = "font-weight:600;font-size:15px;";
  dialog.appendChild(title);

  const listWrap = document.createElement("div");
  listWrap.style.cssText =
    "max-height:200px;overflow:auto;display:flex;flex-wrap:wrap;gap:6px;padding:6px;border:1px solid rgba(0,0,0,var(--border-opacity));border-radius:4px;";
  dialog.appendChild(listWrap);

  const dimWrap = document.createElement("div");
  dimWrap.style.cssText = "display:flex;flex-direction:column;gap:8px;";
  dialog.appendChild(dimWrap);

  const sizeRow = document.createElement("div");
  sizeRow.style.cssText = "display:flex;align-items:center;gap:8px;font-size:13px;";
  const wInput = document.createElement("input");
  wInput.type = "number"; wInput.min = "1"; wInput.style.width = "64px";
  const hInput = document.createElement("input");
  hInput.type = "number"; hInput.min = "1"; hInput.style.width = "64px";
  const sizeLabel = document.createElement("span");
  const xLabel = document.createElement("span"); xLabel.textContent = "×";
  sizeRow.append(sizeLabel, wInput, xLabel, hInput);

  const fbRow = document.createElement("div");
  fbRow.style.cssText = "display:flex;align-items:center;gap:12px;font-size:13px;";
  const fbLabel = document.createElement("span");
  const cbF = makeCheck();
  const cbB = makeCheck();
  const fSpan = document.createElement("label"); fSpan.style.cssText = "display:flex;align-items:center;gap:4px;cursor:pointer;";
  const bSpan = document.createElement("label"); bSpan.style.cssText = "display:flex;align-items:center;gap:4px;cursor:pointer;";
  const fText = document.createElement("span");
  const bText = document.createElement("span");
  fSpan.append(cbF, fText);
  bSpan.append(cbB, bText);
  fbRow.append(fbLabel, fSpan, bSpan);

  const lrRow = document.createElement("div");
  lrRow.style.cssText = "display:flex;align-items:center;gap:12px;font-size:13px;";
  const lrLabel = document.createElement("span");
  const cbL = makeCheck();
  const cbR = makeCheck();
  const lSpan = document.createElement("label"); lSpan.style.cssText = "display:flex;align-items:center;gap:4px;cursor:pointer;";
  const rSpan = document.createElement("label"); rSpan.style.cssText = "display:flex;align-items:center;gap:4px;cursor:pointer;";
  const lText = document.createElement("span");
  const rText = document.createElement("span");
  lSpan.append(cbL, lText);
  rSpan.append(cbR, rText);
  lrRow.append(lrLabel, lSpan, rSpan);

  dimWrap.append(sizeRow, fbRow, lrRow);

  const btnRow = document.createElement("div");
  btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:4px;";
  const addBtn = document.createElement("button"); addBtn.className = "btn btn-primary";
  const addNextBtn = document.createElement("button"); addNextBtn.className = "btn";
  const cancelBtn = document.createElement("button"); cancelBtn.className = "btn";
  btnRow.append(cancelBtn, addNextBtn, addBtn);
  dialog.appendChild(btnRow);

  function makeCheck(): HTMLInputElement {
    const c = document.createElement("input");
    c.type = "checkbox";
    c.style.cssText = "width:16px;height:16px;cursor:pointer;accent-color:var(--accent,#3b82f6);";
    return c;
  }

  function visibleDefs(): PartDef[] {
    return defs.filter((d) => !isPartFullyCreated(d, prefix, existing));
  }

  function missingCombos(def: PartDef): Array<{ side: "" | "F" | "B"; right: boolean }> {
    const sides: Array<"" | "F" | "B"> = def.fb ? ["F", "B"] : [""];
    const rights: boolean[] = def.lr ? [false, true] : [false];
    const out: Array<{ side: "" | "F" | "B"; right: boolean }> = [];
    for (const side of sides) for (const right of rights) {
      const fileName = buildPartFileName(prefix, def.base, side, right);
      if (existing.has(fileName)) continue;
      out.push({ side, right });
    }
    return out;
  }

  function primeMissingSelection(def: PartDef): void {
    const missing = missingCombos(def);
    wantF = !def.fb || missing.some((c) => c.side === "F");
    wantB = def.fb && missing.some((c) => c.side === "B");
    wantLeft = !def.lr || missing.some((c) => !c.right);
    wantRight = def.lr && missing.some((c) => c.right);
  }

  function selectDef(def: PartDef): void {
    selected = def;
    width = def.width;
    height = def.height;
    wInput.value = String(width);
    hInput.value = String(height);
    primeMissingSelection(def);
    syncControls();
    renderList();
  }

  function renderList(): void {
    listWrap.innerHTML = "";
    for (const def of visibleDefs()) {
      const b = document.createElement("button");
      b.className = def === selected ? "btn btn-primary" : "btn";
      b.style.cssText = "font-size:12px;padding:2px 8px;";
      b.textContent = localizePartName(prefix + def.base);
      b.addEventListener("click", () => selectDef(def));
      listWrap.appendChild(b);
    }
  }

  function syncControls(): void {
    fbRow.style.display = selected.fb ? "flex" : "none";
    lrRow.style.display = selected.lr ? "flex" : "none";
    sizeRow.style.display = useTemplate ? "none" : "flex";
    cbF.checked = wantF; cbB.checked = wantB;
    cbL.checked = wantLeft; cbR.checked = wantRight;
    const combos = computeCombos();
    addBtn.disabled = combos.length === 0;
    addNextBtn.disabled = combos.length === 0;
  }

  function computeCombos(): Array<{ side: "" | "F" | "B"; right: boolean }> {
    const sides: Array<"" | "F" | "B"> = selected.fb
      ? ([...(wantF ? ["F"] : []), ...(wantB ? ["B"] : [])] as Array<"F" | "B">)
      : [""];
    const rights: boolean[] = selected.lr
      ? [...(wantLeft ? [false] : []), ...(wantRight ? [true] : [])]
      : [false];
    const out: Array<{ side: "" | "F" | "B"; right: boolean }> = [];
    for (const s of sides) for (const r of rights) {
      // 跳过已存在的组合，避免重复创建。
      if (existing.has(buildPartFileName(prefix, selected.base, s, r))) continue;
      out.push({ side: s, right: r });
    }
    return out;
  }

  async function doCreate(keepOpen: boolean): Promise<void> {
    const combos = computeCombos();
    if (combos.length === 0) return;
    let created = 0;
    let skipped = 0;
    let firstError: ApiError | null = null;
    for (const c of combos) {
      const fileName = buildPartFileName(prefix, selected.base, c.side, c.right);
      try {
        if (useTemplate) {
          await createPartFromTemplate(opts.skinRoot, opts.skinName, opts.category, fileName);
        } else {
          await createPart(opts.skinRoot, opts.skinName, opts.category, fileName, width, height);
        }
        existing.add(fileName);
        created++;
      } catch (e) {
        if (!firstError && e && typeof e === "object" && "message" in e && "code" in e) {
          firstError = e as ApiError;
        }
        skipped++;
      }
    }
    const resultText = t("addPart.resultToast").replace("{n}", String(created)).replace("{m}", String(skipped));
    showToast(firstError ? `${resultText} ${firstError.message}` : resultText, created > 0 ? "info" : "error");
    if (created > 0) opts.onCreated();
    if (keepOpen) {
      const remaining = visibleDefs();
      if (remaining.length === 0) {
        close();
        return;
      }
      // 当前选中项已建齐时切到下一个仍可建的部件。
      if (!remaining.includes(selected)) selectDef(remaining[0]);
      else { renderList(); syncControls(); }
    } else if (created > 0) {
      close();
    }
  }

  function applyTexts(): void {
    title.textContent = t("addPart.title");
    sizeLabel.textContent = t("addPart.size");
    fbLabel.textContent = t("addPart.frontBack");
    lrLabel.textContent = t("addPart.leftRight");
    fText.textContent = t("addPart.front");
    bText.textContent = t("addPart.back");
    lText.textContent = t("addPart.left");
    rText.textContent = t("addPart.right");
    addBtn.textContent = t("addPart.add");
    addNextBtn.textContent = t("addPart.addNext");
    cancelBtn.textContent = t("addPart.cancel");
  }

  function close(): void {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") close();
  }

  cbF.addEventListener("change", () => { wantF = cbF.checked; syncControls(); });
  cbB.addEventListener("change", () => { wantB = cbB.checked; syncControls(); });
  cbL.addEventListener("change", () => { wantLeft = cbL.checked; syncControls(); });
  cbR.addEventListener("change", () => { wantRight = cbR.checked; syncControls(); });
  wInput.addEventListener("input", () => { width = Math.max(1, Number.parseInt(wInput.value, 10) || 1); });
  hInput.addEventListener("input", () => { height = Math.max(1, Number.parseInt(hInput.value, 10) || 1); });
  addBtn.addEventListener("click", () => void doCreate(false));
  addNextBtn.addEventListener("click", () => void doCreate(true));
  cancelBtn.addEventListener("click", close);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  document.addEventListener("keydown", onKey);

  wInput.value = String(width);
  hInput.value = String(height);
  primeMissingSelection(selected);
  applyTexts();
  renderList();
  syncControls();
}
