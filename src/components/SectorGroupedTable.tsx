/**
 * Sector Grouped Table — Accordion layout grouping stocks by sector.
 * Extracted from the original standalone index-end-of-day widget.
 */
import type { App } from "@modelcontextprotocol/ext-apps";
import { useCallback, useEffect, useMemo, useState } from "react";
import { SymbolActions } from "./SymbolActions";
import type { TFunction } from "./useLanguage";
import type { TranslationKey } from "./translations";
import type { StockData } from "../widgets/shared/end-of-day-shared";
import { formatPercent, formatVolume, formatNumber } from "../widgets/shared/end-of-day-shared";
import styles from "./SectorGroupedTable.module.css";

// ── Constants ──────────────────────────────────────────────────────────────────

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

// ── Component ──────────────────────────────────────────────────────────────────

export interface SectorGroupedTableProps {
  data: StockData[];
  app: App;
  t: TFunction;
}

export function SectorGroupedTable({ data, app, t }: SectorGroupedTableProps) {
  const [search, setSearch] = useState("");
  const [sortField, setSortField] = useState<SortField>("change");
  const [expandedSectors, setExpandedSectors] = useState<Set<string>>(new Set());

  // Auto-expand all sectors when data changes
  useEffect(() => {
    if (data.length > 0) {
      const sectors = new Set(data.map((s) => s.sector ?? t("indexEod.otherSector")));
      setExpandedSectors(sectors);
    }
  }, [data]);

  // Filter stocks by search across all columns
  const filteredStocks = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter((s) =>
      Object.values(s).some((v) =>
        v != null && String(v).toLowerCase().includes(q)
      )
    );
  }, [data, search]);

  // Group by sector, sort sectors and stocks within
  const sectorGroups = useMemo(() => {
    const otherLabel = t("indexEod.otherSector");
    const map = new Map<string, StockData[]>();
    for (const stock of filteredStocks) {
      const sec = stock.sector ?? otherLabel;
      const arr = map.get(sec) ?? [];
      arr.push(stock);
      map.set(sec, arr);
    }

    for (const [, stocks] of map) {
      stocks.sort((a, b) => {
        const av = a[sortField] ?? 0;
        const bv = b[sortField] ?? 0;
        return bv - av;
      });
    }

    const entries = Array.from(map.entries());
    entries.sort((a, b) => avgField(b[1], sortField) - avgField(a[1], sortField));
    return entries;
  }, [filteredStocks, sortField, t]);

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

  if (data.length === 0) {
    return <div className={styles.noData}>{t("eod.noDataFound")}</div>;
  }

  return (
    <>
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
                        <th className="numCol">RSI14</th>
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
    </>
  );
}
