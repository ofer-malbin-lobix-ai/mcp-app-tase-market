/**
 * Shared types, helpers, columns, and data extraction for End of Day widgets.
 * Used by both EndOfDayApp (single date) and EndOfDaysApp (date range).
 */
import type { App } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { createColumnHelper } from "@tanstack/react-table";
import { SymbolActions } from "../../components/SymbolActions";
import styles from "./end-of-day-widget.module.css";

// --- Types ---

export interface StockData {
  tradeDate: string;
  symbol: string;
  securityId: number;
  change: number | null;
  turnover: number | null;
  closingPrice: number | null;
  basePrice: number | null;
  openingPrice: number | null;
  high: number | null;
  low: number | null;
  changeValue: number | null;
  volume: number | null;
  marketCap: number | null;
  minContPhaseAmount: number | null;
  listedCapital: number | null;
  marketType: string | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  cci20: number | null;
  mfi14: number | null;
  turnover10: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  stddev20: number | null;
  upperBollingerBand20: number | null;
  lowerBollingerBand20: number | null;
  bandWidth20: number | null;
  ez: number | null;
  companyName: string | null;
  sector: string | null;
  subSector: string | null;
}

export interface EndOfDayWidgetData {
  tradeDate?: string;
  marketType?: string | null;
  symbols?: string[];
  count?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  rows: StockData[];
}

// --- Helpers ---

export function deriveTitle(toolName: string): string {
  return toolName
    .replace(/^get-/, "")
    .replace(/-data$/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function formatPrice(price: number): string {
  return price.toFixed(2);
}

export function formatPercent(percent: number): string {
  const sign = percent >= 0 ? "+" : "";
  return `${sign}${percent.toFixed(2)}%`;
}

export function formatVolume(volume: number): string {
  if (volume >= 1000000000) return `${(volume / 1000000000).toFixed(1)}B`;
  if (volume >= 1000000) return `${(volume / 1000000).toFixed(1)}M`;
  if (volume >= 1000) return `${(volume / 1000).toFixed(0)}K`;
  return new Intl.NumberFormat("en-US").format(volume);
}

export function formatNumber(value: number | null, decimals = 2): string {
  if (value === null) return "\u2014";
  return value.toFixed(decimals);
}

// --- Data extraction ---

export function extractEndOfDayData(
  callToolResult: CallToolResult | null | undefined,
): EndOfDayWidgetData | null {
  try {
    if (!callToolResult) return null;

    if (callToolResult.structuredContent) {
      const raw = callToolResult.structuredContent as Record<string, unknown>;
      const arr = raw.items;
      if (Array.isArray(arr)) {
        return { ...raw, rows: arr } as EndOfDayWidgetData;
      }
    }

    const textContent = callToolResult.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;

    let parsed = JSON.parse(textContent.text);
    if (parsed && typeof parsed.text === "string" && !parsed.items) {
      parsed = JSON.parse(parsed.text);
    }

    return { ...parsed, rows: parsed.items ?? [] } as EndOfDayWidgetData;
  } catch {
    return null;
  }
}

// --- Columns ---

export const columnHelper = createColumnHelper<StockData>();

export function createEndOfDayColumns(app: App, showDateColumn?: boolean) {
  const cols = [];

  if (showDateColumn) {
    cols.push(
      columnHelper.accessor("tradeDate", {
        header: "Date",
        cell: (info) => {
          const value = info.getValue();
          const dateOnly = value ? value.split("T")[0] : "\u2014";
          return <span className={styles.textCell}>{dateOnly}</span>;
        },
        enableColumnFilter: false,
      })
    );
  }

  cols.push(
    columnHelper.accessor("symbol", {
      header: "Symbol",
      cell: (info) => <span className={styles.symbolCell}>{info.getValue()}</span>,
    }),
    columnHelper.display({
      id: "actions",
      header: "",
      enableSorting: false,
      enableColumnFilter: false,
      cell: (info) => <SymbolActions symbol={info.row.original.symbol} app={app} />,
    }),
    columnHelper.accessor("securityId", {
      header: "Security ID",
      cell: (info) => info.getValue(),
    }),
    columnHelper.accessor("companyName", {
      header: "Company",
      cell: (info) => <span className={styles.textCell}>{info.getValue() ?? "\u2014"}</span>,
      filterFn: "includesString",
    }),
    columnHelper.accessor("sector", {
      header: "Sector",
      cell: (info) => <span className={styles.textCell}>{info.getValue() ?? "\u2014"}</span>,
      filterFn: "includesString",
    }),
    columnHelper.accessor("subSector", {
      header: "Sub-Sector",
      cell: (info) => <span className={styles.textCell}>{info.getValue() ?? "\u2014"}</span>,
      filterFn: "includesString",
    }),
    columnHelper.accessor("marketType", {
      header: "Type",
      cell: (info) => <span className={styles.textCell}>{info.getValue() ?? "\u2014"}</span>,
      enableColumnFilter: false,
    }),
    // Price data
    columnHelper.accessor("closingPrice", {
      header: "Close",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("openingPrice", {
      header: "Open",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("high", {
      header: "High",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("low", {
      header: "Low",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("basePrice", {
      header: "Base",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    // Change
    columnHelper.accessor("changeValue", {
      header: "Chg",
      cell: (info) => {
        const value = info.getValue() ?? 0;
        const className = value > 0 ? styles.positive : value < 0 ? styles.negative : "";
        return (
          <span className={`${styles.numericCell} ${className}`}>
            {value > 0 ? "+" : ""}{formatPrice(value)}
          </span>
        );
      },
    }),
    columnHelper.accessor("change", {
      header: "Chg%",
      cell: (info) => {
        const value = info.getValue() ?? 0;
        const className = value > 0 ? styles.positive : value < 0 ? styles.negative : "";
        return (
          <span className={`${styles.numericCell} ${className}`}>
            {formatPercent(value)}
          </span>
        );
      },
    }),
    // Volume & Turnover
    columnHelper.accessor("volume", {
      header: "Volume",
      cell: (info) => <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>,
    }),
    columnHelper.accessor("turnover", {
      header: "Turnover",
      cell: (info) => <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>,
    }),
    columnHelper.accessor("turnover10", {
      header: "Turn10",
      cell: (info) => <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>,
    }),
    // Market data
    columnHelper.accessor("marketCap", {
      header: "Mkt Cap",
      cell: (info) => <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>,
    }),
    columnHelper.accessor("listedCapital", {
      header: "Listed Cap",
      cell: (info) => <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>,
    }),
    columnHelper.accessor("minContPhaseAmount", {
      header: "Min Cont",
      cell: (info) => <span className={styles.numericCell}>{formatVolume(Number(info.getValue() ?? 0))}</span>,
    }),
    // Technical indicators
    columnHelper.accessor("rsi14", {
      header: "RSI14",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("mfi14", {
      header: "MFI14",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("cci20", {
      header: "CCI20",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("macd", {
      header: "MACD",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("macdSignal", {
      header: "MACD Sig",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("macdHist", {
      header: "MACD Hist",
      cell: (info) => {
        const value = info.getValue();
        const className = value !== null ? (value > 0 ? styles.positive : value < 0 ? styles.negative : "") : "";
        return <span className={`${styles.numericCell} ${className}`}>{formatNumber(value)}</span>;
      },
    }),
    // Moving averages
    columnHelper.accessor("sma20", {
      header: "SMA20",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("sma50", {
      header: "SMA50",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("sma200", {
      header: "SMA200",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    // Bollinger bands
    columnHelper.accessor("upperBollingerBand20", {
      header: "BB Upper",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("lowerBollingerBand20", {
      header: "BB Lower",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("bandWidth20", {
      header: "bw20",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    columnHelper.accessor("stddev20", {
      header: "StdDev20",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
    // EZ
    columnHelper.accessor("ez", {
      header: "EZ",
      cell: (info) => <span className={styles.numericCell}>{formatNumber(info.getValue())}</span>,
    }),
  );

  return cols;
}

export const INITIAL_COLUMN_VISIBILITY: Record<string, boolean> = {
  securityId: false,
  tradeDate: false,
  subSector: false,
  marketType: false,
  openingPrice: false,
  high: false,
  low: false,
  basePrice: false,
  turnover10: false,
  listedCapital: false,
  minContPhaseAmount: false,
  rsi14: false,
  mfi14: false,
  cci20: false,
  macd: false,
  macdSignal: false,
  macdHist: false,
  sma20: false,
  sma50: false,
  sma200: false,
  upperBollingerBand20: false,
  lowerBollingerBand20: false,
  bandWidth20: false,
  stddev20: false,
  ez: false,
};
