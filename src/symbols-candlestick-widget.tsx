/**
 * Multi-Symbol Candlestick Widget
 * Sidebar with symbol table (Symbol, Last, Chg, Chg%) + chart area with candlestick rendering.
 * Clicking a symbol fetches its candlestick data and displays the chart.
 */
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CandlestickData, HistogramData, LineData, MouseEventParams, Time } from "lightweight-charts";
import {
  CandlestickSeries,
  Chart,
  HistogramSeries,
  LineSeries,
  TimeScale,
  TimeScaleFitContentTrigger,
} from "lightweight-charts-react-components";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./symbols-candlestick-widget.module.css";

// ─── Timeframe ──────────────────────────────────────────────────────

type CandlestickTimeframe = "1D" | "3D" | "1W" | "1M" | "3M";

const TIMEFRAMES: { value: CandlestickTimeframe; label: string }[] = [
  { value: "1D", label: "Day" },
  { value: "3D", label: "3D" },
  { value: "1W", label: "Week" },
  { value: "1M", label: "Month" },
  { value: "3M", label: "Quarter" },
];

// ─── Types ──────────────────────────────────────────────────────────

interface StockData {
  tradeDate: string;
  symbol: string;
  change: number | null;
  closingPrice: number | null;
  openingPrice: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  ez: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  changeValue: number | null;
  [key: string]: unknown;
}

interface EndOfDaySymbolsData {
  symbols: string[];
  count: number;
  dateFrom: string | null;
  dateTo: string | null;
  items: StockData[];
}

interface CandlestickWidgetData {
  symbol: string;
  count: number;
  dateFrom: string | null;
  dateTo: string | null;
  items: StockData[];
}

interface LegendValues {
  open: number;
  high: number;
  low: number;
  close: number;
  change: number | null;
  volume: number;
  ez: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
}

// ─── Extraction helpers ─────────────────────────────────────────────

function extractEndOfDaySymbolsData(callToolResult: CallToolResult | null | undefined): EndOfDaySymbolsData | null {
  try {
    if (!callToolResult) return null;
    if (callToolResult.structuredContent) {
      const data = callToolResult.structuredContent as unknown as EndOfDaySymbolsData;
      if (Array.isArray(data?.items)) return data;
    }
    const textContent = callToolResult.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;
    let parsed = JSON.parse(textContent.text);
    if (parsed && typeof parsed.text === "string" && !parsed.items) {
      parsed = JSON.parse(parsed.text);
    }
    return parsed as EndOfDaySymbolsData;
  } catch {
    return null;
  }
}

function extractCandlestickData(callToolResult: CallToolResult | null | undefined): CandlestickWidgetData | null {
  try {
    if (!callToolResult) return null;
    if (callToolResult.structuredContent) {
      const data = callToolResult.structuredContent as unknown as CandlestickWidgetData;
      if (Array.isArray(data?.items)) return data;
    }
    const textContent = callToolResult.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;
    let parsed = JSON.parse(textContent.text);
    if (parsed && typeof parsed.text === "string" && !parsed.items) {
      parsed = JSON.parse(parsed.text);
    }
    return parsed as CandlestickWidgetData;
  } catch {
    return null;
  }
}

// ─── Formatters ─────────────────────────────────────────────────────

function formatPrice(price: number): string {
  return price.toFixed(2);
}

function formatVolume(volume: number): string {
  if (volume >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(1)}B`;
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(0)}K`;
  return String(volume);
}

// ─── Sidebar ────────────────────────────────────────────────────────

interface SidebarProps {
  symbols: StockData[];
  selectedSymbol: string | null;
  onSelectSymbol: (symbol: string) => void;
}

function Sidebar({ symbols, selectedSymbol, onSelectSymbol }: SidebarProps) {
  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>Symbols ({symbols.length})</div>
      <div className={styles.sidebarScroll}>
        <table className={styles.symbolTable}>
          <thead>
            <tr>
              <th>Symbol</th>
              <th>Last</th>
              <th>Chg%</th>
            </tr>
          </thead>
          <tbody>
            {symbols.map((s) => (
              <tr
                key={s.symbol}
                className={`${styles.symbolRow} ${selectedSymbol === s.symbol ? styles.symbolRowSelected : ""}`}
                onClick={() => onSelectSymbol(s.symbol)}
              >
                <td>{s.symbol}</td>
                <td>{s.closingPrice != null ? formatPrice(s.closingPrice) : "—"}</td>
                <td
                  className={
                    s.change != null
                      ? s.change >= 0
                        ? styles.positive
                        : styles.negative
                      : ""
                  }
                >
                  {s.change != null ? (s.change >= 0 ? "+" : "") + s.change.toFixed(2) + "%" : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Chart ──────────────────────────────────────────────────────────

interface ChartPanelProps {
  data: CandlestickWidgetData;
  isFullscreen: boolean;
}

function ChartPanel({ data, isFullscreen }: ChartPanelProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartSize, setChartSize] = useState<{ width: number; height: number }>({ width: 600, height: 400 });
  const [legendValues, setLegendValues] = useState<LegendValues | null>(null);
  const [showEz, setShowEz] = useState(false);
  const [showSma20, setShowSma20] = useState(false);
  const [showSma50, setShowSma50] = useState(false);
  const [showSma200, setShowSma200] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showCandles, setShowCandles] = useState(true);

  useEffect(() => {
    const el = chartContainerRef.current;
    if (!el) return;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) {
        setChartSize({ width: Math.floor(width), height: Math.floor(height) });
      }
    };
    update();
    const observer = new ResizeObserver(() => update());
    observer.observe(el);
    return () => observer.disconnect();
  }, [data, isFullscreen]);

  const { candleData, volumeData, ezData, sma20Data, sma50Data, sma200Data } = useMemo(() => {
    if (!data?.items) return { candleData: [], volumeData: [], ezData: [], sma20Data: [], sma50Data: [], sma200Data: [] };

    const sorted = data.items
      .filter((item) => item.openingPrice != null && item.high != null && item.low != null && item.closingPrice != null)
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));

    const candles: CandlestickData<Time>[] = sorted.map((item) => ({
      time: item.tradeDate.split("T")[0] as Time,
      open: item.openingPrice!,
      high: item.high!,
      low: item.low!,
      close: item.closingPrice!,
    }));

    const volumes: HistogramData<Time>[] = sorted.map((item) => {
      const isUp = (item.closingPrice ?? 0) >= (item.openingPrice ?? 0);
      return {
        time: item.tradeDate.split("T")[0] as Time,
        value: item.volume ?? 0,
        color: isUp ? "rgba(16, 185, 129, 0.4)" : "rgba(239, 68, 68, 0.4)",
      };
    });

    const ez: LineData<Time>[] = sorted
      .filter((item) => item.ez != null)
      .map((item) => ({ time: item.tradeDate.split("T")[0] as Time, value: item.ez! }));

    const sma20: LineData<Time>[] = sorted
      .filter((item) => item.sma20 != null)
      .map((item) => ({ time: item.tradeDate.split("T")[0] as Time, value: item.sma20! }));

    const sma50: LineData<Time>[] = sorted
      .filter((item) => item.sma50 != null)
      .map((item) => ({ time: item.tradeDate.split("T")[0] as Time, value: item.sma50! }));

    const sma200: LineData<Time>[] = sorted
      .filter((item) => item.sma200 != null)
      .map((item) => ({ time: item.tradeDate.split("T")[0] as Time, value: item.sma200! }));

    return { candleData: candles, volumeData: volumes, ezData: ez, sma20Data: sma20, sma50Data: sma50, sma200Data: sma200 };
  }, [data?.items]);

  const legendMap = useMemo(() => {
    if (!data?.items) return new Map<string, LegendValues>();
    const map = new Map<string, LegendValues>();
    for (const item of data.items) {
      if (item.openingPrice == null || item.high == null || item.low == null || item.closingPrice == null) continue;
      const time = item.tradeDate.split("T")[0];
      map.set(time, {
        open: item.openingPrice,
        high: item.high,
        low: item.low,
        close: item.closingPrice,
        change: item.change,
        volume: item.volume ?? 0,
        ez: item.ez,
        sma20: item.sma20,
        sma50: item.sma50,
        sma200: item.sma200,
      });
    }
    return map;
  }, [data?.items]);

  // Reset legend when data changes (new symbol selected)
  useEffect(() => {
    if (candleData.length > 0) {
      const lastTime = candleData[candleData.length - 1].time as string;
      const values = legendMap.get(lastTime);
      if (values) setLegendValues(values);
    } else {
      setLegendValues(null);
    }
  }, [candleData, legendMap]);

  const handleCrosshairMove = useCallback((params: MouseEventParams<Time>) => {
    if (params.time) {
      const values = legendMap.get(params.time as string);
      if (values) {
        setLegendValues(values);
        return;
      }
    }
    if (candleData.length > 0) {
      const lastTime = candleData[candleData.length - 1].time as string;
      const values = legendMap.get(lastTime);
      if (values) setLegendValues(values);
    }
  }, [legendMap, candleData]);

  if (candleData.length === 0) {
    return <div className={styles.noChart}>No price data available for {data.symbol}</div>;
  }

  return (
    <>
      <div className={styles.overlays}>
        <label className={styles.checkboxLabel}>
          <input type="checkbox" checked={showCandles} onChange={(e) => setShowCandles(e.target.checked)} />
          Candles
        </label>
        <label className={styles.checkboxLabel}>
          <input type="checkbox" checked={showVolume} onChange={(e) => setShowVolume(e.target.checked)} />
          Volume
        </label>
        {sma20Data.length > 0 && (
          <label className={styles.checkboxLabel}>
            <input type="checkbox" checked={showSma20} onChange={(e) => setShowSma20(e.target.checked)} />
            SMA20
          </label>
        )}
        {sma50Data.length > 0 && (
          <label className={styles.checkboxLabel}>
            <input type="checkbox" checked={showSma50} onChange={(e) => setShowSma50(e.target.checked)} />
            SMA50
          </label>
        )}
        {sma200Data.length > 0 && (
          <label className={styles.checkboxLabel}>
            <input type="checkbox" checked={showSma200} onChange={(e) => setShowSma200(e.target.checked)} />
            SMA200
          </label>
        )}
        {ezData.length > 0 && (
          <label className={styles.checkboxLabel}>
            <input type="checkbox" checked={showEz} onChange={(e) => setShowEz(e.target.checked)} />
            EZ
          </label>
        )}
      </div>

      <div className={styles.chartContainer} ref={chartContainerRef}>
        {legendValues && (
          <div className={styles.legend}>
            <span className={styles.legendSymbol}>{data.symbol}</span>
            <span className={styles.legendItem}>O: {formatPrice(legendValues.open)}</span>
            <span className={styles.legendItem}>H: {formatPrice(legendValues.high)}</span>
            <span className={styles.legendItem}>L: {formatPrice(legendValues.low)}</span>
            <span className={styles.legendItem}>C: {formatPrice(legendValues.close)}</span>
            {legendValues.change != null && (
              <span className={`${styles.legendItem} ${legendValues.change >= 0 ? styles.positive : styles.negative}`}>
                {legendValues.change >= 0 ? "+" : ""}{legendValues.change.toFixed(2)}%
              </span>
            )}
            {legendValues.volume > 0 && (
              <span className={styles.legendItem}>Vol: {formatVolume(legendValues.volume)}</span>
            )}
            {showSma20 && legendValues.sma20 != null && (
              <span className={styles.legendItem} style={{ color: "#3b82f6" }}>SMA20: {formatPrice(legendValues.sma20)}</span>
            )}
            {showSma50 && legendValues.sma50 != null && (
              <span className={styles.legendItem} style={{ color: "#8b5cf6" }}>SMA50: {formatPrice(legendValues.sma50)}</span>
            )}
            {showSma200 && legendValues.sma200 != null && (
              <span className={styles.legendItem} style={{ color: "#ec4899" }}>SMA200: {formatPrice(legendValues.sma200)}</span>
            )}
            {showEz && legendValues.ez != null && (
              <span className={styles.legendItem} style={{ color: "#f59e0b" }}>EZ: {legendValues.ez.toFixed(2)}</span>
            )}
          </div>
        )}
        <Chart
          key={`${data.symbol}-${chartSize.width}-${chartSize.height}`}
          options={{
            width: chartSize.width,
            height: chartSize.height,
            layout: {
              background: { color: "transparent" },
              textColor: "#999",
            },
            grid: {
              vertLines: { color: "rgba(197, 203, 206, 0.2)" },
              horzLines: { color: "rgba(197, 203, 206, 0.2)" },
            },
            crosshair: { mode: 0 },
            rightPriceScale: { borderColor: "rgba(197, 203, 206, 0.4)" },
            timeScale: { borderColor: "rgba(197, 203, 206, 0.4)" },
          }}
          onCrosshairMove={handleCrosshairMove}
        >
          {showCandles && (
            <CandlestickSeries
              data={candleData}
              options={{
                upColor: "#10b981",
                downColor: "#ef4444",
                borderUpColor: "#10b981",
                borderDownColor: "#ef4444",
                wickUpColor: "#10b981",
                wickDownColor: "#ef4444",
              }}
              reactive
            />
          )}
          {showVolume && (
            <HistogramSeries
              data={volumeData}
              options={{ priceFormat: { type: "volume" }, priceScaleId: "volume" }}
              reactive
            />
          )}
          {showSma20 && sma20Data.length > 0 && (
            <LineSeries data={sma20Data} options={{ color: "#3b82f6", lineWidth: 2 }} reactive />
          )}
          {showSma50 && sma50Data.length > 0 && (
            <LineSeries data={sma50Data} options={{ color: "#8b5cf6", lineWidth: 2 }} reactive />
          )}
          {showSma200 && sma200Data.length > 0 && (
            <LineSeries data={sma200Data} options={{ color: "#ec4899", lineWidth: 2 }} reactive />
          )}
          {showEz && ezData.length > 0 && (
            <LineSeries data={ezData} options={{ color: "#f59e0b", lineWidth: 2, priceScaleId: "ez" }} reactive />
          )}
          <TimeScale>
            <TimeScaleFitContentTrigger deps={[candleData]} />
          </TimeScale>
        </Chart>
      </div>
    </>
  );
}

// ─── Main App ───────────────────────────────────────────────────────

function SymbolsCandlestickApp() {
  const [eodData, setEodData] = useState<EndOfDaySymbolsData | null>(null);
  const [chartData, setChartData] = useState<CandlestickWidgetData | null>(null);
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState<CandlestickTimeframe>("1D");
  const [selectedDateFrom, setSelectedDateFrom] = useState("");
  const [selectedDateTo, setSelectedDateTo] = useState("");
  const [isChartLoading, setIsChartLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();
  const [displayMode, setDisplayMode] = useState<"inline" | "fullscreen">("inline");

  const { app, error } = useApp({
    appInfo: { name: "Multi-Symbol Candlestick", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});
      app.ontoolinput = async () => {};

      app.ontoolresult = async (result) => {
        try {
          const extracted = extractEndOfDaySymbolsData(result);
          if (extracted) {
            setEodData(extracted);
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

  // Auto-fetch fallback (harmless — API requires symbols so won't return data)
  useEffect(() => {
    if (!needsAutoFetch || !app) return;
    setNeedsAutoFetch(false);
    if (typeof app.callServerTool !== "function") return;
    app.callServerTool({ name: "get-end-of-day-symbols-data", arguments: {} })
      .then((result) => {
        const fetched = extractEndOfDaySymbolsData(result);
        if (fetched) setEodData(fetched);
      })
      .catch((e) => console.error("Auto-fetch failed:", e));
  }, [needsAutoFetch, app]);

  // Sync date inputs from eodData on first load
  useEffect(() => {
    if (eodData?.dateFrom && !selectedDateFrom) setSelectedDateFrom(eodData.dateFrom);
  }, [eodData?.dateFrom, selectedDateFrom]);

  useEffect(() => {
    if (eodData?.dateTo && !selectedDateTo) setSelectedDateTo(eodData.dateTo);
  }, [eodData?.dateTo, selectedDateTo]);

  useHostStyles(app ?? null);

  useEffect(() => {
    if (app) setHostContext(app.getHostContext());
  }, [app]);

  useEffect(() => {
    if (hostContext?.displayMode) {
      setDisplayMode(hostContext.displayMode as "inline" | "fullscreen");
    }
  }, [hostContext?.displayMode]);

  const isFullscreenAvailable = hostContext?.availableDisplayModes?.includes("fullscreen") ?? false;

  const toggleFullscreen = useCallback(async () => {
    const newMode = displayMode === "fullscreen" ? "inline" : "fullscreen";
    try {
      const result = await app!.requestDisplayMode({ mode: newMode });
      setDisplayMode(result.mode as "inline" | "fullscreen");
    } catch (e) {
      console.error("Failed to toggle fullscreen:", e);
    }
  }, [app, displayMode]);

  // Deduplicate items to get one row per symbol (latest trade date)
  const sidebarSymbols = useMemo(() => {
    if (!eodData?.items) return [];
    const map = new Map<string, StockData>();
    for (const item of eodData.items) {
      const existing = map.get(item.symbol);
      if (!existing || item.tradeDate > existing.tradeDate) {
        map.set(item.symbol, item);
      }
    }
    return Array.from(map.values());
  }, [eodData?.items]);

  // Fetch candlestick data when a symbol is selected or timeframe changes
  const handleSelectSymbol = useCallback(async (symbol: string, tf?: CandlestickTimeframe, dateFrom?: string, dateTo?: string) => {
    if (!app || typeof app.callServerTool !== "function") return;
    setSelectedSymbol(symbol);
    setIsChartLoading(true);
    setChartData(null);
    setRefreshError(null);
    try {
      const timeframe = tf ?? selectedTimeframe;
      const from = dateFrom ?? (selectedDateFrom || eodData?.dateFrom);
      const to = dateTo ?? (selectedDateTo || eodData?.dateTo);
      const args: Record<string, unknown> = { symbol, timeframe };
      if (from) args.dateFrom = from;
      if (to) args.dateTo = to;
      const result = await app.callServerTool({
        name: "get-symbol-candlestick-data",
        arguments: args,
      });
      const fetched = extractCandlestickData(result);
      if (fetched) setChartData(fetched);
    } catch (e) {
      console.error("Failed to fetch candlestick:", e);
    } finally {
      setIsChartLoading(false);
    }
  }, [app, eodData?.dateFrom, eodData?.dateTo, selectedTimeframe, selectedDateFrom, selectedDateTo]);

  const handleTimeframeChange = useCallback((tf: CandlestickTimeframe) => {
    setSelectedTimeframe(tf);
    if (selectedSymbol) {
      handleSelectSymbol(selectedSymbol, tf);
    }
  }, [selectedSymbol, handleSelectSymbol]);

  const handleRefresh = useCallback(async () => {
    if (!selectedSymbol) return;
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const args: Record<string, unknown> = { symbol: selectedSymbol, timeframe: selectedTimeframe };
      if (selectedDateFrom) args.dateFrom = selectedDateFrom;
      if (selectedDateTo) args.dateTo = selectedDateTo;
      const result = await app!.callServerTool({
        name: "get-symbol-candlestick-data",
        arguments: args,
      });
      const fetched = extractCandlestickData(result);
      if (fetched) setChartData(fetched);
      else setRefreshError("No data found");
    } catch (e) {
      console.error("Failed to refresh:", e);
      setRefreshError("Failed to fetch data");
    } finally {
      setIsRefreshing(false);
    }
  }, [app, selectedSymbol, selectedTimeframe, selectedDateFrom, selectedDateTo]);

  // Auto-select first symbol when sidebar data loads
  useEffect(() => {
    if (sidebarSymbols.length > 0 && !selectedSymbol) {
      handleSelectSymbol(sidebarSymbols[0].symbol);
    }
  }, [sidebarSymbols, selectedSymbol, handleSelectSymbol]);

  if (error) return <div className={styles.error}><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div className={styles.loading}>Connecting...</div>;

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
          <h1 className={styles.title}>Multi-Symbol Candlestick</h1>
          {eodData && (
            <div className={styles.subtitle}>
              {eodData.symbols.join(", ")}
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

      {eodData && (
        <div className={styles.controls}>
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
            onClick={handleRefresh}
            disabled={isRefreshing || isChartLoading || !selectedSymbol}
          >
            {isRefreshing ? "Loading..." : "Refresh"}
          </button>
        </div>
      )}
      {refreshError && <div className={styles.refreshError}>{refreshError}</div>}

      {!eodData ? (
        <div className={styles.loading}>Loading symbols...</div>
      ) : (
        <div className={`${styles.splitLayout} ${chartData || isChartLoading ? styles.hasChart : ""}`}>
          <div className={styles.chartArea}>
            <div className={styles.timeframeToolbar}>
              {TIMEFRAMES.map((tf) => (
                <button
                  key={tf.value}
                  className={`${styles.timeframeBtn} ${selectedTimeframe === tf.value ? styles.timeframeBtnActive : ""}`}
                  onClick={() => handleTimeframeChange(tf.value)}
                  disabled={isChartLoading}
                >
                  {tf.label}
                </button>
              ))}
            </div>
            {isChartLoading ? (
              <div className={styles.chartLoading}>Loading chart for {selectedSymbol}...</div>
            ) : chartData ? (
              <ChartPanel data={chartData} isFullscreen={displayMode === "fullscreen"} />
            ) : (
              <div className={styles.noChart}>Select a symbol to view its candlestick chart</div>
            )}
          </div>
          <Sidebar
            symbols={sidebarSymbols}
            selectedSymbol={selectedSymbol}
            onSelectSymbol={handleSelectSymbol}
          />
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SymbolsCandlestickApp />
  </StrictMode>,
);
