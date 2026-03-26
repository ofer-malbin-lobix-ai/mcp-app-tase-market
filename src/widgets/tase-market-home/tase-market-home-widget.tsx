/**
 * Home Page Widget
 * Shows available TASE Market tools organized by category tabs.
 */
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { StrictMode, useEffect, useState } from "react";
import { WidgetLayout } from "../../components/WidgetLayout";
import { useLanguage } from "../../components/useLanguage";
import type { TranslationKey } from "../../components/translations";
import { createRoot } from "react-dom/client";
import styles from "./tase-market-home-widget.module.css";

const WIDGET_REFERENCE = [
  { n: 1, widget: "market-end-of-day", showTool: "show-market-end-of-day-widget", showParams: "marketType?, tradeDate?", dataTools: ["get-market-end-of-day-data"], dataParams: ["marketType?, tradeDate?"] },
  { n: 2, widget: "market-spirit", showTool: "show-market-spirit-widget", showParams: "marketType?, tradeDate?", dataTools: ["get-market-spirit-data"], dataParams: ["marketType?, tradeDate?"] },
  { n: 3, widget: "market-sector-heatmap", showTool: "show-market-sector-heatmap-widget", showParams: "marketType?, tradeDate?, period?", dataTools: ["get-market-sector-heatmap-data"], dataParams: ["marketType?, tradeDate?, period?"] },
  { n: 4, widget: "market-momentum", showTool: "show-market-momentum-widget", showParams: "marketType?, tradeDate?", dataTools: ["get-market-momentum-data"], dataParams: ["marketType?, tradeDate?"] },
  { n: 5, widget: "market-anticipation", showTool: "show-market-anticipation-widget", showParams: "marketType?, tradeDate?", dataTools: ["get-market-anticipation-data"], dataParams: ["marketType?, tradeDate?"] },
  { n: 6, widget: "my-position-table", showTool: "show-my-position-table-widget", showParams: "tradeDate?", dataTools: ["get-my-position-table-data"], dataParams: ["tradeDate?"] },
  { n: 7, widget: "my-position-candlestick", showTool: "show-my-position-candlestick-widget", showParams: "dateFrom, dateTo?", dataTools: ["get-my-position-end-of-day-data", "get-symbol-candlestick-data", "get-my-position-period-data"], dataParams: ["dateFrom?, dateTo?", "symbol, dateFrom?, dateTo?, timeframe?", "tradeDate?, period?"] },
  { n: 8, widget: "my-position-end-of-day", showTool: "show-my-position-end-of-day-widget", showParams: "tradeDate?", dataTools: ["get-my-position-end-of-day-data"], dataParams: ["tradeDate?"] },
  { n: 9, widget: "my-positions-manager", showTool: "show-my-positions-manager-widget", showParams: "none", dataTools: ["get-my-positions", "set-my-position", "delete-my-position"], dataParams: ["none", "symbol, startDate, amount, avgEntryPrice?, alloc?, side?", "symbol"] },
  { n: 10, widget: "watchlist-manager", showTool: "show-watchlist-manager-widget", showParams: "none", dataTools: ["get-watchlist", "set-watchlist-item", "delete-watchlist-item"], dataParams: ["none", "symbol, startDate, note?", "symbol"] },
  { n: 11, widget: "watchlist-table", showTool: "show-watchlist-table-widget", showParams: "tradeDate?", dataTools: ["get-watchlist-table-data"], dataParams: ["tradeDate?, period?"] },
  { n: 12, widget: "watchlist-end-of-day", showTool: "show-watchlist-end-of-day-widget", showParams: "tradeDate?", dataTools: ["get-watchlist-end-of-day-data"], dataParams: ["tradeDate?"] },
  { n: 13, widget: "watchlist-candlestick", showTool: "show-watchlist-candlestick-widget", showParams: "dateFrom, dateTo?", dataTools: ["get-watchlist-end-of-day-data", "get-symbol-candlestick-data", "get-watchlist-period-data"], dataParams: ["dateFrom?, dateTo?", "symbol, dateFrom?, dateTo?, timeframe?", "tradeDate?, period?"] },
  { n: 14, widget: "symbols-candlestick", showTool: "show-symbols-candlestick-widget", showParams: "symbols, dateFrom, dateTo?", dataTools: ["get-symbols-end-of-days-data", "get-symbol-candlestick-data", "get-symbols-period-data"], dataParams: ["symbols?, dateFrom?, dateTo?", "symbol, dateFrom?, dateTo?, timeframe?", "symbols, tradeDate?, period?"] },
  { n: 15, widget: "symbols-table", showTool: "show-symbols-table-widget", showParams: "symbols, tradeDate?", dataTools: ["get-symbols-table-data"], dataParams: ["symbols, tradeDate?, period?"] },
  { n: 16, widget: "symbols-end-of-day", showTool: "show-symbols-end-of-day-widget", showParams: "symbols, tradeDate?", dataTools: ["get-symbols-end-of-day-data"], dataParams: ["symbols, tradeDate?"] },
  { n: 17, widget: "symbol-end-of-days", showTool: "show-symbol-end-of-days-widget", showParams: "symbol, dateFrom?, dateTo?", dataTools: ["get-symbol-end-of-days-data"], dataParams: ["symbol, dateFrom?, dateTo?"] },
  { n: 18, widget: "symbol-candlestick", showTool: "show-symbol-candlestick-widget", showParams: "symbol, dateFrom?, dateTo?, timeframe?", dataTools: ["get-symbol-candlestick-data"], dataParams: ["symbol, dateFrom?, dateTo?, timeframe?"] },
  { n: 19, widget: "symbol-intraday-candlestick", showTool: "show-symbol-intraday-candlestick-widget", showParams: "securityIdOrSymbol", dataTools: ["get-symbol-intraday-candlestick-data"], dataParams: ["securityIdOrSymbol"] },
  { n: 20, widget: "market-last-update", showTool: "show-market-last-update-widget", showParams: "none", dataTools: ["get-market-last-update-data"], dataParams: ["none"] },
  { n: 21, widget: "settings", showTool: "show-tase-market-settings-widget", showParams: "none", dataTools: ["get-tase-market-settings-data"], dataParams: ["none"] },
  { n: 22, widget: "home", showTool: "show-tase-market-home-widget", showParams: "none", dataTools: ["none (static)"], dataParams: ["\u2014"] },
];

const DATA_TOOL_REFERENCE = [
  { n: 1, tool: "get-market-end-of-day-data", params: "marketType?, tradeDate?", visibility: "model, app", usedBy: "market-end-of-day" },
  { n: 2, tool: "get-market-spirit-data", params: "marketType?, tradeDate?", visibility: "model, app", usedBy: "market-spirit" },
  { n: 3, tool: "get-market-sector-heatmap-data", params: "marketType?, tradeDate?, period?", visibility: "model, app", usedBy: "market-sector-heatmap" },
  { n: 4, tool: "get-market-momentum-data", params: "marketType?, tradeDate?", visibility: "model, app", usedBy: "market-momentum" },
  { n: 5, tool: "get-market-anticipation-data", params: "marketType?, tradeDate?", visibility: "model, app", usedBy: "market-anticipation" },
  { n: 6, tool: "get-my-position-table-data", params: "tradeDate?", visibility: "model, app", usedBy: "my-position-table" },
  { n: 7, tool: "get-my-position-end-of-day-data", params: "tradeDate?", visibility: "model, app", usedBy: "my-position-end-of-day, my-position-candlestick" },
  { n: 8, tool: "get-my-position-period-data", params: "tradeDate?, period?", visibility: "model, app", usedBy: "my-position-candlestick" },
  { n: 9, tool: "get-my-positions", params: "none", visibility: "model, app", usedBy: "my-positions-manager" },
  { n: 10, tool: "set-my-position", params: "symbol, startDate, amount, avgEntryPrice?, alloc?, side?", visibility: "app", usedBy: "my-positions-manager" },
  { n: 11, tool: "delete-my-position", params: "symbol", visibility: "app", usedBy: "my-positions-manager" },
  { n: 12, tool: "get-watchlist", params: "none", visibility: "model, app", usedBy: "watchlist-manager" },
  { n: 13, tool: "set-watchlist-item", params: "symbol, startDate, note?", visibility: "app", usedBy: "watchlist-manager" },
  { n: 14, tool: "delete-watchlist-item", params: "symbol", visibility: "app", usedBy: "watchlist-manager" },
  { n: 15, tool: "get-watchlist-table-data", params: "tradeDate?, period?", visibility: "model, app", usedBy: "watchlist-table" },
  { n: 16, tool: "get-watchlist-end-of-day-data", params: "tradeDate?", visibility: "model, app", usedBy: "watchlist-end-of-day, watchlist-candlestick" },
  { n: 17, tool: "get-watchlist-period-data", params: "tradeDate?, period?", visibility: "model, app", usedBy: "watchlist-candlestick" },
  { n: 18, tool: "get-symbols-end-of-days-data", params: "symbols?, dateFrom?, dateTo?", visibility: "model, app", usedBy: "symbols-candlestick" },
  { n: 19, tool: "get-symbols-period-data", params: "symbols, tradeDate?, period?", visibility: "model, app", usedBy: "symbols-candlestick" },
  { n: 20, tool: "get-symbols-table-data", params: "symbols, tradeDate?, period?", visibility: "model, app", usedBy: "symbols-table" },
  { n: 21, tool: "get-symbols-end-of-day-data", params: "symbols, tradeDate?", visibility: "model, app", usedBy: "symbols-end-of-day" },
  { n: 22, tool: "get-symbol-end-of-days-data", params: "symbol, dateFrom?, dateTo?", visibility: "model, app", usedBy: "symbol-end-of-days" },
  { n: 23, tool: "get-symbol-candlestick-data", params: "symbol, dateFrom?, dateTo?, timeframe?", visibility: "model, app", usedBy: "symbol-candlestick, my-position-candlestick, watchlist-candlestick, symbols-candlestick" },
  { n: 24, tool: "get-symbol-intraday-candlestick-data", params: "securityIdOrSymbol", visibility: "model, app", usedBy: "symbol-intraday-candlestick" },
  { n: 25, tool: "get-market-last-update-data", params: "none", visibility: "model, app", usedBy: "market-last-update" },
  { n: 26, tool: "get-tase-market-settings-data", params: "none", visibility: "model, app", usedBy: "settings" },
  { n: 27, tool: "get-indices-list-data", params: "language?", visibility: "model, app", usedBy: "standalone" },
];

interface ToolItem {
  icon: string;
  nameKey: TranslationKey;
  descKey: TranslationKey;
  prompt: string;
}

interface ToolGroup {
  titleKey: TranslationKey;
  tools: ToolItem[];
}

const TOOL_GROUPS: ToolGroup[] = [
  {
    titleKey: "home.group.market",
    tools: [
      { icon: "\u{1F6A6}", nameKey: "home.tool.marketSpirit", descKey: "home.desc.marketSpirit", prompt: "call show-market-spirit-widget" },
      { icon: "\u{1F4C8}", nameKey: "home.tool.marketEndOfDay", descKey: "home.desc.marketEndOfDay", prompt: "call show-market-end-of-day-widget" },
      { icon: "\u{1F5FA}\u{FE0F}", nameKey: "home.tool.marketSectorHeatmap", descKey: "home.desc.marketSectorHeatmap", prompt: "call show-market-sector-heatmap-widget" },
      { icon: "\u{1F52C}", nameKey: "home.tool.marketMomentum", descKey: "home.desc.marketMomentum", prompt: "call show-market-momentum-widget" },
      { icon: "\u{1F52E}", nameKey: "home.tool.marketAnticipation", descKey: "home.desc.marketAnticipation", prompt: "call show-market-anticipation-widget" },
      { icon: "\u{1F4E1}", nameKey: "home.tool.marketLastUpdate", descKey: "home.desc.marketLastUpdate", prompt: "call show-market-last-update-widget" },
    ],
  },
  {
    titleKey: "home.group.myPosition",
    tools: [
      { icon: "\u{1F4CB}", nameKey: "home.tool.myPositionsManager", descKey: "home.desc.myPositionsManager", prompt: "call show-my-positions-manager-widget" },
      { icon: "\u{1F4CA}", nameKey: "home.tool.myPositionTable", descKey: "home.desc.myPositionTable", prompt: "call show-my-position-table-widget" },
      { icon: "\u{1F4C8}", nameKey: "home.tool.myPositionEndOfDay", descKey: "home.desc.myPositionEndOfDay", prompt: "call show-my-position-end-of-day-widget" },
      { icon: "\u{1F56F}\u{FE0F}", nameKey: "home.tool.myPositionCandlestick", descKey: "home.desc.myPositionCandlestick", prompt: "call show-my-position-candlestick-widget" },
    ],
  },
  {
    titleKey: "home.group.watchlist",
    tools: [
      { icon: "\u{1F4CB}", nameKey: "home.tool.watchlistManager", descKey: "home.desc.watchlistManager", prompt: "call show-watchlist-manager-widget" },
      { icon: "\u{1F4CA}", nameKey: "home.tool.watchlistTable", descKey: "home.desc.watchlistTable", prompt: "call show-watchlist-table-widget" },
      { icon: "\u{1F4C8}", nameKey: "home.tool.watchlistEndOfDay", descKey: "home.desc.watchlistEndOfDay", prompt: "call show-watchlist-end-of-day-widget" },
      { icon: "\u{1F56F}\u{FE0F}", nameKey: "home.tool.watchlistCandlestick", descKey: "home.desc.watchlistCandlestick", prompt: "call show-watchlist-candlestick-widget" },
    ],
  },
  {
    titleKey: "home.group.symbols",
    tools: [
      { icon: "\u{1F4CA}", nameKey: "home.tool.symbolsTable", descKey: "home.desc.symbolsTable", prompt: "call show-symbols-table-widget" },
      { icon: "\u{1F4CB}", nameKey: "home.tool.symbolsEndOfDay", descKey: "home.desc.symbolsEndOfDay", prompt: "call show-symbols-end-of-day-widget" },
      { icon: "\u{1F4C8}", nameKey: "home.tool.symbolEndOfDays", descKey: "home.desc.symbolEndOfDays", prompt: "call show-symbol-end-of-days-widget" },
      { icon: "\u{1F56F}\u{FE0F}", nameKey: "home.tool.symbolsCandlestick", descKey: "home.desc.symbolsCandlestick", prompt: "call show-symbols-candlestick-widget" },
      { icon: "\u{1F56F}\u{FE0F}", nameKey: "home.tool.symbolCandlestick", descKey: "home.desc.symbolCandlestick", prompt: "call show-symbol-candlestick-widget" },
      { icon: "\u{23F1}\u{FE0F}", nameKey: "home.tool.symbolIntradayCandlestick", descKey: "home.desc.symbolIntradayCandlestick", prompt: "call show-symbol-intraday-candlestick-widget" },
    ],
  },
];

function ReferencePanel({ t }: { t: (key: TranslationKey) => string }) {
  const [subTab, setSubTab] = useState<"widgets" | "data">("widgets");

  return (
    <div className={styles.referencePanel}>
      <div className={styles.refSubTabs}>
        <button
          className={`${styles.refSubTab} ${subTab === "widgets" ? styles.refSubTabActive : ""}`}
          onClick={() => setSubTab("widgets")}
        >
          {t("home.widgets")} (22)
        </button>
        <button
          className={`${styles.refSubTab} ${subTab === "data" ? styles.refSubTabActive : ""}`}
          onClick={() => setSubTab("data")}
        >
          {t("home.dataTools")} (26)
        </button>
      </div>

      {subTab === "widgets" ? (
        <div className={styles.refTableWrap}>
          <table className={styles.refTable}>
            <thead>
              <tr>
                <th className={styles.refNum}>#</th>
                <th>{t("home.col.widget")}</th>
                <th>{t("home.col.showTool")}</th>
                <th>{t("home.col.showParams")}</th>
                <th>{t("home.col.dataTools")}</th>
                <th>{t("home.col.dataParams")}</th>
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
                <th>{t("home.col.dataTool")}</th>
                <th>{t("home.col.inputParams")}</th>
                <th>{t("home.col.visibility")}</th>
                <th>{t("home.col.usedByWidgets")}</th>
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

function HomeApp() {
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();
  const { t } = useLanguage();

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
  if (!app) return <div className={styles.loading}>{t("layout.connecting")}</div>;

  return <HomeInner hostContext={hostContext} app={app} />;
}

interface HomeInnerProps {
  hostContext?: McpUiHostContext;
  app: NonNullable<ReturnType<typeof useApp>["app"]>;
}

function HomeInner({ hostContext, app }: HomeInnerProps) {
  const [activeTab, setActiveTab] = useState(0);
  const [refOpen, setRefOpen] = useState(false);
  const { language, t, dir, toggle } = useLanguage();

  return (
    <WidgetLayout title={t("home.title")} app={app} hostContext={hostContext} titleClassName={styles.title} language={language} dir={dir} onLanguageToggle={toggle}>
      <div className={styles.content}>
      <div className={styles.tabsContainer}>
        <div className={styles.tabBar}>
          {TOOL_GROUPS.map((group, i) => (
            <button
              key={group.titleKey}
              className={`${styles.tab} ${i === activeTab ? styles.tabActive : ""}`}
              onClick={() => setActiveTab(i)}
            >
              {t(group.titleKey)}
            </button>
          ))}
        </div>
        <div className={styles.tabPanel}>
          {TOOL_GROUPS[activeTab].tools.map((tool) => (
            <button
              key={tool.nameKey}
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
              <span className={styles.featureName}>{t(tool.nameKey)}</span>
              <span className={styles.featureDescription}>{t(tool.descKey)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.metaRow}>
        <button className={styles.referenceToggle} onClick={() => setRefOpen(!refOpen)}>
          <span className={`${styles.referenceArrow} ${refOpen ? styles.referenceArrowOpen : ""}`}>&#9654;</span>
          {t("home.reference")}
        </button>
        <button
          className={styles.settingsBtn}
          title={t("home.settings")}
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
          {t("home.settings")}
        </button>
      </div>
      {refOpen && <div className={styles.referenceContent}><ReferencePanel t={t} /></div>}

      </div>
    </WidgetLayout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <HomeApp />
  </StrictMode>,
);
