/**
 * Shared End of Day Widget Component
 * Used by all 4 end-of-day widgets: market, symbols, my-position, my-watchlist.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createColumnHelper } from "@tanstack/react-table";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DataTable } from "../../components/DataTable";
import { SymbolActions } from "../../components/SymbolActions";
import { WidgetLayout } from "../../components/WidgetLayout";
import styles from "./end-of-day-widget.module.css";

// --- Types ---

export interface StockData {
  tradeDate: string;
  symbol: string;
  securityId: number;
  change: number | null;
  turnover: number | null;
  closingPrice: number | null;
  basePrice: number | null;
  openingPrice: number | null;
  high: number | null;
  low: number | null;
  changeValue: number | null;
  volume: number | null;
  marketCap: number | null;
  minContPhaseAmount: number | null;
  listedCapital: number | null;
  marketType: string | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  cci20: number | null;
  mfi14: number | null;
  turnover10: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  stddev20: number | null;
  upperBollingerBand20: number | null;
  lowerBollingerBand20: number | null;
  ez: number | null;
  companyName: string | null;
  sector: string | null;
  subSector: string | null;
}

export interface EndOfDayWidgetData {
  tradeDate?: string;
  marketType?: string | null;
  symbols?: string[];
  count?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  rows: StockData[];
}

export interface EndOfDayAppConfig {
  toolName: string;
  isMarketView?: boolean;
  passSymbolsOnRefresh?: boolean;
}

// --- Helpers ---

function deriveTitle(toolName: string): string {
  return toolName
    .replace(/^get-/, "")
    .replace(/-data$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatPrice(price: number): string {
  return price.toFixed(2);
}

function formatPercent(percent: number): string {
  const sign = percent >= 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

function formatVolume(volume: number): string {
  if (volume >= 1000000000) return `${(volume / 1000000000).toFixed(1)}B`;
  if (volume >= 1000000) return `${(volume / 1000000).toFixed(1)}M`;
  if (volume >= 1000) return `${(volume / 1000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US").format(volume);
}

function formatNumber(value: number | null, decimals = 2): string {
  if (value === null) return "\u2014";
  return value.toFixed(decimals);
}

// --- Data extraction ---

function extractEndOfDayData(
  callToolResult: CallToolResult | null | undefined,
): EndOfDayWidgetData | null {
  try {
    if (!callToolResult) return null;

    if (callToolResult.structuredContent) {
      const raw = callToolResult.structuredContent as Record<string, unknown>;
      const arr = raw.items;
      if (Array.isArray(arr)) {
        return { ...raw, rows: arr } as EndOfDayWidgetData;
      }
    }

    const textContent = callToolResult.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;

    let parsed = JSON.parse(textContent.text);
    if (parsed && typeof parsed.text === "string" && !parsed.items) {
      parsed = JSON.parse(parsed.text);
    }

    return { ...parsed, rows: parsed.items ?? [] } as EndOfDayWidgetData;
  } catch {
    return null;
  }
}

// --- Columns ---

const columnHelper = createColumnHelper<StockData>();

function createEndOfDayColumns(app: App, showDateColumn?: boolean) {
  const cols = [];

  if (showDateColumn) {
    cols.push(
      columnHelper.accessor("tradeDate", {
        header: "Date",
        cell: (info) => {
          const value = info.getValue();
          const dateOnly = value ? value.split("T")[0] : "\u2014";
          return <span className={styles.textCell}>{dateOnly}</span>;
        },
        enableColumnFilter: false,
      })
    );
  }

  cols.push(
    columnHelper.accessor("symbol", {
      header: "Symbol",
      cell: (info) => <span className={styles.symbolCell}>{info.getValue()}</span>,
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      enableSorting: false,
      enableColumnFilter: false,
      cell: (info) => <SymbolActions symbol={info.row.original.symbol} app={app} />,
    }),
    columnHelper.accessor("securityId", {
      header: "Security ID",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("companyName", {
      header: "Company",
      cell: (info) => <span className={styles.textCell}>{info.getValue() ?? "\u2014"}</span>,
      filterFn: "includesString",
    }),
    columnHelper.accessor("sector", {
      header: "Sector",
      cell: (info) => <span className={styles.textCell}>{info.getValue() ?? "\u2014"}</span>,
      filterFn: "includesString",
    }),
    columnHelper.accessor("subSector", {
      header: "Sub-Sector",
      cell: (info) => <span className={styles.textCell}>{info.getValue() ?? "\u2014"}</span>,
      filterFn: "includesString",
    }),
    columnHelper.accessor("marketType", {
      header: "Type",
      cell: (info) => <span className={styles.textCell}>{info.getValue() ?? "\u2014"}</span>,
      enableColumnFilter: false,
    }),
    // Price data
    columnHelper.accessor("closingPrice", {
      header: "Close",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("openingPrice", {
      header: "Open",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("high", {
      header: "High",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("low", {
      header: "Low",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("basePrice", {
      header: "Base",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    // Change
    columnHelper.accessor("changeValue", {
      header: "Chg",
      cell: (info) => {
        const value = info.getValue() ?? 0;
        const className = value > 0 ? styles.positive : value < 0 ? styles.negative : "";
        return (
          <span className={`${styles.numericCell} ${className}`}>
            {value > 0 ? "+" : ""}{formatPrice(value)}
          </span>
        );
      },
    }),
    columnHelper.accessor("change", {
      header: "Chg%",
      cell: (info) => {
        const value = info.getValue() ?? 0;
        const className = value > 0 ? styles.positive : value < 0 ? styles.negative : "";
        return (
          <span className={`${styles.numericCell} ${className}`}>
            {formatPercent(value)}
          </span>
        );
      },
    }),
    // Volume & Turnover
    columnHelper.accessor("volume", {
      header: "Volume",
      cell: (info) => <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>,
    }),
    columnHelper.accessor("turnover", {
      header: "Turnover",
      cell: (info) => <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>,
    }),
    columnHelper.accessor("turnover10", {
      header: "Turn10",
      cell: (info) => <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>,
    }),
    // Market data
    columnHelper.accessor("marketCap", {
      header: "Mkt Cap",
      cell: (info) => <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>,
    }),
    columnHelper.accessor("listedCapital", {
      header: "Listed Cap",
      cell: (info) => <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>,
    }),
    columnHelper.accessor("minContPhaseAmount", {
      header: "Min Cont",
      cell: (info) => <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>,
    }),
    // Technical indicators
    columnHelper.accessor("rsi14", {
      header: "RSI14",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("mfi14", {
      header: "MFI14",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("cci20", {
      header: "CCI20",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("macd", {
      header: "MACD",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("macdSignal", {
      header: "MACD Sig",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("macdHist", {
      header: "MACD Hist",
      cell: (info) => {
        const value = info.getValue();
        const className = value !== null ? (value > 0 ? styles.positive : value < 0 ? styles.negative : "") : "";
        return <span className={`${styles.numericCell} ${className}`}>{formatNumber(value)}</span>;
      },
    }),
    // Moving averages
    columnHelper.accessor("sma20", {
      header: "SMA20",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("sma50", {
      header: "SMA50",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("sma200", {
      header: "SMA200",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    // Bollinger bands
    columnHelper.accessor("upperBollingerBand20", {
      header: "BB Upper",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("lowerBollingerBand20", {
      header: "BB Lower",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("stddev20", {
      header: "StdDev20",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    // EZ
    columnHelper.accessor("ez", {
      header: "EZ",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
  );

  return cols;
}

const INITIAL_COLUMN_VISIBILITY: Record<string, boolean> = {
  securityId: false,
  tradeDate: false,
  subSector: false,
  marketType: false,
  openingPrice: false,
  high: false,
  low: false,
  basePrice: false,
  turnover10: false,
  listedCapital: false,
  minContPhaseAmount: false,
  rsi14: false,
  mfi14: false,
  cci20: false,
  macd: false,
  macdSignal: false,
  macdHist: false,
  sma20: false,
  sma50: false,
  sma200: false,
  upperBollingerBand20: false,
  lowerBollingerBand20: false,
  stddev20: false,
  ez: false,
};

// --- App component ---

function EndOfDayApp({ config }: { config: EndOfDayAppConfig }) {
  const [data, setData] = useState<EndOfDayWidgetData | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [toolInput, setToolInput] = useState<Record<string, unknown>>({});
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
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedMarketType, setSelectedMarketType] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

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
      const extracted = extractEndOfDayData(result);
      if (extracted) {
        setData(extracted);
      } else {
        setRefreshError("No data found");
      }
    } catch (e) {
      console.error("Failed to refresh data:", e);
      setRefreshError("Failed to fetch data");
    } finally {
      setIsRefreshing(false);
    }
  }, [app, config, data, selectedDate, selectedMarketType, setData]);

  // CRITICAL: Memoize columns to prevent infinite re-renders
  const columns = useMemo(
    () => createEndOfDayColumns(app, config.isMarketView),
    [app, config.isMarketView]
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
    <WidgetLayout title={deriveTitle(config.toolName)} subtitle={subtitle} app={app} hostContext={hostContext}>
      {data && (
        <div className={styles.summary}>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Total Stocks</div>
            <div className={styles.summaryValue}>{marketSummary.totalStocks}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Gainers</div>
            <div className={`${styles.summaryValue} ${styles.gainers}`}>{marketSummary.gainers}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Losers</div>
            <div className={`${styles.summaryValue} ${styles.losers}`}>{marketSummary.losers}</div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Total Volume</div>
            <div className={styles.summaryValue}>{formatVolume(marketSummary.totalVolume)}</div>
          </div>
        </div>
      )}

      <div className={styles.controls}>
        <label className={styles.dateLabel}>
          {config.isMarketView ? "Trade Date:" : "Date:"}
          <input
            type="date"
            className={styles.dateInput}
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </label>
        {config.isMarketView && (
          <label className={styles.dateLabel}>
            Market Type:
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
          {isRefreshing ? "Loading..." : "Refresh"}
        </button>
      </div>

      {refreshError && <div className={styles.loading}>{refreshError}</div>}

      {!data && !refreshError ? (
        <div className={styles.loading}>Waiting for data...</div>
      ) : data && rows.length === 0 ? (
        <div className={styles.loading}>No rows found</div>
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
