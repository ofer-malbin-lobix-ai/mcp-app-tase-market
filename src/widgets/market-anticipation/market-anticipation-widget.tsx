/**
 * Market Anticipation Scanner Widget (Stage 0)
 * Displays pre-uptrend setups identified via Stochastic %K/%D signals.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { WidgetLayout, handleSubscriptionRedirect, SubscriptionBanner } from "../../components/WidgetLayout";
import { useLanguage } from "../../components/useLanguage";
import { createRoot } from "react-dom/client";
import styles from "./market-anticipation-widget.module.css";

interface AnticipationSignal {
  type: "A" | "B" | "C";
  label: string;
}

interface AnticipationSymbolItem {
  symbol: string;
  companyName: string | null;
  stage0Score: number;
  priority: "HIGH" | "WATCH" | "RADAR";
  signals: AnticipationSignal[];
  stochK14: number | null;
  stochD14: number | null;
  rsi14: number | null;
  macdHist: number | null;
  bandWidth20: number | null;
  sma20AboveSma50: boolean;
  closeAboveSma200: boolean;
}

interface AnticipationData {
  tradeDate: string;
  marketType: string;
  count: number;
  items: AnticipationSymbolItem[];
}

type TabKey = "all" | "HIGH" | "WATCH" | "RADAR";

function extractAnticipationData(callToolResult: CallToolResult | null | undefined): AnticipationData | null {
  try {
    if (!callToolResult) return null;
    const textContent = callToolResult.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;
    let parsed = JSON.parse(textContent.text);
    if (parsed && typeof parsed.text === "string" && !parsed.items) {
      parsed = JSON.parse(parsed.text);
    }
    const data = parsed as AnticipationData;
    if (!Array.isArray(data.items)) return null;
    return data;
  } catch {
    return null;
  }
}

const PRIORITY_COLORS: Record<string, string> = {
  HIGH: "#ef4444",
  WATCH: "#eab308",
  RADAR: "#6b7280",
};

const SIGNAL_COLORS: Record<string, { bg: string; color: string }> = {
  A: { bg: "rgba(239, 68, 68, 0.2)", color: "#f87171" },
  B: { bg: "rgba(234, 179, 8, 0.2)", color: "#facc15" },
  C: { bg: "rgba(139, 92, 246, 0.2)", color: "#a78bfa" },
};

function AnticipationWidget() {
  const { t } = useLanguage();
  const [data, setData] = useState<AnticipationData | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [toolInput, setToolInput] = useState<Record<string, unknown>>({});
  const [subscribeUrl, setSubscribeUrl] = useState<string | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "Market Anticipation", version: "1.0.0" },
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
          const anticipationData = extractAnticipationData(result);
          if (anticipationData) {
            setData(anticipationData);
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
      app.callServerTool({ name: "get-market-anticipation-data", arguments: toolInput })
        .then((result) => {
          if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
          const fetchedData = extractAnticipationData(result);
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
  if (!app) return <div className={styles.loading}>{t("layout.connecting")}</div>;
  if (subscribeUrl !== null) return (
    <WidgetLayout title="TASE Market" app={app} hostContext={hostContext}>
      <SubscriptionBanner subscribeUrl={subscribeUrl} app={app} />
    </WidgetLayout>
  );

  return (
    <AnticipationWidgetInner
      app={app}
      data={data}
      setData={setData}
      hostContext={hostContext}
    />
  );
}

interface AnticipationWidgetInnerProps {
  app: App;
  data: AnticipationData | null;
  setData: React.Dispatch<React.SetStateAction<AnticipationData | null>>;
  hostContext?: McpUiHostContext;
}

function AnticipationWidgetInner({ app, data, setData, hostContext }: AnticipationWidgetInnerProps) {
  const { language, dir, toggle, t } = useLanguage();
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("all");

  useEffect(() => {
    if (data) setIsRefreshing(false);
  }, [data]);

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
        name: "get-market-anticipation-data",
        arguments: args,
      });
      if (handleSubscriptionRedirect(result, app)) return;
      const anticipationData = extractAnticipationData(result);
      if (anticipationData) {
        setData(anticipationData);
      } else {
        setRefreshError(t("spirit.noData"));
      }
    } catch (e) {
      console.error("Failed to refresh data:", e);
      setRefreshError(t("eod.failedToFetch"));
    } finally {
      setIsRefreshing(false);
    }
  }, [app, setData]);

  const counts = useMemo(() => {
    if (!data) return { HIGH: 0, WATCH: 0, RADAR: 0 };
    return {
      HIGH: data.items.filter((i) => i.priority === "HIGH").length,
      WATCH: data.items.filter((i) => i.priority === "WATCH").length,
      RADAR: data.items.filter((i) => i.priority === "RADAR").length,
    };
  }, [data]);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    if (activeTab === "all") return data.items;
    return data.items.filter((i) => i.priority === activeTab);
  }, [data, activeTab]);

  const subtitle = data ? `${data.tradeDate} · ${data.marketType}` : undefined;

  return (
    <WidgetLayout title={t("home.tool.marketAnticipation")} subtitle={subtitle} app={app} hostContext={hostContext} titleClassName={styles.title} language={language} dir={dir} onLanguageToggle={toggle}>

      {data && (
        <div className={styles.stats}>
          <div className={styles.statBadge}>
            <span className={styles.statNumber} style={{ color: "#ef4444" }}>{counts.HIGH}</span>
            <span className={styles.statLabel}>HIGH</span>
          </div>
          <div className={styles.statBadge}>
            <span className={styles.statNumber} style={{ color: "#eab308" }}>{counts.WATCH}</span>
            <span className={styles.statLabel}>WATCH</span>
          </div>
          <div className={styles.statBadge}>
            <span className={styles.statNumber} style={{ color: "#6b7280" }}>{counts.RADAR}</span>
            <span className={styles.statLabel}>RADAR</span>
          </div>
        </div>
      )}

      {data && (
        <div className={styles.tabs}>
          {([
            ["all", `${t("momentum.all")} (${data.count})`],
            ["HIGH", `HIGH (${counts.HIGH})`],
            ["WATCH", `WATCH (${counts.WATCH})`],
            ["RADAR", `RADAR (${counts.RADAR})`],
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
            {filteredItems.map((item) => (
              <div key={item.symbol} className={styles.symbolCard}>
                <div className={styles.symbolHeader}>
                  <span className={styles.symbolName}>{item.symbol}</span>
                  <span
                    className={styles.priorityBadge}
                    style={{ background: PRIORITY_COLORS[item.priority] }}
                  >
                    {item.priority}
                  </span>
                </div>
                {item.companyName && (
                  <span className={styles.companyName}>{item.companyName}</span>
                )}
                <div className={styles.signals}>
                  {item.signals.map((sig, i) => {
                    const sigStyle = SIGNAL_COLORS[sig.type] ?? { bg: "transparent", color: "inherit" };
                    return (
                      <span
                        key={i}
                        className={styles.signalBadge}
                        style={{ background: sigStyle.bg, color: sigStyle.color }}
                      >
                        {sig.type}: {sig.label}
                      </span>
                    );
                  })}
                </div>
                <div className={styles.scores}>
                  <span className={styles.scoreItem}>
                    S0:<span className={styles.scoreValue}>{item.stage0Score}</span>
                  </span>
                </div>
                <div className={styles.indicators}>
                  {item.stochK14 != null && <span className={styles.indicator}>%K:{item.stochK14.toFixed(0)}</span>}
                  {item.stochD14 != null && <span className={styles.indicator}>%D:{item.stochD14.toFixed(0)}</span>}
                  {item.rsi14 != null && <span className={styles.indicator}>RSI:{item.rsi14.toFixed(0)}</span>}
                  {item.bandWidth20 != null && <span className={styles.indicator}>BW:{(item.bandWidth20 * 100).toFixed(1)}%</span>}
                </div>
                <div className={styles.structureBadges}>
                  {item.sma20AboveSma50 && <span className={styles.structureBadge}>SMA20&gt;50</span>}
                  {item.closeAboveSma200 && <span className={styles.structureBadge}>Close&gt;SMA200</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && filteredItems.length === 0 && (
        <div className={styles.empty}>{t("momentum.noSymbols")}</div>
      )}

      {refreshError && (
        <div className={styles.waiting}>{refreshError}</div>
      )}

      <div className={styles.controls}>
        <label className={styles.label}>
          {t("eod.tradeDate")}
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
          {isRefreshing ? t("eod.loading") : t("eod.refresh")}
        </button>
      </div>
    </WidgetLayout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AnticipationWidget />
  </StrictMode>,
);
