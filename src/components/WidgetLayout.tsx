import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTheme } from "./useTheme";
import { useLanguage, type Language } from "./useLanguage";
import styles from "./WidgetLayout.module.css";

export type { Language, TFunction } from "./useLanguage";

interface WidgetLayoutProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  app: App;
  hostContext?: McpUiHostContext;
  /** Optional CSS class to add to the title element */
  titleClassName?: string;
  /** Language props — if omitted, WidgetLayout creates its own language state */
  language?: Language;
  dir?: string;
  onLanguageToggle?: () => void;
}

export function WidgetLayout({
  title,
  subtitle,
  children,
  app,
  hostContext,
  titleClassName,
  language: externalLanguage,
  dir: externalDir,
  onLanguageToggle,
}: WidgetLayoutProps) {
  const { theme, toggle } = useTheme();
  const fallbackLang = useLanguage();
  const [displayMode, setDisplayMode] = useState<"inline" | "fullscreen">("inline");

  // Use external language props if provided, otherwise fall back to own hook
  const language = externalLanguage ?? fallbackLang.language;
  const direction = externalDir ?? fallbackLang.dir;
  const langToggle = onLanguageToggle ?? fallbackLang.toggle;
  const t = fallbackLang.t;

  const isFullscreenAvailable =
    hostContext?.availableDisplayModes?.includes("fullscreen") ?? false;

  const toggleFullscreen = useCallback(async () => {
    const newMode = displayMode === "fullscreen" ? "inline" : "fullscreen";
    try {
      const result = await app.requestDisplayMode({ mode: newMode });
      setDisplayMode(result.mode as "inline" | "fullscreen");
    } catch (e) {
      console.error("Failed to toggle fullscreen:", e);
    }
  }, [app, displayMode]);

  useEffect(() => {
    if (hostContext?.displayMode) {
      setDisplayMode(hostContext.displayMode as "inline" | "fullscreen");
    }
  }, [hostContext?.displayMode]);

  return (
    <main
      className={`${styles.main} ${displayMode === "fullscreen" ? styles.fullscreen : ""}`}
      dir={direction}
      style={{
        paddingTop: hostContext?.safeAreaInsets?.top,
        paddingRight: hostContext?.safeAreaInsets?.right,
        paddingBottom: hostContext?.safeAreaInsets?.bottom,
        paddingLeft: hostContext?.safeAreaInsets?.left,
      }}
    >
      <div className={styles.header}>
        <div>
          <h1 className={titleClassName ?? styles.title}>{title}</h1>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.langToggle}
            onClick={langToggle}
            title={language === "en" ? "Switch to עברית" : "Switch to English"}
          >
            {language === "en" ? "עב" : "EN"}
          </button>
          <button
            className={styles.themeToggle}
            onClick={toggle}
            title={theme === "dark" ? t("layout.switchToLight") : t("layout.switchToDark")}
          >
            {theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19"}
          </button>
          {isFullscreenAvailable && (
            <button
              className={styles.fullscreenButton}
              onClick={toggleFullscreen}
              title={displayMode === "fullscreen" ? t("layout.exitFullscreen") : t("layout.fullscreen")}
            >
              {displayMode === "fullscreen" ? t("layout.exitFullscreen") : t("layout.fullscreen")}
            </button>
          )}
        </div>
      </div>
      <div className={styles.content}>{children}</div>
    </main>
  );
}
