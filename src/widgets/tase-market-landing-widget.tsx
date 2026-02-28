/**
 * Subscription Landing Page Widget
 * Shows available tools and a subscribe button for users without a subscription.
 */
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useEffect, useState } from "react";
import { WidgetLayout } from "../components/WidgetLayout";
import { createRoot } from "react-dom/client";
import styles from "./tase-market-landing-widget.module.css";

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

const TOOL_GROUPS = [
  {
    title: "Market",
    tools: [
      { icon: "\u{1F4CA}", name: "Market Dashboard", description: "Single-page overview combining market spirit, top movers, and uptrend count", prompt: "call show-market-dashboard-widget" },
      { icon: "\u{1F6A6}", name: "Market Spirit", description: "Traffic light indicator for market conditions", prompt: "call show-market-spirit-widget" },
      { icon: "\u{1F4C8}", name: "Market End of Day", description: "Full market data with prices, volume, and technical indicators", prompt: "call show-market-end-of-day-widget" },
      { icon: "\u{2B06}\u{FE0F}", name: "Market Uptrend Symbols", description: "Symbols in uptrend with EZ values", prompt: "call show-market-uptrend-symbols-widget" },
      { icon: "\u{1F5FA}\u{FE0F}", name: "Market Sector Heatmap", description: "Treemap heatmap by sector, sub-sector, and symbol", prompt: "call show-market-sector-heatmap-widget" },
    ],
  },
  {
    title: "My Position",
    tools: [
      { icon: "\u{1F4CB}", name: "My Positions Manager", description: "Add, edit, and delete portfolio positions", prompt: "call show-my-positions-manager-widget" },
      { icon: "\u{1F4CA}", name: "My Position Table", description: "Portfolio EOD table with period selector", prompt: "call show-my-position-table-widget" },
      { icon: "\u{1F4C8}", name: "My Position End of Day", description: "Portfolio data across date ranges", prompt: "call show-my-position-end-of-day-widget" },
      { icon: "\u{1F56F}\u{FE0F}", name: "My Position Candlestick", description: "Multi-symbol candlestick with sidebar", prompt: "call show-my-position-candlestick-widget" },
    ],
  },
  {
    title: "Symbols",
    tools: [
      { icon: "\u{1F4CA}", name: "Symbols Table", description: "EOD table for any symbols with period selector", prompt: "call show-symbols-table-widget" },
      { icon: "\u{1F50D}", name: "Symbols End of Day", description: "Data for specific symbols across date ranges", prompt: "call show-symbols-end-of-day-widget" },
      { icon: "\u{1F56F}\u{FE0F}", name: "Symbols Candlestick", description: "Multi-symbol candlestick for any symbols", prompt: "call show-symbols-candlestick-widget" },
      { icon: "\u{1F56F}\u{FE0F}", name: "Symbol Candlestick", description: "Single-symbol candlestick chart", prompt: "call show-symbol-candlestick-widget" },
    ],
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

function hasToken(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).searchParams.has("token");
  } catch {
    return false;
  }
}

function SubscriptionInner({ data, hostContext, app }: SubscriptionInnerProps) {
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  const connectedUrl = hasToken(data?.subscribeUrl) ? data!.subscribeUrl : null;

  return (
    <WidgetLayout title="Tel Aviv Stock Exchange (TASE)" app={app} hostContext={hostContext} titleClassName={styles.title}>
      <div className={styles.header}>
        <h2 className={styles.title2}>TASE Market Tools</h2>
        <p className={styles.subtitle}>Data Analysis, Using AI</p>
      </div>

      <div className={styles.tabsContainer}>
        <div className={styles.tabBar}>
          {TOOL_GROUPS.map((group, i) => (
            <button
              key={group.title}
              className={`${styles.tab} ${i === activeTab ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(i)}
            >
              {group.title}
            </button>
          ))}
        </div>
        <div className={styles.tabPanel}>
          {TOOL_GROUPS[activeTab].tools.map((tool) => (
            <button
              key={tool.name}
              className={styles.featureCard}
              onClick={async () => {
                try {
                  await app.sendMessage({
                    role: "user",
                    content: [{ type: "text", text: tool.prompt }],
                  });
                } catch (e) {
                  console.error("sendMessage failed:", e);
                }
              }}
            >
              <span className={styles.featureIcon}>{tool.icon}</span>
              <span className={styles.featureName}>{tool.name}</span>
              <span className={styles.featureDescription}>{tool.description}</span>
            </button>
          ))}
        </div>
      </div>

      {connectedUrl ? (
        <div className={styles.cta}>
          <button
            className={styles.subscribeButton}
            onClick={async () => {
              try {
                const result = await app.openLink({ url: connectedUrl });
                if (result?.isError) {
                  await navigator.clipboard.writeText(connectedUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }
              } catch {
                try {
                  await navigator.clipboard.writeText(connectedUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  const el = document.getElementById("subscribe-url");
                  if (el) {
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    const sel = window.getSelection();
                    sel?.removeAllRanges();
                    sel?.addRange(range);
                  }
                }
              }
            }}
          >
            {copied ? "Copied!" : data?.needsSubscription ? "Subscribe Now" : "Subscription"}
          </button>
        </div>
      ) : (
        <div className={styles.notConnected}>
          <p>Go to the server to subscribe and access all tools.</p>
        </div>
      )}

      <footer className={styles.footer}>
        {(() => {
          const hv = app.getHostVersion();
          return hv ? <div className={styles.debugHost}>Host: {hv.name} v{hv.version}</div> : null;
        })()}
        <button
          className={styles.companyLink}
          onClick={async () => {
            try {
              const result = await app.openLink({ url: "https://www.lobix.ai" });
              if (result?.isError) {
                await navigator.clipboard.writeText("https://www.lobix.ai");
              }
            } catch {
              try {
                await navigator.clipboard.writeText("https://www.lobix.ai");
              } catch { /* ignore */ }
            }
          }}
        >
          www.lobix.ai
        </button>
      </footer>
    </WidgetLayout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SubscriptionApp />
  </StrictMode>,
);
