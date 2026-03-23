/**
 * Market Last Update Widget
 * Displays real-time last-update trading data from the TASE Data Hub API.
 * No selectors (no period, no market type) — only a refresh button.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createColumnHelper } from "@tanstack/react-table";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DataTable } from "../../components/DataTable";
import { WidgetLayout, handleSubscriptionRedirect, SubscriptionBanner } from "../../components/WidgetLayout";
import { useLanguage } from "../../components/useLanguage";
import styles from "./market-last-update-widget.module.css";

interface LastUpdateItem {
  date: string;
  lastSaleTime: string | null;
  securityId: number;
  symbol: string | null;
  securityStatusId: string | null;
  securityLastPrice: number | null;
  securityPercentageChange: number | null;
  auctionLastSaleVolume: number | null;
  lastSaleVolume: number | null;
  securityDailyAggVolume: number | null;
  securityDailyAggValue: number | null;
  securityDailyNumTrades: number | null;
  tradingPhaseId: string | null;
  priceTypeId: string | null;
}

interface LastUpdateData {
  count: number;
  items: LastUpdateItem[];
}

function extractLastUpdateData(callToolResult: CallToolResult | null | undefined): LastUpdateData | null {
  try {
    if (!callToolResult) return null;
    console.info("extractLastUpdateData called");

    if (callToolResult.structuredContent) {
      const data = callToolResult.structuredContent as unknown as LastUpdateData;
      if (Array.isArray(data?.items)) {
        console.info("Using structuredContent:", { count: data.count });
        return data;
      }
      console.info("structuredContent has no items array, falling back");
    }

    const textContent = callToolResult.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      console.error("No text content found in result");
      return null;
    }
    // ChatGPT double-wraps text content: {"text": "{actual JSON}"} — unwrap if needed
    let parsed = JSON.parse(textContent.text);
    if (parsed && typeof parsed.text === "string" && !parsed.items) {
      parsed = JSON.parse(parsed.text);
    }
    const data = parsed as LastUpdateData;
    console.info("Parsed last update data:", { count: data.count, itemCount: data.items?.length });
    return data;
  } catch (e) {
    console.error("Failed to extract last update data:", e);
    return null;
  }
}

function formatPercent(percent: number): string {
  const sign = percent >= 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

function formatVolume(volume: number): string {
  if (volume >= 1000000000) {
    return `${(volume / 1000000000).toFixed(1)}B`;
  }
  if (volume >= 1000000) {
    return `${(volume / 1000000).toFixed(1)}M`;
  }
  if (volume >= 1000) {
    return `${(volume / 1000).toFixed(0)}K`;
  }
  return new Intl.NumberFormat("en-US").format(volume);
}

const columnHelper = createColumnHelper<LastUpdateItem>();

function LastUpdateApp() {
  const { t } = useLanguage();
  const [data, setData] = useState<LastUpdateData | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [subscribeUrl, setSubscribeUrl] = useState<string | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "Market Last Update", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => {
        console.info("App is being torn down");
        return {};
      };

      app.ontoolinput = async (input) => {
        console.info("Received tool call input:", input);
      };

      app.ontoolresult = async (result) => {
        try {
          if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
          const data = extractLastUpdateData(result);
          if (data) {
            setData(data);
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
    try {
      app.callServerTool({ name: "get-market-last-update-data", arguments: {} })
        .then((result) => {
          if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
          const fetchedData = extractLastUpdateData(result);
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
  }, [needsAutoFetch, app]);

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
    <LastUpdateAppInner
      app={app}
      data={data}
      setData={setData}
      hostContext={hostContext}
    />
  );
}

interface LastUpdateAppInnerProps {
  app: App;
  data: LastUpdateData | null;
  setData: React.Dispatch<React.SetStateAction<LastUpdateData | null>>;
  hostContext?: McpUiHostContext;
}

function LastUpdateAppInner({
  app,
  data,
  setData,
  hostContext,
}: LastUpdateAppInnerProps) {
  const { language, dir, toggle, t } = useLanguage();
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Clear initial loading state when data first arrives
  useEffect(() => {
    if (data) setIsRefreshing(false);
  }, [data]);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const result = await app.callServerTool({
        name: "get-market-last-update-data",
        arguments: {},
      });
      if (handleSubscriptionRedirect(result, app)) return;
      const data = extractLastUpdateData(result);
      if (data) {
        setData(data);
      } else {
        setRefreshError(t("eod.noDataFound"));
      }
    } catch (e) {
      console.error("Failed to refresh data:", e);
      setRefreshError(t("eod.failedToFetch"));
    } finally {
      setIsRefreshing(false);
    }
  }, [app, setData]);

  const columns = useMemo(
    () => [
      columnHelper.accessor("symbol", {
        header: t("eod.col.symbol"),
        cell: (info) => (
          <span className={styles.symbolCell}>{info.getValue() ?? "—"}</span>
        ),
      }),
      columnHelper.accessor("securityId", {
        header: t("eod.col.securityId"),
        cell: (info) => info.getValue(),
      }),
      columnHelper.accessor("securityLastPrice", {
        header: t("lastUpdate.col.lastPrice"),
        cell: (info) => {
          const value = info.getValue();
          return (
            <span className={styles.numericCell}>
              {value != null ? Number(value).toFixed(2) : "—"}
            </span>
          );
        },
      }),
      columnHelper.accessor("securityPercentageChange", {
        header: t("eod.col.chgPct"),
        cell: (info) => {
          const value = info.getValue();
          if (value == null) return <span className={styles.numericCell}>—</span>;
          const className = value > 0 ? styles.positive : value < 0 ? styles.negative : "";
          return (
            <span className={`${styles.numericCell} ${className}`}>
              {formatPercent(value)}
            </span>
          );
        },
      }),
      columnHelper.accessor("lastSaleTime", {
        header: t("lastUpdate.col.lastSaleTime"),
        cell: (info) => <span className={styles.textCell}>{info.getValue() ?? "—"}</span>,
        enableColumnFilter: false,
      }),
      columnHelper.accessor("lastSaleVolume", {
        header: t("lastUpdate.col.lastSaleVol"),
        cell: (info) => {
          const value = info.getValue();
          return (
            <span className={styles.numericCell}>
              {value != null ? formatVolume(Number(value)) : "—"}
            </span>
          );
        },
      }),
      columnHelper.accessor("securityDailyAggVolume", {
        header: t("lastUpdate.col.dailyVolume"),
        cell: (info) => {
          const value = info.getValue();
          return (
            <span className={styles.numericCell}>
              {value != null ? formatVolume(Number(value)) : "—"}
            </span>
          );
        },
      }),
      columnHelper.accessor("securityDailyAggValue", {
        header: t("lastUpdate.col.dailyValue"),
        cell: (info) => {
          const value = info.getValue();
          return (
            <span className={styles.numericCell}>
              {value != null ? formatVolume(Number(value)) : "—"}
            </span>
          );
        },
      }),
      columnHelper.accessor("securityDailyNumTrades", {
        header: t("lastUpdate.col.numTrades"),
        cell: (info) => {
          const value = info.getValue();
          return (
            <span className={styles.numericCell}>
              {value != null ? new Intl.NumberFormat("en-US").format(value) : "—"}
            </span>
          );
        },
      }),
      columnHelper.accessor("tradingPhaseId", {
        header: t("lastUpdate.col.tradingPhase"),
        cell: (info) => <span className={styles.textCell}>{info.getValue() ?? "—"}</span>,
        enableColumnFilter: false,
      }),
      columnHelper.accessor("date", {
        header: t("eod.col.date"),
        cell: (info) => {
          const value = info.getValue();
          const dateOnly = value ? value.split("T")[0] : "—";
          return <span className={styles.textCell}>{dateOnly}</span>;
        },
        enableColumnFilter: false,
      }),
    ],
    [t]
  );

  const rows = useMemo(() => data?.items ?? [], [data?.items]);

  const initialColumnVisibility = useMemo<Record<string, boolean>>(() => ({
    securityId: false,
    securityStatusId: false,
    priceTypeId: false,
    auctionLastSaleVolume: false,
    date: false,
  }), []);

  // Summary
  const [filteredRows, setFilteredRows] = useState<LastUpdateItem[]>([]);

  const handleFilteredRowsChange = useCallback((rows: LastUpdateItem[]) => {
    setFilteredRows(rows);
  }, []);

  const summaryRows = filteredRows.length > 0 ? filteredRows : rows;
  const marketSummary = useMemo(() => {
    const gainers = summaryRows.filter(row => (row.securityPercentageChange ?? 0) > 0).length;
    const losers = summaryRows.filter(row => (row.securityPercentageChange ?? 0) < 0).length;
    return {
      totalStocks: summaryRows.length,
      gainers,
      losers,
    };
  }, [summaryRows]);

  return (
    <WidgetLayout title={t("landing.tool.marketLastUpdate")} app={app} hostContext={hostContext} language={language} dir={dir} onLanguageToggle={toggle}>

      {data && (
        <div className={styles.summary}>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{t("eod.totalStocks")}</div>
            <div className={styles.summaryValue}>
              {marketSummary.totalStocks}
            </div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{t("eod.gainers")}</div>
            <div className={`${styles.summaryValue} ${styles.gainers}`}>
              {marketSummary.gainers}
            </div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>{t("eod.losers")}</div>
            <div className={`${styles.summaryValue} ${styles.losers}`}>
              {marketSummary.losers}
            </div>
          </div>
        </div>
      )}

      <div className={styles.controls}>
        <button
          className={styles.refreshButton}
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? t("eod.loading") : t("eod.refresh")}
        </button>
      </div>

      {refreshError && (
        <div className={styles.loading}>{refreshError}</div>
      )}

      {data && rows.length === 0 ? (
        <div className={styles.loading}>{t("eod.noDataFound")}</div>
      ) : data ? (
        <DataTable
          data={rows}
          columns={columns}
          initialPageSize={50}
          storageKey="tase-last-update-column-visibility"
          initialColumnVisibility={initialColumnVisibility}
          onFilteredRowsChange={handleFilteredRowsChange}
        />
      ) : null}
    </WidgetLayout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LastUpdateApp />
  </StrictMode>,
);
