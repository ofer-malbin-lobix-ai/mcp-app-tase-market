import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTheme } from "./useTheme";
import styles from "./WidgetLayout.module.css";

interface WidgetLayoutProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
  app: App;
  hostContext?: McpUiHostContext;
  /** Optional CSS class to add to the title element */
  titleClassName?: string;
}

export function WidgetLayout({
  title,
  subtitle,
  children,
  app,
  hostContext,
  titleClassName,
}: WidgetLayoutProps) {
  const { theme, toggle } = useTheme();
  const [displayMode, setDisplayMode] = useState<"inline" | "fullscreen">("inline");

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
            className={styles.themeToggle}
            onClick={toggle}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? "\u2600\uFE0F" : "\uD83C\uDF19"}
          </button>
          {isFullscreenAvailable && (
            <button
              className={styles.fullscreenButton}
              onClick={toggleFullscreen}
              title={displayMode === "fullscreen" ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {displayMode === "fullscreen" ? "Exit Fullscreen" : "Fullscreen"}
            </button>
          )}
        </div>
      </div>
      {children}
    </main>
  );
}
