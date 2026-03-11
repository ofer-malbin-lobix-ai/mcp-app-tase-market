import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useTheme } from "./useTheme";
import styles from "./WidgetLayout.module.css";

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
export function SubscriptionBanner({ subscribeUrl, app }: { subscribeUrl: string; app: App }) {
  const [copied, setCopied] = useState(false);

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
        Subscription Required
      </div>
      <div style={{ fontSize: "13px", color: "var(--t-text-secondary, #666)", maxWidth: "280px" }}>
        Subscribe to access all TASE Market tools and data.
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
        {copied ? "Link Copied!" : "Subscribe"}
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
