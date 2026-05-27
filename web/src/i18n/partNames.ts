// 部件文件名 → 当前语言显示名的映射。仅供 UI 展示，
// 后端 / sessionStore / API 一律沿用原文件名（PNG 物理名不可改）。

import { currentLang } from "./index";

// 已知前缀列表，扩名时把对应项加进来。
const KNOWN_PREFIXES = ["experiment"];

function stripKnownPrefix(name: string): string {
  for (const prefix of KNOWN_PREFIXES) {
    if (name.startsWith(prefix) && name.length > prefix.length) {
      const rest = name.slice(prefix.length);
      // 首字母转小写以匹配查表 key（如 "DownArm" → "downArm"）。
      return rest.charAt(0).toLowerCase() + rest.slice(1);
    }
  }
  return name;
}

// 查表 key = 去前缀 + 首字母小写后的 lemma。覆盖 data/skin/st1/{Body,Head} 现有部件。
const ZH_MAP: Record<string, string> = {
  // ---- Body ----
  upTorso: "上身",
  downTorso: "下身",
  upArm: "上臂",
  downArm: "前臂",
  handF: "前手",
  handB: "后手",
  thigh: "大腿",
  crus: "小腿",
  foot: "脚",
  tail: "尾巴",
  // ---- Wings ----
  wingUL: "翼·左上",
  wingUR: "翼·右上",
  wingDL: "翼·左下",
  wingDR: "翼·右下",
  // ---- Head 主体 ----
  head: "头（默认）",
  headBack: "头（背面）",
  headBackMouth: "头（背面·张嘴）",
  headBackMouthMini: "头（背面·半张嘴）",
  headDisfigured1: "头（毁容 1）",
  headDisfigured2: "头（毁容 2）",
  headDisfigured3: "头（毁容 3）",
  headDisfigured1Healed: "头（愈合 1）",
  headDisfigured2Healed: "头（愈合 2）",
  headDisfigured3Healed: "头（愈合 3）",
  nosebleed: "流鼻血",
  // ---- Head 表情（眼睛/嘴） ----
  eyeOpen: "眼·睁开",
  eyeClosed: "眼·闭眼",
  eyeHalfClosed: "眼·微闭",
  eyeHalfClosedBack: "眼·微闭（背）",
  eyeSad: "眼·悲伤",
  eyeSadBack: "眼·悲伤（背）",
  eyeHappy: "眼·开心",
  eyeScared: "眼·惊恐",
  eyeScaredBack: "眼·惊恐（背）",
  eyePanic: "眼·恐慌",
  eyeLookBack: "眼·回望",
  eyeGone: "眼·缺失",
  eyeGoneHealed: "眼·愈合",

  // ---- Accessories（配件 itemId → 通用习惯中文）----
  autopump: "自动泵",
  autozoomgoggles: "变焦护目镜",
  balaclava: "头套",
  bandolier: "弹链",
  bellyarmor: "腹甲",
  belt: "腰带",
  bigpack: "大背包",
  bikehelmet: "自行车头盔",
  blindfold: "眼罩",
  carapace: "甲壳护甲",
  climbingclaws: "攀爬爪",
  duffelbag: "帆布包",
  dustmask: "防尘面罩",
  fannypack: "腰包",
  headlamp: "头灯",
  holidayhat: "节日帽",
  jetpack: "喷气背包",
  latexgloves: "乳胶手套",
  legpouch: "腿包",
  makeshiftheadlamp: "自制头灯",
  makeshifthelmet: "自制头盔",
  materialpouch: "材料包",
  safetyglasses: "护目镜",
  scarf: "围巾",
  slingbag: "单肩包",
  smallpack: "小背包",
  sneakers: "运动鞋",
  woodsandals: "木凉鞋",

  // ---- Blood（血液贴图）----
  BloodParticle: "血液粒子",
  bloodParticle: "血液粒子",
};

/// 把 PNG 文件名（不含扩展名）转成当前语言下的显示名。
/// - 中文：去 KNOWN_PREFIXES 前缀 → 查 ZH_MAP；查不到回退到去前缀后的原文（驼峰）。
/// - 英文：去 KNOWN_PREFIXES 前缀（与中文同步保持视觉对齐），其余原样返回。
/// - F / B 后缀代表前侧 / 后侧独立副本，按 base 名翻译后追加（前）/（后）/ (front)/(back)。
///   HandF / HandB 在 ZH_MAP 已显式映射为"前手 / 后手"，此处只补 base 名 + F/B 的兜底。
export function localizePartName(rawName: string): string {
  const lemma = stripKnownPrefix(rawName);
  const zh = currentLang() === "zh";
  if (zh && ZH_MAP[lemma]) return ZH_MAP[lemma];
  // 末尾 F/B 后缀且 base 名在 ZH_MAP（如 experimentFootF → footF→不在表→剥后缀 foot 在表）。
  if (lemma.length > 1) {
    const last = lemma[lemma.length - 1];
    if (last === "F" || last === "B") {
      const baseLemma = lemma.slice(0, -1);
      if (zh) {
        const base = ZH_MAP[baseLemma] ?? baseLemma;
        return `${base}${last === "F" ? "（前）" : "（后）"}`;
      }
      return `${baseLemma} (${last === "F" ? "front" : "back"})`;
    }
  }
  return lemma;
}
