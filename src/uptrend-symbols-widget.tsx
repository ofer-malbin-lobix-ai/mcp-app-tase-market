/**
 * Uptrend Symbols List Widget
 * Displays TASE symbols currently in uptrend.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./uptrend-symbols-widget.module.css";

interface UptrendSymbolItem {
  symbol: string;
  ez: number;
}

interface UptrendSymbolsData {
  tradeDate: string;
  marketType: string;
  count: number;
  items: UptrendSymbolItem[];
}

function extractUptrendSymbolsData(callToolResult: CallToolResult | null | undefined): UptrendSymbolsData | null {
  try {
    if (!callToolResult) return null;
    const textContent = callToolResult.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;
    // ChatGPT double-wraps text content: {"text": "{actual JSON}"} — unwrap if needed
    let parsed = JSON.parse(textContent.text);
    if (parsed && typeof parsed.text === "string" && !parsed.items) {
      parsed = JSON.parse(parsed.text);
    }
    const data = parsed as UptrendSymbolsData;
    if (!Array.isArray(data.items)) return null;
    return data;
  } catch {
    return null;
  }
}

function UptrendSymbolsWidget() {
  const [data, setData] = useState<UptrendSymbolsData | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [toolInput, setToolInput] = useState<Record<string, unknown>>({});
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "Uptrend Symbols", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});

      app.ontoolinput = async (input) => {
        if (input?.arguments) {
          setToolInput(input.arguments as Record<string, unknown>);
        }
      };

      app.ontoolresult = async (result) => {
        try {
          const uptrendSymbolsData = extractUptrendSymbolsData(result);
          if (uptrendSymbolsData) {
            setData(uptrendSymbolsData);
          } else {
            setNeedsAutoFetch(true);
          }
        } catch (e) {
          console.error("ontoolresult error:", e);
        }
      };

      app.ontoolcancelled = () => {};
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
      app.callServerTool({ name: "get-uptrend-symbols-data", arguments: toolInput })
        .then((result) => {
          const fetchedData = extractUptrendSymbolsData(result);
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

  useHostStyles(app ?? null);

  useEffect(() => {
    if (app) {
      setHostContext(app.getHostContext());
    }
  }, [app]);

  if (error) return <div className={styles.error}><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div className={styles.loading}>Connecting...</div>;

  return (
    <UptrendSymbolsWidgetInner
      app={app}
      data={data}
      setData={setData}
      hostContext={hostContext}
    />
  );
}

interface UptrendSymbolsWidgetInnerProps {
  app: App;
  data: UptrendSymbolsData | null;
  setData: React.Dispatch<React.SetStateAction<UptrendSymbolsData | null>>;
  hostContext?: McpUiHostContext;
}

function UptrendSymbolsWidgetInner({ app, data, setData, hostContext }: UptrendSymbolsWidgetInnerProps) {
  const [selectedDate, setSelectedDate] = useState<string>("");
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

  // Sync date picker with the trade date from data
  useEffect(() => {
    if (data?.tradeDate && !selectedDate) {
      setSelectedDate(data.tradeDate);
    }
  }, [data?.tradeDate, selectedDate]);

  const handleRefresh = useCallback(async (tradeDate?: string) => {
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      const args: Record<string, string> = {};
      if (tradeDate) args.tradeDate = tradeDate;
      const result = await app.callServerTool({
        name: "get-uptrend-symbols-data",
        arguments: args,
      });
      const uptrendSymbolsData = extractUptrendSymbolsData(result);
      if (uptrendSymbolsData) {
        setData(uptrendSymbolsData);
      } else {
        setRefreshError("No data found for this date");
      }
    } catch (e) {
      console.error("Failed to refresh data:", e);
      setRefreshError("Failed to fetch data");
    } finally {
      setIsRefreshing(false);
    }
  }, [app, setData]);

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
          <h1 className={styles.title}>Uptrend Symbols</h1>
          {data && (
            <div className={styles.subtitle}>
              {data.tradeDate} · {data.marketType}
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
        <div className={styles.stats}>
          <div className={styles.statBadge}>
            <span className={styles.statNumber}>{data.count}</span>
            <span className={styles.statLabel}>symbols in uptrend</span>
          </div>
        </div>
      )}

      {data && data.items.length > 0 && (
        <div className={styles.symbolsContainer}>
          <div className={styles.symbolsGrid}>
            {data.items.map((item) => (
              <div key={item.symbol} className={styles.symbolCard}>
                <span className={styles.symbolName}>{item.symbol}</span>
                <span className={styles.ezValue}>{item.ez.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {data && data.items.length === 0 && (
        <div className={styles.empty}>No symbols in uptrend for this date.</div>
      )}

      {refreshError && (
        <div className={styles.waiting}>{refreshError}</div>
      )}

      {!data && !refreshError && (
        <div className={styles.waiting}>Waiting for data...</div>
      )}

      <div className={styles.controls}>
        <label className={styles.label}>
          Trade Date:
          <input
            type="date"
            className={styles.select}
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </label>
        <button
          className={styles.refreshButton}
          onClick={() => handleRefresh(selectedDate || undefined)}
          disabled={isRefreshing}
        >
          {isRefreshing ? "Loading..." : "Refresh"}
        </button>
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UptrendSymbolsWidget />
  </StrictMode>,
);
