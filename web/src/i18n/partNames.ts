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
};

/// 把 PNG 文件名（不含扩展名）转成当前语言下的显示名。
/// - 中文：去 KNOWN_PREFIXES 前缀 → 查 ZH_MAP；查不到回退到去前缀后的原文（驼峰）。
/// - 英文：去 KNOWN_PREFIXES 前缀（与中文同步保持视觉对齐），其余原样返回。
export function localizePartName(rawName: string): string {
  const lemma = stripKnownPrefix(rawName);
  if (currentLang() === "zh") {
    return ZH_MAP[lemma] ?? lemma;
  }
  return lemma;
}
