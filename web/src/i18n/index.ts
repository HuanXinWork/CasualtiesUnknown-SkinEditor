// 前端轻量双语查询（zh / en）与语言变更订阅。

import { sessionStore } from "../stateStore";
import { en } from "./en";
import type { Lang, Translations } from "./types";
import { zh } from "./zh";

export type { Lang, Translations };

export const dictionaries: Record<Lang, Translations> = { zh, en };

function lookup(dict: Translations, key: string): string | undefined {
  const parts = key.split(".");
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

export function currentLang(): Lang {
  const v = sessionStore.getState().lang;
  return v === "en" ? "en" : "zh";
}

export function t(key: string, lang?: Lang): string {
  const useLang = lang ?? currentLang();
  return lookup(dictionaries[useLang], key) ?? lookup(dictionaries.zh, key) ?? key;
}

export function subscribeLang(cb: (lang: Lang) => void): () => void {
  let last = currentLang();
  return sessionStore.subscribe(() => {
    const next = currentLang();
    if (next !== last) {
      last = next;
      cb(next);
    }
  });
}
