// 部件物理文件名到当前语言 UI 显示名的映射（物理 PNG 文件名保持不变）。

import { currentLang } from "./index";

const KNOWN_PREFIXES = ["experiment", "milky", "dune"];

const SPECIAL_LEMMAS: Record<string, string> = {
  milkytorso: "upTorso",
  mildownarm: "downArm",
  milkyheadbackmouthopen: "headBackMouth",
  milkyheadbackmouthhalfopen: "headBackMouthMini",
  milkydisfigure1: "headDisfigured1",
  milkydisfigure2: "headDisfigured2",
  milkydisfigure1healed: "headDisfigured1Healed",
  milkydisfigure2healed: "headDisfigured2Healed",
  duneHeadMouth: "headBackMouth",
  duneHeadMouthHalf: "headBackMouthMini",
  duneDisfigured: "headDisfigured1",
  duneDisfiguredHealed: "headDisfigured1Healed",
};

function stripKnownPrefix(name: string): string {
  if (SPECIAL_LEMMAS[name]) return SPECIAL_LEMMAS[name];
  for (const prefix of KNOWN_PREFIXES) {
    if (name.startsWith(prefix) && name.length > prefix.length) {
      const rest = name.slice(prefix.length);
      return rest.charAt(0).toLowerCase() + rest.slice(1);
    }
  }
  return name;
}

const ZH_MAP: Record<string, string> = {
  upTorso: "上身",
  uptorso: "上身",
  downTorso: "下身",
  downtorso: "下身",
  upArm: "上臂",
  uparm: "上臂",
  downArm: "前臂",
  downarm: "前臂",
  hand: "手",
  handF: "前手",
  handf: "前手",
  handB: "后手",
  handb: "后手",
  thigh: "大腿",
  crus: "小腿",
  foot: "脚",
  tail: "尾巴",

  wingUL: "翼·左上",
  wingUR: "翼·右上",
  wingDL: "翼·左下",
  wingDR: "翼·右下",

  head: "头（默认）",
  headBack: "头（背面）",
  headback: "头（背面）",
  headBackMouth: "头（背面·张嘴）",
  headBackMouthMini: "头（背面·半张嘴）",
  headDisfigured1: "头（毁容 1）",
  headDisfigured2: "头（毁容 2）",
  headDisfigured3: "头（毁容 3）",
  headDisfigured1Healed: "头（愈合 1）",
  headDisfigured2Healed: "头（愈合 2）",
  headDisfigured3Healed: "头（愈合 3）",
  nosebleed: "流鼻血",
  Nosebleed: "流鼻血",

  eyeOpen: "眼·睁开",
  eyeopen: "眼·睁开",
  eyeClosed: "眼·闭眼",
  eyeclosed: "眼·闭眼",
  eyeHalfClosed: "眼·微闭",
  eyehalfclosed: "眼·微闭",
  eyeHalfClosedBack: "眼·微闭（背）",
  eyehalfclosedback: "眼·微闭（背）",
  eyeSad: "眼·悲伤",
  eyesad: "眼·悲伤",
  eyeSadBack: "眼·悲伤（背）",
  eyesadback: "眼·悲伤（背）",
  eyeHappy: "眼·开心",
  eyehappy: "眼·开心",
  eyeScared: "眼·惊恐",
  eyescared: "眼·惊恐",
  eyeScaredBack: "眼·惊恐（背）",
  eyescaredback: "眼·惊恐（背）",
  eyePanic: "眼·恐慌",
  eyepanic: "眼·恐慌",
  eyeLockedIn: "眼·专注",
  eyelockedin: "眼·专注",
  eyeLockedInBack: "眼·专注（背）",
  eyelockedinback: "眼·专注（背）",
  eyeLookBack: "眼·回望",
  eyelookback: "眼·回望",
  eyeGone: "眼·缺失",
  eyegone: "眼·缺失",
  eyeGoneHealed: "眼·愈合",
  eyegonehealed: "眼·愈合",

  armwarmers: "护臂套",
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
  earmuffs: "耳罩",
  fannypack: "腰包",
  headlamp: "头灯",
  holidayhat: "节日帽",
  hoodie: "连帽衫",
  jetpack: "喷气背包",
  kneepads: "护膝",
  latexgloves: "乳胶手套",
  legpouch: "腿包",
  limbwraps: "肢体绷带",
  liquidpouch: "水袋",
  makeshiftheadlamp: "自制头灯",
  makeshifthelmet: "自制头盔",
  materialpouch: "材料包",
  mercscarf: "佣兵围巾",
  riothelmet: "防暴头盔",
  safetyglasses: "护目镜",
  scarf: "围巾",
  scubadivinggear: "潜水服",
  slingbag: "单肩包",
  smallpack: "小背包",
  sneakers: "运动鞋",
  striderpelt: "行者皮毛",
  tacticalboots: "战术靴",
  tacticalgloves: "战术手套",
  tornshirt: "破衬衫",
  traumarig: "创伤背心",
  waterpouch1: "储水袋",
  woodsandals: "木凉鞋",

  BloodParticle: "血液粒子",
  bloodParticle: "血液粒子",
  BloodParticle_splat: "飞溅血滴",
  limbBlood: "肢体血迹",
};

/** 将部件文件名转换为当前语言的展示名（自动识别 `R_` 朝右前缀及 `F`/`B`/`Alt` 前后侧后缀）。 */
export function localizePartName(rawName: string): string {
  if (rawName.startsWith("R_") && rawName.length > 2) {
    const base = localizePartName(rawName.slice(2));
    return currentLang() === "zh" ? `${base}（朝右）` : `${base} (right)`;
  }
  const zh = currentLang() === "zh";
  if (rawName.endsWith("Alt") && rawName.length > 3) {
    const base = localizePartName(rawName.slice(0, -3));
    return zh ? `${base}（后）` : `${base} (back)`;
  }
  const lemma = stripKnownPrefix(rawName);
  if (zh && ZH_MAP[lemma]) return ZH_MAP[lemma];
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
