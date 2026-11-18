// 新建标准部件目录表与跨角色前缀/维度拼接规则。
import type { PartCategory } from "../stateStore/types";

export interface PartDef {
  base: string;
  width: number;
  height: number;
  fb: boolean;
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
    { base: "EyeLockedIn", width: 26, height: 12, fb: false, lr: true },
    { base: "EyeLockedInBack", width: 26, height: 12, fb: false, lr: true },
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
    { base: "armwarmers", width: 12, height: 14, fb: false, lr: true },
    { base: "autopump", width: 12, height: 12, fb: false, lr: true },
    { base: "autozoomgoggles", width: 16, height: 12, fb: false, lr: true },
    { base: "balaclava", width: 26, height: 12, fb: false, lr: true },
    { base: "bandolier", width: 12, height: 18, fb: false, lr: true },
    { base: "bellyarmor", width: 12, height: 12, fb: false, lr: true },
    { base: "belt", width: 10, height: 8, fb: false, lr: true },
    { base: "bigpack", width: 24, height: 24, fb: false, lr: true },
    { base: "bikehelmet", width: 20, height: 18, fb: false, lr: true },
    { base: "blindfold", width: 26, height: 12, fb: false, lr: true },
    { base: "carapace", width: 12, height: 18, fb: false, lr: true },
    { base: "climbingclaws", width: 8, height: 12, fb: false, lr: true },
    { base: "duffelbag", width: 20, height: 24, fb: false, lr: true },
    { base: "dustmask", width: 26, height: 12, fb: false, lr: true },
    { base: "earmuffs", width: 26, height: 18, fb: false, lr: true },
    { base: "fannypack", width: 16, height: 10, fb: false, lr: true },
    { base: "headlamp", width: 26, height: 12, fb: false, lr: true },
    { base: "holidayhat", width: 22, height: 18, fb: false, lr: true },
    { base: "hoodie", width: 16, height: 20, fb: false, lr: true },
    { base: "jetpack", width: 24, height: 30, fb: false, lr: true },
    { base: "kneepads", width: 10, height: 12, fb: false, lr: true },
    { base: "latexgloves", width: 6, height: 8, fb: false, lr: true },
    { base: "legpouch", width: 10, height: 12, fb: false, lr: true },
    { base: "limbwraps", width: 12, height: 14, fb: false, lr: true },
    { base: "liquidpouch", width: 12, height: 14, fb: false, lr: true },
    { base: "makeshiftheadlamp", width: 20, height: 20, fb: false, lr: true },
    { base: "makeshifthelmet", width: 22, height: 18, fb: false, lr: true },
    { base: "materialpouch", width: 12, height: 12, fb: false, lr: true },
    { base: "mercscarf", width: 16, height: 14, fb: false, lr: true },
    { base: "riothelmet", width: 26, height: 20, fb: false, lr: true },
    { base: "safetyglasses", width: 26, height: 12, fb: false, lr: true },
    { base: "scarf", width: 12, height: 14, fb: false, lr: true },
    { base: "scubadivinggear", width: 20, height: 24, fb: false, lr: true },
    { base: "slingbag", width: 26, height: 16, fb: false, lr: true },
    { base: "smallpack", width: 16, height: 14, fb: false, lr: true },
    { base: "sneakers", width: 8, height: 11, fb: false, lr: true },
    { base: "striderpelt", width: 20, height: 24, fb: false, lr: true },
    { base: "tacticalboots", width: 12, height: 12, fb: false, lr: true },
    { base: "tacticalgloves", width: 6, height: 12, fb: false, lr: true },
    { base: "tornshirt", width: 14, height: 18, fb: false, lr: true },
    { base: "traumarig", width: 16, height: 18, fb: false, lr: true },
    { base: "waterpouch1", width: 12, height: 14, fb: false, lr: true },
    { base: "woodsandals", width: 10, height: 11, fb: false, lr: true },
  ],
  Blood: [
    { base: "BloodParticle", width: 32, height: 32, fb: false, lr: false },
    { base: "BloodParticle_splat", width: 32, height: 32, fb: false, lr: false },
    { base: "limbBlood", width: 128, height: 128, fb: false, lr: false },
    { base: "nosebleed", width: 14, height: 12, fb: false, lr: false },
  ],
};

export function categorySupportsCreate(cat: PartCategory): boolean {
  return cat in PART_CATALOG;
}

/** 推断当前皮肤的角色前缀（兼容 `experiment*`、`dune*` 驼峰与 `milky*` 全小写命名）。 */
export function inferPrefix(cat: PartCategory, existingNames: string[]): string {
  if (cat === "Wings" || cat === "Blood" || cat === "Accessories") return "";
  for (const raw of existingNames) {
    const clean = raw.replace(/^R_/, "");
    if (clean.startsWith("milky") || clean === "mildownarm") return "milky";
    if (clean.startsWith("dune")) return "dune";
    const m = /^([a-z]+)[A-Z]/.exec(clean);
    if (m) return m[1];
  }
  return "experiment";
}

const MILKY_STEM_OVERRIDES: Record<string, string> = {
  UpTorso: "milkytorso",
  DownArm: "mildownarm",
  HeadBackMouth: "milkyheadbackmouthopen",
  HeadBackMouthMini: "milkyheadbackmouthhalfopen",
  HeadDisfigured1: "milkydisfigure1",
  HeadDisfigured1Healed: "milkydisfigure1healed",
  HeadDisfigured2: "milkydisfigure2",
  HeadDisfigured2Healed: "milkydisfigure2healed",
};

export function buildPartFileName(prefix: string, base: string, side: "" | "F" | "B", right: boolean): string {
  const rPrefix = right ? "R_" : "";
  if (prefix === "milky") {
    const stem = MILKY_STEM_OVERRIDES[base] ?? `milky${base.toLowerCase()}`;
    return `${rPrefix}${stem}${side}`;
  }
  return `${rPrefix}${prefix}${base}${side}`;
}

export function partAllComboNames(def: PartDef, prefix: string): string[] {
  const sides: Array<"" | "F" | "B"> = def.fb ? ["F", "B"] : [""];
  const rights: boolean[] = def.lr ? [false, true] : [false];
  const out: string[] = [];
  for (const s of sides) for (const r of rights) out.push(buildPartFileName(prefix, def.base, s, r));
  return out;
}

export function isPartFullyCreated(def: PartDef, prefix: string, existing: Set<string>): boolean {
  return partAllComboNames(def, prefix).every((n) => existing.has(n));
}

export function categoryFullyCreated(cat: PartCategory, existingNames: string[]): boolean {
  const defs = PART_CATALOG[cat];
  if (!defs || defs.length === 0) return true;
  const prefix = inferPrefix(cat, existingNames);
  const existing = new Set(existingNames);
  return defs.every((def) => isPartFullyCreated(def, prefix, existing));
}
