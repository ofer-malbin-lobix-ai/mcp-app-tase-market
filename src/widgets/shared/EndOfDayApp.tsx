/**
 * Shared End of Day Widget Component (single date picker)
 * Used by all 4 end-of-day widgets: market, symbols, my-position, watchlist.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DataTable } from "../../components/DataTable";
import type { NavItem } from "../../components/NavRow";
import { NavRow } from "../../components/NavRow";
import { WidgetLayout, handleSubscriptionRedirect, SubscriptionBanner } from "../../components/WidgetLayout";
import { useLanguage } from "../../components/useLanguage";
import styles from "./end-of-day-widget.module.css";

import type { EndOfDayWidgetData, StockData } from "./end-of-day-shared";
import {
  INITIAL_COLUMN_VISIBILITY,
  TOOL_TITLE_KEYS,
  createEndOfDayColumns,
  deriveTitle,
  extractEndOfDayData,
  formatVolume,
} from "./end-of-day-shared";

// Re-export types for backward compatibility
export type { EndOfDayWidgetData, StockData } from "./end-of-day-shared";

export interface EndOfDayAppConfig {
  toolName: string;
  isMarketView?: boolean;
  passSymbolsOnRefresh?: boolean;
  navButtons?: NavItem[];
}

// --- App component ---

function EndOfDayApp({ config }: { config: EndOfDayAppConfig }) {
  const [data, setData] = useState<EndOfDayWidgetData | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [toolInput, setToolInput] = useState<Record<string, unknown>>({});
  const [subscribeUrl, setSubscribeUrl] = useState<string | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: deriveTitle(config.toolName), version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});

      app.ontoolinput = async (input) => {
        console.info("Received tool call input:", input);
        if (input?.arguments) {
          setToolInput(input.arguments as Record<string, unknown>);
        }
      };

      app.ontoolresult = async (result) => {
        try {
          if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
          const extracted = extractEndOfDayData(result);
          if (extracted) {
            setData(extracted);
          } else {
            setNeedsAutoFetch(true);
          }
        } catch (e) {
          console.error("ontoolresult error:", e);
        }
      };

      app.ontoolcancelled = (params) => {
        console.info("Tool call cancelled:", params.reason);
      };

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
    app.callServerTool({ name: config.toolName, arguments: toolInput })
      .then((result) => {
        if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
        const fetched = extractEndOfDayData(result);
        if (fetched) setData(fetched);
      })
      .catch((e) => console.error("Auto-fetch failed:", e));
  }, [needsAutoFetch, app, config.toolName, toolInput]);

  useHostStyles(app ?? null);

  useEffect(() => {
    if (app) setHostContext(app.getHostContext());
  }, [app]);

  if (error) return <div className={styles.error}><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div className={styles.loading}>Connecting...</div>;
  if (subscribeUrl !== null) return (
    <WidgetLayout title="TASE Market" app={app} hostContext={hostContext}>
      <SubscriptionBanner subscribeUrl={subscribeUrl} app={app} />
    </WidgetLayout>
  );

  return (
    <EndOfDayInner
      app={app}
      data={data}
      setData={setData}
      hostContext={hostContext}
      config={config}
    />
  );
}

// --- Inner component ---

function EndOfDayInner({
  app,
  data,
  setData,
  hostContext,
  config,
}: {
  app: App;
  data: EndOfDayWidgetData | null;
  setData: React.Dispatch<React.SetStateAction<EndOfDayWidgetData | null>>;
  hostContext?: McpUiHostContext;
  config: EndOfDayAppConfig;
}) {
  const { language, dir, toggle, t } = useLanguage();
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedMarketType, setSelectedMarketType] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Clear initial loading state when data first arrives
  useEffect(() => {
    if (data) setIsRefreshing(false);
  }, [data]);

  // Sync date from data
  const dateValue = data?.tradeDate || data?.dateFrom || "";
  useEffect(() => {
    if (dateValue && !selectedDate) setSelectedDate(dateValue);
  }, [dateValue, selectedDate]);

  // Sync market type from data (market widget only)
  useEffect(() => {
    if (data?.marketType && !selectedMarketType) setSelectedMarketType(data.marketType);
  }, [data?.marketType, selectedMarketType]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const args: Record<string, unknown> = {};
      if (selectedDate) args.tradeDate = selectedDate;
      if (config.isMarketView && selectedMarketType) args.marketType = selectedMarketType;
      if (config.passSymbolsOnRefresh && data?.symbols?.length) args.symbols = data.symbols;
      const result = await app.callServerTool({ name: config.toolName, arguments: args });
      if (handleSubscriptionRedirect(result, app)) return;
      const extracted = extractEndOfDayData(result);
      if (extracted) {
        setData(extracted);
      } else {
        setRefreshError(t("eod.noDataFound"));
      }
    } catch (e) {
      console.error("Failed to refresh data:", e);
      setRefreshError(t("eod.failedToFetch"));
    } finally {
      setIsRefreshing(false);
    }
  }, [app, config, data, selectedDate, selectedMarketType, setData]);

  // CRITICAL: Memoize columns to prevent infinite re-renders
  const columns = useMemo(
    () => createEndOfDayColumns(app, config.isMarketView, t),
    [app, config.isMarketView, t]
  );

  // CRITICAL: Memoize rows to prevent infinite re-renders
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);

  // Track filtered rows from DataTable for summary
  const [filteredRows, setFilteredRows] = useState<StockData[]>([]);
  const handleFilteredRowsChange = useCallback((rows: StockData[]) => {
    setFilteredRows(rows);
  }, []);

  // Calculate market summary from filtered rows (falls back to all rows)
  const summaryRows = filteredRows.length > 0 ? filteredRows : rows;
  const marketSummary = useMemo(() => ({
    totalStocks: summaryRows.length,
    gainers: summaryRows.filter(row => (row.changeValue ?? 0) > 0).length,
    losers: summaryRows.filter(row => (row.changeValue ?? 0) < 0).length,
    totalVolume: summaryRows.reduce((sum, row) => sum + Number(row.volume ?? 0), 0),
  }), [summaryRows]);

  const subtitle = data
    ? config.isMarketView
      ? `${data.tradeDate}${data.marketType ? ` \u00b7 ${data.marketType}` : ""}`
      : `${data.symbols?.length ? data.symbols.join(", ") : "All symbols"} \u00b7 ${data.dateFrom ?? ""}`
    : undefined;

  return (
    <WidgetLayout title={(TOOL_TITLE_KEYS[config.toolName] ? t(TOOL_TITLE_KEYS[config.toolName] as any) : "") || deriveTitle(config.toolName)} subtitle={subtitle} app={app} hostContext={hostContext} language={language} dir={dir} onLanguageToggle={toggle}>
      {config.navButtons && config.navButtons.length > 0 && (
        <NavRow app={app} items={config.navButtons} />
      )}
      {data && (
        <div className={styles.summary}>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{t("eod.totalStocks")}</div>
            <div className={styles.summaryValue}>{marketSummary.totalStocks}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{t("eod.gainers")}</div>
            <div className={`${styles.summaryValue} ${styles.gainers}`}>{marketSummary.gainers}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{t("eod.losers")}</div>
            <div className={`${styles.summaryValue} ${styles.losers}`}>{marketSummary.losers}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{t("eod.totalVolume")}</div>
            <div className={styles.summaryValue}>{formatVolume(marketSummary.totalVolume)}</div>
          </div>
        </div>
      )}

      <div className={styles.controls}>
        <label className={styles.dateLabel}>
          {config.isMarketView ? t("eod.tradeDate") : t("eod.date")}
          <input
            type="date"
            className={styles.dateInput}
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </label>
        {config.isMarketView && (
          <label className={styles.dateLabel}>
            {t("eod.marketType")}
            <select
              className={styles.dateInput}
              value={selectedMarketType}
              onChange={(e) => setSelectedMarketType(e.target.value)}
            >
              <option value="">{"\u2014"}</option>
              <option value="STOCK">Stock</option>
              <option value="BOND">Bond</option>
              <option value="TASE UP STOCK">TASE UP Stock</option>
              <option value="LOAN">Loan</option>
            </select>
          </label>
        )}
        <button
          className={styles.refreshButton}
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? t("eod.loading") : t("eod.refresh")}
        </button>
      </div>

      {refreshError && <div className={styles.loading}>{refreshError}</div>}

      {data && rows.length === 0 ? (
        <div className={styles.loading}>{t("eod.noRowsFound")}</div>
      ) : data ? (
        <DataTable
          data={rows}
          columns={columns}
          initialPageSize={50}
          storageKey={`tase-${config.toolName.replace(/^get-/, "").replace(/-data$/, "")}-column-visibility`}
          initialColumnVisibility={INITIAL_COLUMN_VISIBILITY}
          onFilteredRowsChange={handleFilteredRowsChange}
        />
      ) : null}
    </WidgetLayout>
  );
}

// --- Entry point helper ---

export function renderEndOfDayApp(config: EndOfDayAppConfig) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <EndOfDayApp config={config} />
    </StrictMode>
  );
}
