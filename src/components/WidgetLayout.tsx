import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTheme } from "./useTheme";
import { useLanguage, type Language, type TFunction } from "./useLanguage";
import styles from "./WidgetLayout.module.css";

export type { Language, TFunction } from "./useLanguage";

/**
 * Check if a CallToolResult contains a subscription redirect.
 * Returns true if `needsSubscription: true` was detected.
 * Sets the subscribeUrl via the provided setter.
 */
export function handleSubscriptionRedirect(
  result: CallToolResult | null | undefined,
  _app: App | null,
  setSubscribeUrl?: (url: string) => void,
): boolean {
  try {
    if (!result) return false;
    const textContent = result.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return false;
    let parsed = JSON.parse(textContent.text);
    // ChatGPT double-wraps text content
    if (parsed && typeof parsed.text === "string" && !parsed.needsSubscription) {
      parsed = JSON.parse(parsed.text);
    }
    if (parsed?.needsSubscription) {
      setSubscribeUrl?.(parsed.subscribeUrl ?? "");
      return true;
    }
  } catch { /* ignore parse errors */ }
  return false;
}

/**
 * Subscription required banner — shown inside any widget when user has no active subscription.
 * Opens the subscribe URL directly via app.openLink, with clipboard fallback.
 */
export function SubscriptionBanner({ subscribeUrl, app, t: externalT }: { subscribeUrl: string; app: App; t?: TFunction }) {
  const [copied, setCopied] = useState(false);
  const fallback = useLanguage();
  const t = externalT ?? fallback.t;

  const handleSubscribe = async () => {
    if (!subscribeUrl) return;
    try {
      await app.openLink({ url: subscribeUrl });
    } catch {
      // Fallback: copy to clipboard
      try {
        await navigator.clipboard.writeText(subscribeUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 3000);
      } catch { /* */ }
    }
  };

  return (
    <div style={{
      padding: "32px 16px",
      textAlign: "center",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: "16px",
    }}>
      <div style={{ fontSize: "15px", fontWeight: 500, color: "var(--t-text-primary, #333)" }}>
        {t("layout.subscriptionRequired")}
      </div>
      <div style={{ fontSize: "13px", color: "var(--t-text-secondary, #666)", maxWidth: "280px" }}>
        {t("layout.subscriptionDescription")}
      </div>
      <button
        onClick={handleSubscribe}
        style={{
          padding: "10px 24px",
          borderRadius: "8px",
          border: "none",
          background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
          color: "#fff",
          fontWeight: 600,
          fontSize: "14px",
          cursor: "pointer",
        }}
      >
        {copied ? t("layout.linkCopied") : t("layout.subscribe")}
      </button>
    </div>
  );
}

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
            {language === "en" ? "EN" : "עב"}
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
      {children}
    </main>
  );
}
