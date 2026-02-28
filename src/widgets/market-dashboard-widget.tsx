/**
 * Market Dashboard Portal Widget
 * Combines Market Spirit, End-of-Day stats, and Uptrend Symbols in one view.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./market-dashboard-widget.module.css";

// ---------- Types ----------

type MarketScore = "Defense" | "Selective" | "Attack" | null;

interface MarketSpiritData {
  tradeDate: string;
  marketType: string;
  score: MarketScore;
  description: string;
  adv: number | null;
  adLine: number | null;
}

interface StockRow {
  symbol: string;
  change: number | null;
  volume: number | null;
  turnover: number | null;
  closingPrice: number | null;
}

interface EndOfDayData {
  tradeDate: string;
  marketType: string | null;
  count: number;
  rows: StockRow[];
}

interface UptrendData {
  tradeDate: string;
  marketType: string;
  count: number;
  items: { symbol: string; ez: number }[];
}

interface DashboardState {
  spirit: MarketSpiritData | null;
  eod: EndOfDayData | null;
  uptrend: UptrendData | null;
  spiritError: string | null;
  eodError: string | null;
  uptrendError: string | null;
}

// ---------- Data extraction helpers ----------

function extractFromResult<T>(result: CallToolResult | null | undefined): T | null {
  try {
    if (!result) return null;
    const textContent = result.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;
    // ChatGPT double-wraps text content — unwrap if needed
    let parsed = JSON.parse(textContent.text);
    if (parsed && typeof parsed.text === "string" && !parsed.items && !parsed.rows && !parsed.score) {
      parsed = JSON.parse(parsed.text);
    }
    return parsed as T;
  } catch {
    return null;
  }
}

// ---------- Computed helpers ----------

function numChange(r: StockRow): number {
  return Number(r.change ?? 0);
}

function avgChange(rows: StockRow[]): number {
  const valid = rows.filter((r) => r.change != null);
  if (valid.length === 0) return 0;
  return valid.reduce((sum, r) => sum + numChange(r), 0) / valid.length;
}

function totalVolume(rows: StockRow[]): number {
  return rows.reduce((sum, r) => {
    const v = Number(r.turnover ?? r.volume ?? 0);
    return sum + (isFinite(v) ? v : 0);
  }, 0);
}

function formatVolume(v: number): string {
  if (!isFinite(v)) return "—";
  if (v >= 1e9) return (v / 1e9).toFixed(1) + "B";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toLocaleString();
}

// ---------- Main App ----------

function DashboardApp() {
  const [data, setData] = useState<DashboardState>({
    spirit: null, eod: null, uptrend: null,
    spiritError: null, eodError: null, uptrendError: null,
  });
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [toolInput, setToolInput] = useState<Record<string, unknown>>({});
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "Market Dashboard", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});

      app.ontoolinput = async (input) => {
        if (input?.arguments) {
          setToolInput(input.arguments as Record<string, unknown>);
        }
      };

      app.ontoolresult = async () => {
        // Show tool returns summary text only — always auto-fetch
        setNeedsAutoFetch(true);
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
    fetchAllData(app, toolInput, setData);
  }, [needsAutoFetch, app, toolInput]);

  useHostStyles(app ?? null);

  useEffect(() => {
    if (app) setHostContext(app.getHostContext());
  }, [app]);

  if (error) return <div className={styles.error}><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div className={styles.loading}>Connecting...</div>;

  return (
    <DashboardInner
      app={app}
      data={data}
      setData={setData}
      hostContext={hostContext}
    />
  );
}

// ---------- Fetch all data in parallel ----------

async function fetchAllData(
  app: App,
  args: Record<string, unknown>,
  setData: React.Dispatch<React.SetStateAction<DashboardState>>,
) {
  const callArgs: Record<string, string> = {};
  if (args.tradeDate) callArgs.tradeDate = args.tradeDate as string;
  if (args.marketType) callArgs.marketType = args.marketType as string;

  const [spiritResult, eodResult, uptrendResult] = await Promise.allSettled([
    app.callServerTool({ name: "get-market-spirit-data", arguments: callArgs }),
    app.callServerTool({ name: "get-market-end-of-day-data", arguments: callArgs }),
    app.callServerTool({ name: "get-market-uptrend-symbols-data", arguments: callArgs }),
  ]);

  setData({
    spirit: spiritResult.status === "fulfilled" ? extractFromResult<MarketSpiritData>(spiritResult.value) : null,
    eod: eodResult.status === "fulfilled" ? extractFromResult<EndOfDayData>(eodResult.value) : null,
    uptrend: uptrendResult.status === "fulfilled" ? extractFromResult<UptrendData>(uptrendResult.value) : null,
    spiritError: spiritResult.status === "rejected" ? "Failed to load" : null,
    eodError: eodResult.status === "rejected" ? "Failed to load" : null,
    uptrendError: uptrendResult.status === "rejected" ? "Failed to load" : null,
  });
}

// ---------- Inner component ----------

interface DashboardInnerProps {
  app: App;
  data: DashboardState;
  setData: React.Dispatch<React.SetStateAction<DashboardState>>;
  hostContext?: McpUiHostContext;
}

function DashboardInner({ app, data, setData, hostContext }: DashboardInnerProps) {
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [displayMode, setDisplayMode] = useState<"inline" | "fullscreen">("inline");

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

  // Sync date from first available data source
  useEffect(() => {
    if (!selectedDate) {
      const date = data.spirit?.tradeDate || data.eod?.tradeDate || data.uptrend?.tradeDate;
      if (date) setSelectedDate(date);
    }
  }, [data.spirit?.tradeDate, data.eod?.tradeDate, data.uptrend?.tradeDate, selectedDate]);

  const handleRefresh = useCallback(async (tradeDate?: string) => {
    setIsRefreshing(true);
    const args: Record<string, unknown> = {};
    if (tradeDate) args.tradeDate = tradeDate;
    try {
      await fetchAllData(app, args, setData);
    } finally {
      setIsRefreshing(false);
    }
  }, [app, setData]);

  const hasAnyData = data.spirit || data.eod || data.uptrend;
  const tradeDate = data.spirit?.tradeDate || data.eod?.tradeDate || data.uptrend?.tradeDate;

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
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>Market Dashboard</h1>
          {tradeDate && <div className={styles.subtitle}>{tradeDate}</div>}
        </div>
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

      {!hasAnyData && (
        <div className={styles.grid}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      )}

      {hasAnyData && (
        <div className={styles.grid}>
          <SpiritCard spirit={data.spirit} error={data.spiritError} />
          <StatsCard eod={data.eod} error={data.eodError} />
          <UptrendCard uptrend={data.uptrend} error={data.uptrendError} />
          <GainersCard eod={data.eod} error={data.eodError} />
          <LosersCard eod={data.eod} error={data.eodError} />
        </div>
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
    </main>
  );
}

// ---------- Card components ----------

function SkeletonCard() {
  return (
    <div className={styles.card}>
      <div className={styles.skeleton} style={{ width: "40%" }} />
      <div className={styles.skeleton} style={{ width: "80%" }} />
      <div className={styles.skeleton} style={{ width: "60%" }} />
    </div>
  );
}

function SpiritCard({ spirit, error }: { spirit: MarketSpiritData | null; error: string | null }) {
  const getScoreColor = (score: MarketScore): string => {
    switch (score) {
      case "Defense": return "#ef4444";
      case "Selective": return "#eab308";
      case "Attack": return "#22c55e";
      default: return "#6b7280";
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>Market Spirit</div>
      {error && <div className={styles.cardError}>{error}</div>}
      {!spirit && !error && <div className={styles.skeleton} />}
      {spirit && (
        <>
          <div className={styles.spiritRow}>
            <div className={styles.trafficLightHorizontal}>
              <div className={`${styles.dot} ${styles.red} ${spirit.score === "Defense" ? styles.active : ""}`} />
              <div className={`${styles.dot} ${styles.yellow} ${spirit.score === "Selective" ? styles.active : ""}`} />
              <div className={`${styles.dot} ${styles.green} ${spirit.score === "Attack" ? styles.active : ""}`} />
            </div>
            {spirit.score && (
              <span className={styles.scoreBadge} style={{ backgroundColor: getScoreColor(spirit.score) }}>
                {spirit.score}
              </span>
            )}
          </div>
          {(spirit.adv != null || spirit.adLine != null) && (
            <div className={styles.spiritMeta}>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>ADV</span>
                <span className={styles.metaValue} style={{ color: "#22c55e" }}>
                  {spirit.adv != null ? spirit.adv.toLocaleString() : "\u2014"}
                </span>
              </div>
              <div className={styles.metaItem}>
                <span className={styles.metaLabel}>AD Line</span>
                <span className={styles.metaValue} style={{ color: "#3b82f6" }}>
                  {spirit.adLine != null ? spirit.adLine.toLocaleString() : "\u2014"}
                </span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatsCard({ eod, error }: { eod: EndOfDayData | null; error: string | null }) {
  return (
    <div className={styles.card}>
      <div className={styles.cardTitle}>Market Stats</div>
      {error && <div className={styles.cardError}>{error}</div>}
      {!eod && !error && <div className={styles.skeleton} />}
      {eod && (
        <div className={styles.statsGrid}>
          <div className={styles.statItem}>
            <div className={styles.statValue}>{eod.count}</div>
            <div className={styles.statLabel}>Total Stocks</div>
          </div>
          <div className={styles.statItem}>
            <div className={styles.statValue} style={{ color: avgChange(eod.rows) >= 0 ? "#22c55e" : "#ef4444" }}>
              {avgChange(eod.rows).toFixed(2)}%
            </div>
            <div className={styles.statLabel}>Avg Change</div>
          </div>
          <div className={styles.statItem}>
            <div className={styles.statValue}>{formatVolume(totalVolume(eod.rows))}</div>
            <div className={styles.statLabel}>Total Turnover</div>
          </div>
        </div>
      )}
    </div>
  );
}

function UptrendCard({ uptrend, error }: { uptrend: UptrendData | null; error: string | null }) {
  const [showAll, setShowAll] = useState(false);
  const sorted = uptrend?.items.slice().sort((a, b) => a.ez - b.ez) ?? [];
  const displayed = showAll ? sorted : sorted.slice(0, 5);

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>Uptrend Symbols</div>
        {uptrend && sorted.length > 5 && (
          <button className={styles.viewAllButton} onClick={() => setShowAll(!showAll)}>
            {showAll ? "Top 5" : `View All (${sorted.length})`}
          </button>
        )}
      </div>
      {error && <div className={styles.cardError}>{error}</div>}
      {!uptrend && !error && <div className={styles.skeleton} />}
      {uptrend && (
        <>
          <div className={styles.spiritRow}>
            <div className={styles.uptrendValue}>{uptrend.count}</div>
            <div className={styles.uptrendLabel}>symbols in uptrend</div>
          </div>
          {displayed.length > 0 && (
            <table className={styles.miniTable}>
              <thead>
                <tr><th>Symbol</th><th>EZ %</th></tr>
              </thead>
              <tbody>
                {displayed.map((item) => (
                  <tr key={item.symbol}>
                    <td>{item.symbol}</td>
                    <td className={styles.positive}>{item.ez.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function GainersCard({ eod, error }: { eod: EndOfDayData | null; error: string | null }) {
  const [showAll, setShowAll] = useState(false);
  const allGainers = eod ? eod.rows.filter((r) => r.change != null).sort((a, b) => numChange(b) - numChange(a)).filter((r) => numChange(r) > 0) : [];
  const displayed = showAll ? allGainers : allGainers.slice(0, 5);

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>Top Gainers</div>
        {eod && allGainers.length > 5 && (
          <button className={styles.viewAllButton} onClick={() => setShowAll(!showAll)}>
            {showAll ? "Top 5" : `View All (${allGainers.length})`}
          </button>
        )}
      </div>
      {error && <div className={styles.cardError}>{error}</div>}
      {!eod && !error && <div className={styles.skeleton} />}
      {eod && (
        <table className={styles.miniTable}>
          <thead>
            <tr><th>Symbol</th><th>Change %</th></tr>
          </thead>
          <tbody>
            {displayed.map((r) => (
              <tr key={r.symbol}>
                <td>{r.symbol}</td>
                <td className={styles.positive}>+{numChange(r).toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function LosersCard({ eod, error }: { eod: EndOfDayData | null; error: string | null }) {
  const [showAll, setShowAll] = useState(false);
  const allLosers = eod ? eod.rows.filter((r) => r.change != null).sort((a, b) => numChange(a) - numChange(b)).filter((r) => numChange(r) < 0) : [];
  const displayed = showAll ? allLosers : allLosers.slice(0, 5);

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardTitle}>Top Losers</div>
        {eod && allLosers.length > 5 && (
          <button className={styles.viewAllButton} onClick={() => setShowAll(!showAll)}>
            {showAll ? "Top 5" : `View All (${allLosers.length})`}
          </button>
        )}
      </div>
      {error && <div className={styles.cardError}>{error}</div>}
      {!eod && !error && <div className={styles.skeleton} />}
      {eod && (
        <table className={styles.miniTable}>
          <thead>
            <tr><th>Symbol</th><th>Change %</th></tr>
          </thead>
          <tbody>
            {displayed.map((r) => (
              <tr key={r.symbol}>
                <td>{r.symbol}</td>
                <td className={styles.negative}>{numChange(r).toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---------- Mount ----------

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DashboardApp />
  </StrictMode>,
);
