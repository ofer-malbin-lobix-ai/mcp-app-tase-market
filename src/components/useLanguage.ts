import { useCallback, useEffect, useState } from "react";
import { translations, type TranslationKey } from "./translations";

export type Language = "en" | "he";
export type TFunction = (key: TranslationKey) => string;

const STORAGE_KEY = "tase-language";

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

  const toggle = useCallback(() => {
    setLanguage((prev) => (prev === "en" ? "he" : "en"));
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
