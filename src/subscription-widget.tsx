/**
 * Subscription Landing Page Widget
 * Shows available tools and a subscribe button for users without a subscription.
 */
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./subscription-widget.module.css";

interface SubscriptionData {
  subscribeUrl: string;
  needsSubscription?: boolean;
}

function extractSubscriptionData(callToolResult: CallToolResult | null | undefined): SubscriptionData | null {
  try {
    if (!callToolResult) return null;
    const textContent = callToolResult.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;
    // ChatGPT double-wraps text content: {"text": "{actual JSON}"} — unwrap if needed
    let parsed = JSON.parse(textContent.text);
    if (parsed && typeof parsed.text === "string" && !parsed.subscribeUrl) {
      parsed = JSON.parse(parsed.text);
    }
    if (parsed?.subscribeUrl) return parsed as SubscriptionData;
    return null;
  } catch {
    return null;
  }
}

const FEATURES = [
  {
    icon: "\u{1F4CA}",
    name: "Market Dashboard",
    description: "Single-page overview combining market spirit, top movers, and uptrend count.",
  },
  {
    icon: "\u{1F6A6}",
    name: "Market Spirit",
    description: "Traffic light indicator showing bearish, neutral, or bullish market conditions.",
  },
  {
    icon: "\u{1F4C8}",
    name: "End of Day Data",
    description: "Full market data with prices, volume, and technical indicators for all symbols.",
  },
  {
    icon: "\u{2B06}\u{FE0F}",
    name: "Uptrend Symbols",
    description: "Symbols currently in uptrend with EZ values showing distance from SMA20.",
  },
  {
    icon: "\u{1F56F}\u{FE0F}",
    name: "Symbol Candlestick",
    description: "Candlestick charts with OHLCV data for individual symbols over a date range.",
  },
  {
    icon: "\u{1F50D}",
    name: "End of Day Symbols",
    description: "Detailed data for specific symbols across custom date ranges.",
  },
];

function SubscriptionApp() {
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "TASE Data Hub", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});

      app.ontoolresult = async (result) => {
        try {
          const subData = extractSubscriptionData(result);
          if (subData) {
            setData(subData);
          }
        } catch (e) {
          console.error("ontoolresult error:", e);
        }
      };

      app.ontoolcancelled = () => {};
      app.onerror = console.error;

      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  useHostStyles(app ?? null);

  useEffect(() => {
    if (app) {
      setHostContext(app.getHostContext());
    }
  }, [app]);

  if (error) return <div className={styles.error}><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div className={styles.loading}>Connecting...</div>;

  return <SubscriptionInner data={data} hostContext={hostContext} app={app} />;
}

interface SubscriptionInnerProps {
  data: SubscriptionData | null;
  hostContext?: McpUiHostContext;
  app: NonNullable<ReturnType<typeof useApp>["app"]>;
}

function SubscriptionInner({ data, hostContext, app }: SubscriptionInnerProps) {
  const [displayMode, setDisplayMode] = useState<"inline" | "fullscreen">("inline");
  const [copied, setCopied] = useState(false);

  const isFullscreenAvailable = hostContext?.availableDisplayModes?.includes("fullscreen") ?? false;

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
      <div className={styles.headerRow}>
        <div />
        <div />
        {isFullscreenAvailable ? (
          <button
            className={styles.fullscreenButton}
            onClick={toggleFullscreen}
            title={displayMode === "fullscreen" ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {displayMode === "fullscreen" ? "Exit Fullscreen" : "Fullscreen"}
          </button>
        ) : <div />}
      </div>

      <div className={styles.header}>
        <h1 className={styles.title}>TASE Data Hub</h1>
        <p className={styles.subtitle}>Access Tel Aviv Stock Exchange market data</p>
      </div>

      <div className={styles.featuresGrid}>
        {FEATURES.map((feature) => (
          <div key={feature.name} className={styles.featureCard}>
            <span className={styles.featureIcon}>{feature.icon}</span>
            <span className={styles.featureName}>{feature.name}</span>
            <span className={styles.featureDescription}>{feature.description}</span>
          </div>
        ))}
      </div>

      <div className={styles.cta}>
        {data?.subscribeUrl ? (
          <>
            <button
              className={styles.subscribeButton}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(data.subscribeUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  // Fallback: select the URL text
                  const el = document.getElementById("subscribe-url");
                  if (el) {
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    const sel = window.getSelection();
                    sel?.removeAllRanges();
                    sel?.addRange(range);
                  }
                }
              }}
            >
              {copied ? "Copied!" : "Copy Subscribe Link"}
            </button>
            <div className={styles.urlBox} id="subscribe-url">
              {data.subscribeUrl}
            </div>
          </>
        ) : (
          <span className={styles.subscribeButton} style={{ opacity: 0.5, pointerEvents: "none" }}>
            Subscribe Now
          </span>
        )}
        <span className={styles.pricing}>Plans start at \u20AA35/month</span>
      </div>

      {!data && (
        <div className={styles.waiting}>Waiting for subscription info...</div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SubscriptionApp />
  </StrictMode>,
);
