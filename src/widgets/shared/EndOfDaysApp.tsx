/**
 * Shared End of Days Widget Component (date range: dateFrom + dateTo)
 * Used by date-range widgets like symbol-end-of-days.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DataTable } from "../../components/DataTable";
import { RefreshButton } from "../../components/RefreshButton";
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

export interface EndOfDaysAppConfig {
  toolName: string;
}

// Override column visibility for single-symbol date-range views:
// Hide redundant Symbol/Company/Sector, show Date
const DAYS_COLUMN_VISIBILITY: Record<string, boolean> = {
  ...INITIAL_COLUMN_VISIBILITY,
  symbol: false,
  companyName: false,
  sector: false,
  tradeDate: true,
};

// --- App component ---

function EndOfDaysApp({ config }: { config: EndOfDaysAppConfig }) {
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

  return (
    <EndOfDaysInner
      app={app}
      data={data}
      setData={setData}
      hostContext={hostContext}
      config={config}
      toolInput={toolInput}
    />
  );
}

// --- Inner component ---

function EndOfDaysInner({
  app,
  data,
  setData,
  hostContext,
  config,
  toolInput,
}: {
  app: App;
  data: EndOfDayWidgetData | null;
  setData: React.Dispatch<React.SetStateAction<EndOfDayWidgetData | null>>;
  hostContext?: McpUiHostContext;
  config: EndOfDaysAppConfig;
  toolInput: Record<string, unknown>;
}) {
  const { language, dir, toggle, t } = useLanguage();
  const [selectedDateFrom, setSelectedDateFrom] = useState("");
  const [selectedDateTo, setSelectedDateTo] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Clear initial loading state when data first arrives
  useEffect(() => {
    if (data) setIsRefreshing(false);
  }, [data]);

  // Sync dates from data
  useEffect(() => {
    if (data?.dateFrom && !selectedDateFrom) setSelectedDateFrom(data.dateFrom);
  }, [data?.dateFrom, selectedDateFrom]);

  useEffect(() => {
    if (data?.dateTo && !selectedDateTo) setSelectedDateTo(data.dateTo);
  }, [data?.dateTo, selectedDateTo]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const args: Record<string, unknown> = {};
      if (selectedDateFrom) args.dateFrom = selectedDateFrom;
      if (selectedDateTo) args.dateTo = selectedDateTo;
      // Always re-send symbol from original toolInput
      if (toolInput.symbol) args.symbol = toolInput.symbol;
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
  }, [app, config, toolInput, selectedDateFrom, selectedDateTo, setData]);

  // Always show date column for date-range widgets
  const columns = useMemo(
    () => createEndOfDayColumns(app, true, t),
    [app, t]
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

  // Subtitle: "TEVA · 2026-01-01 → 2026-03-06" with tooltip on symbol showing company/sector/subsector
  const subtitle = useMemo(() => {
    if (!data) return undefined;
    const symbol = data.symbols?.[0] ?? "";
    const first = rows[0];
    const tooltipParts: string[] = [];
    if (first?.companyName) tooltipParts.push(`${t("eod.company")} ${first.companyName}`);
    if (first?.sector) tooltipParts.push(`${t("eod.sector")} ${first.sector}`);
    if (first?.subSector) tooltipParts.push(`${t("eod.subSector")} ${first.subSector}`);
    const tooltip = tooltipParts.join("\n");
    const dateRange = `${data.dateFrom ?? ""} \u2192 ${data.dateTo ?? ""}`;
    if (!symbol) return dateRange;
    return (
      <>
        <span title={tooltip || undefined} style={{ cursor: tooltip ? "help" : undefined }}>{symbol}</span>
        {" \u00b7 "}{dateRange}
      </>
    );
  }, [data, rows]);

  return (
    <WidgetLayout title={(TOOL_TITLE_KEYS[config.toolName] ? t(TOOL_TITLE_KEYS[config.toolName] as any) : "") || deriveTitle(config.toolName)} subtitle={subtitle} app={app} hostContext={hostContext} language={language} dir={dir} onLanguageToggle={toggle}>
      {data && (
        <>
          <div className={styles.summary}>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>{t("eod.tradingDays")}</div>
              <div className={styles.summaryValue}>{marketSummary.totalStocks}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>{t("eod.upDays")}</div>
              <div className={`${styles.summaryValue} ${styles.gainers}`}>{marketSummary.gainers}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>{t("eod.downDays")}</div>
              <div className={`${styles.summaryValue} ${styles.losers}`}>{marketSummary.losers}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>{t("eod.totalTurnover")}</div>
              <div className={styles.summaryValue}>{formatVolume(marketSummary.totalVolume)}</div>
            </div>
          </div>
        </>
      )}

      <div className={styles.controls}>
        <label className={styles.dateLabel}>
          {t("eod.from")}
          <input
            type="date"
            className={styles.dateInput}
            value={selectedDateFrom}
            onChange={(e) => setSelectedDateFrom(e.target.value)}
          />
        </label>
        <label className={styles.dateLabel}>
          {t("eod.to")}
          <input
            type="date"
            className={styles.dateInput}
            value={selectedDateTo}
            onChange={(e) => setSelectedDateTo(e.target.value)}
          />
        </label>
        <RefreshButton
          onClick={handleRefresh}
          isRefreshing={isRefreshing}
          label={t("eod.refresh")}
          loadingLabel={t("eod.loading")}
        />
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
          initialColumnVisibility={DAYS_COLUMN_VISIBILITY}
          onFilteredRowsChange={handleFilteredRowsChange}
        />
      ) : null}
    </WidgetLayout>
  );
}

// --- Entry point helper ---

export function renderEndOfDaysApp(config: EndOfDaysAppConfig) {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <EndOfDaysApp config={config} />
    </StrictMode>
  );
}
