/**
 * Market Momentum Scanner Widget
 * Displays scored and classified momentum symbols with persistence filtering.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { WidgetLayout, handleSubscriptionRedirect, SubscriptionBanner } from "../components/WidgetLayout";
import { createRoot } from "react-dom/client";
import styles from "./market-momentum-widget.module.css";

interface MomentumSymbolItem {
  symbol: string;
  companyName: string | null;
  dailyScore: number;
  trendQuality: number;
  leaderScore: number;
  persistence: "strong" | "confirmed" | "new";
  phase: "compression" | "early" | "expansion" | "extended";
  isLeader: boolean;
  isCompression: boolean;
  ez: number;
  rsi14: number | null;
  bandWidth20: number | null;
  mfi14: number | null;
}

interface MomentumData {
  tradeDate: string;
  marketType: string;
  count: number;
  items: MomentumSymbolItem[];
}

type TabKey = "all" | "strong" | "confirmed" | "new" | "compression";

function extractMomentumData(callToolResult: CallToolResult | null | undefined): MomentumData | null {
  try {
    if (!callToolResult) return null;
    const textContent = callToolResult.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;
    let parsed = JSON.parse(textContent.text);
    if (parsed && typeof parsed.text === "string" && !parsed.items) {
      parsed = JSON.parse(parsed.text);
    }
    const data = parsed as MomentumData;
    if (!Array.isArray(data.items)) return null;
    return data;
  } catch {
    return null;
  }
}

const PHASE_COLORS: Record<string, { bg: string; color: string }> = {
  compression: { bg: "rgba(139, 92, 246, 0.2)", color: "#a78bfa" },
  early: { bg: "rgba(59, 130, 246, 0.2)", color: "#60a5fa" },
  expansion: { bg: "rgba(34, 197, 94, 0.2)", color: "#4ade80" },
  extended: { bg: "rgba(239, 68, 68, 0.2)", color: "#f87171" },
};

function MomentumWidget() {
  const [data, setData] = useState<MomentumData | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [toolInput, setToolInput] = useState<Record<string, unknown>>({});
  const [subscribeUrl, setSubscribeUrl] = useState<string | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "Market Momentum", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});

      app.ontoolinput = async (input) => {
        if (input?.arguments) {
          setToolInput(input.arguments as Record<string, unknown>);
        }
      };

      app.ontoolresult = async (result) => {
        try {
          if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
          const momentumData = extractMomentumData(result);
          if (momentumData) {
            setData(momentumData);
          } else {
            setNeedsAutoFetch(true);
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

  useEffect(() => {
    if (!needsAutoFetch || !app) return;
    setNeedsAutoFetch(false);
    if (typeof app.callServerTool !== "function") return;
    try {
      app.callServerTool({ name: "get-market-momentum-data", arguments: toolInput })
        .then((result) => {
          if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
          const fetchedData = extractMomentumData(result);
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
    <MomentumWidgetInner
      app={app}
      data={data}
      setData={setData}
      hostContext={hostContext}
    />
  );
}

interface MomentumWidgetInnerProps {
  app: App;
  data: MomentumData | null;
  setData: React.Dispatch<React.SetStateAction<MomentumData | null>>;
  hostContext?: McpUiHostContext;
}

function MomentumWidgetInner({ app, data, setData, hostContext }: MomentumWidgetInnerProps) {
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("all");

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
        name: "get-market-momentum-data",
        arguments: args,
      });
      if (handleSubscriptionRedirect(result, app)) return;
      const momentumData = extractMomentumData(result);
      if (momentumData) {
        setData(momentumData);
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

  const counts = useMemo(() => {
    if (!data) return { strong: 0, confirmed: 0, new: 0, leaders: 0, compression: 0 };
    return {
      strong: data.items.filter((i) => i.persistence === "strong").length,
      confirmed: data.items.filter((i) => i.persistence === "confirmed").length,
      new: data.items.filter((i) => i.persistence === "new").length,
      leaders: data.items.filter((i) => i.isLeader).length,
      compression: data.items.filter((i) => i.isCompression).length,
    };
  }, [data]);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    switch (activeTab) {
      case "strong": return data.items.filter((i) => i.persistence === "strong");
      case "confirmed": return data.items.filter((i) => i.persistence === "confirmed");
      case "new": return data.items.filter((i) => i.persistence === "new");
      case "compression": return data.items.filter((i) => i.isCompression);
      default: return data.items;
    }
  }, [data, activeTab]);

  const subtitle = data ? `${data.tradeDate} · ${data.marketType}` : undefined;

  return (
    <WidgetLayout title="Momentum Scanner" subtitle={subtitle} app={app} hostContext={hostContext} titleClassName={styles.title}>

      {data && (
        <div className={styles.stats}>
          <div className={styles.statBadge}>
            <span className={styles.statNumber} style={{ color: "#22c55e" }}>{counts.strong}</span>
            <span className={styles.statLabel}>Strong</span>
          </div>
          <div className={styles.statBadge}>
            <span className={styles.statNumber} style={{ color: "#3b82f6" }}>{counts.confirmed}</span>
            <span className={styles.statLabel}>Confirmed</span>
          </div>
          <div className={styles.statBadge}>
            <span className={styles.statNumber} style={{ color: "#f59e0b" }}>{counts.new}</span>
            <span className={styles.statLabel}>New</span>
          </div>
          <div className={styles.statBadge}>
            <span className={styles.statNumber} style={{ color: "#ef4444" }}>{counts.leaders}</span>
            <span className={styles.statLabel}>Leaders</span>
          </div>
          <div className={styles.statBadge}>
            <span className={styles.statNumber} style={{ color: "#8b5cf6" }}>{counts.compression}</span>
            <span className={styles.statLabel}>Compression</span>
          </div>
        </div>
      )}

      {data && (
        <div className={styles.tabs}>
          {([
            ["all", `All (${data.count})`],
            ["strong", `Strong (${counts.strong})`],
            ["confirmed", `Confirmed (${counts.confirmed})`],
            ["new", `New (${counts.new})`],
            ["compression", `Compression (${counts.compression})`],
          ] as [TabKey, string][]).map(([key, label]) => (
            <button
              key={key}
              className={`${styles.tab} ${activeTab === key ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {data && filteredItems.length > 0 && (
        <div className={styles.symbolsContainer}>
          <div className={styles.symbolsGrid}>
            {filteredItems.map((item) => {
              const phaseStyle = PHASE_COLORS[item.phase] ?? { bg: "transparent", color: "inherit" };
              return (
                <div key={item.symbol} className={styles.symbolCard}>
                  <div className={styles.symbolHeader}>
                    <span className={styles.symbolName}>{item.symbol}</span>
                    <span
                      className={styles.phaseBadge}
                      style={{ background: phaseStyle.bg, color: phaseStyle.color }}
                    >
                      {item.phase}
                    </span>
                  </div>
                  {item.companyName && (
                    <span className={styles.companyName}>{item.companyName}</span>
                  )}
                  <div className={styles.scores}>
                    <span className={styles.scoreItem}>
                      DS:<span className={styles.scoreValue}>{item.dailyScore}</span>
                    </span>
                    <span className={styles.scoreItem}>
                      TQ:<span className={styles.scoreValue}>{item.trendQuality}</span>
                    </span>
                    <span className={styles.scoreItem}>
                      LS:<span className={styles.scoreValue}>{item.leaderScore}</span>
                    </span>
                  </div>
                  <div className={styles.indicators}>
                    <span className={styles.indicator}>EZ:{item.ez.toFixed(1)}%</span>
                    {item.rsi14 != null && <span className={styles.indicator}>RSI:{item.rsi14.toFixed(0)}</span>}
                    {item.mfi14 != null && <span className={styles.indicator}>MFI:{item.mfi14.toFixed(0)}</span>}
                    {item.bandWidth20 != null && <span className={styles.indicator}>BW:{(item.bandWidth20 * 100).toFixed(1)}%</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data && filteredItems.length === 0 && (
        <div className={styles.empty}>No symbols in this category.</div>
      )}

      {refreshError && (
        <div className={styles.waiting}>{refreshError}</div>
      )}

      {!data && !refreshError && (
        <div className={styles.waiting}>Waiting for data...</div>
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
    </WidgetLayout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MomentumWidget />
  </StrictMode>,
);
