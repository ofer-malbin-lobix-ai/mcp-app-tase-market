/**
 * Candlestick Chart Widget
 * Displays a candlestick chart for a single TASE symbol across a date range.
 * Uses lightweight-charts via lightweight-charts-react-components.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
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
import styles from "./symbol-candlestick-widget.module.css";

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
  [key: string]: unknown;
}

type CandlestickTimeframe = "1D" | "3D" | "1W" | "1M" | "3M";

const TIMEFRAMES: { value: CandlestickTimeframe; label: string }[] = [
  { value: "1D", label: "Day" },
  { value: "3D", label: "3D" },
  { value: "1W", label: "Week" },
  { value: "1M", label: "Month" },
  { value: "3M", label: "Quarter" },
];

interface CandlestickWidgetData {
  symbol: string;
  count: number;
  dateFrom: string | null;
  dateTo: string | null;
  timeframe?: CandlestickTimeframe;
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

function extractCandlestickData(callToolResult: CallToolResult | null | undefined): CandlestickWidgetData | null {
  try {
    if (!callToolResult) return null;

    if (callToolResult.structuredContent) {
      const data = callToolResult.structuredContent as unknown as CandlestickWidgetData;
      if (Array.isArray(data?.items)) {
        return data;
      }
    }

    const textContent = callToolResult.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;

    // ChatGPT double-wraps text content — unwrap if needed
    let parsed = JSON.parse(textContent.text);
    if (parsed && typeof parsed.text === "string" && !parsed.items) {
      parsed = JSON.parse(parsed.text);
    }
    return parsed as CandlestickWidgetData;
  } catch (e) {
    console.error("Failed to extract candlestick data:", e);
    return null;
  }
}

function formatPrice(price: number): string {
  return price.toFixed(2);
}

function formatVolume(volume: number): string {
  if (volume >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(1)}B`;
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(0)}K`;
  return String(volume);
}

// ─── Main App ──────────────────────────────────────────────────────────

function CandlestickApp() {
  const [data, setData] = useState<CandlestickWidgetData | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [toolInput, setToolInput] = useState<Record<string, unknown>>({});
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "Candlestick Chart", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});

      app.ontoolinput = async (input) => {
        if (input?.arguments) setToolInput(input.arguments as Record<string, unknown>);
      };

      app.ontoolresult = async (result) => {
        try {
          const extracted = extractCandlestickData(result);
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

  // Auto-fetch fallback
  useEffect(() => {
    if (!needsAutoFetch || !app) return;
    setNeedsAutoFetch(false);
    if (typeof app.callServerTool !== "function") return;
    app.callServerTool({ name: "get-symbol-candlestick-data", arguments: {} })
      .then((result) => {
        const fetched = extractCandlestickData(result);
        if (fetched) {
          setData(fetched);
        }
      })
      .catch((e) => console.error("Auto-fetch failed:", e));
  }, [needsAutoFetch, app]);

  useHostStyles(app ?? null);

  useEffect(() => {
    if (app) {
      setHostContext(app.getHostContext());
    }
  }, [app]);

  if (error) return <div className={styles.error}><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div className={styles.loading}>Connecting...</div>;

  return <CandlestickAppInner app={app} data={data} setData={setData} toolInput={toolInput} hostContext={hostContext} />;
}

interface CandlestickAppInnerProps {
  app: App;
  data: CandlestickWidgetData | null;
  setData: React.Dispatch<React.SetStateAction<CandlestickWidgetData | null>>;
  toolInput: Record<string, unknown>;
  hostContext?: McpUiHostContext;
}

function CandlestickAppInner({ app, data, setData, toolInput, hostContext }: CandlestickAppInnerProps) {
  const [symbolInput, setSymbolInput] = useState("");
  const [selectedDateFrom, setSelectedDateFrom] = useState("");
  const [selectedDateTo, setSelectedDateTo] = useState("");
  const [selectedTimeframe, setSelectedTimeframe] = useState<CandlestickTimeframe>("1D");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [displayMode, setDisplayMode] = useState<"inline" | "fullscreen">("inline");
  const [legendValues, setLegendValues] = useState<LegendValues | null>(null);
  const [showEz, setShowEz] = useState(false);
  const [showSma20, setShowSma20] = useState(false);
  const [showSma50, setShowSma50] = useState(false);
  const [showSma200, setShowSma200] = useState(false);
  const [showVolume, setShowVolume] = useState(true);
  const [showCandles, setShowCandles] = useState(true);
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const [chartSize, setChartSize] = useState<{ width: number; height: number }>({ width: 600, height: 400 });

  // Track container size with ResizeObserver
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
  }, [data, displayMode]);

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

  // Map API data to lightweight-charts format
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
      .map((item) => ({
        time: item.tradeDate.split("T")[0] as Time,
        value: item.ez!,
      }));

    const sma20: LineData<Time>[] = sorted
      .filter((item) => item.sma20 != null)
      .map((item) => ({
        time: item.tradeDate.split("T")[0] as Time,
        value: item.sma20!,
      }));

    const sma50: LineData<Time>[] = sorted
      .filter((item) => item.sma50 != null)
      .map((item) => ({
        time: item.tradeDate.split("T")[0] as Time,
        value: item.sma50!,
      }));

    const sma200: LineData<Time>[] = sorted
      .filter((item) => item.sma200 != null)
      .map((item) => ({
        time: item.tradeDate.split("T")[0] as Time,
        value: item.sma200!,
      }));

    return { candleData: candles, volumeData: volumes, ezData: ez, sma20Data: sma20, sma50Data: sma50, sma200Data: sma200 };
  }, [data?.items]);

  // Build a lookup map for legend values by time
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

  // Set default legend to last bar
  useEffect(() => {
    if (candleData.length > 0 && !legendValues) {
      const lastTime = candleData[candleData.length - 1].time as string;
      const values = legendMap.get(lastTime);
      if (values) setLegendValues(values);
    }
  }, [candleData, legendMap, legendValues]);

  // Handle crosshair move
  const handleCrosshairMove = useCallback((params: MouseEventParams<Time>) => {
    if (params.time) {
      const values = legendMap.get(params.time as string);
      if (values) {
        setLegendValues(values);
        return;
      }
    }
    // Fallback to last bar when crosshair leaves
    if (candleData.length > 0) {
      const lastTime = candleData[candleData.length - 1].time as string;
      const values = legendMap.get(lastTime);
      if (values) setLegendValues(values);
    }
  }, [legendMap, candleData]);

  // Refresh data from server
  const handleRefresh = useCallback(async (symbol?: string, dateFrom?: string, dateTo?: string, timeframe?: CandlestickTimeframe) => {
    setIsRefreshing(true);
    setRefreshError(null);
    const args: Record<string, unknown> = {};
    if (symbol) args.symbol = symbol;
    if (dateFrom) args.dateFrom = dateFrom;
    if (dateTo) args.dateTo = dateTo;
    if (timeframe) args.timeframe = timeframe;
    try {
      const result = await app.callServerTool({
        name: "get-symbol-candlestick-data",
        arguments: args,
      });
      const fetched = extractCandlestickData(result);
      if (fetched) {
        setData(fetched);
        setLegendValues(null); // Reset legend so it picks up last bar of new data
      } else {
        setRefreshError("No data found");
      }
    } catch (e) {
      console.error("Failed to refresh:", e);
      setRefreshError("Failed to fetch data");
    } finally {
      setIsRefreshing(false);
    }
  }, [app, setData]);

  // Sync controls with data on first load
  useEffect(() => {
    if (data?.symbol && !symbolInput) setSymbolInput(data.symbol);
  }, [data?.symbol, symbolInput]);

  useEffect(() => {
    if (data?.dateFrom && !selectedDateFrom) setSelectedDateFrom(data.dateFrom);
  }, [data?.dateFrom, selectedDateFrom]);

  useEffect(() => {
    if (data?.dateTo && !selectedDateTo) setSelectedDateTo(data.dateTo);
  }, [data?.dateTo, selectedDateTo]);

  // Sync timeframe from tool input (model may call with a specific timeframe)
  useEffect(() => {
    if (toolInput.timeframe) setSelectedTimeframe(toolInput.timeframe as CandlestickTimeframe);
  }, [toolInput.timeframe]);

  const handleRefreshClick = useCallback(() => {
    if (symbolInput.trim()) {
      handleRefresh(symbolInput.trim(), selectedDateFrom || undefined, selectedDateTo || undefined, selectedTimeframe);
    }
  }, [symbolInput, selectedDateFrom, selectedDateTo, selectedTimeframe, handleRefresh]);

  const handleTimeframeClick = useCallback((tf: CandlestickTimeframe) => {
    setSelectedTimeframe(tf);
    if (symbolInput.trim()) {
      handleRefresh(symbolInput.trim(), selectedDateFrom || undefined, selectedDateTo || undefined, tf);
    }
  }, [symbolInput, selectedDateFrom, selectedDateTo, handleRefresh]);

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
          <h1 className={styles.title}>Candlestick Chart</h1>
          {data && (
            <div className={styles.subtitle}>
              {data.symbol}
              {data.dateFrom && ` · ${data.dateFrom}`}
              {data.dateTo && data.dateTo !== data.dateFrom && ` — ${data.dateTo}`}
              {` · ${data.count} bars`}
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

      <div className={styles.controls}>
        <label className={styles.dateLabel}>
          Symbol:
          <input
            type="text"
            className={styles.dateInput}
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRefreshClick(); }}
            placeholder="e.g. TEVA"
            style={{ minWidth: "100px" }}
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

      <div className={styles.overlays}>
        <div className={styles.timeframeGroup}>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              className={`${styles.timeframeBtn} ${selectedTimeframe === tf.value ? styles.timeframeBtnActive : ""}`}
              onClick={() => handleTimeframeClick(tf.value)}
              disabled={isRefreshing}
            >
              {tf.label}
            </button>
          ))}
        </div>
        <span className={styles.overlaySep} />
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={showCandles}
            onChange={(e) => setShowCandles(e.target.checked)}
          />
          Candles
        </label>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={showVolume}
            onChange={(e) => setShowVolume(e.target.checked)}
          />
          Volume
        </label>
        {sma20Data.length > 0 && (
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={showSma20}
              onChange={(e) => setShowSma20(e.target.checked)}
            />
            SMA20
          </label>
        )}
        {sma50Data.length > 0 && (
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={showSma50}
              onChange={(e) => setShowSma50(e.target.checked)}
            />
            SMA50
          </label>
        )}
        {sma200Data.length > 0 && (
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={showSma200}
              onChange={(e) => setShowSma200(e.target.checked)}
            />
            SMA200
          </label>
        )}
        {ezData.length > 0 && (
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={showEz}
              onChange={(e) => setShowEz(e.target.checked)}
            />
            EZ
          </label>
        )}
      </div>

      {refreshError && (
        <div className={styles.loading}>{refreshError}</div>
      )}

      {!data && !refreshError ? (
        <div className={styles.loading}>Waiting for data...</div>
      ) : data && candleData.length === 0 ? (
        <div className={styles.loading}>No price data available</div>
      ) : data ? (
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
            key={`${chartSize.width}-${chartSize.height}`}
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
              crosshair: {
                mode: 0, // Normal
              },
              rightPriceScale: {
                borderColor: "rgba(197, 203, 206, 0.4)",
              },
              timeScale: {
                borderColor: "rgba(197, 203, 206, 0.4)",
              },
              overlayPriceScales: {
                scaleMargins: { top: 0.75, bottom: 0 },
              },
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
                options={{
                  priceFormat: { type: "volume" },
                  priceScaleId: "volume",
                }}
                reactive
              />
            )}
            {showSma20 && sma20Data.length > 0 && (
              <LineSeries
                data={sma20Data}
                options={{
                  color: "#3b82f6",
                  lineWidth: 2,
                }}
                reactive
              />
            )}
            {showSma50 && sma50Data.length > 0 && (
              <LineSeries
                data={sma50Data}
                options={{
                  color: "#8b5cf6",
                  lineWidth: 2,
                }}
                reactive
              />
            )}
            {showSma200 && sma200Data.length > 0 && (
              <LineSeries
                data={sma200Data}
                options={{
                  color: "#ec4899",
                  lineWidth: 2,
                }}
                reactive
              />
            )}
            {showEz && ezData.length > 0 && (
              <LineSeries
                data={ezData}
                options={{
                  color: "#f59e0b",
                  lineWidth: 2,
                  priceScaleId: "ez",
                }}
                reactive
              />
            )}
            <TimeScale>
              <TimeScaleFitContentTrigger deps={[candleData]} />
            </TimeScale>
          </Chart>
        </div>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CandlestickApp />
  </StrictMode>,
);
