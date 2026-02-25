/**
 * My Position Widget
 * Displays EOD data for user's portfolio symbols in a sortable table.
 * Columns: Symbol | Company | Close | {period}% | Turnover | RSI | EZ
 * Period selector switches the change % and close price.
 */
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./my-position-table-widget.module.css";

// ─── Types ──────────────────────────────────────────────────────────

type HeatmapPeriod = "1D" | "1W" | "1M" | "3M";

const PERIODS: { value: HeatmapPeriod; label: string }[] = [
  { value: "1D", label: "1D" },
  { value: "1W", label: "1W" },
  { value: "1M", label: "1M" },
  { value: "3M", label: "3M" },
];

type SortKey = "symbol" | "companyName" | "closingPrice" | "change" | "turnover" | "rsi14" | "ez";
type SortDir = "asc" | "desc";

interface StockData {
  tradeDate: string;
  symbol: string;
  change: number | null;
  closingPrice: number | null;
  turnover: number | null;
  rsi14: number | null;
  ez: number | null;
  companyName: string | null;
  [key: string]: unknown;
}

interface EndOfDaySymbolsData {
  symbols: string[];
  count: number;
  dateFrom: string | null;
  dateTo: string | null;
  items: StockData[];
}

// ─── Extraction ─────────────────────────────────────────────────────

function extractData(result: CallToolResult | null | undefined): EndOfDaySymbolsData | null {
  try {
    if (!result) return null;
    if (result.structuredContent) {
      const d = result.structuredContent as unknown as EndOfDaySymbolsData;
      if (Array.isArray(d?.items)) return d;
    }
    const textContent = result.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;
    let parsed = JSON.parse(textContent.text);
    // ChatGPT double-wrap: { text: "{actual JSON}" }
    if (parsed && typeof parsed.text === "string" && !parsed.items) {
      parsed = JSON.parse(parsed.text);
    }
    return parsed as EndOfDaySymbolsData;
  } catch {
    return null;
  }
}

// ─── Formatters ─────────────────────────────────────────────────────

function fmtPrice(v: number | null): string {
  return v != null ? v.toFixed(2) : "—";
}

function fmtTurnover(v: number | null): string {
  if (v == null) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return String(Math.round(v));
}

function fmtRsi(v: number | null): string {
  return v != null ? v.toFixed(1) : "—";
}

function fmtEz(v: number | null): string {
  if (v == null) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2);
}

function fmtChange(v: number | null): string {
  if (v == null) return "—";
  return (v >= 0 ? "+" : "") + v.toFixed(2) + "%";
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
  const [baseData, setBaseData] = useState<EndOfDaySymbolsData | null>(null);
  const [period, setPeriod] = useState<HeatmapPeriod>("1D");
  const [periodOverlay, setPeriodOverlay] = useState<Map<
    string,
    { closingPrice: number | null; change: number | null }
  > | null>(null);
  const [isFetchingPeriod, setIsFetchingPeriod] = useState(false);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("symbol");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const { app, error } = useApp({
    appInfo: { name: "My Positions", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});
      app.ontoolinput = async () => {};

      app.ontoolresult = async (result) => {
        try {
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
    },
  });

  // Auto-fetch fallback — only works if symbols stored in baseData (harmless no-op otherwise)
  useEffect(() => {
    if (!needsAutoFetch || !app) return;
    setNeedsAutoFetch(false);
    if (typeof app.callServerTool !== "function") return;
    // Can't auto-fetch without symbols; rely on ontoolresult succeeding
  }, [needsAutoFetch, app]);

  useHostStyles(app ?? null);

  // Reset period when new baseData arrives
  useEffect(() => {
    setPeriod("1D");
    setPeriodOverlay(null);
  }, [baseData]);

  const handleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      const numericCols: SortKey[] = ["closingPrice", "change", "turnover", "rsi14", "ez"];
      setSortDir(numericCols.includes(key) ? "desc" : "asc");
      return key;
    });
  }, []);

  const handlePeriodChange = useCallback(
    async (p: HeatmapPeriod) => {
      setPeriod(p);
      if (p === "1D") {
        setPeriodOverlay(null);
        return;
      }
      if (!app || typeof app.callServerTool !== "function") return;
      if (!baseData?.symbols?.length) return;
      setIsFetchingPeriod(true);
      try {
        const args: Record<string, unknown> = { symbols: baseData.symbols, period: p };
        if (baseData.dateTo) args.tradeDate = baseData.dateTo;
        const result = await app.callServerTool({ name: "get-my-position-table-data", arguments: args });
        const fetched = extractData(result);
        if (fetched) {
          const overlay = new Map<string, { closingPrice: number | null; change: number | null }>();
          for (const item of fetched.items) {
            overlay.set(item.symbol, { closingPrice: item.closingPrice, change: item.change });
          }
          setPeriodOverlay(overlay);
        }
      } catch (e) {
        console.error("Period fetch failed:", e);
      } finally {
        setIsFetchingPeriod(false);
      }
    },
    [app, baseData],
  );

  const displayRows = useMemo((): StockData[] => {
    if (!baseData?.items) return [];
    // Deduplicate: one row per symbol (latest tradeDate)
    const map = new Map<string, StockData>();
    for (const item of baseData.items) {
      const existing = map.get(item.symbol);
      if (!existing || item.tradeDate > existing.tradeDate) {
        map.set(item.symbol, item);
      }
    }
    let rows = Array.from(map.values());
    // Apply period overlay: replace closingPrice + change from period data
    if (period !== "1D" && periodOverlay) {
      rows = rows.map((row) => {
        const ov = periodOverlay.get(row.symbol);
        return ov ? { ...row, closingPrice: ov.closingPrice, change: ov.change } : row;
      });
    }
    rows.sort((a, b) => compareValues(a[sortKey], b[sortKey], sortDir));
    return rows;
  }, [baseData, period, periodOverlay, sortKey, sortDir]);

  if (error) return <div className={styles.error}><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div className={styles.loading}>Connecting...</div>;

  const thProps = (col: SortKey, extraClass?: string) => ({
    className: `${styles.th}${extraClass ? ` ${extraClass}` : ""}`,
    onClick: () => handleSort(col),
  });

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>My Positions</h1>
          {baseData && (
            <div className={styles.subtitle}>
              {baseData.dateTo} · {displayRows.length} symbol{displayRows.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
        <div className={styles.periodBar}>
          {PERIODS.map((p) => (
            <button
              key={p.value}
              className={`${styles.periodBtn} ${period === p.value ? styles.periodBtnActive : ""}`}
              onClick={() => handlePeriodChange(p.value)}
              disabled={isFetchingPeriod}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {!baseData ? (
        <div className={styles.loading}>Loading positions...</div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th {...thProps("symbol", styles.thLeft)}>
                  Symbol <SortIcon col="symbol" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("companyName", styles.thLeft)}>
                  Company <SortIcon col="companyName" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("closingPrice")}>
                  Close <SortIcon col="closingPrice" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("change")}>
                  {period} % <SortIcon col="change" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("turnover")}>
                  Turnover <SortIcon col="turnover" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("rsi14")}>
                  RSI <SortIcon col="rsi14" sortKey={sortKey} sortDir={sortDir} />
                </th>
                <th {...thProps("ez")}>
                  EZ <SortIcon col="ez" sortKey={sortKey} sortDir={sortDir} />
                </th>
              </tr>
            </thead>
            <tbody>
              {displayRows.map((row) => (
                <tr key={row.symbol} className={styles.tr}>
                  <td className={`${styles.tdLeft} ${styles.tdSymbol}`}>{row.symbol}</td>
                  <td className={`${styles.tdLeft} ${styles.tdCompany}`} title={row.companyName ?? ""}>
                    {row.companyName ?? "—"}
                  </td>
                  <td className={styles.td}>{fmtPrice(row.closingPrice)}</td>
                  <td
                    className={`${styles.td} ${
                      row.change != null
                        ? row.change >= 0
                          ? styles.positive
                          : styles.negative
                        : ""
                    }`}
                  >
                    {fmtChange(row.change)}
                  </td>
                  <td className={styles.td}>{fmtTurnover(row.turnover)}</td>
                  <td className={styles.td}>{fmtRsi(row.rsi14)}</td>
                  <td
                    className={`${styles.td} ${
                      row.ez != null
                        ? row.ez > 0
                          ? styles.positive
                          : row.ez < 0
                          ? styles.negative
                          : ""
                        : ""
                    }`}
                  >
                    {fmtEz(row.ez)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MyPositionApp />
  </StrictMode>,
);
