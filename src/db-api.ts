import { prisma } from "./db.js";
import { Prisma } from "./generated/prisma/client.js";
import type {
  StockData,
  EndOfDayResult,
  MarketSpiritResponse,
  UptrendSymbolsResponse,
  EndOfDaySymbolsResponse,
  CandlestickResponse,
  CandlestickTimeframe,
  HeatmapPeriod,
  SectorHeatmapResponse,
  SymbolHeatmapItem,
  TaseDataProviders,
} from "./types.js";

// Fields to select for StockData (excludes isin, securityId, etc. not in StockData)
const EOD_SELECT = {
  tradeDate: true,
  symbol: true,
  change: true,
  turnover: true,
  closingPrice: true,
  basePrice: true,
  openingPrice: true,
  high: true,
  low: true,
  changeValue: true,
  volume: true,
  marketCap: true,
  minContPhaseAmount: true,
  listedCapital: true,
  marketType: true,
  rsi14: true,
  macd: true,
  macdSignal: true,
  macdHist: true,
  cci20: true,
  mfi14: true,
  turnover10: true,
  sma20: true,
  sma50: true,
  sma200: true,
  stddev20: true,
  upperBollingerBand20: true,
  lowerBollingerBand20: true,
  ez: true,
} as const;

type DbRow = {
  tradeDate: Date;
  symbol: string;
  change: number | null;
  turnover: bigint | null;
  closingPrice: number | null;
  basePrice: number | null;
  openingPrice: number | null;
  high: number | null;
  low: number | null;
  changeValue: number | null;
  volume: bigint | null;
  marketCap: bigint | null;
  minContPhaseAmount: number | null;
  listedCapital: bigint | null;
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
  ez: number | null;
};

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0] as string;
}

function rowToStockData(row: DbRow): StockData {
  return {
    tradeDate: toDateStr(row.tradeDate),
    symbol: row.symbol,
    change: row.change,
    turnover: row.turnover != null ? Number(row.turnover) : null,
    closingPrice: row.closingPrice,
    basePrice: row.basePrice,
    openingPrice: row.openingPrice,
    high: row.high,
    low: row.low,
    changeValue: row.changeValue,
    volume: row.volume != null ? Number(row.volume) : null,
    marketCap: row.marketCap != null ? Number(row.marketCap) : null,
    minContPhaseAmount: row.minContPhaseAmount,
    listedCapital: row.listedCapital != null ? Number(row.listedCapital) : null,
    marketType: row.marketType,
    rsi14: row.rsi14,
    macd: row.macd,
    macdSignal: row.macdSignal,
    macdHist: row.macdHist,
    cci20: row.cci20,
    mfi14: row.mfi14,
    turnover10: row.turnover10,
    sma20: row.sma20,
    sma50: row.sma50,
    sma200: row.sma200,
    stddev20: row.stddev20,
    upperBollingerBand20: row.upperBollingerBand20,
    lowerBollingerBand20: row.lowerBollingerBand20,
    ez: row.ez,
    companyName: null,
    sector: null,
    subSector: null,
  };
}

async function getLastTradeDate(marketType: string, before?: Date): Promise<Date> {
  const row = await prisma.taseSecuritiesEndOfDayTradingData.findFirst({
    where: {
      marketType,
      ...(before ? { tradeDate: { lte: before } } : {}),
    },
    orderBy: { tradeDate: "desc" },
    select: { tradeDate: true },
  });
  if (!row) throw new Error(`No trading data found for market type: ${marketType}`);
  return row.tradeDate;
}

export async function fetchEndOfDay(marketType = "STOCK", tradeDate?: string): Promise<EndOfDayResult> {
  const date = tradeDate ? new Date(tradeDate) : await getLastTradeDate(marketType);

  const rows = await prisma.taseSecuritiesEndOfDayTradingData.findMany({
    where: { tradeDate: date, marketType },
    select: {
      ...EOD_SELECT,
      taseSymbol: { select: { companyName: true, companySector: true, companySubSector: true } },
    },
    orderBy: { symbol: "asc" },
  });

  return {
    rows: rows.map((row) => ({
      ...rowToStockData(row),
      companyName: row.taseSymbol?.companyName ?? null,
      sector: row.taseSymbol?.companySector ?? null,
      subSector: row.taseSymbol?.companySubSector ?? null,
    })),
    tradeDate: toDateStr(date),
    marketType,
  };
}

/**
 * Market Spirit approximation from stored indicators.
 *
 * 6-point composite score (each = 1 point):
 *   1. ADV > 0           — more advancing than declining stocks today
 *   2. ADLine > 0        — cumulative advance-decline over last ~90 calendar days is positive
 *   3. >50% ez > 0       — majority of stocks above their SMA20
 *   4. >50% rsi14 > 50   — majority in bullish RSI territory
 *   5. >50% macdHist > 0 — majority with positive MACD momentum
 *   6. >50% cci20 > 0    — majority with positive CCI
 *
 * Score → Defense (0-2) | Selective (3-4) | Attack (5-6)
 */
export async function fetchMarketSpirit(marketType = "STOCK", tradeDate?: string): Promise<MarketSpiritResponse> {
  const date = tradeDate ? new Date(tradeDate) : await getLastTradeDate(marketType);
  const tradeDateStr = toDateStr(date);

  const stocks = await prisma.taseSecuritiesEndOfDayTradingData.findMany({
    where: { tradeDate: date, marketType },
    select: { change: true, ez: true, rsi14: true, macdHist: true, cci20: true },
  });

  const total = stocks.length;
  if (total === 0) {
    return { tradeDate: tradeDateStr, marketType, score: null, adv: null, adLine: null };
  }

  const advancing = stocks.filter((s) => (s.change ?? 0) > 0).length;
  const declining = stocks.filter((s) => (s.change ?? 0) < 0).length;
  const adv = advancing - declining;

  // Cumulative ADV over the last ~90 calendar days (≈ 20 trading days)
  const fromDate = new Date(date);
  fromDate.setDate(fromDate.getDate() - 90);

  const advHistory = await prisma.$queryRaw<{ adv: number }[]>`
    SELECT
      SUM(CASE WHEN change > 0 THEN 1 ELSE 0 END)::int -
      SUM(CASE WHEN change < 0 THEN 1 ELSE 0 END)::int AS adv
    FROM "TaseSecuritiesEndOfDayTradingData"
    WHERE "marketType" = ${marketType}
      AND "tradeDate" BETWEEN ${fromDate} AND ${date}
    GROUP BY "tradeDate"
    ORDER BY "tradeDate" ASC
  `;

  const adLine = advHistory.reduce((sum, row) => sum + (Number(row.adv) || 0), 0);

  let scorePoints = 0;
  if (adv > 0) scorePoints++;
  if (adLine > 0) scorePoints++;
  if (stocks.filter((s) => (s.ez ?? -Infinity) > 0).length / total > 0.5) scorePoints++;
  if (stocks.filter((s) => (s.rsi14 ?? 0) > 50).length / total > 0.5) scorePoints++;
  if (stocks.filter((s) => (s.macdHist ?? -Infinity) > 0).length / total > 0.5) scorePoints++;
  if (stocks.filter((s) => (s.cci20 ?? -Infinity) > 0).length / total > 0.5) scorePoints++;

  const score: "Defense" | "Selective" | "Attack" =
    scorePoints <= 2 ? "Defense" : scorePoints <= 4 ? "Selective" : "Attack";

  return { tradeDate: tradeDateStr, marketType, score, adv, adLine };
}

export async function fetchUptrendSymbols(marketType = "STOCK", tradeDate?: string): Promise<UptrendSymbolsResponse> {
  const date = tradeDate ? new Date(tradeDate) : await getLastTradeDate(marketType);

  const rows = await prisma.$queryRaw<{ symbol: string; ez: number }[]>`
    SELECT symbol, ez
    FROM "TaseSecuritiesEndOfDayTradingData"
    WHERE "tradeDate" = ${date}
      AND "marketType" = ${marketType}
      AND "turnover10" IS NOT NULL
      AND "turnover10" >= 1500000
      AND "rsi14" IS NOT NULL
      AND "rsi14" BETWEEN 60 AND 70
      AND "macdHist" IS NOT NULL
      AND "macdHist" >= 0
      AND "closingPrice" IS NOT NULL
      AND "sma20" IS NOT NULL
      AND "sma50" IS NOT NULL
      AND "sma200" IS NOT NULL
      AND "closingPrice" > "sma20"
      AND "sma20" > "sma50"
      AND "sma50" > "sma200"
    ORDER BY ez ASC, symbol ASC
  `;

  const items = rows.map((r) => ({ symbol: r.symbol, ez: Number(r.ez) }));

  return {
    tradeDate: toDateStr(date),
    marketType,
    count: items.length,
    items,
  };
}

export async function fetchEndOfDaySymbols(
  symbols?: string[],
  dateFrom?: string,
  dateTo?: string,
): Promise<EndOfDaySymbolsResponse> {
  const lastDate = await getLastTradeDate("STOCK");
  const from = dateFrom ? new Date(dateFrom) : lastDate;
  const to = dateTo ? new Date(dateTo) : lastDate;

  const rows = await prisma.taseSecuritiesEndOfDayTradingData.findMany({
    where: {
      ...(symbols && symbols.length > 0 ? { symbol: { in: symbols } } : {}),
      tradeDate: { gte: from, lte: to },
    },
    select: EOD_SELECT,
    orderBy: [{ symbol: "asc" }, { tradeDate: "asc" }],
  });

  return {
    symbols: symbols ?? [],
    count: rows.length,
    dateFrom: toDateStr(from),
    dateTo: toDateStr(to),
    items: rows.map(rowToStockData),
  };
}

export async function fetchEndOfDaySymbolsByDate(
  symbols: string[],
  tradeDate?: string,
  period: HeatmapPeriod = "1D",
): Promise<EndOfDaySymbolsResponse> {
  const lastDate = await getLastTradeDate("STOCK");
  const date = tradeDate ? new Date(tradeDate) : lastDate;
  const dateStr = toDateStr(date);

  if (period === "1D") {
    const rows = await prisma.taseSecuritiesEndOfDayTradingData.findMany({
      where: { symbol: { in: symbols }, tradeDate: date },
      select: EOD_SELECT,
      orderBy: { symbol: "asc" },
    });
    return { symbols, count: rows.length, dateFrom: dateStr, dateTo: dateStr, items: rows.map(rowToStockData) };
  }

  // 1W / 1M / 3M: compute period change via LAG window function
  const N = HEATMAP_PERIOD_OFFSETS[period];
  const limit = N + 1;
  const symbolParam = Prisma.join(symbols);

  type SidebarRow = { symbol: string; closingPrice: number | null; marketCap: bigint | null; change: number | null };

  const rows = await prisma.$queryRaw<SidebarRow[]>`
    WITH recent_dates AS (
      SELECT DISTINCT "tradeDate"
      FROM "TaseSecuritiesEndOfDayTradingData"
      WHERE "tradeDate" <= ${date}::date
      ORDER BY "tradeDate" DESC
      LIMIT ${limit}
    ),
    windowed AS (
      SELECT
        t.symbol,
        t."tradeDate",
        t."closingPrice",
        t."marketCap",
        LAG(t."closingPrice", ${N}) OVER (PARTITION BY t.symbol ORDER BY t."tradeDate") AS past_close
      FROM "TaseSecuritiesEndOfDayTradingData" t
      WHERE t."tradeDate" IN (SELECT "tradeDate" FROM recent_dates)
        AND t.symbol IN (${symbolParam})
    )
    SELECT
      symbol,
      "closingPrice",
      "marketCap",
      CASE
        WHEN past_close IS NOT NULL AND CAST(past_close AS FLOAT8) > 0
        THEN CAST(("closingPrice" - past_close) / past_close * 100 AS FLOAT8)
        ELSE NULL
      END AS change
    FROM windowed
    WHERE "tradeDate" = ${date}::date
    ORDER BY symbol
  `;

  const items: StockData[] = rows.map((r) => ({
    tradeDate: dateStr, symbol: r.symbol,
    change: r.change != null ? Number(r.change) : null,
    closingPrice: r.closingPrice != null ? Number(r.closingPrice) : null,
    marketCap: r.marketCap != null ? Number(r.marketCap) : null,
    turnover: null, basePrice: null, openingPrice: null, high: null, low: null,
    changeValue: null, volume: null, minContPhaseAmount: null, listedCapital: null,
    marketType: null, rsi14: null, macd: null, macdSignal: null, macdHist: null,
    cci20: null, mfi14: null, turnover10: null, sma20: null, sma50: null, sma200: null,
    stddev20: null, upperBollingerBand20: null, lowerBollingerBand20: null, ez: null,
    companyName: null, sector: null, subSector: null,
  }));

  return { symbols, count: items.length, dateFrom: dateStr, dateTo: dateStr, items };
}

// Raw row returned by aggregated SQL queries
type AggRow = {
  tradeDate: Date;
  openingPrice: number | null;
  high: number | null;
  low: number | null;
  closingPrice: number | null;
  volume: bigint | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ez: number | null;
};

function aggRowToStockData(row: AggRow, symbol: string): StockData {
  const open = row.openingPrice;
  const close = row.closingPrice;
  const change = open != null && open !== 0 && close != null ? ((close - open) / open) * 100 : null;
  return {
    tradeDate: toDateStr(row.tradeDate),
    symbol,
    openingPrice: open,
    closingPrice: close,
    high: row.high,
    low: row.low,
    volume: row.volume != null ? Number(row.volume) : null,
    change,
    sma20: row.sma20,
    sma50: row.sma50,
    sma200: row.sma200,
    ez: row.ez,
    // All other fields are not meaningful for aggregated candles
    turnover: null, basePrice: null, changeValue: null, marketCap: null,
    minContPhaseAmount: null, listedCapital: null, marketType: null,
    rsi14: null, macd: null, macdSignal: null, macdHist: null,
    cci20: null, mfi14: null, turnover10: null, stddev20: null,
    upperBollingerBand20: null, lowerBollingerBand20: null,
    companyName: null, sector: null, subSector: null,
  };
}

async function fetchCandlestickAggregated(
  symbol: string,
  from: Date,
  to: Date,
  timeframe: "3D" | "1W" | "1M" | "3M",
): Promise<AggRow[]> {
  if (timeframe === "3D") {
    return prisma.$queryRaw<AggRow[]>`
      WITH numbered AS (
        SELECT
          "tradeDate", "openingPrice", "high", "low", "closingPrice", "volume",
          "sma20", "sma50", "sma200", "ez",
          (ROW_NUMBER() OVER (ORDER BY "tradeDate") - 1) AS row_idx
        FROM "TaseSecuritiesEndOfDayTradingData"
        WHERE symbol = ${symbol} AND "tradeDate" BETWEEN ${from} AND ${to}
      ),
      bucketed AS (
        SELECT *, row_idx / 3 AS bucket FROM numbered
      ),
      ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY "tradeDate" ASC)  AS rn_asc,
          ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY "tradeDate" DESC) AS rn_desc
        FROM bucketed
      )
      SELECT
        MAX("tradeDate")                                              AS "tradeDate",
        MAX(CASE WHEN rn_asc  = 1 THEN "openingPrice" END)          AS "openingPrice",
        MAX("high")                                                   AS "high",
        MIN("low")                                                    AS "low",
        MAX(CASE WHEN rn_desc = 1 THEN "closingPrice" END)           AS "closingPrice",
        SUM("volume")::bigint                                         AS "volume",
        MAX(CASE WHEN rn_desc = 1 THEN "sma20"   END)                AS "sma20",
        MAX(CASE WHEN rn_desc = 1 THEN "sma50"   END)                AS "sma50",
        MAX(CASE WHEN rn_desc = 1 THEN "sma200"  END)                AS "sma200",
        MAX(CASE WHEN rn_desc = 1 THEN "ez"      END)                AS "ez"
      FROM ranked
      GROUP BY bucket
      ORDER BY bucket
    `;
  }

  const truncUnit = timeframe === "1W" ? "week" : timeframe === "1M" ? "month" : "quarter";

  return prisma.$queryRaw<AggRow[]>`
    WITH d AS (
      SELECT
        "tradeDate", "openingPrice", "high", "low", "closingPrice", "volume",
        "sma20", "sma50", "sma200", "ez",
        DATE_TRUNC(${truncUnit}, "tradeDate"::timestamp) AS period,
        ROW_NUMBER() OVER (PARTITION BY DATE_TRUNC(${truncUnit}, "tradeDate"::timestamp) ORDER BY "tradeDate" ASC)  AS rn_asc,
        ROW_NUMBER() OVER (PARTITION BY DATE_TRUNC(${truncUnit}, "tradeDate"::timestamp) ORDER BY "tradeDate" DESC) AS rn_desc
      FROM "TaseSecuritiesEndOfDayTradingData"
      WHERE symbol = ${symbol} AND "tradeDate" BETWEEN ${from} AND ${to}
    )
    SELECT
      MAX("tradeDate")                                              AS "tradeDate",
      MAX(CASE WHEN rn_asc  = 1 THEN "openingPrice" END)          AS "openingPrice",
      MAX("high")                                                   AS "high",
      MIN("low")                                                    AS "low",
      MAX(CASE WHEN rn_desc = 1 THEN "closingPrice" END)           AS "closingPrice",
      SUM("volume")::bigint                                         AS "volume",
      MAX(CASE WHEN rn_desc = 1 THEN "sma20"   END)                AS "sma20",
      MAX(CASE WHEN rn_desc = 1 THEN "sma50"   END)                AS "sma50",
      MAX(CASE WHEN rn_desc = 1 THEN "sma200"  END)                AS "sma200",
      MAX(CASE WHEN rn_desc = 1 THEN "ez"      END)                AS "ez"
    FROM d
    GROUP BY period
    ORDER BY period
  `;
}

export async function fetchCandlestick(
  symbol: string,
  dateFrom?: string,
  dateTo?: string,
  timeframe: CandlestickTimeframe = "1D",
): Promise<CandlestickResponse> {
  const lastDate = await getLastTradeDate("STOCK");
  const to = dateTo ? new Date(dateTo) : lastDate;
  const from = dateFrom
    ? new Date(dateFrom)
    : new Date(new Date(to).setFullYear(to.getFullYear() - 1));

  let items: StockData[];

  if (timeframe === "1D") {
    const rows = await prisma.taseSecuritiesEndOfDayTradingData.findMany({
      where: { symbol, tradeDate: { gte: from, lte: to } },
      select: EOD_SELECT,
      orderBy: { tradeDate: "asc" },
    });
    items = rows.map(rowToStockData);
  } else {
    const aggRows = await fetchCandlestickAggregated(symbol, from, to, timeframe);
    items = aggRows.map((r) => aggRowToStockData(r, symbol));
  }

  return {
    symbol,
    timeframe,
    count: items.length,
    dateFrom: items.length > 0 ? items[0]!.tradeDate : null,
    dateTo: items.length > 0 ? items[items.length - 1]!.tradeDate : null,
    items,
  };
}

const HEATMAP_PERIOD_OFFSETS: Record<HeatmapPeriod, number> = {
  "1D": 1,
  "1W": 5,
  "1M": 21,
  "3M": 63,
};

type PeriodRow = {
  symbol: string;
  marketCap: bigint | null;
  companyName: string | null;
  companySector: string;
  companySubSector: string | null;
  change: number | null;
};

export async function fetchSectorHeatmap(
  marketType = "STOCK",
  tradeDate?: string,
  period: HeatmapPeriod = "1D",
): Promise<SectorHeatmapResponse> {
  const date = tradeDate ? new Date(tradeDate) : await getLastTradeDate(marketType);
  const dateStr = toDateStr(date);

  if (period === "1D") {
    const rows = await prisma.taseSecuritiesEndOfDayTradingData.findMany({
      where: { tradeDate: date, marketType },
      select: {
        symbol: true,
        marketCap: true,
        change: true,
        taseSymbol: {
          select: { companyName: true, companySector: true, companySubSector: true },
        },
      },
      orderBy: { symbol: "asc" },
    });

    const items: SymbolHeatmapItem[] = rows
      .filter((r) => r.taseSymbol?.companySector != null)
      .map((r) => ({
        symbol: r.symbol,
        companyName: r.taseSymbol?.companyName ?? null,
        marketCap: r.marketCap != null ? Number(r.marketCap) : null,
        change: r.change,
        sector: r.taseSymbol!.companySector!,
        subSector: r.taseSymbol?.companySubSector ?? null,
      }));

    return { tradeDate: dateStr, marketType, period, count: items.length, items };
  }

  // 1W / 1M / 3M: compute period change via LAG window function
  const N = HEATMAP_PERIOD_OFFSETS[period];
  const limit = N + 1;

  const rows = await prisma.$queryRaw<PeriodRow[]>`
    WITH recent_dates AS (
      SELECT DISTINCT "tradeDate"
      FROM "TaseSecuritiesEndOfDayTradingData"
      WHERE "marketType" = ${marketType}
        AND "tradeDate" <= ${date}::date
      ORDER BY "tradeDate" DESC
      LIMIT ${limit}
    ),
    windowed AS (
      SELECT
        t.symbol,
        t."tradeDate",
        t."closingPrice",
        t."marketCap",
        s."companyName",
        s."companySector",
        s."companySubSector",
        LAG(t."closingPrice", ${N}) OVER (PARTITION BY t.symbol ORDER BY t."tradeDate") AS past_close
      FROM "TaseSecuritiesEndOfDayTradingData" t
      LEFT JOIN "TaseSymbol" s ON t.symbol = s.symbol
      WHERE t."tradeDate" IN (SELECT "tradeDate" FROM recent_dates)
        AND t."marketType" = ${marketType}
    )
    SELECT
      symbol,
      "marketCap",
      "companyName",
      "companySector",
      "companySubSector",
      CASE
        WHEN past_close IS NOT NULL AND CAST(past_close AS FLOAT8) > 0
        THEN CAST(("closingPrice" - past_close) / past_close * 100 AS FLOAT8)
        ELSE NULL
      END AS change
    FROM windowed
    WHERE "tradeDate" = ${date}::date
      AND "companySector" IS NOT NULL
    ORDER BY symbol
  `;

  const items: SymbolHeatmapItem[] = rows.map((r) => ({
    symbol: r.symbol,
    companyName: r.companyName,
    marketCap: r.marketCap != null ? Number(r.marketCap) : null,
    change: r.change != null ? Number(r.change) : null,
    sector: r.companySector,
    subSector: r.companySubSector,
  }));

  return { tradeDate: dateStr, marketType, period, count: items.length, items };
}

export const dbProviders: TaseDataProviders = {
  fetchEndOfDay,
  fetchMarketSpirit,
  fetchUptrendSymbols,
  fetchEndOfDaySymbols,
  fetchEndOfDaySymbolsByDate,
  fetchCandlestick,
  fetchSectorHeatmap,
};
