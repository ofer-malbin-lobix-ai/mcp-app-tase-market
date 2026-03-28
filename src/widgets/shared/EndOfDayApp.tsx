/**
 * Shared End of Day Widget Component (single date picker)
 * Used by all 5 end-of-day widgets: market, index, symbols, my-position, watchlist.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { DataTable } from "../../components/DataTable";
import type { NavItem } from "../../components/NavRow";
import { SectorGroupedTable } from "../../components/SectorGroupedTable";
import { NavRow } from "../../components/NavRow";
import { SearchableSelect } from "../../components/SearchableSelect";
import { WidgetLayout, handleSubscriptionRedirect, SubscriptionBanner } from "../../components/WidgetLayout";
import { useLanguage } from "../../components/useLanguage";
// @ts-ignore — JSON import
import indicesData from "../../data/indices.json";
import styles from "./end-of-day-widget.module.css";

import type { EndOfDayWidgetData, StockData } from "./end-of-day-shared";
import {
  INITIAL_COLUMN_VISIBILITY,
  TOOL_TITLE_KEYS,
  createEndOfDayColumns,
  deriveTitle,
  extractEndOfDayData,
  formatPercent,
  formatVolume,
} from "./end-of-day-shared";

// Re-export types for backward compatibility
export type { EndOfDayWidgetData, StockData } from "./end-of-day-shared";

export interface EndOfDayAppConfig {
  toolName: string;
  isMarketView?: boolean;
  showIndexFilter?: boolean;
  defaultIndexId?: number;
  passSymbolsOnRefresh?: boolean;
  navButtons?: NavItem[];
  groupBySector?: boolean;
}

// --- App component ---

function EndOfDayApp({ config }: { config: EndOfDayAppConfig }) {
  const { t } = useLanguage();
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
  if (!app) return <div className={styles.loading}>{t("layout.connecting")}</div>;
  if (subscribeUrl !== null) return (
    <WidgetLayout title="TASE Market" app={app} hostContext={hostContext}>
      <SubscriptionBanner subscribeUrl={subscribeUrl} app={app} />
    </WidgetLayout>
  );

  const initialIndexId = config.showIndexFilter
    ? (toolInput.indexId != null ? String(toolInput.indexId) : String(config.defaultIndexId ?? 137))
    : undefined;

  return (
    <EndOfDayInner
      app={app}
      data={data}
      setData={setData}
      hostContext={hostContext}
      config={config}
      initialIndexId={initialIndexId}
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
  initialIndexId,
}: {
  app: App;
  data: EndOfDayWidgetData | null;
  setData: React.Dispatch<React.SetStateAction<EndOfDayWidgetData | null>>;
  hostContext?: McpUiHostContext;
  config: EndOfDayAppConfig;
  initialIndexId?: string;
}) {
  const { language, dir, toggle, t } = useLanguage();
  const [selectedDate, setSelectedDate] = useState("");
  const hasDateSynced = useRef(false);
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [selectedIndexId, setSelectedIndexId] = useState(initialIndexId ?? "");

  // Index selector options (language-aware, stock indices only)
  const indexSelectOptions = useMemo(() => {
    if (!config.showIndexFilter) return [];
    const lang = language as "en" | "he";
    const list = (indicesData as Record<string, { index: number; indexName: string }[]>)[lang] ?? (indicesData as any).en;
    return list
      .filter((idx: { index: number }) => idx.index < 500)
      .map((idx: { index: number; indexName: string }) => ({ value: String(idx.index), label: idx.indexName }));
  }, [config.showIndexFilter, language]);

  // Clear initial loading state when data first arrives
  useEffect(() => {
    if (data) setIsRefreshing(false);
  }, [data]);

  // Sync date from data
  const dateValue = data?.tradeDate || data?.dateFrom || "";
  useEffect(() => {
    if (dateValue && !selectedDate) {
      setSelectedDate(dateValue);
      hasDateSynced.current = true;
    }
  }, [dateValue, selectedDate]);

  // Auto-refresh when user changes the date
  useEffect(() => {
    if (!hasDateSynced.current) {
      hasDateSynced.current = true;
      return;
    }
    if (selectedDate) handleRefresh();
  }, [selectedDate]);

  const handleRefresh = useCallback(async (indexIdOverride?: string) => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const args: Record<string, unknown> = {};
      if (selectedDate) args.tradeDate = selectedDate;
      if (config.passSymbolsOnRefresh && data?.symbols?.length) args.symbols = data.symbols;
      const idxId = indexIdOverride ?? selectedIndexId;
      if (config.showIndexFilter && idxId) args.indexId = Number(idxId);
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
  }, [app, config, data, selectedDate, selectedIndexId, setData]);

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

  // Calculate market summary from filtered rows (falls back to index-filtered rows)
  const summaryRows = filteredRows.length > 0 ? filteredRows : rows;
  const marketSummary = useMemo(() => {
    const changedRows = summaryRows.filter(row => row.change != null);
    const avgChange = changedRows.length > 0
      ? changedRows.reduce((sum, row) => sum + (row.change ?? 0), 0) / changedRows.length
      : 0;
    return {
      totalStocks: summaryRows.length,
      gainers: summaryRows.filter(row => (row.changeValue ?? 0) > 0).length,
      losers: summaryRows.filter(row => (row.changeValue ?? 0) < 0).length,
      avgChange,
      totalTurnover: summaryRows.reduce((sum, row) => sum + Number(row.turnover ?? 0), 0),
    };
  }, [summaryRows]);

  // Index change handler — fetch immediately on index change
  const handleIndexChange = useCallback((val: string) => {
    setSelectedIndexId(val);
    handleRefresh(val);
  }, [handleRefresh]);

  const subtitle = data
    ? config.isMarketView
      ? data.tradeDate
      : config.showIndexFilter
        ? data.tradeDate
        : `${data.symbols?.length ? data.symbols.join(", ") : t("eod.allSymbols")} \u00b7 ${data.dateFrom ?? ""}`
    : undefined;

  return (
    <WidgetLayout title={(TOOL_TITLE_KEYS[config.toolName] ? t(TOOL_TITLE_KEYS[config.toolName] as any) : "") || deriveTitle(config.toolName)} subtitle={subtitle} app={app} hostContext={hostContext} language={language} dir={dir} onLanguageToggle={toggle}>
      {config.navButtons && config.navButtons.length > 0 && (
        <NavRow app={app} items={config.navButtons} />
      )}
      {data && (
        <div className={styles.summary}>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{t("eod.constituents")}</div>
            <div className={styles.summaryValue}>{marketSummary.totalStocks}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{t("eod.advancers")}</div>
            <div className={`${styles.summaryValue} ${styles.gainers}`}>{marketSummary.gainers}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{t("eod.decliners")}</div>
            <div className={`${styles.summaryValue} ${styles.losers}`}>{marketSummary.losers}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{t("eod.avgChange")}</div>
            <div className={`${styles.summaryValue} ${marketSummary.avgChange > 0 ? styles.gainers : marketSummary.avgChange < 0 ? styles.losers : ""}`}>{formatPercent(marketSummary.avgChange)}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{t("eod.totalTurnover")}</div>
            <div className={styles.summaryValue}>{formatVolume(marketSummary.totalTurnover)} ₪</div>
          </div>
        </div>
      )}

      <div className={styles.controls}>
        {config.showIndexFilter && (
          <div>
            <SearchableSelect
              options={indexSelectOptions}
              value={selectedIndexId}
              onChange={handleIndexChange}
              placeholder={t("indexEod.selectIndex")}
            />
          </div>
        )}
        <label className={styles.dateLabel}>
          {config.isMarketView ? t("eod.tradeDate") : t("eod.date")}
          <input
            type="date"
            className={styles.dateInput}
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </label>
        <button
          className={styles.refreshButton}
          onClick={() => handleRefresh()}
          disabled={isRefreshing}
        >
          {isRefreshing ? t("eod.loading") : t("eod.refresh")}
        </button>
      </div>

      {refreshError && <div className={styles.loading}>{refreshError}</div>}

      {data ? (
        config.groupBySector ? (
          <SectorGroupedTable data={rows} app={app} t={t} />
        ) : (
          <DataTable
            data={rows}
            columns={columns}
            initialPageSize={50}
            storageKey={`tase-${config.toolName.replace(/^get-/, "").replace(/-data$/, "")}-column-visibility`}
            initialColumnVisibility={INITIAL_COLUMN_VISIBILITY}
            onFilteredRowsChange={handleFilteredRowsChange}
          />
        )
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
