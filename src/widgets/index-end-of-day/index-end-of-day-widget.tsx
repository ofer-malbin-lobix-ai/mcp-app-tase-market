/**
 * Index End of Day Widget — Sector Breakdown
 * Shows all stocks in a TASE index grouped by sector in an accordion layout.
 */
import type { App, McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { WidgetLayout, handleSubscriptionRedirect, SubscriptionBanner } from "../../components/WidgetLayout";
import { useLanguage } from "../../components/useLanguage";
import { SearchableSelect } from "../../components/SearchableSelect";
import { SymbolActions } from "../../components/SymbolActions";
import type { TranslationKey } from "../../components/translations";
import { extractEndOfDayData, formatPercent, formatVolume, formatNumber } from "../shared/end-of-day-shared";
import type { StockData } from "../shared/end-of-day-shared";
// @ts-ignore — JSON import
import indicesData from "../../data/indices.json";
import styles from "./index-end-of-day-widget.module.css";

// ── Constants ──────────────────────────────────────────────────────────────────

const TOOL_NAME = "get-index-end-of-day-data";
const DEFAULT_INDEX_ID = 137; // TA-125

const SECTOR_COLORS = [
  "#4f86f7", "#f7a84f", "#4fc76f", "#f74f6d", "#a84ff7",
  "#f7df4f", "#4fd4f7", "#f7864f", "#86f74f", "#d44ff7",
  "#4ff7c7", "#f74faf",
];

type SortField = "change" | "turnover" | "rsi14" | "ez" | "marketCap";

const SORT_FIELDS: { field: SortField; labelKey: TranslationKey }[] = [
  { field: "change", labelKey: "indexEod.sort.chgPct" },
  { field: "turnover", labelKey: "indexEod.sort.turnover" },
  { field: "rsi14", labelKey: "indexEod.sort.rsi" },
  { field: "ez", labelKey: "indexEod.sort.ez" },
  { field: "marketCap", labelKey: "indexEod.sort.mktCap" },
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function sectorColorIndex(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % SECTOR_COLORS.length;
}

function avgField(stocks: StockData[], field: SortField): number {
  let sum = 0, count = 0;
  for (const s of stocks) {
    const v = s[field];
    if (v != null) { sum += v; count++; }
  }
  return count > 0 ? sum / count : 0;
}

function getStockIndices(): { value: string; label: string }[] {
  const list = (indicesData as any).en as { index: number; indexName: string }[];
  return list
    .filter((idx) => idx.index < 500)
    .map((idx) => ({ value: String(idx.index), label: idx.indexName }));
}

// ── App Shell ──────────────────────────────────────────────────────────────────

function IndexEndOfDayApp() {
  const { t } = useLanguage();
  const [data, setData] = useState<StockData[] | null>(null);
  const [tradeDate, setTradeDate] = useState<string>("");
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [toolInput, setToolInput] = useState<Record<string, unknown>>({});
  const [subscribeUrl, setSubscribeUrl] = useState<string | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "Index End of Day", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});

      app.ontoolinput = async (input) => {
        if (input?.arguments) setToolInput(input.arguments as Record<string, unknown>);
      };

      app.ontoolresult = async (result) => {
        if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
        const d = extractEndOfDayData(result);
        if (d) {
          setData(d.rows);
          if (d.tradeDate) setTradeDate(d.tradeDate.split("T")[0]!);
        } else {
          setNeedsAutoFetch(true);
        }
      };

      app.ontoolcancelled = () => {};
      app.onerror = console.error;
      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  useEffect(() => {
    if (!needsAutoFetch || !app) return;
    setNeedsAutoFetch(false);
    if (typeof app.callServerTool !== "function") return;
    app.callServerTool({ name: TOOL_NAME, arguments: toolInput })
      .then((result) => {
        if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
        const d = extractEndOfDayData(result);
        if (d) {
          setData(d.rows);
          if (d.tradeDate) setTradeDate(d.tradeDate.split("T")[0]!);
        }
      })
      .catch(console.error);
  }, [needsAutoFetch, app, toolInput]);

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

  return (
    <IndexEndOfDayInner
      app={app}
      data={data}
      tradeDate={tradeDate}
      setTradeDate={setTradeDate}
      setData={setData}
      hostContext={hostContext}
      initialIndexId={toolInput.indexId != null ? String(toolInput.indexId) : String(DEFAULT_INDEX_ID)}
    />
  );
}

// ── Inner Component ────────────────────────────────────────────────────────────

interface InnerProps {
  app: App;
  data: StockData[] | null;
  tradeDate: string;
  setTradeDate: (d: string) => void;
  setData: (d: StockData[] | null) => void;
  hostContext?: McpUiHostContext;
  initialIndexId: string;
}

function IndexEndOfDayInner({ app, data, tradeDate, setTradeDate, setData, hostContext, initialIndexId }: InnerProps) {
  const { language, dir, toggle, t } = useLanguage();
  const [selectedDate, setSelectedDate] = useState(tradeDate);
  const [selectedIndexId, setSelectedIndexId] = useState(initialIndexId);
  const [isRefreshing, setIsRefreshing] = useState(!data);
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("change");
  const [expandedSectors, setExpandedSectors] = useState<Set<string>>(new Set());

  const indexOptions = useMemo(() => getStockIndices(), []);

  const selectedIndexName = useMemo(() => {
    return indexOptions.find((o) => o.value === selectedIndexId)?.label ?? `Index ${selectedIndexId}`;
  }, [indexOptions, selectedIndexId]);

  // Sync date from data
  useEffect(() => {
    if (tradeDate && !selectedDate) setSelectedDate(tradeDate);
  }, [tradeDate, selectedDate]);

  // Clear refresh state when data arrives
  useEffect(() => {
    if (data) setIsRefreshing(false);
  }, [data]);

  // Auto-expand all sectors on first load
  useEffect(() => {
    if (data && expandedSectors.size === 0) {
      const sectors = new Set(data.map((s) => s.sector ?? t("indexEod.otherSector")));
      setExpandedSectors(sectors);
    }
  }, [data]);

  const fetchData = useCallback((date?: string, indexId?: string) => {
    if (!app || typeof app.callServerTool !== "function") return;
    setIsRefreshing(true);
    const args: Record<string, unknown> = {};
    if (date) args.tradeDate = date;
    if (indexId) args.indexId = Number(indexId);
    app.callServerTool({ name: TOOL_NAME, arguments: args })
      .then((result) => {
        const d = extractEndOfDayData(result);
        if (d) {
          setData(d.rows);
          if (d.tradeDate) {
            const dt = d.tradeDate.split("T")[0]!;
            setTradeDate(dt);
            setSelectedDate(dt);
          }
        }
      })
      .catch(console.error)
      .finally(() => setIsRefreshing(false));
  }, [app, setData, setTradeDate]);

  const handleDateChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const d = e.target.value;
    setSelectedDate(d);
    if (d) fetchData(d, selectedIndexId);
  }, [fetchData, selectedIndexId]);

  const handleIndexChange = useCallback((val: string) => {
    setSelectedIndexId(val);
    fetchData(selectedDate || undefined, val);
  }, [fetchData, selectedDate]);

  // Filter stocks by search
  const filteredStocks = useMemo(() => {
    if (!data) return [];
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter((s) =>
      s.symbol.toLowerCase().includes(q) ||
      (s.companyName?.toLowerCase().includes(q)) ||
      (s.sector?.toLowerCase().includes(q)) ||
      (s.subSector?.toLowerCase().includes(q))
    );
  }, [data, search]);

  // Group by sector
  const sectorGroups = useMemo(() => {
    const otherLabel = t("indexEod.otherSector");
    const map = new Map<string, StockData[]>();
    for (const stock of filteredStocks) {
      const sec = stock.sector ?? otherLabel;
      const arr = map.get(sec) ?? [];
      arr.push(stock);
      map.set(sec, arr);
    }

    // Sort stocks within each sector
    for (const [, stocks] of map) {
      stocks.sort((a, b) => {
        const av = a[sortField] ?? 0;
        const bv = b[sortField] ?? 0;
        return bv - av;
      });
    }

    // Sort sectors by avg of sort field
    const entries = Array.from(map.entries());
    entries.sort((a, b) => avgField(b[1], sortField) - avgField(a[1], sortField));
    return entries;
  }, [filteredStocks, sortField, t]);

  // Summary stats
  const stats = useMemo(() => {
    if (!data || data.length === 0) return null;
    const constituents = data.length;
    const advancers = data.filter((s) => (s.change ?? 0) > 0).length;
    const decliners = data.filter((s) => (s.change ?? 0) < 0).length;
    let changeSum = 0, changeCount = 0;
    let turnoverSum = 0;
    for (const s of data) {
      if (s.change != null) { changeSum += s.change; changeCount++; }
      turnoverSum += s.turnover ?? 0;
    }
    const avgChange = changeCount > 0 ? changeSum / changeCount : 0;
    const sectorCount = new Set(data.map((s) => s.sector ?? "Other")).size;
    return { constituents, advancers, decliners, avgChange, turnoverSum, sectorCount };
  }, [data]);

  const toggleSector = useCallback((sector: string) => {
    setExpandedSectors((prev) => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector); else next.add(sector);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpandedSectors(new Set(sectorGroups.map(([s]) => s)));
  }, [sectorGroups]);

  const collapseAll = useCallback(() => {
    setExpandedSectors(new Set());
  }, []);

  const title = `TASE · ${selectedIndexName} ${t("indexEod.title")}`;

  return (
    <WidgetLayout title={title} app={app} hostContext={hostContext} language={language} dir={dir} onLanguageToggle={toggle}>
      <div className={styles.content}>
        {/* Header controls */}
        <div className={styles.headerRow}>
          <span className={styles.subtitle}>{t("indexEod.subtitle")}</span>
          {stats && (
            <span className={styles.subtitle}>
              {t("indexEod.endOfDay")} · {stats.constituents} {t("indexEod.constituents")} · {stats.sectorCount} {t("indexEod.sectors")}
            </span>
          )}
          <div style={{ flex: 1 }} />
          <input
            type="date"
            className={styles.dateInput}
            value={selectedDate}
            onChange={handleDateChange}
          />
          <div className={styles.indexSelect}>
            <SearchableSelect
              options={indexOptions}
              value={selectedIndexId}
              onChange={handleIndexChange}
              placeholder={t("indexEod.selectIndex")}
            />
          </div>
          <button
            className={styles.refreshBtn}
            onClick={() => fetchData(selectedDate || undefined, selectedIndexId)}
            title={t("eod.refresh")}
          >
            <span className={isRefreshing ? styles.refreshing : ""}>&#x21BB;</span>
          </button>
        </div>

        {/* Summary cards */}
        {stats && (
          <div className={styles.summaryGrid}>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>{t("indexEod.constituents")}</div>
              <div className={styles.summaryValue}>{stats.constituents}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>{t("indexEod.advancers")}</div>
              <div className={`${styles.summaryValue} ${styles.positive}`}>{stats.advancers}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>{t("indexEod.decliners")}</div>
              <div className={`${styles.summaryValue} ${styles.negative}`}>{stats.decliners}</div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>{t("indexEod.avgChange")}</div>
              <div className={`${styles.summaryValue} ${stats.avgChange > 0 ? styles.positive : stats.avgChange < 0 ? styles.negative : ""}`}>
                {formatPercent(stats.avgChange)}
              </div>
            </div>
            <div className={styles.summaryCard}>
              <div className={styles.summaryLabel}>{t("indexEod.totalTurnover")}</div>
              <div className={styles.summaryValue}>{formatVolume(stats.turnoverSum)}</div>
            </div>
          </div>
        )}

        {/* Controls: search + sort + expand/collapse */}
        <div className={styles.controls}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder={t("indexEod.searchPlaceholder")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className={styles.sortGroup}>
            {SORT_FIELDS.map((sf) => (
              <button
                key={sf.field}
                className={`${styles.sortBtn} ${sortField === sf.field ? styles.sortBtnActive : ""}`}
                onClick={() => setSortField(sf.field)}
              >
                {t(sf.labelKey)}
              </button>
            ))}
          </div>
          <button className={styles.expandCollapseBtn} onClick={expandAll}>{t("indexEod.expandAll")}</button>
          <button className={styles.expandCollapseBtn} onClick={collapseAll}>{t("indexEod.collapseAll")}</button>
        </div>

        {/* Sector accordion */}
        {isRefreshing && !data && <div className={styles.noData}>{t("eod.loading")}</div>}
        {!isRefreshing && data && data.length === 0 && <div className={styles.noData}>{t("eod.noDataFound")}</div>}
        {sectorGroups.length > 0 && (
          <div className={styles.sectorList}>
            {sectorGroups.map(([sectorName, stocks]) => {
              const isOpen = expandedSectors.has(sectorName);
              const avg = avgField(stocks, "change");
              const colorIdx = sectorColorIndex(sectorName);
              return (
                <div key={sectorName}>
                  <div className={styles.sectorHeader} onClick={() => toggleSector(sectorName)}>
                    <span className={`${styles.sectorArrow} ${isOpen ? styles.sectorArrowOpen : ""}`}>&#9654;</span>
                    <span className={styles.sectorDot} style={{ background: SECTOR_COLORS[colorIdx] }} />
                    <span className={styles.sectorName}>{sectorName}</span>
                    <span className={styles.sectorBadge}>{stocks.length}</span>
                    <span className={`${styles.sectorAvgChange} ${avg > 0 ? styles.positive : avg < 0 ? styles.negative : ""}`}>
                      {formatPercent(avg)}
                    </span>
                  </div>
                  {isOpen && (
                    <div className={styles.sectorContent}>
                      <table className={styles.stockTable}>
                        <thead>
                          <tr>
                            <th>{t("eod.col.symbol")}</th>
                            <th></th>
                            <th>{t("eod.col.company")}</th>
                            <th>{t("eod.col.subSector")}</th>
                            <th className="numCol">{t("eod.col.close")}</th>
                            <th className="numCol">{t("eod.col.chgPct")}</th>
                            <th className="numCol">{t("eod.col.turnover")}</th>
                            <th className="numCol">{t("eod.col.mktCap")}</th>
                            <th className="numCol">RSI</th>
                            <th className="numCol">EZ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stocks.map((stock) => {
                            const chg = stock.change ?? 0;
                            return (
                              <tr key={stock.symbol}>
                                <td><span className={styles.symbolCell}>{stock.symbol}</span></td>
                                <td><SymbolActions symbol={stock.symbol} app={app} /></td>
                                <td><span className={styles.textCell}>{stock.companyName ?? "\u2014"}</span></td>
                                <td><span className={styles.textCell}>{stock.subSector ?? "\u2014"}</span></td>
                                <td className={styles.numCell}>{formatNumber(stock.closingPrice)}</td>
                                <td className={`${styles.numCell} ${chg > 0 ? styles.positive : chg < 0 ? styles.negative : ""}`}>
                                  {formatPercent(chg)}
                                </td>
                                <td className={styles.numCell}>{formatVolume(Number(stock.turnover ?? 0))}</td>
                                <td className={styles.numCell}>{formatVolume(Number(stock.marketCap ?? 0))}</td>
                                <td className={styles.numCell}>{formatNumber(stock.rsi14)}</td>
                                <td className={styles.numCell}>{formatNumber(stock.ez)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div className={styles.footer}>
          <span>{t("indexEod.footerSource")}</span>
          {tradeDate && <span>{t("indexEod.generated")} {tradeDate}</span>}
        </div>
      </div>
    </WidgetLayout>
  );
}

// ── Mount ──────────────────────────────────────────────────────────────────────

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <IndexEndOfDayApp />
  </StrictMode>,
);
