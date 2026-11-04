import { createContext, useContext } from "react";

export type Lang = "ko" | "en";

const KEY = "glpfit.lang.v1";

export function loadLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "ko" || saved === "en") return saved;
  } catch {
    // Fall through to the browser language.
  }
  return typeof navigator !== "undefined" &&
    navigator.language?.startsWith("ko")
    ? "ko"
    : "en";
}

export function saveLang(lang: Lang) {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    // Remember for this session only.
  }
  document.documentElement.lang = lang;
}

/** Inline pairs keep each string next to its translation: tr("체중", "Weight"). */
export type Tr = (ko: string, en: string) => string;

export function makeTr(lang: Lang): Tr {
  return (ko, en) => (lang === "ko" ? ko : en);
}

export const LangContext = createContext<{ lang: Lang; tr: Tr }>({
  lang: "ko",
  tr: makeTr("ko"),
});

export function useTr() {
  return useContext(LangContext);
}
