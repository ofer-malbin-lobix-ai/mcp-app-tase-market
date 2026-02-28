/**
 * End of Day Data Visualization App
 * Displays Tel Aviv Stock Exchange end of day data with interactive sorting and pagination.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createColumnHelper } from "@tanstack/react-table";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DataTable } from "../components/DataTable";
import { WidgetLayout } from "../components/WidgetLayout";
import styles from "./market-end-of-day-widget.module.css";

interface StockData {
  tradeDate: string;
  symbol: string;
  change: number | null;              // percentage change
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
  // Technical indicators
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

interface EndOfDayData {
  tradeDate: string;
  marketType: string | null;
  rows: StockData[];
}

function extractEndOfDayData(callToolResult: CallToolResult | null | undefined): EndOfDayData | null {
  try {
    if (!callToolResult) return null;
    console.info("extractEndOfDayData called");

    // Prefer structuredContent (from show-end-of-day-widget) — validate rows exist
    if (callToolResult.structuredContent) {
      const data = callToolResult.structuredContent as unknown as EndOfDayData;
      if (Array.isArray(data?.rows)) {
        console.info("Using structuredContent:", { tradeDate: data.tradeDate, marketType: data.marketType, rowCount: data.rows.length });
        return data;
      }
      console.info("structuredContent has no rows array, falling back");
    }

    // Fallback to text content (from get-market-end-of-day-data or app.callServerTool)
    const textContent = callToolResult.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      console.error("No text content found in result");
      return null;
    }
    // ChatGPT double-wraps text content: {"text": "{actual JSON}"} — unwrap if needed
    let parsed = JSON.parse(textContent.text);
    if (parsed && typeof parsed.text === "string" && !parsed.rows) {
      parsed = JSON.parse(parsed.text);
    }
    const data = parsed as EndOfDayData;
    console.info("Parsed market data:", { tradeDate: data.tradeDate, marketType: data.marketType, rowCount: data.rows?.length });
    return data;
  } catch (e) {
    console.error("Failed to extract end of day data:", e);
    return null;
  }
}

function formatPrice(price: number): string {
  return price.toFixed(2);
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

function formatNumber(value: number | null, decimals = 2): string {
  if (value === null) return "—";
  return value.toFixed(decimals);
}

// Create column helper for type-safe column definitions
const columnHelper = createColumnHelper<StockData>();

function EndOfDayApp() {
  const [data, setData] = useState<EndOfDayData | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [toolInput, setToolInput] = useState<Record<string, unknown>>({});
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "End of Day", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => {
        console.info("App is being torn down");
        return {};
      };

      app.ontoolinput = async (input) => {
        console.info("Received tool call input:", input);
        if (input?.arguments) {
          setToolInput(input.arguments as Record<string, unknown>);
        }
      };

      app.ontoolresult = async (result) => {
        try {
          const data = extractEndOfDayData(result);
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
      app.callServerTool({ name: "get-market-end-of-day-data", arguments: toolInput })
        .then((result) => {
          const fetchedData = extractEndOfDayData(result);
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

  // Apply host styles for theme integration
  useHostStyles(app ?? null);

  useEffect(() => {
    if (app) {
      setHostContext(app.getHostContext());
    }
  }, [app]);

  if (error) return <div className={styles.error}><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div className={styles.loading}>Connecting...</div>;

  return (
    <EndOfDayAppInner
      app={app}
      data={data}
      setData={setData}
      hostContext={hostContext}
    />
  );
}

interface EndOfDayAppInnerProps {
  app: App;
  data: EndOfDayData | null;
  setData: React.Dispatch<React.SetStateAction<EndOfDayData | null>>;
  hostContext?: McpUiHostContext;
}

function EndOfDayAppInner({
  app,
  data,
  setData,
  hostContext,
}: EndOfDayAppInnerProps) {
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedMarketType, setSelectedMarketType] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  const handleRefresh = useCallback(async (tradeDate?: string, marketType?: string) => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const args: Record<string, string> = {};
      if (tradeDate) args.tradeDate = tradeDate;
      if (marketType) args.marketType = marketType;
      const result = await app.callServerTool({
        name: "get-market-end-of-day-data",
        arguments: args,
      });
      const data = extractEndOfDayData(result);
      if (data) {
        setData(data);
      } else {
        setRefreshError("No data found");
      }
    } catch (e) {
      console.error("Failed to refresh data:", e);
      setRefreshError("Failed to fetch data");
    } finally {
      setIsRefreshing(false);
    }
  }, [app, setData]);

  // Sync selectors with data on first load
  useEffect(() => {
    if (data?.tradeDate && !selectedDate) {
      setSelectedDate(data.tradeDate);
    }
  }, [data?.tradeDate, selectedDate]);

  useEffect(() => {
    if (data?.marketType && !selectedMarketType) {
      setSelectedMarketType(data.marketType);
    }
  }, [data?.marketType, selectedMarketType]);

  const handleDateChange = useCallback((date: string) => {
    setSelectedDate(date);
  }, []);

  const handleMarketTypeChange = useCallback((type: string) => {
    setSelectedMarketType(type);
  }, []);

  // CRITICAL: Memoize columns to prevent infinite re-renders
  const columns = useMemo(
    () => [
      // Date (first column)
      columnHelper.accessor("tradeDate", {
        header: "Date",
        cell: (info) => {
          const value = info.getValue();
          const dateOnly = value ? value.split("T")[0] : "—";
          return <span className={styles.textCell}>{dateOnly}</span>;
        },
        enableColumnFilter: false,
      }),
      // Basic info
      columnHelper.accessor("symbol", {
        header: "Symbol",
        cell: (info) => (
          <span className={styles.symbolCell}>{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor("companyName", {
        header: "Company",
        cell: (info) => <span className={styles.textCell}>{info.getValue() ?? "—"}</span>,
        filterFn: "includesString",
      }),
      columnHelper.accessor("sector", {
        header: "Sector",
        cell: (info) => <span className={styles.textCell}>{info.getValue() ?? "—"}</span>,
        filterFn: "includesString",
      }),
      columnHelper.accessor("subSector", {
        header: "Sub-Sector",
        cell: (info) => <span className={styles.textCell}>{info.getValue() ?? "—"}</span>,
        filterFn: "includesString",
      }),
      columnHelper.accessor("marketType", {
        header: "Type",
        cell: (info) => <span className={styles.textCell}>{info.getValue() ?? "—"}</span>,
        enableColumnFilter: false,
      }),
      // Price data
      columnHelper.accessor("closingPrice", {
        header: "Close",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("openingPrice", {
        header: "Open",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("high", {
        header: "High",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("low", {
        header: "Low",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("basePrice", {
        header: "Base",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
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
        cell: (info) => (
          <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>
        ),
      }),
      columnHelper.accessor("turnover", {
        header: "Turnover",
        cell: (info) => (
          <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>
        ),
      }),
      columnHelper.accessor("turnover10", {
        header: "Turn10",
        cell: (info) => (
          <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>
        ),
      }),
      // Market data
      columnHelper.accessor("marketCap", {
        header: "Mkt Cap",
        cell: (info) => (
          <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>
        ),
      }),
      columnHelper.accessor("listedCapital", {
        header: "Listed Cap",
        cell: (info) => (
          <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>
        ),
      }),
      columnHelper.accessor("minContPhaseAmount", {
        header: "Min Cont",
        cell: (info) => (
          <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>
        ),
      }),
      // Technical indicators - Momentum
      columnHelper.accessor("rsi14", {
        header: "RSI14",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("mfi14", {
        header: "MFI14",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("cci20", {
        header: "CCI20",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
      // MACD
      columnHelper.accessor("macd", {
        header: "MACD",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("macdSignal", {
        header: "MACD Sig",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("macdHist", {
        header: "MACD Hist",
        cell: (info) => {
          const value = info.getValue();
          const className = value !== null ? (value > 0 ? styles.positive : value < 0 ? styles.negative : "") : "";
          return (
            <span className={`${styles.numericCell} ${className}`}>{formatNumber(value)}</span>
          );
        },
      }),
      // Moving averages
      columnHelper.accessor("sma20", {
        header: "SMA20",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("sma50", {
        header: "SMA50",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("sma200", {
        header: "SMA200",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
      // Bollinger bands
      columnHelper.accessor("upperBollingerBand20", {
        header: "BB Upper",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("lowerBollingerBand20", {
        header: "BB Lower",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
      columnHelper.accessor("stddev20", {
        header: "StdDev20",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
      // EZ
      columnHelper.accessor("ez", {
        header: "EZ",
        cell: (info) => (
          <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>
        ),
      }),
    ],
    []
  );

  // CRITICAL: Memoize rows to prevent infinite re-renders
  const rows = useMemo(() => data?.rows ?? [], [data?.rows]);

  // Default column visibility: show only the most important columns.
  // Users can reveal any hidden column via the Columns picker.
  const initialColumnVisibility = useMemo<Record<string, boolean>>(() => ({
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
  }), []);

  // Track filtered rows from DataTable for summary
  const [filteredRows, setFilteredRows] = useState<StockData[]>([]);

  const handleFilteredRowsChange = useCallback((rows: StockData[]) => {
    setFilteredRows(rows);
  }, []);

  // Calculate market summary from filtered rows (falls back to all rows)
  const summaryRows = filteredRows.length > 0 ? filteredRows : rows;
  const marketSummary = useMemo(() => {
    const totalVolume = summaryRows.reduce((sum, row) => sum + Number(row.volume ?? 0), 0);
    const gainers = summaryRows.filter(row => (row.changeValue ?? 0) > 0).length;
    const losers = summaryRows.filter(row => (row.changeValue ?? 0) < 0).length;
    return {
      totalStocks: summaryRows.length,
      gainers,
      losers,
      totalVolume,
    };
  }, [summaryRows]);

  const subtitle = data
    ? `${data.tradeDate}${data.marketType ? ` · ${data.marketType}` : ""}`
    : undefined;

  return (
    <WidgetLayout title="End of Day" subtitle={subtitle} app={app} hostContext={hostContext}>


      {data && (
        <div className={styles.summary}>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Total Stocks</div>
            <div className={styles.summaryValue}>
              {marketSummary.totalStocks}
            </div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Gainers</div>
            <div className={`${styles.summaryValue} ${styles.gainers}`}>
              {marketSummary.gainers}
            </div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Losers</div>
            <div className={`${styles.summaryValue} ${styles.losers}`}>
              {marketSummary.losers}
            </div>
          </div>
          <div className={styles.summaryCard}>
            <div className={styles.summaryLabel}>Total Volume</div>
            <div className={styles.summaryValue}>
              {formatVolume(marketSummary.totalVolume)}
            </div>
          </div>
        </div>
      )}

      <div className={styles.controls}>
        <label className={styles.dateLabel}>
          Trade Date:
          <input
            type="date"
            className={styles.dateInput}
            value={selectedDate}
            onChange={(e) => handleDateChange(e.target.value)}
          />
        </label>
        <label className={styles.dateLabel}>
          Market Type:
          <select
            className={styles.dateInput}
            value={selectedMarketType}
            onChange={(e) => handleMarketTypeChange(e.target.value)}
          >
            <option value="">—</option>
            <option value="STOCK">Stock</option>
            <option value="BOND">Bond</option>
            <option value="TASE UP STOCK">TASE UP Stock</option>
            <option value="LOAN">Loan</option>
          </select>
        </label>
        <button
          className={styles.refreshButton}
          onClick={() => handleRefresh(selectedDate || undefined, selectedMarketType || undefined)}
          disabled={isRefreshing}
        >
          {isRefreshing ? "Loading..." : "Refresh"}
        </button>
      </div>

      {refreshError && (
        <div className={styles.loading}>{refreshError}</div>
      )}

      {!data && !refreshError ? (
        <div className={styles.loading}>Waiting for data...</div>
      ) : data && rows.length === 0 ? (
        <div className={styles.loading}>No rows found (tradeDate: {data.tradeDate}, marketType: {data.marketType})</div>
      ) : data ? (
        <DataTable
          data={rows}
          columns={columns}
          initialPageSize={50}
          storageKey="tase-column-visibility"
          initialColumnVisibility={initialColumnVisibility}
          onFilteredRowsChange={handleFilteredRowsChange}
        />
      ) : null}
    </WidgetLayout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EndOfDayApp />
  </StrictMode>,
);
