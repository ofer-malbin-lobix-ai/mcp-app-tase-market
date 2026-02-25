/**
 * End of Day Symbols Data Visualization App
 * Displays Tel Aviv Stock Exchange end of day data for specific symbols across a date range.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createColumnHelper } from "@tanstack/react-table";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DataTable } from "./components/DataTable";
import styles from "./symbols-end-of-day-widget.module.css";

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
}

interface EndOfDaySymbolsData {
  symbols: string[];
  count: number;
  dateFrom: string | null;
  dateTo: string | null;
  items: StockData[];
}

function extractEndOfDaySymbolsData(callToolResult: CallToolResult | null | undefined): EndOfDaySymbolsData | null {
  try {
    if (!callToolResult) return null;
    console.info("extractEndOfDaySymbolsData called");

    // Prefer structuredContent — validate items exist
    if (callToolResult.structuredContent) {
      const data = callToolResult.structuredContent as unknown as EndOfDaySymbolsData;
      if (Array.isArray(data?.items)) {
        console.info("Using structuredContent:", { symbols: data.symbols, count: data.count });
        return data;
      }
      console.info("structuredContent has no items array, falling back");
    }

    // Fallback to text content (from get-symbols-end-of-day-data or app.callServerTool)
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
    const data = parsed as EndOfDaySymbolsData;
    console.info("Parsed symbols data:", { symbols: data.symbols, count: data.count, itemCount: data.items?.length });
    return data;
  } catch (e) {
    console.error("Failed to extract end of day symbols data:", e);
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

function EndOfDaySymbolsApp() {
  const [data, setData] = useState<EndOfDaySymbolsData | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "End of Day Symbols", version: "1.0.0" },
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
          const data = extractEndOfDaySymbolsData(result);
          if (data) {
            setData(data);
          } else {
            setNeedsAutoFetch(true);
          }
        } catch (e) {
          console.error("ontoolresult error:", e);
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
      app.callServerTool({ name: "get-symbols-end-of-day-data", arguments: {} })
        .then((result) => {
          const fetchedData = extractEndOfDaySymbolsData(result);
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
    <EndOfDaySymbolsAppInner
      app={app}
      data={data}
      setData={setData}
      hostContext={hostContext}
    />
  );
}

interface EndOfDaySymbolsAppInnerProps {
  app: App;
  data: EndOfDaySymbolsData | null;
  setData: React.Dispatch<React.SetStateAction<EndOfDaySymbolsData | null>>;
  hostContext?: McpUiHostContext;
}

function EndOfDaySymbolsAppInner({
  app,
  data,
  setData,
  hostContext,
}: EndOfDaySymbolsAppInnerProps) {
  const [symbolsInput, setSymbolsInput] = useState<string>("");
  const [selectedDateFrom, setSelectedDateFrom] = useState<string>("");
  const [selectedDateTo, setSelectedDateTo] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<"inline" | "fullscreen">("inline");

  // Check if fullscreen is available
  const isFullscreenAvailable = hostContext?.availableDisplayModes?.includes("fullscreen") ?? false;

  // Toggle fullscreen mode
  const toggleFullscreen = useCallback(async () => {
    const newMode = displayMode === "fullscreen" ? "inline" : "fullscreen";
    try {
      const result = await app.requestDisplayMode({ mode: newMode });
      setDisplayMode(result.mode as "inline" | "fullscreen");
    } catch (e) {
      console.error("Failed to toggle fullscreen:", e);
    }
  }, [app, displayMode]);

  // Update display mode when host context changes
  useEffect(() => {
    if (hostContext?.displayMode) {
      setDisplayMode(hostContext.displayMode as "inline" | "fullscreen");
    }
  }, [hostContext?.displayMode]);

  const parseSymbols = useCallback((input: string): string[] => {
    return input.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }, []);

  const handleRefresh = useCallback(async (symbols?: string[], dateFrom?: string, dateTo?: string) => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      console.info("Calling get-symbols-end-of-day-data tool...", { symbols, dateFrom, dateTo });
      const args: Record<string, unknown> = {};
      if (symbols && symbols.length > 0) args.symbols = symbols;
      if (dateFrom) args.dateFrom = dateFrom;
      if (dateTo) args.dateTo = dateTo;
      const result = await app.callServerTool({
        name: "get-symbols-end-of-day-data",
        arguments: args,
      });
      const data = extractEndOfDaySymbolsData(result);
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

  // Sync controls with data
  useEffect(() => {
    if (data?.dateFrom && !selectedDateFrom) {
      setSelectedDateFrom(data.dateFrom);
    }
  }, [data?.dateFrom, selectedDateFrom]);

  useEffect(() => {
    if (data?.dateTo && !selectedDateTo) {
      setSelectedDateTo(data.dateTo);
    }
  }, [data?.dateTo, selectedDateTo]);

  useEffect(() => {
    if (data?.symbols && data.symbols.length > 0 && !symbolsInput) {
      setSymbolsInput(data.symbols.join(", "));
    }
  }, [data?.symbols, symbolsInput]);

  const handleRefreshClick = useCallback(() => {
    const symbols = parseSymbols(symbolsInput);
    handleRefresh(symbols.length > 0 ? symbols : undefined, selectedDateFrom || undefined, selectedDateTo || undefined);
  }, [symbolsInput, selectedDateFrom, selectedDateTo, handleRefresh, parseSymbols]);

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
  const rows = useMemo(() => data?.items ?? [], [data?.items]);

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
        <div>
          <h1 className={styles.title}>End of Day Symbols</h1>
          {data && (
            <div className={styles.subtitle}>
              {data.symbols?.length > 0 ? data.symbols.join(", ") : "All symbols"}
              {data.dateFrom && ` · ${data.dateFrom}`}
              {data.dateTo && data.dateTo !== data.dateFrom && ` — ${data.dateTo}`}
            </div>
          )}
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
          Symbols:
          <input
            type="text"
            className={styles.dateInput}
            value={symbolsInput}
            onChange={(e) => setSymbolsInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRefreshClick(); }}
            placeholder="e.g. TEVA, LUMI, BEZQ"
            style={{ minWidth: "200px" }}
          />
        </label>
        <label className={styles.dateLabel}>
          From:
          <input
            type="date"
            className={styles.dateInput}
            value={selectedDateFrom}
            onChange={(e) => setSelectedDateFrom(e.target.value)}
          />
        </label>
        <label className={styles.dateLabel}>
          To:
          <input
            type="date"
            className={styles.dateInput}
            value={selectedDateTo}
            onChange={(e) => setSelectedDateTo(e.target.value)}
          />
        </label>
        <button
          className={styles.refreshButton}
          onClick={handleRefreshClick}
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
        <div className={styles.loading}>No rows found</div>
      ) : data ? (
        <DataTable
          data={rows}
          columns={columns}
          initialPageSize={50}
          storageKey="tase-symbols-column-visibility"
          onFilteredRowsChange={handleFilteredRowsChange}
        />
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EndOfDaySymbolsApp />
  </StrictMode>,
);
