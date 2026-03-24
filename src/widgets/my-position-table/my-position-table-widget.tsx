/**
 * My Position Widget
 * Displays portfolio P&L table: Symbol | SecID | Company | Close | Avg Price | Profit/Loss | % | Period
 */
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { NavRow } from "../../components/NavRow";
import { SymbolActions } from "../../components/SymbolActions";
import { WidgetLayout, handleSubscriptionRedirect, SubscriptionBanner } from "../../components/WidgetLayout";
import { useLanguage } from "../../components/useLanguage";
import styles from "./my-position-table-widget.module.css";

// ─── Types ──────────────────────────────────────────────────────────

type SortKey = "symbol" | "securityId" | "companyName" | "closingPrice" | "avgEntryPrice" | "profitLoss" | "profitLossPct" | "period";
type SortDir = "asc" | "desc";

interface StockData {
  tradeDate: string;
  symbol: string;
  securityId: number;
  closingPrice: number | null;
  companyName: string | null;
  [key: string]: unknown;
}

interface PositionMeta {
  avgEntryPrice?: number;
  startDate: string;
  amount: number;
  side?: string;
}

interface PositionTableData {
  symbols: string[];
  count: number;
  dateFrom: string | null;
  dateTo: string | null;
  items: StockData[];
  positions?: Record<string, PositionMeta>;
}

interface DisplayRow {
  symbol: string;
  securityId: number;
  companyName: string | null;
  closingPrice: number | null;
  avgEntryPrice: number | null;
  profitLoss: number | null;
  profitLossPct: number | null;
  period: number | null;
  startDate: string | null;
}

// ─── Extraction ─────────────────────────────────────────────────────

function extractData(result: CallToolResult | null | undefined): PositionTableData | null {
  try {
    if (!result) return null;
    if (result.structuredContent) {
      const d = result.structuredContent as unknown as PositionTableData;
      if (Array.isArray(d?.items)) return d;
    }
    const textContent = result.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;
    let parsed = JSON.parse(textContent.text);
    // ChatGPT double-wrap: { text: "{actual JSON}" }
    if (parsed && typeof parsed.text === "string" && !parsed.items) {
      parsed = JSON.parse(parsed.text);
    }
    return parsed as PositionTableData;
  } catch {
    return null;
  }
}

// ─── Formatters ─────────────────────────────────────────────────────

function fmtPrice(v: number | null): string {
  return v != null ? v.toFixed(2) : "—";
}

function fmtPnl(v: number | null): string {
  if (v == null) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2);
}

function fmtPnlPct(v: number | null): string {
  if (v == null) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
}

function fmtPeriod(v: number | null): string {
  if (v == null) return "—";
  return v + "d";
}

// ─── Sort helper ─────────────────────────────────────────────────────

function compareValues(a: unknown, b: unknown, dir: SortDir): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const cmp =
    typeof a === "number"
      ? (a as number) - (b as number)
      : String(a).localeCompare(String(b));
  return dir === "asc" ? cmp : -cmp;
}

// ─── Sort icon ───────────────────────────────────────────────────────

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey; sortDir: SortDir }) {
  if (sortKey !== col) return <span className={styles.sortIcon}>↕</span>;
  return <span className={styles.sortIconActive}>{sortDir === "asc" ? "↑" : "↓"}</span>;
}

// ─── Main App ────────────────────────────────────────────────────────

function MyPositionApp() {
  const { language, dir, toggle, t } = useLanguage();
  const [baseData, setBaseData] = useState<PositionTableData | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [subscribeUrl, setSubscribeUrl] = useState<string | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "My Positions", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});
      app.ontoolinput = async () => {};

      app.ontoolresult = async (result) => {
        try {
          if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
          const extracted = extractData(result);
          if (extracted) {
            setBaseData(extracted);
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
    app.callServerTool({ name: "get-my-position-table-data", arguments: {} })
      .then((result) => {
        if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
        const extracted = extractData(result);
        if (extracted) setBaseData(extracted);
      })
      .catch((e) => console.error("Auto-fetch failed:", e));
  }, [needsAutoFetch, app]);

  useHostStyles(app ?? null);

  useEffect(() => {
    if (app) setHostContext(app.getHostContext());
  }, [app]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      const numericCols: SortKey[] = ["securityId", "closingPrice", "avgEntryPrice", "profitLoss", "profitLossPct", "period"];
      setSortDir(numericCols.includes(key) ? "desc" : "asc");
      return key;
    });
  }, []);

  const displayRows = useMemo((): DisplayRow[] => {
    if (!baseData?.items) return [];
    const positions = baseData.positions ?? {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Deduplicate: one row per symbol (latest tradeDate)
    const map = new Map<string, StockData>();
    for (const item of baseData.items) {
      const existing = map.get(item.symbol);
      if (!existing || item.tradeDate > existing.tradeDate) {
        map.set(item.symbol, item);
      }
    }

    let rows: DisplayRow[] = Array.from(map.values()).map((item) => {
      const pos = positions[item.symbol];
      const avgEntryPrice = pos?.avgEntryPrice ?? null;
      const closingPrice = item.closingPrice;

      let profitLoss: number | null = null;
      let profitLossPct: number | null = null;
      if (closingPrice != null && avgEntryPrice != null) {
        profitLoss = closingPrice - avgEntryPrice;
        profitLossPct = (profitLoss / avgEntryPrice) * 100;
      }

      let period: number | null = null;
      if (pos?.startDate) {
        const start = new Date(pos.startDate + "T00:00:00");
        period = Math.floor((today.getTime() - start.getTime()) / 86400000);
      }

      return {
        symbol: item.symbol,
        securityId: item.securityId,
        companyName: item.companyName,
        closingPrice,
        avgEntryPrice,
        profitLoss,
        profitLossPct,
        period,
        startDate: pos?.startDate ?? null,
      };
    });

    rows.sort((a, b) => compareValues(a[sortKey], b[sortKey], sortDir));
    return rows;
  }, [baseData, sortKey, sortDir]);

  if (error) return <div className={styles.error}><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div className={styles.loading}>{t("layout.connecting")}</div>;
  if (subscribeUrl !== null) return (
    <WidgetLayout title="TASE Market" app={app} hostContext={hostContext} language={language} dir={dir} onLanguageToggle={toggle}>
      <SubscriptionBanner subscribeUrl={subscribeUrl} app={app} />
    </WidgetLayout>
  );

  const thProps = (col: SortKey, extraClass?: string) => ({
    className: `${styles.th}${extraClass ? ` ${extraClass}` : ""}`,
    onClick: () => handleSort(col),
  });

  return (
    <WidgetLayout
      title={t("home.tool.myPositionTable")}
      subtitle={baseData ? `${baseData.dateTo} · ${displayRows.length} symbol${displayRows.length !== 1 ? "s" : ""}` : undefined}
      app={app}
      hostContext={hostContext}
      language={language}
      dir={dir}
      onLanguageToggle={toggle}
    >
      <NavRow
        app={app}
        items={[
          { label: t("nav.manager"), prompt: "call show-my-positions-manager-widget" },
          { label: t("nav.candlestick"), prompt: "call show-my-position-candlestick-widget" },
          { label: t("nav.endOfDay"), prompt: "call show-my-position-end-of-day-widget" },
        ]}
      />

      {!baseData ? (
        <div className={styles.loading}>{t("common.loadingPositions")}</div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th {...thProps("symbol", styles.thLeft)}>
                  Symbol <SortIcon col="symbol" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={styles.thActions} />
                <th {...thProps("securityId")}>
                  Sec ID <SortIcon col="securityId" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("companyName", styles.thLeft)}>
                  Company <SortIcon col="companyName" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("closingPrice")}>
                  Close <SortIcon col="closingPrice" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("avgEntryPrice")}>
                  Avg Price <SortIcon col="avgEntryPrice" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("profitLoss")}>
                  P/L <SortIcon col="profitLoss" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("profitLossPct")}>
                  % <SortIcon col="profitLossPct" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("period")}>
                  Period <SortIcon col="period" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th className={styles.thEdit} />
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={row.symbol} className={styles.tr}>
                  <td className={`${styles.tdLeft} ${styles.tdSymbol}`}>{row.symbol}</td>
                  <td className={styles.tdActions}>
                    <SymbolActions symbol={row.symbol} app={app} startDate={row.startDate} />
                  </td>
                  <td className={styles.td}>{row.securityId}</td>
                  <td className={`${styles.tdLeft} ${styles.tdCompany}`} title={row.companyName ?? ""}>
                    {row.companyName ?? "—"}
                  </td>
                  <td className={styles.td}>{fmtPrice(row.closingPrice)}</td>
                  <td className={styles.td}>{fmtPrice(row.avgEntryPrice)}</td>
                  <td
                    className={`${styles.td} ${
                      row.profitLoss != null
                        ? row.profitLoss >= 0
                          ? styles.positive
                          : styles.negative
                        : ""
                    }`}
                  >
                    {fmtPnl(row.profitLoss)}
                  </td>
                  <td
                    className={`${styles.td} ${
                      row.profitLossPct != null
                        ? row.profitLossPct >= 0
                          ? styles.positive
                          : styles.negative
                        : ""
                    }`}
                  >
                    {fmtPnlPct(row.profitLossPct)}
                  </td>
                  <td className={styles.td}>{fmtPeriod(row.period)}</td>
                  <td className={styles.tdEdit}>
                    <button
                      className={styles.editBtn}
                      title={`Edit ${row.symbol}`}
                      onClick={() => {
                        app.sendMessage({
                          role: "user",
                          content: [{ type: "text", text: "call show-my-positions-manager-widget" }],
                        });
                      }}
                    >
                      &#9998;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </WidgetLayout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MyPositionApp />
  </StrictMode>,
);
