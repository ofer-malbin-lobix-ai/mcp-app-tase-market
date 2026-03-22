/**
 * Symbol Intraday Candlestick Chart Widget
 * Displays an intraday candlestick chart for a single TASE symbol.
 * Raw intraday ticks are aggregated client-side into configurable timeframe candles.
 * Auto-refreshes every 30 seconds.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { WidgetLayout, handleSubscriptionRedirect, SubscriptionBanner } from "../components/WidgetLayout";
import { useLanguage } from "../components/useLanguage";
import type { CandlestickData, HistogramData, MouseEventParams, Time } from "lightweight-charts";
import {
  CandlestickSeries,
  Chart,
  HistogramSeries,
  TimeScale,
  TimeScaleFitContentTrigger,
} from "lightweight-charts-react-components";
import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./symbol-intraday-candlestick-widget.module.css";

// ─── Types ──────────────────────────────────────────────────────────────

interface IntradayItem {
  date: string;
  lastSaleTime: string | null;
  securityId: number;
  securityLastRate: number | null;
  securityPercentageChange: number | null;
  lastSaleVolume: number | null;
  securityDailyAggVolume: number | null;
  securityDailyAggValue: number | null;
  securityDailyNumTrades: number | null;
}

type IntradayTimeframe = "1m" | "3m" | "5m" | "10m" | "30m" | "1h";

const TIMEFRAMES: { value: IntradayTimeframe; label: string }[] = [
  { value: "1m", label: "1m" },
  { value: "3m", label: "3m" },
  { value: "5m", label: "5m" },
  { value: "10m", label: "10m" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
];

const TIMEFRAME_MINUTES: Record<IntradayTimeframe, number> = {
  "1m": 1,
  "3m": 3,
  "5m": 5,
  "10m": 10,
  "30m": 30,
  "1h": 60,
};

interface IntradayCandlestickWidgetData {
  symbol: string;
  securityId: number;
  count: number;
  items: IntradayItem[];
}

interface AggregatedCandle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface LegendValues {
  open: number;
  high: number;
  low: number;
  close: number;
  change: number | null;
  volume: number;
}

// ─── Data Extraction ────────────────────────────────────────────────────

function extractIntradayData(callToolResult: CallToolResult | null | undefined): IntradayCandlestickWidgetData | null {
  try {
    if (!callToolResult) return null;

    if (callToolResult.structuredContent) {
      const data = callToolResult.structuredContent as unknown as IntradayCandlestickWidgetData;
      if (Array.isArray(data?.items)) return data;
    }

    const textContent = callToolResult.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;

    // ChatGPT double-wraps text content — unwrap if needed
    let parsed = JSON.parse(textContent.text);
    if (parsed && typeof parsed.text === "string" && !parsed.items) {
      parsed = JSON.parse(parsed.text);
    }
    return parsed as IntradayCandlestickWidgetData;
  } catch (e) {
    console.error("Failed to extract intraday data:", e);
    return null;
  }
}

// ─── Client-side Candle Aggregation ─────────────────────────────────────

function parseIntradayTime(item: IntradayItem): number | null {
  // lastSaleTime is like "14:35:22" or null, date is like "2026-03-01"
  // TASE times are Israel time. lightweight-charts displays UTC timestamps as-is,
  // so we parse Israel wall-clock time as UTC — the chart shows the correct IL time.
  if (!item.lastSaleTime || !item.date) return null;
  const dateStr = item.date.split("T")[0];
  const timeClean = item.lastSaleTime.replace(/\.\d+$/, "");
  const dt = new Date(`${dateStr}T${timeClean}Z`);
  if (isNaN(dt.getTime())) return null;
  return Math.floor(dt.getTime() / 1000);
}

function aggregateCandles(items: IntradayItem[], timeframe: IntradayTimeframe): AggregatedCandle[] {
  const minutes = TIMEFRAME_MINUTES[timeframe];
  const bucketSeconds = minutes * 60;

  // Filter items with valid price and time, sort by time
  // Coerce price/volume to number in case API returns strings
  const valid = items
    .map((item) => {
      const ts = parseIntradayTime(item);
      const price = item.securityLastRate != null ? Number(item.securityLastRate) : NaN;
      const volume = Number(item.lastSaleVolume ?? 0);
      return ts != null && !isNaN(price) && price > 0 ? { ts, price, volume: isNaN(volume) ? 0 : volume } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.ts - b.ts);

  if (valid.length === 0) {
    // Debug: log why items were filtered out
    if (items.length > 0) {
      const sample = items[0];
      console.warn(`[aggregateCandles] All ${items.length} items filtered out. Sample item:`, {
        date: sample.date,
        lastSaleTime: sample.lastSaleTime,
        securityLastRate: sample.securityLastRate,
        priceType: typeof sample.securityLastRate,
      });
    }
    return [];
  }

  const candles: AggregatedCandle[] = [];
  let currentBucket = Math.floor(valid[0].ts / bucketSeconds) * bucketSeconds;
  let open = valid[0].price;
  let high = valid[0].price;
  let low = valid[0].price;
  let close = valid[0].price;
  let volume = valid[0].volume;

  for (let i = 1; i < valid.length; i++) {
    const tick = valid[i];
    const bucket = Math.floor(tick.ts / bucketSeconds) * bucketSeconds;

    if (bucket !== currentBucket) {
      candles.push({ time: currentBucket, open, high, low, close, volume });
      currentBucket = bucket;
      open = tick.price;
      high = tick.price;
      low = tick.price;
      close = tick.price;
      volume = tick.volume;
    } else {
      high = Math.max(high, tick.price);
      low = Math.min(low, tick.price);
      close = tick.price;
      volume += tick.volume;
    }
  }
  // Push last candle
  candles.push({ time: currentBucket, open, high, low, close, volume });

  return candles;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  return price.toFixed(2);
}

function formatVolume(volume: number): string {
  if (volume >= 1_000_000_000) return `${(volume / 1_000_000_000).toFixed(1)}B`;
  if (volume >= 1_000_000) return `${(volume / 1_000_000).toFixed(1)}M`;
  if (volume >= 1_000) return `${(volume / 1_000).toFixed(0)}K`;
  return String(volume);
}

const AUTO_REFRESH_INTERVAL = 30 * 1000; // 30 seconds

// ─── Main App ──────────────────────────────────────────────────────────

function IntradayCandlestickApp() {
  const [data, setData] = useState<IntradayCandlestickWidgetData | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [toolInput, setToolInput] = useState<Record<string, unknown>>({});
  const [subscribeUrl, setSubscribeUrl] = useState<string | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { t } = useLanguage();

  const { app, error } = useApp({
    appInfo: { name: "Symbol Intraday Candlestick Chart", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});

      app.ontoolinput = async (input) => {
        if (input?.arguments) setToolInput(input.arguments as Record<string, unknown>);
      };

      app.ontoolresult = async (result) => {
        try {
          if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
          const extracted = extractIntradayData(result);
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
    app.callServerTool({ name: "get-symbol-intraday-candlestick-data", arguments: {} })
      .then((result) => {
        if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
        const fetched = extractIntradayData(result);
        if (fetched) setData(fetched);
      })
      .catch((e) => console.error("Auto-fetch failed:", e));
  }, [needsAutoFetch, app]);

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

  return <IntradayAppInner app={app} data={data} setData={setData} toolInput={toolInput} hostContext={hostContext} />;
}

// ─── Inner App ──────────────────────────────────────────────────────────

interface IntradayAppInnerProps {
  app: App;
  data: IntradayCandlestickWidgetData | null;
  setData: React.Dispatch<React.SetStateAction<IntradayCandlestickWidgetData | null>>;
  toolInput: Record<string, unknown>;
  hostContext?: McpUiHostContext;
}

function IntradayAppInner({ app, data, setData, toolInput: _toolInput, hostContext }: IntradayAppInnerProps) {
  const { language, dir, toggle, t } = useLanguage();
  const [symbolInput, setSymbolInput] = useState("");
  const [selectedTimeframe, setSelectedTimeframe] = useState<IntradayTimeframe>("5m");
  const [isRefreshing, setIsRefreshing] = useState(true);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [legendValues, setLegendValues] = useState<LegendValues | null>(null);
  const [showVolume, setShowVolume] = useState(true);
  const [showCandles, setShowCandles] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
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
  }, [data]);

  // Aggregate raw data into candles
  const { candleData, volumeData } = useMemo(() => {
    if (!data?.items || data.items.length === 0) return { candleData: [], volumeData: [] };

    const candles = aggregateCandles(data.items, selectedTimeframe);

    const candleChartData: CandlestickData<Time>[] = candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const volumeChartData: HistogramData<Time>[] = candles.map((c) => ({
      time: c.time as Time,
      value: c.volume,
      color: c.close >= c.open ? "rgba(16, 185, 129, 0.4)" : "rgba(239, 68, 68, 0.4)",
    }));

    return { candleData: candleChartData, volumeData: volumeChartData };
  }, [data?.items, selectedTimeframe]);

  // Build legend lookup map
  const legendMap = useMemo(() => {
    if (!data?.items) return new Map<number, LegendValues>();
    const candles = aggregateCandles(data.items, selectedTimeframe);
    const map = new Map<number, LegendValues>();
    for (const c of candles) {
      const change = c.open !== 0 ? ((c.close - c.open) / c.open) * 100 : null;
      map.set(c.time, { open: c.open, high: c.high, low: c.low, close: c.close, change, volume: c.volume });
    }
    return map;
  }, [data?.items, selectedTimeframe]);

  // Set default legend to last bar
  useEffect(() => {
    if (candleData.length > 0 && !legendValues) {
      const lastTime = candleData[candleData.length - 1].time as number;
      const values = legendMap.get(lastTime);
      if (values) setLegendValues(values);
    }
  }, [candleData, legendMap, legendValues]);

  // Handle crosshair move
  const handleCrosshairMove = useCallback((params: MouseEventParams<Time>) => {
    if (params.time) {
      const values = legendMap.get(params.time as number);
      if (values) {
        setLegendValues(values);
        return;
      }
    }
    if (candleData.length > 0) {
      const lastTime = candleData[candleData.length - 1].time as number;
      const values = legendMap.get(lastTime);
      if (values) setLegendValues(values);
    }
  }, [legendMap, candleData]);

  // Refresh data from server
  const handleRefresh = useCallback(async (securityIdOrSymbol?: string | number) => {
    setIsRefreshing(true);
    setRefreshError(null);
    const args: Record<string, unknown> = {};
    if (securityIdOrSymbol) args.securityIdOrSymbol = securityIdOrSymbol;
    try {
      const result = await app.callServerTool({
        name: "get-symbol-intraday-candlestick-data",
        arguments: args,
      });
      if (handleSubscriptionRedirect(result, app)) return;
      const fetched = extractIntradayData(result);
      if (fetched) {
        setData(fetched);
        setLegendValues(null);
      } else {
        setRefreshError(t("eod.noDataFound"));
      }
    } catch (e) {
      console.error("Failed to refresh:", e);
      setRefreshError(t("eod.failedToFetch"));
    } finally {
      setIsRefreshing(false);
    }
  }, [app, setData]);

  // Clear initial loading state when data first arrives
  useEffect(() => {
    if (data) setIsRefreshing(false);
  }, [data]);

  // Sync symbol input with data
  useEffect(() => {
    if (data?.symbol && !symbolInput) setSymbolInput(data.symbol);
  }, [data?.symbol, symbolInput]);

  const handleRefreshClick = useCallback(() => {
    if (symbolInput.trim()) {
      handleRefresh(symbolInput.trim());
    }
  }, [symbolInput, handleRefresh]);

  // Auto-refresh every 30 seconds (when enabled)
  useEffect(() => {
    if (!autoRefresh || !data?.symbol) return;
    const interval = setInterval(() => {
      handleRefresh(data.securityId);
    }, AUTO_REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, [autoRefresh, data?.symbol, data?.securityId, handleRefresh]);

  const subtitle = data
    ? `${data.symbol} (ID: ${data.securityId}) · ${data.count} ticks · ${selectedTimeframe}`
    : undefined;

  return (
    <WidgetLayout title={t("landing.tool.symbolIntradayCandlestick")} subtitle={subtitle} app={app} hostContext={hostContext} language={language} dir={dir} onLanguageToggle={toggle}>

      <div className={styles.controls}>
        <label className={styles.dateLabel}>
          {t("candlestick.symbol")}
          <input
            type="text"
            className={styles.dateInput}
            value={symbolInput}
            onChange={(e) => setSymbolInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleRefreshClick(); }}
            placeholder={t("common.eg") + " TEVA"}
            style={{ minWidth: "100px" }}
          />
        </label>
        <button
          className={styles.refreshButton}
          onClick={handleRefreshClick}
          disabled={isRefreshing}
        >
          {isRefreshing ? t("eod.loading") : t("eod.refresh")}
        </button>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          {t("candlestick.autoRefresh")}
        </label>
      </div>

      <div className={styles.overlays}>
        <div className={styles.timeframeGroup}>
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.value}
              className={`${styles.timeframeBtn} ${selectedTimeframe === tf.value ? styles.timeframeBtnActive : ""}`}
              onClick={() => { setSelectedTimeframe(tf.value); setLegendValues(null); }}
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
      </div>

      {refreshError && (
        <div className={styles.loading}>{refreshError}</div>
      )}

      {data && candleData.length === 0 ? (
        <div className={styles.loading}>{t("candlestick.noIntraday")}</div>
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
                ...({ attributionLogo: false } as Record<string, unknown>),
              },
              grid: {
                vertLines: { color: "rgba(197, 203, 206, 0.2)" },
                horzLines: { color: "rgba(197, 203, 206, 0.2)" },
              },
              crosshair: {
                mode: 0,
              },
              rightPriceScale: {
                borderColor: "rgba(197, 203, 206, 0.4)",
              },
              timeScale: {
                borderColor: "rgba(197, 203, 206, 0.4)",
                timeVisible: true,
                secondsVisible: false,
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
            <TimeScale>
              <TimeScaleFitContentTrigger deps={[candleData]} />
            </TimeScale>
          </Chart>
        </div>
      ) : null}
    </WidgetLayout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IntradayCandlestickApp />
  </StrictMode>,
);
