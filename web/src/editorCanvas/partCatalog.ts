// 新建标准部件的目录表：各分类可建部件 base 名、默认黑块尺寸、是否支持前后(F/B) / 左右(R_)。
import type { PartCategory } from "../stateStore/types";

export interface PartDef {
  /** 不含前缀的 base 名，如 "UpArm" / "EyeOpen" / "wingUL"。 */
  base: string;
  width: number;
  height: number;
  /** 支持前后副本（生成 F / B 后缀）。 */
  fb: boolean;
  /** 支持左右朝向副本（生成 R_ 前缀）。 */
  lr: boolean;
}

export const PART_CATALOG: Partial<Record<PartCategory, PartDef[]>> = {
  Body: [
    { base: "UpArm", width: 8, height: 12, fb: true, lr: true },
    { base: "DownArm", width: 12, height: 14, fb: true, lr: true },
    { base: "Hand", width: 6, height: 12, fb: true, lr: true },
    { base: "Thigh", width: 10, height: 15, fb: true, lr: true },
    { base: "Crus", width: 8, height: 10, fb: true, lr: true },
    { base: "Foot", width: 11, height: 12, fb: true, lr: true },
    { base: "UpTorso", width: 12, height: 18, fb: false, lr: true },
    { base: "DownTorso", width: 12, height: 12, fb: false, lr: true },
    { base: "Tail", width: 68, height: 22, fb: false, lr: true },
  ],
  Head: [
    { base: "Head", width: 26, height: 18, fb: false, lr: true },
    { base: "HeadBack", width: 26, height: 18, fb: false, lr: true },
    { base: "HeadBackMouth", width: 26, height: 18, fb: false, lr: true },
    { base: "HeadBackMouthMini", width: 26, height: 18, fb: false, lr: true },
    { base: "HeadDisfigured1", width: 26, height: 18, fb: false, lr: true },
    { base: "HeadDisfigured1Healed", width: 26, height: 18, fb: false, lr: true },
    { base: "HeadDisfigured2", width: 26, height: 18, fb: false, lr: true },
    { base: "HeadDisfigured2Healed", width: 26, height: 18, fb: false, lr: true },
    { base: "HeadDisfigured3", width: 26, height: 18, fb: false, lr: true },
    { base: "HeadDisfigured3Healed", width: 26, height: 18, fb: false, lr: true },
    { base: "Nosebleed", width: 14, height: 12, fb: false, lr: true },
    { base: "EyeOpen", width: 26, height: 12, fb: false, lr: true },
    { base: "EyeClosed", width: 26, height: 12, fb: false, lr: true },
    { base: "EyeHalfClosed", width: 26, height: 12, fb: false, lr: true },
    { base: "EyeHalfClosedBack", width: 26, height: 12, fb: false, lr: true },
    { base: "EyeHappy", width: 26, height: 12, fb: false, lr: true },
    { base: "EyeSad", width: 26, height: 12, fb: false, lr: true },
    { base: "EyeSadBack", width: 26, height: 12, fb: false, lr: true },
    { base: "EyeScared", width: 26, height: 12, fb: false, lr: true },
    { base: "EyeScaredBack", width: 26, height: 12, fb: false, lr: true },
    { base: "EyePanic", width: 26, height: 12, fb: false, lr: true },
    { base: "EyeLookBack", width: 26, height: 12, fb: false, lr: true },
    { base: "EyeGone", width: 26, height: 12, fb: false, lr: true },
    { base: "EyeGoneHealed", width: 26, height: 12, fb: false, lr: true },
  ],
  Wings: [
    { base: "wingUL", width: 32, height: 32, fb: false, lr: false },
    { base: "wingUR", width: 32, height: 32, fb: false, lr: false },
    { base: "wingDL", width: 32, height: 32, fb: false, lr: false },
    { base: "wingDR", width: 32, height: 32, fb: false, lr: false },
  ],
  Accessories: [
    { base: "autopump", width: 12, height: 12, fb: false, lr: false },
    { base: "autozoomgoggles", width: 16, height: 12, fb: false, lr: false },
    { base: "balaclava", width: 26, height: 12, fb: false, lr: false },
    { base: "bellyarmor", width: 12, height: 12, fb: false, lr: false },
    { base: "belt", width: 10, height: 8, fb: false, lr: false },
    { base: "bigpack", width: 24, height: 24, fb: false, lr: false },
    { base: "bikehelmet", width: 20, height: 18, fb: false, lr: false },
    { base: "blindfold", width: 26, height: 12, fb: false, lr: false },
    { base: "carapace", width: 12, height: 18, fb: false, lr: false },
    { base: "climbingclaws", width: 8, height: 12, fb: false, lr: false },
    { base: "duffelbag", width: 20, height: 24, fb: false, lr: false },
    { base: "dustmask", width: 26, height: 12, fb: false, lr: false },
    { base: "fannypack", width: 16, height: 10, fb: false, lr: false },
    { base: "headlamp", width: 26, height: 12, fb: false, lr: false },
    { base: "holidayhat", width: 22, height: 18, fb: false, lr: false },
    { base: "jetpack", width: 24, height: 30, fb: false, lr: false },
    { base: "latexgloves", width: 6, height: 8, fb: false, lr: false },
    { base: "legpouch", width: 10, height: 12, fb: false, lr: false },
    { base: "makeshiftheadlamp", width: 20, height: 20, fb: false, lr: false },
    { base: "makeshifthelmet", width: 22, height: 18, fb: false, lr: false },
    { base: "materialpouch", width: 12, height: 12, fb: false, lr: false },
    { base: "safetyglasses", width: 26, height: 12, fb: false, lr: false },
    { base: "scarf", width: 12, height: 14, fb: false, lr: false },
    { base: "slingbag", width: 26, height: 16, fb: false, lr: false },
    { base: "smallpack", width: 16, height: 14, fb: false, lr: false },
    { base: "sneakers", width: 8, height: 11, fb: false, lr: false },
    { base: "woodsandals", width: 10, height: 11, fb: false, lr: false },
  ],
  Blood: [
    { base: "BloodParticle", width: 32, height: 32, fb: false, lr: false },
    { base: "limbBlood", width: 128, height: 128, fb: false, lr: false },
    { base: "nosebleed", width: 14, height: 12, fb: false, lr: false },
  ],
};

/// 分类是否提供"添加部件"功能。
export function categorySupportsCreate(cat: PartCategory): boolean {
  return cat in PART_CATALOG;
}

/// 推断该分类新建部件的前缀：Wings / Blood / Accessories 恒空（base 名即文件名）；其它取已有部件公共前缀，缺失默认 "experiment"。
export function inferPrefix(cat: PartCategory, existingNames: string[]): string {
  if (cat === "Wings" || cat === "Blood" || cat === "Accessories") return "";
  for (const name of existingNames) {
    const m = /^([a-z]+)[A-Z]/.exec(name.replace(/^R_/, ""));
    if (m) return m[1];
  }
  return "experiment";
}

/// 按 base + 前缀 + 维度组合拼出最终文件名（不含扩展名）。
export function buildPartFileName(prefix: string, base: string, side: "" | "F" | "B", right: boolean): string {
  return `${right ? "R_" : ""}${prefix}${base}${side}`;
}

/// 列出该部件定义在当前前缀下的全部维度组合文件名（fb × lr 笛卡尔积）。
export function partAllComboNames(def: PartDef, prefix: string): string[] {
  const sides: Array<"" | "F" | "B"> = def.fb ? ["F", "B"] : [""];
  const rights: boolean[] = def.lr ? [false, true] : [false];
  const out: string[] = [];
  for (const s of sides) for (const r of rights) out.push(buildPartFileName(prefix, def.base, s, r));
  return out;
}

/// 该部件定义的所有维度组合是否都已存在。
export function isPartFullyCreated(def: PartDef, prefix: string, existing: Set<string>): boolean {
  return partAllComboNames(def, prefix).every((n) => existing.has(n));
}

/// 该分类下所有标准部件是否都已建齐（决定是否隐藏"添加部件"按钮）。
export function categoryFullyCreated(cat: PartCategory, existingNames: string[]): boolean {
  const defs = PART_CATALOG[cat];
  if (!defs || defs.length === 0) return true;
  const prefix = inferPrefix(cat, existingNames);
  const existing = new Set(existingNames);
  return defs.every((def) => isPartFullyCreated(def, prefix, existing));
}
