/**
 * Market Spirit Traffic Light Visualization
 * Displays TASE market sentiment as a traffic light indicator.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { WidgetLayout, handleSubscriptionRedirect, SubscriptionBanner } from "../components/WidgetLayout";
import { createRoot } from "react-dom/client";
import styles from "./market-spirit-widget.module.css";

type MarketScore = "Defense" | "Selective" | "Attack" | null;

type RegimeType = "weak" | "early" | "healthy" | "overextended";

interface MarketSpiritData {
  tradeDate: string;
  marketType: string;
  score: MarketScore;
  description: string;
  adv: number | null;
  adLine: number | null;
  momentumBreadth?: number;
  moneyFlowBreadth?: number;
  compressionBreadth?: number;
  regime?: RegimeType;
  regimeDescription?: string;
}

function extractMarketSpiritData(callToolResult: CallToolResult | null | undefined): MarketSpiritData | null {
  try {
    if (!callToolResult) return null;
    const textContent = callToolResult.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;
    // ChatGPT double-wraps text content: {"text": "{actual JSON}"} — unwrap if needed
    let parsed = JSON.parse(textContent.text);
    if (parsed && typeof parsed.text === "string" && !parsed.score) {
      parsed = JSON.parse(parsed.text);
    }
    return parsed as MarketSpiritData;
  } catch {
    return null;
  }
}

function MarketSpiritApp() {
  const [data, setData] = useState<MarketSpiritData | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [toolInput, setToolInput] = useState<Record<string, unknown>>({});
  const [subscribeUrl, setSubscribeUrl] = useState<string | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "Market Spirit", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({ });

      app.ontoolinput = async (input) => {
        if (input?.arguments) {
          setToolInput(input.arguments as Record<string, unknown>);
        }
      };

      app.ontoolresult = async (result) => {
        try {
          if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
          const spiritData = extractMarketSpiritData(result);
          if (spiritData) {
            setData(spiritData);
          } else {
            setNeedsAutoFetch(true);
          }
        } catch (e) {
          console.error("ontoolresult error:", e);
        }
      };

      app.ontoolcancelled = () => { };
      app.onerror = console.error;

      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  // Auto-fetch: when ontoolresult couldn't extract data, fetch directly via callServerTool
  useEffect(() => {
    if (!needsAutoFetch || !app) return;
    setNeedsAutoFetch(false);
    if (typeof app.callServerTool !== "function") return;
    try {
      app.callServerTool({ name: "get-market-spirit-data", arguments: toolInput })
        .then((result) => {
          if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
          const fetchedData = extractMarketSpiritData(result);
          if (fetchedData) {
            setData(fetchedData);
          }
        })
        .catch((e) => {
          console.error("Auto-fetch failed:", e);
        });
    } catch (e) {
      console.error("Auto-fetch call threw:", e);
    }
  }, [needsAutoFetch, app, toolInput]);

  useHostStyles(app ?? null);

  useEffect(() => {
    if (app) {
      setHostContext(app.getHostContext());
    }
  }, [app]);

  if (error) return <div className={styles.error}><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div className={styles.loading}>Connecting...</div>;
  if (subscribeUrl !== null) return (
    <WidgetLayout title="TASE Market" app={app} hostContext={hostContext}>
      <SubscriptionBanner subscribeUrl={subscribeUrl} app={app} />
    </WidgetLayout>
  );
  return (
    <MarketSpiritInner
      app={app}
      data={data}
      setData={setData}
      hostContext={hostContext}
    />
  );
}

interface MarketSpiritInnerProps {
  app: App;
  data: MarketSpiritData | null;
  setData: React.Dispatch<React.SetStateAction<MarketSpiritData | null>>;
  hostContext?: McpUiHostContext;
}

function MarketSpiritInner({ app, data, setData, hostContext }: MarketSpiritInnerProps) {
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Clear initial loading state when data first arrives
  useEffect(() => {
    if (data) setIsRefreshing(false);
  }, [data]);

  // Sync date picker with the trade date from data
  useEffect(() => {
    if (data?.tradeDate && !selectedDate) {
      setSelectedDate(data.tradeDate);
    }
  }, [data?.tradeDate, selectedDate]);

  const handleRefresh = useCallback(async (tradeDate?: string) => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const args: Record<string, string> = {};
      if (tradeDate) args.tradeDate = tradeDate;
      const result = await app.callServerTool({
        name: "get-market-spirit-data",
        arguments: args,
      });
      const spiritData = extractMarketSpiritData(result);
      if (spiritData) {
        setData(spiritData);
      } else {
        setRefreshError("No data found for this date");
      }
    } catch (e) {
      console.error("Failed to refresh data:", e);
      setRefreshError("Failed to fetch data");
    } finally {
      setIsRefreshing(false);
    }
  }, [app, setData]);

  const getScoreColor = (score: MarketScore): string => {
    switch (score) {
      case "Defense": return "#ef4444"; // Red
      case "Selective": return "#eab308"; // Yellow
      case "Attack": return "#22c55e"; // Green
      default: return "#6b7280"; // Gray
    }
  };

  const getScoreEmoji = (score: MarketScore): string => {
    switch (score) {
      case "Defense": return "🔴";
      case "Selective": return "🟡";
      case "Attack": return "🟢";
      default: return "⚪";
    }
  };

  const getRegimeColor = (regime?: RegimeType): string => {
    switch (regime) {
      case "weak": return "#ef4444";
      case "early": return "#eab308";
      case "healthy": return "#22c55e";
      case "overextended": return "#f97316";
      default: return "#6b7280";
    }
  };

  const subtitle = data ? `${data.tradeDate} · ${data.marketType}` : undefined;

  return (
    <WidgetLayout title="Market Spirit" subtitle={subtitle} app={app} hostContext={hostContext} titleClassName={styles.title}>

      {data?.regime && (
        <div className={styles.regimeSection}>
          <div
            className={styles.regimeBadge}
            style={{ backgroundColor: getRegimeColor(data.regime) }}
          >
            {data.regime.toUpperCase()}
          </div>
          {data.regimeDescription && (
            <p className={styles.regimeDescription}>{data.regimeDescription}</p>
          )}
        </div>
      )}

      {data && data.momentumBreadth != null && (
        <div className={styles.breadthGauges}>
          <div className={styles.gaugeItem}>
            <span className={styles.gaugeLabel}>Momentum</span>
            <div className={styles.gaugeBar}>
              <div
                className={styles.gaugeFill}
                style={{
                  width: `${Math.min(data.momentumBreadth, 100)}%`,
                  background: getRegimeColor(data.regime),
                }}
              />
            </div>
            <span className={styles.gaugeValue}>{data.momentumBreadth}%</span>
          </div>
          <div className={styles.gaugeItem}>
            <span className={styles.gaugeLabel}>Money Flow</span>
            <div className={styles.gaugeBar}>
              <div
                className={styles.gaugeFill}
                style={{
                  width: `${Math.min(data.moneyFlowBreadth ?? 0, 100)}%`,
                  background: "#3b82f6",
                }}
              />
            </div>
            <span className={styles.gaugeValue}>{data.moneyFlowBreadth ?? 0}%</span>
          </div>
          <div className={styles.gaugeItem}>
            <span className={styles.gaugeLabel}>Compression</span>
            <div className={styles.gaugeBar}>
              <div
                className={styles.gaugeFill}
                style={{
                  width: `${Math.min(data.compressionBreadth ?? 0, 100)}%`,
                  background: "#8b5cf6",
                }}
              />
            </div>
            <span className={styles.gaugeValue}>{data.compressionBreadth ?? 0}%</span>
          </div>
        </div>
      )}

      <div className={styles.trafficLight}>
        <div className={styles.lightContainer}>
          <div
            className={`${styles.light} ${styles.red} ${data?.score === "Defense" ? styles.active : ""}`}
          />
          <div
            className={`${styles.light} ${styles.yellow} ${data?.score === "Selective" ? styles.active : ""}`}
          />
          <div
            className={`${styles.light} ${styles.green} ${data?.score === "Attack" ? styles.active : ""}`}
          />
        </div>
      </div>

      {data && data.score && (
        <div className={styles.scoreInfo}>
          <div
            className={styles.scoreBadge}
            style={{ backgroundColor: getScoreColor(data.score) }}
          >
            {getScoreEmoji(data.score)} {data.score}
          </div>
          <p className={styles.description}>{data.description}</p>
        </div>
      )}

      {data && (data.adv != null || data.adLine != null) && (
        <div className={styles.breadth}>
          <div className={styles.breadthItem}>
            <span className={styles.breadthLabel}>ADV</span>
            <span className={styles.breadthValue} style={{ color: "#22c55e" }}>
              {data.adv != null ? data.adv.toLocaleString() : "—"}
            </span>
          </div>
          <div className={styles.breadthItem}>
            <span className={styles.breadthLabel}>AD Line</span>
            <span className={styles.breadthValue} style={{ color: "#3b82f6" }}>
              {data.adLine != null ? data.adLine.toLocaleString() : "—"}
            </span>
          </div>
        </div>
      )}

      {data && !data.score && (
        <div className={styles.waiting}>No data found for this date</div>
      )}

      {refreshError && (
        <div className={styles.waiting}>{refreshError}</div>
      )}

      <div className={styles.controls}>
        <label className={styles.label}>
          Trade Date:
          <input
            type="date"
            className={styles.select}
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </label>
        <button
          className={styles.refreshButton}
          onClick={() => handleRefresh(selectedDate || undefined)}
          disabled={isRefreshing}
        >
          {isRefreshing ? "Loading..." : "Refresh"}
        </button>
      </div>

      <div className={styles.legend}>
        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.red}`} />
          <span>Defense - Bearish</span>
        </div>
        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.yellow}`} />
          <span>Selective - Neutral</span>
        </div>
        <div className={styles.legendItem}>
          <span className={`${styles.legendDot} ${styles.green}`} />
          <span>Attack - Bullish</span>
        </div>
      </div>
    </WidgetLayout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MarketSpiritApp />
  </StrictMode>,
);
