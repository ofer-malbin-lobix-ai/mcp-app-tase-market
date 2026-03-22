import { useCallback, useEffect, useState } from "react";
import { translations, type TranslationKey } from "./translations";

export type Language = "en" | "he";
export type TFunction = (key: TranslationKey) => string;

const STORAGE_KEY = "tase-language";

const LANG_CHANGE_EVENT = "tase-language-change";

export function useLanguage() {
  const [language, setLanguage] = useState<Language>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "he" || stored === "en") return stored;
    } catch {
      // ignore
    }
    return "en";
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, language);
    } catch {
      // ignore
    }
  }, [language]);

  useEffect(() => {
    const handler = (e: Event) => {
      const lang = (e as CustomEvent<Language>).detail;
      setLanguage(lang);
    };
    window.addEventListener(LANG_CHANGE_EVENT, handler);
    return () => window.removeEventListener(LANG_CHANGE_EVENT, handler);
  }, []);

  const toggle = useCallback(() => {
    setLanguage((prev) => {
      const next = prev === "en" ? "he" : "en";
      window.dispatchEvent(
        new CustomEvent(LANG_CHANGE_EVENT, { detail: next }),
      );
      return next;
    });
  }, []);

  const t: TFunction = useCallback(
    (key: TranslationKey) => {
      const entry = translations[key];
      if (!entry) return key;
      return entry[language];
    },
    [language],
  );

  const dir = language === "he" ? "rtl" : "ltr";

  return { language, t, dir, toggle } as const;
}
