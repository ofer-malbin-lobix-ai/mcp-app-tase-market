/**
 * Landing Page Widget
 * Shows available TASE Market tools organized by category tabs.
 */
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { StrictMode, useEffect, useState } from "react";
import { WidgetLayout } from "../components/WidgetLayout";
import { createRoot } from "react-dom/client";
import styles from "./tase-market-landing-widget.module.css";

const WIDGET_REFERENCE = [
  { n: 1, widget: "market-end-of-day", showTool: "show-market-end-of-day-widget", showParams: "marketType?, tradeDate?", dataTools: ["get-market-end-of-day-data"], dataParams: ["marketType?, tradeDate?"] },
  { n: 2, widget: "market-spirit", showTool: "show-market-spirit-widget", showParams: "marketType?, tradeDate?", dataTools: ["get-market-spirit-data"], dataParams: ["marketType?, tradeDate?"] },
  { n: 3, widget: "market-uptrend-symbols", showTool: "show-market-uptrend-symbols-widget", showParams: "marketType?, tradeDate?", dataTools: ["get-market-uptrend-symbols-data"], dataParams: ["marketType?, tradeDate?"] },
  { n: 4, widget: "market-sector-heatmap", showTool: "show-market-sector-heatmap-widget", showParams: "marketType?, tradeDate?, period?", dataTools: ["get-market-sector-heatmap-data"], dataParams: ["marketType?, tradeDate?, period?"] },
  { n: 5, widget: "market-dashboard", showTool: "show-market-dashboard-widget", showParams: "marketType?, tradeDate?", dataTools: ["get-market-spirit-data", "get-market-end-of-day-data", "get-market-uptrend-symbols-data"], dataParams: ["(same as individual tools)"] },
  { n: 6, widget: "my-position-table", showTool: "show-my-position-table-widget", showParams: "tradeDate?", dataTools: ["get-my-position-table-data"], dataParams: ["tradeDate?"] },
  { n: 7, widget: "my-position-candlestick", showTool: "show-my-position-candlestick-widget", showParams: "dateFrom, dateTo?", dataTools: ["get-my-position-end-of-day-data", "get-symbol-candlestick-data", "get-my-position-period-data"], dataParams: ["dateFrom?, dateTo?", "symbol, dateFrom?, dateTo?, timeframe?", "tradeDate?, period?"] },
  { n: 8, widget: "my-position-end-of-day", showTool: "show-my-position-end-of-day-widget", showParams: "tradeDate?", dataTools: ["get-my-position-end-of-day-data"], dataParams: ["tradeDate?"] },
  { n: 9, widget: "my-positions-manager", showTool: "show-my-positions-manager-widget", showParams: "none", dataTools: ["get-user-positions", "set-user-position", "delete-user-position"], dataParams: ["none", "symbol, startDate, amount, avgEntryPrice?, alloc?, side?", "symbol"] },
  { n: 10, widget: "my-watchlist-manager", showTool: "show-my-watchlist-manager-widget", showParams: "none", dataTools: ["get-user-watchlist", "set-user-watchlist-item", "delete-user-watchlist-item"], dataParams: ["none", "symbol, startDate, note?", "symbol"] },
  { n: 11, widget: "my-watchlist-table", showTool: "show-my-watchlist-table-widget", showParams: "tradeDate?", dataTools: ["get-my-watchlist-table-data"], dataParams: ["tradeDate?, period?"] },
  { n: 12, widget: "my-watchlist-end-of-day", showTool: "show-my-watchlist-end-of-day-widget", showParams: "tradeDate?", dataTools: ["get-my-watchlist-end-of-day-data"], dataParams: ["tradeDate?"] },
  { n: 13, widget: "my-watchlist-candlestick", showTool: "show-my-watchlist-candlestick-widget", showParams: "dateFrom, dateTo?", dataTools: ["get-my-watchlist-end-of-day-data", "get-symbol-candlestick-data", "get-my-watchlist-period-data"], dataParams: ["dateFrom?, dateTo?", "symbol, dateFrom?, dateTo?, timeframe?", "tradeDate?, period?"] },
  { n: 14, widget: "symbols-candlestick", showTool: "show-symbols-candlestick-widget", showParams: "symbols, dateFrom, dateTo?", dataTools: ["get-symbols-end-of-days-data", "get-symbol-candlestick-data", "get-symbols-period-data"], dataParams: ["symbols?, dateFrom?, dateTo?", "symbol, dateFrom?, dateTo?, timeframe?", "symbols, tradeDate?, period?"] },
  { n: 15, widget: "symbols-table", showTool: "show-symbols-table-widget", showParams: "symbols, tradeDate?", dataTools: ["get-symbols-table-data"], dataParams: ["symbols, tradeDate?, period?"] },
  { n: 16, widget: "symbols-end-of-day", showTool: "show-symbols-end-of-day-widget", showParams: "symbols, tradeDate?", dataTools: ["get-symbols-end-of-day-data"], dataParams: ["symbols, tradeDate?"] },
  { n: 17, widget: "symbol-end-of-days", showTool: "show-symbol-end-of-days-widget", showParams: "symbol, dateFrom?, dateTo?", dataTools: ["get-symbol-end-of-days-data"], dataParams: ["symbol, dateFrom?, dateTo?"] },
  { n: 18, widget: "symbol-candlestick", showTool: "show-symbol-candlestick-widget", showParams: "symbol, dateFrom?, dateTo?, timeframe?", dataTools: ["get-symbol-candlestick-data"], dataParams: ["symbol, dateFrom?, dateTo?, timeframe?"] },
  { n: 19, widget: "symbol-intraday-candlestick", showTool: "show-symbol-intraday-candlestick-widget", showParams: "securityIdOrSymbol", dataTools: ["get-symbol-intraday-candlestick-data"], dataParams: ["securityIdOrSymbol"] },
  { n: 20, widget: "market-last-update", showTool: "show-market-last-update-widget", showParams: "none", dataTools: ["get-market-last-update-data"], dataParams: ["none"] },
  { n: 21, widget: "settings", showTool: "show-tase-market-settings-widget", showParams: "none", dataTools: ["get-tase-market-settings-data"], dataParams: ["none"] },
  { n: 22, widget: "landing", showTool: "show-tase-market-landing-widget", showParams: "none", dataTools: ["none (static)"], dataParams: ["\u2014"] },
];

const DATA_TOOL_REFERENCE = [
  { n: 1, tool: "get-market-end-of-day-data", params: "marketType?, tradeDate?", visibility: "model, app", usedBy: "market-end-of-day, market-dashboard" },
  { n: 2, tool: "get-market-spirit-data", params: "marketType?, tradeDate?", visibility: "model, app", usedBy: "market-spirit, market-dashboard" },
  { n: 3, tool: "get-market-uptrend-symbols-data", params: "marketType?, tradeDate?", visibility: "model, app", usedBy: "market-uptrend-symbols, market-dashboard" },
  { n: 4, tool: "get-market-sector-heatmap-data", params: "marketType?, tradeDate?, period?", visibility: "model, app", usedBy: "market-sector-heatmap" },
  { n: 5, tool: "get-my-position-table-data", params: "tradeDate?", visibility: "model, app", usedBy: "my-position-table" },
  { n: 6, tool: "get-my-position-end-of-day-data", params: "tradeDate?", visibility: "model, app", usedBy: "my-position-end-of-day, my-position-candlestick" },
  { n: 7, tool: "get-my-position-period-data", params: "tradeDate?, period?", visibility: "model, app", usedBy: "my-position-candlestick" },
  { n: 8, tool: "get-user-positions", params: "none", visibility: "model, app", usedBy: "my-positions-manager" },
  { n: 9, tool: "set-user-position", params: "symbol, startDate, amount, avgEntryPrice?, alloc?, side?", visibility: "app", usedBy: "my-positions-manager" },
  { n: 10, tool: "delete-user-position", params: "symbol", visibility: "app", usedBy: "my-positions-manager" },
  { n: 11, tool: "get-user-watchlist", params: "none", visibility: "model, app", usedBy: "my-watchlist-manager" },
  { n: 12, tool: "set-user-watchlist-item", params: "symbol, startDate, note?", visibility: "app", usedBy: "my-watchlist-manager" },
  { n: 13, tool: "delete-user-watchlist-item", params: "symbol", visibility: "app", usedBy: "my-watchlist-manager" },
  { n: 14, tool: "get-my-watchlist-table-data", params: "tradeDate?, period?", visibility: "model, app", usedBy: "my-watchlist-table" },
  { n: 15, tool: "get-my-watchlist-end-of-day-data", params: "tradeDate?", visibility: "model, app", usedBy: "my-watchlist-end-of-day, my-watchlist-candlestick" },
  { n: 16, tool: "get-my-watchlist-period-data", params: "tradeDate?, period?", visibility: "model, app", usedBy: "my-watchlist-candlestick" },
  { n: 17, tool: "get-symbols-end-of-days-data", params: "symbols?, dateFrom?, dateTo?", visibility: "model, app", usedBy: "symbols-candlestick" },
  { n: 18, tool: "get-symbols-period-data", params: "symbols, tradeDate?, period?", visibility: "model, app", usedBy: "symbols-candlestick" },
  { n: 19, tool: "get-symbols-table-data", params: "symbols, tradeDate?, period?", visibility: "model, app", usedBy: "symbols-table" },
  { n: 20, tool: "get-symbols-end-of-day-data", params: "symbols, tradeDate?", visibility: "model, app", usedBy: "symbols-end-of-day" },
  { n: 21, tool: "get-symbol-end-of-days-data", params: "symbol, dateFrom?, dateTo?", visibility: "model, app", usedBy: "symbol-end-of-days" },
  { n: 22, tool: "get-symbol-candlestick-data", params: "symbol, dateFrom?, dateTo?, timeframe?", visibility: "model, app", usedBy: "symbol-candlestick, my-position-candlestick, my-watchlist-candlestick, symbols-candlestick" },
  { n: 23, tool: "get-symbol-intraday-candlestick-data", params: "securityIdOrSymbol", visibility: "model, app", usedBy: "symbol-intraday-candlestick" },
  { n: 24, tool: "get-market-last-update-data", params: "none", visibility: "model, app", usedBy: "market-last-update" },
  { n: 25, tool: "get-tase-market-settings-data", params: "none", visibility: "model, app", usedBy: "settings" },
];

const TOOL_GROUPS = [
  {
    title: "Market",
    tools: [
      { icon: "\u{1F4CA}", name: "Market Dashboard", description: "Single-page overview combining market spirit, top movers, and uptrend count", prompt: "call show-market-dashboard-widget" },
      { icon: "\u{1F6A6}", name: "Market Spirit", description: "Traffic light indicator for market conditions", prompt: "call show-market-spirit-widget" },
      { icon: "\u{1F4C8}", name: "Market End of Day", description: "Full market data with prices, volume, and technical indicators", prompt: "call show-market-end-of-day-widget" },
      { icon: "\u{2B06}\u{FE0F}", name: "Market Uptrend Symbols", description: "Symbols in uptrend with EZ values", prompt: "call show-market-uptrend-symbols-widget" },
      { icon: "\u{1F5FA}\u{FE0F}", name: "Market Sector Heatmap", description: "Treemap heatmap by sector, sub-sector, and symbol", prompt: "call show-market-sector-heatmap-widget" },
      { icon: "\u{1F4E1}", name: "Market Last Update", description: "Real-time last-update trading data for all securities", prompt: "call show-market-last-update-widget" },
    ],
  },
  {
    title: "My Position",
    tools: [
      { icon: "\u{1F4CB}", name: "My Positions Manager", description: "Add, edit, and delete portfolio positions", prompt: "call show-my-positions-manager-widget" },
      { icon: "\u{1F4CA}", name: "My Position Table", description: "Portfolio EOD table with period selector", prompt: "call show-my-position-table-widget" },
      { icon: "\u{1F4C8}", name: "My Position End of Day", description: "Full DataTable for portfolio on a single date", prompt: "call show-my-position-end-of-day-widget" },
      { icon: "\u{1F56F}\u{FE0F}", name: "My Position Candlestick", description: "Candlestick chart with sidebar", prompt: "call show-my-position-candlestick-widget" },
    ],
  },
  {
    title: "Watchlist",
    tools: [
      { icon: "\u{1F4CB}", name: "Watchlist Manager", description: "Add, edit, and delete watchlist items", prompt: "call show-my-watchlist-manager-widget" },
      { icon: "\u{1F4CA}", name: "Watchlist Table", description: "Watchlist EOD table with period selector", prompt: "call show-my-watchlist-table-widget" },
      { icon: "\u{1F4C8}", name: "Watchlist End of Day", description: "Full DataTable for watchlist on a single date", prompt: "call show-my-watchlist-end-of-day-widget" },
      { icon: "\u{1F56F}\u{FE0F}", name: "Watchlist Candlestick", description: "Candlestick chart with sidebar", prompt: "call show-my-watchlist-candlestick-widget" },
    ],
  },
  {
    title: "Symbols",
    tools: [
      { icon: "\u{1F4CA}", name: "Symbols Table", description: "EOD table for any symbols with period selector", prompt: "call show-symbols-table-widget" },
      { icon: "\u{1F4CB}", name: "Symbols End of Day", description: "Full DataTable for symbols on a single date", prompt: "call show-symbols-end-of-day-widget" },
      { icon: "\u{1F4C8}", name: "Symbol End of Days", description: "Single-symbol EOD data across a date range", prompt: "call show-symbol-end-of-days-widget" },
      { icon: "\u{1F56F}\u{FE0F}", name: "Symbols Candlestick", description: "Candlestick chart for any symbols", prompt: "call show-symbols-candlestick-widget" },
      { icon: "\u{1F56F}\u{FE0F}", name: "Symbol Candlestick", description: "Single-symbol candlestick chart", prompt: "call show-symbol-candlestick-widget" },
      { icon: "\u{23F1}\u{FE0F}", name: "Symbol Intraday Candlestick", description: "Intraday candlestick chart with configurable timeframes", prompt: "call show-symbol-intraday-candlestick-widget" },
    ],
  },
  {
    title: "Reference",
    type: "reference" as const,
    tools: [] as { icon: string; name: string; description: string; prompt: string }[],
  },
];

function ReferencePanel() {
  const [subTab, setSubTab] = useState<"widgets" | "data">("widgets");

  return (
    <div className={styles.referencePanel}>
      <div className={styles.refSubTabs}>
        <button
          className={`${styles.refSubTab} ${subTab === "widgets" ? styles.refSubTabActive : ""}`}
          onClick={() => setSubTab("widgets")}
        >
          Widgets (22)
        </button>
        <button
          className={`${styles.refSubTab} ${subTab === "data" ? styles.refSubTabActive : ""}`}
          onClick={() => setSubTab("data")}
        >
          Data Tools (25)
        </button>
      </div>

      {subTab === "widgets" ? (
        <div className={styles.refTableWrap}>
          <table className={styles.refTable}>
            <thead>
              <tr>
                <th className={styles.refNum}>#</th>
                <th>Widget</th>
                <th>Show Tool</th>
                <th>Show Params</th>
                <th>Data Tools</th>
                <th>Data Params</th>
              </tr>
            </thead>
            <tbody>
              {WIDGET_REFERENCE.map((r) => (
                <tr key={r.n}>
                  <td className={styles.refNum}>{r.n}</td>
                  <td className={styles.refCode}>{r.widget}</td>
                  <td className={styles.refCode}>{r.showTool}</td>
                  <td className={styles.refCode}>{r.showParams}</td>
                  <td className={styles.refCode}>
                    <div className={styles.refMulti}>
                      {r.dataTools.map((t, i) => <div key={i}>{t}</div>)}
                    </div>
                  </td>
                  <td className={styles.refCode}>
                    <div className={styles.refMulti}>
                      {r.dataParams.map((p, i) => <div key={i}>{p}</div>)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.refTableWrap}>
          <table className={styles.refTable}>
            <thead>
              <tr>
                <th className={styles.refNum}>#</th>
                <th>Data Tool</th>
                <th>Input Params</th>
                <th>Visibility</th>
                <th>Used By Widgets</th>
              </tr>
            </thead>
            <tbody>
              {DATA_TOOL_REFERENCE.map((r) => (
                <tr key={r.n}>
                  <td className={styles.refNum}>{r.n}</td>
                  <td className={styles.refCode}>{r.tool}</td>
                  <td className={styles.refCode}>{r.params}</td>
                  <td>{r.visibility}</td>
                  <td className={styles.refCode}>{r.usedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LandingApp() {
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "TASE Data Hub", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});
      app.ontoolresult = async () => {};
      app.ontoolcancelled = () => {};
      app.onerror = console.error;

      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  useHostStyles(app ?? null);

  useEffect(() => {
    if (app) {
      setHostContext(app.getHostContext());
    }
  }, [app]);

  if (error) return <div className={styles.error}><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div className={styles.loading}>Connecting...</div>;

  return <LandingInner hostContext={hostContext} app={app} />;
}

interface LandingInnerProps {
  hostContext?: McpUiHostContext;
  app: NonNullable<ReturnType<typeof useApp>["app"]>;
}

function LandingInner({ hostContext, app }: LandingInnerProps) {
  const [activeTab, setActiveTab] = useState(0);

  return (
    <WidgetLayout title="TASE Market Tools" app={app} hostContext={hostContext} titleClassName={styles.title}>
      <div className={styles.content}>
      <div className={styles.tabsContainer}>
        <div className={styles.tabBar}>
          {TOOL_GROUPS.map((group, i) => (
            <button
              key={group.title}
              className={`${styles.tab} ${i === activeTab ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(i)}
            >
              {group.title}
            </button>
          ))}
          <button
            className={styles.settingsBtn}
            title="Settings"
            onClick={async () => {
              try {
                await app.sendMessage({
                  role: "user",
                  content: [{ type: "text", text: "call show-tase-market-settings-widget" }],
                });
              } catch (e) {
                console.error("sendMessage failed:", e);
              }
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M6.5 1L6.2 2.6C5.8 2.8 5.4 3 5.1 3.3L3.5 2.7L2 5.3L3.4 6.4C3.4 6.6 3.3 6.8 3.3 7C3.3 7.2 3.4 7.4 3.4 7.6L2 8.7L3.5 11.3L5.1 10.7C5.4 11 5.8 11.2 6.2 11.4L6.5 13H9.5L9.8 11.4C10.2 11.2 10.6 11 10.9 10.7L12.5 11.3L14 8.7L12.6 7.6C12.6 7.4 12.7 7.2 12.7 7C12.7 6.8 12.6 6.6 12.6 6.4L14 5.3L12.5 2.7L10.9 3.3C10.6 3 10.2 2.8 9.8 2.6L9.5 1H6.5ZM8 5C9.1 5 10 5.9 10 7C10 8.1 9.1 9 8 9C6.9 9 6 8.1 6 7C6 5.9 6.9 5 8 5Z" fill="currentColor"/>
            </svg>
          </button>
        </div>
        <div className={styles.tabPanel}>
          {"type" in TOOL_GROUPS[activeTab] && TOOL_GROUPS[activeTab].type === "reference" ? (
            <ReferencePanel />
          ) : (
            TOOL_GROUPS[activeTab].tools.map((tool) => (
              <button
                key={tool.name}
                className={styles.featureCard}
                onClick={async () => {
                  try {
                    await app.sendMessage({
                      role: "user",
                      content: [{ type: "text", text: tool.prompt }],
                    });
                  } catch (e) {
                    console.error("sendMessage failed:", e);
                  }
                }}
              >
                <span className={styles.featureIcon}>{tool.icon}</span>
                <span className={styles.featureName}>{tool.name}</span>
                <span className={styles.featureDescription}>{tool.description}</span>
              </button>
            ))
          )}
        </div>
      </div>

      </div>
    </WidgetLayout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LandingApp />
  </StrictMode>,
);
