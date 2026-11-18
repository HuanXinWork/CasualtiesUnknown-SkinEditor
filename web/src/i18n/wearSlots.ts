// 游戏穿戴槽位 ID 到当前语言显示名的映射（对齐 SkinSync `SkinSyncI18n.slot.*`）。
import { currentLang } from "./index";

export const WEAR_SLOT_IDS = [
  "arms", "back", "balaclava", "bandolier", "belt", "blindfold", "eyes", "feet",
  "hands", "hat", "knees", "mouth", "neck", "outertorso", "thigh", "thighback",
  "torso", "torsofront", "wraps",
] as const;

const ZH: Record<string, string> = {
  arms: "臂套", back: "背部", balaclava: "头套", bandolier: "弹链", belt: "腰带",
  blindfold: "眼罩", eyes: "眼镜", feet: "鞋子", hands: "手套", hat: "帽子",
  knees: "护膝", mouth: "口罩", neck: "项圈", outertorso: "外衣", thigh: "护腿（前）",
  thighback: "护腿（后）", torso: "上衣", torsofront: "胸甲", wraps: "绷带",
};

const EN: Record<string, string> = {
  arms: "Arms", back: "Back", balaclava: "Balaclava", bandolier: "Bandolier", belt: "Belt",
  blindfold: "Blindfold", eyes: "Eyewear", feet: "Feet", hands: "Hands", hat: "Hat",
  knees: "Knees", mouth: "Mouth", neck: "Neck", outertorso: "Outer torso", thigh: "Thigh (front)",
  thighback: "Thigh (back)", torso: "Torso", torsofront: "Torso front", wraps: "Wraps",
};

export function localizeWearSlot(id: string): string {
  if (!id) return "";
  const map = currentLang() === "zh" ? ZH : EN;
  return map[id] ?? id;
}
