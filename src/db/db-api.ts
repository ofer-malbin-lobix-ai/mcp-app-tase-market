import { prisma } from "./db.js";
import { Prisma } from "../generated/prisma/client.js";
import type {
  StockData,
  EndOfDayResult,
  MarketSpiritResponse,
  MomentumResponse,
  MomentumSymbolItem,
  AnticipationResponse,
  AnticipationSymbolItem,
  AnticipationSignal,
  EndOfDaySymbolsResponse,
  CandlestickResponse,
  CandlestickTimeframe,
  HeatmapPeriod,
  SectorHeatmapResponse,
  SymbolHeatmapItem,
  TaseDataProviders,
} from "../types.js";

// Fields to select for StockData (excludes isin, etc. not in StockData)
const EOD_SELECT = {
  tradeDate: true,
  symbol: true,
  securityId: true,
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
  bandWidth20: true,
  stochK14: true,
  stochD14: true,
  ez: true,
} as const;

type DbRow = {
  tradeDate: Date;
  symbol: string;
  securityId: number;
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
  bandWidth20: number | null;
  stochK14: number | null;
  stochD14: number | null;
  ez: number | null;
};

function toDateStr(d: Date): string {
  return d.toISOString().split("T")[0] as string;
}

function rowToStockData(row: DbRow): StockData {
  return {
    tradeDate: toDateStr(row.tradeDate),
    symbol: row.symbol,
    securityId: row.securityId,
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
    bandWidth20: row.bandWidth20,
    stochK14: row.stochK14,
    stochD14: row.stochD14,
    ez: row.ez,
    companyName: null,
    sector: null,
    subSector: null,
  };
}

async function getLastTradeDate(
  marketType: string,
  before?: Date,
): Promise<Date> {
  const row = await prisma.taseSecuritiesEndOfDayTradingData.findFirst({
    where: {
      marketType,
      ...(before ? { tradeDate: { lte: before } } : {}),
    },
    orderBy: { tradeDate: "desc" },
    select: { tradeDate: true },
  });
  if (!row)
    throw new Error(`No trading data found for market type: ${marketType}`);
  return row.tradeDate;
}

export async function fetchEndOfDay(
  marketType = "STOCK",
  tradeDate?: string,
): Promise<EndOfDayResult> {
  const date = tradeDate
    ? new Date(tradeDate)
    : await getLastTradeDate(marketType);

  const rows = await prisma.taseSecuritiesEndOfDayTradingData.findMany({
    where: { tradeDate: date, marketType },
    select: {
      ...EOD_SELECT,
      taseSymbol: {
        select: {
          companyName: true,
          companySector: true,
          companySubSector: true,
        },
      },
    },
    orderBy: { symbol: "asc" },
  });

  return {
    items: rows.map((row) => ({
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
 * DailyScore for a single row (0-8):
 *   +2 Close > SMA20
 *   +2 SMA20 > SMA50
 *   +1 MACD Histogram > 0
 *   +1 RSI > 50 (or +2 if >60, or +3 if >70)
 */
function computeDailyScore(row: {
  closingPrice: number | null;
  sma20: number | null;
  sma50: number | null;
  macdHist: number | null;
  rsi14: number | null;
}): number {
  let score = 0;
  if (row.closingPrice != null && row.sma20 != null && row.closingPrice > row.sma20) score += 2;
  if (row.sma20 != null && row.sma50 != null && row.sma20 > row.sma50) score += 2;
  if (row.macdHist != null && row.macdHist > 0) score += 1;
  const rsi = row.rsi14 ?? 0;
  if (rsi > 70) score += 3;
  else if (rsi > 60) score += 2;
  else if (rsi > 50) score += 1;
  return score;
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
 *
 * Also computes breadth metrics on the liquid universe (turnover10 >= 1,500,000):
 *   momentumBreadth  = % with DailyScore >= 6
 *   moneyFlowBreadth = % with MFI > 60
 *   compressionBreadth = % with bandWidth20 < 0.06
 *   regime: <15% weak, 15-30% early, 30-50% healthy, >50% overextended
 */
export async function fetchMarketSpirit(
  marketType = "STOCK",
  tradeDate?: string,
): Promise<MarketSpiritResponse> {
  const date = tradeDate
    ? new Date(tradeDate)
    : await getLastTradeDate(marketType);
  const tradeDateStr = toDateStr(date);

  const stocks = await prisma.taseSecuritiesEndOfDayTradingData.findMany({
    where: { tradeDate: date, marketType },
    select: {
      change: true,
      ez: true,
      rsi14: true,
      macdHist: true,
      cci20: true,
      closingPrice: true,
      sma20: true,
      sma50: true,
      mfi14: true,
      bandWidth20: true,
      turnover10: true,
    },
  });

  const total = stocks.length;
  if (total === 0) {
    return {
      tradeDate: tradeDateStr,
      marketType,
      momentumBreadth: 0,
      moneyFlowBreadth: 0,
      compressionBreadth: 0,
      regime: "weak",
      score: null,
      adv: null,
      adLine: null,
    };
  }

  // --- Legacy score computation ---
  const advancing = stocks.filter((s) => (s.change ?? 0) > 0).length;
  const declining = stocks.filter((s) => (s.change ?? 0) < 0).length;
  const adv = advancing - declining;

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

  const adLine = advHistory.reduce(
    (sum, row) => sum + (Number(row.adv) || 0),
    0,
  );

  let scorePoints = 0;
  if (adv > 0) scorePoints++;
  if (adLine > 0) scorePoints++;
  if (stocks.filter((s) => (s.ez ?? -Infinity) > 0).length / total > 0.5)
    scorePoints++;
  if (stocks.filter((s) => (s.rsi14 ?? 0) > 50).length / total > 0.5)
    scorePoints++;
  if (stocks.filter((s) => (s.macdHist ?? -Infinity) > 0).length / total > 0.5)
    scorePoints++;
  if (stocks.filter((s) => (s.cci20 ?? -Infinity) > 0).length / total > 0.5)
    scorePoints++;

  const score: "Defense" | "Selective" | "Attack" =
    scorePoints <= 2 ? "Defense" : scorePoints <= 4 ? "Selective" : "Attack";

  // --- New breadth metrics (liquid universe only) ---
  const liquid = stocks.filter((s) => s.turnover10 != null && s.turnover10 >= 1500000);
  const liquidTotal = liquid.length;

  let momentumBreadth = 0;
  let moneyFlowBreadth = 0;
  let compressionBreadth = 0;

  let avgBandWidth = 0;

  if (liquidTotal > 0) {
    const momentumCount = liquid.filter((s) => computeDailyScore(s) >= 6).length;
    const mfiCount = liquid.filter((s) => (s.mfi14 ?? 0) > 60).length;
    const compressionCount = liquid.filter((s) => s.bandWidth20 != null && s.bandWidth20 < 0.06).length;

    momentumBreadth = Math.round((momentumCount / liquidTotal) * 100);
    moneyFlowBreadth = Math.round((mfiCount / liquidTotal) * 100);
    compressionBreadth = Math.round((compressionCount / liquidTotal) * 100);

    // Average BandWidth across liquid universe (as %)
    const bwValues = liquid.filter((s) => s.bandWidth20 != null).map((s) => s.bandWidth20! * 100);
    avgBandWidth = bwValues.length > 0 ? Math.round(bwValues.reduce((a, b) => a + b, 0) / bwValues.length * 10) / 10 : 0;
  }

  // 5-regime classification (checked in order)
  const regime: MarketSpiritResponse["regime"] =
    avgBandWidth > 30 ? "avoid" :
    momentumBreadth >= 30 && avgBandWidth < 20 ? "attack" :
    momentumBreadth >= 15 && momentumBreadth < 30 && avgBandWidth < 30 ? "selective" :
    momentumBreadth >= 10 && momentumBreadth < 15 && avgBandWidth >= 20 && avgBandWidth <= 30 ? "neutral" :
    momentumBreadth < 15 ? "defense" :
    // fallback for edge cases
    momentumBreadth > 50 ? "avoid" :
    "selective";

  // Position sizing matrix: regime × BW grid
  const positionSizing: Record<string, Record<string, string>> = {
    attack:    { "BW<8%":  "100%", "BW 8-15%": "75%",  "BW 15-25%": "50%",  "BW>25%": "25%" },
    selective: { "BW<8%":  "75%",  "BW 8-15%": "50%",  "BW 15-25%": "25%",  "BW>25%": "0%"  },
    neutral:   { "BW<8%":  "50%",  "BW 8-15%": "25%",  "BW 15-25%": "0%",   "BW>25%": "0%"  },
    defense:   { "BW<8%":  "25%",  "BW 8-15%": "0%",   "BW 15-25%": "0%",   "BW>25%": "0%"  },
    avoid:     { "BW<8%":  "0%",   "BW 8-15%": "0%",   "BW 15-25%": "0%",   "BW>25%": "0%"  },
  };

  return {
    tradeDate: tradeDateStr,
    marketType,
    momentumBreadth,
    moneyFlowBreadth,
    compressionBreadth,
    regime,
    positionSizing,
    score,
    adv,
    adLine,
    avgBandWidth,
  };
}

// Raw row type for momentum query
type MomentumDbRow = {
  symbol: string;
  tradeDate: Date;
  closingPrice: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  macdHist: number | null;
  mfi14: number | null;
  ez: number | null;
  bandWidth20: number | null;
  turnover: bigint | null;
  turnover10: number | null;
  companyName: string | null;
  companySector: string | null;
};

export async function fetchMomentumSymbols(
  marketType = "STOCK",
  tradeDate?: string,
): Promise<MomentumResponse> {
  const date = tradeDate
    ? new Date(tradeDate)
    : await getLastTradeDate(marketType);
  const tradeDateStr = toDateStr(date);

  // Fetch last 6 trading days of data for all liquid symbols (need 5+ for MACD declining check)
  const rows = await prisma.$queryRaw<MomentumDbRow[]>`
    WITH lastN AS (
      SELECT DISTINCT "tradeDate"
      FROM "TaseSecuritiesEndOfDayTradingData"
      WHERE "tradeDate" <= ${date} AND "marketType" = ${marketType}
      ORDER BY "tradeDate" DESC
      LIMIT 6
    )
    SELECT
      t.symbol,
      t."tradeDate",
      t."closingPrice",
      t."sma20", t."sma50", t."sma200",
      t."rsi14", t."macdHist", t."mfi14",
      t."ez", t."bandWidth20",
      t.turnover, t."turnover10",
      s."companyName",
      s."companySector"
    FROM "TaseSecuritiesEndOfDayTradingData" t
    LEFT JOIN "TaseSymbol" s ON t.symbol = s.symbol
    WHERE t."tradeDate" IN (SELECT "tradeDate" FROM lastN)
      AND t."marketType" = ${marketType}
      AND t."turnover10" IS NOT NULL
      AND t."turnover10" >= 1500000
  `;

  if (rows.length === 0) {
    return { tradeDate: tradeDateStr, marketType, count: 0, items: [] };
  }

  // Group rows by symbol
  const bySymbol = new Map<string, MomentumDbRow[]>();
  for (const row of rows) {
    const arr = bySymbol.get(row.symbol) ?? [];
    arr.push(row);
    bySymbol.set(row.symbol, arr);
  }

  // Sort dates descending to identify latest, previous
  const allDates = [...new Set(rows.map((r) => toDateStr(r.tradeDate)))].sort().reverse();
  const latestDateStr = allDates[0]!;

  // SMA200 Rising Gate: fetch SMA200 from ~365 calendar days ago per symbol
  const histDate = new Date(date);
  histDate.setDate(histDate.getDate() - 365);
  type Sma200HistRow = { symbol: string; sma200: number | null };
  const sma200HistRows = await prisma.$queryRaw<Sma200HistRow[]>`
    SELECT DISTINCT ON (symbol) symbol, "sma200"
    FROM "TaseSecuritiesEndOfDayTradingData"
    WHERE "marketType" = ${marketType}
      AND "tradeDate" <= ${histDate}
    ORDER BY symbol, "tradeDate" DESC
  `;
  const sma200HistMap = new Map<string, number | null>();
  for (const r of sma200HistRows) sma200HistMap.set(r.symbol, r.sma200);

  const items: MomentumSymbolItem[] = [];

  for (const [symbol, symbolRows] of bySymbol) {
    // Sort by date desc
    symbolRows.sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime());

    // Compute DailyScore for each day
    const dailyScores = symbolRows.map((r) => ({
      date: toDateStr(r.tradeDate),
      score: computeDailyScore(r),
      row: r,
    }));

    // Persistence: count days with DailyScore >= 6 (use only last 3 days)
    const last3Scores = dailyScores.slice(0, 3);
    const daysAbove6 = last3Scores.filter((d) => d.score >= 6).length;
    if (daysAbove6 === 0) continue; // Exclude symbols with 0 qualifying days

    const persistence: MomentumSymbolItem["persistence"] =
      daysAbove6 >= 3 ? "strong" : daysAbove6 >= 2 ? "confirmed" : "new";

    // Latest day row
    const latestEntry = dailyScores.find((d) => d.date === latestDateStr);
    if (!latestEntry) continue;
    const latest = latestEntry.row;
    const latestScore = latestEntry.score;

    // MACD Hist Declining Disqualifier: if MACD Hist declined for 5+ consecutive days → skip
    let macdDeclining = false;
    if (dailyScores.length >= 5) {
      let consecutiveDeclines = 0;
      for (let i = 0; i < dailyScores.length - 1; i++) {
        const curr = dailyScores[i]!.row.macdHist;
        const prev = dailyScores[i + 1]!.row.macdHist;
        if (curr != null && prev != null && curr < prev) {
          consecutiveDeclines++;
        } else {
          break;
        }
      }
      macdDeclining = consecutiveDeclines >= 5;
    }

    // Skip symbols with 5+ consecutive MACD declines
    if (macdDeclining) continue;

    // Previous day for MACD comparison
    const prevEntry = dailyScores.length > 1 ? dailyScores[1] : null;
    const macdRising = prevEntry != null &&
      latest.macdHist != null && prevEntry.row.macdHist != null &&
      latest.macdHist > prevEntry.row.macdHist;
    const rsiRising = prevEntry != null &&
      latest.rsi14 != null && prevEntry.row.rsi14 != null &&
      latest.rsi14 > prevEntry.row.rsi14;
    const mfiRising = prevEntry != null &&
      latest.mfi14 != null && prevEntry.row.mfi14 != null &&
      latest.mfi14 > prevEntry.row.mfi14;

    // TrendQuality (0-10)
    let trendQuality = 0;
    if (latest.sma20 != null && latest.sma50 != null && latest.sma20 > latest.sma50) trendQuality += 2;
    if (latest.sma50 != null && latest.sma200 != null && latest.sma50 > latest.sma200) trendQuality += 2;
    const rsi = latest.rsi14 ?? 0;
    if (rsi >= 65 && rsi <= 75) trendQuality += 2;
    else if (rsi >= 55 && rsi < 65) trendQuality += 1;
    if (latest.macdHist != null && latest.macdHist > 0) trendQuality += 1;
    if (macdRising) trendQuality += 1;
    const ez = latest.ez != null ? Number(latest.ez) : 0;
    if (ez >= 0 && ez <= 3) trendQuality += 2;
    else if (ez > 3 && ez <= 8) trendQuality += 1;
    else if (ez > 15) trendQuality -= 1;
    trendQuality = Math.max(0, Math.min(10, trendQuality));

    // LeaderScore (0-9)
    let leaderScore = 0;
    if (rsi >= 60 && rsi <= 70) leaderScore += 2;
    if (ez >= 3 && ez <= 8) leaderScore += 2;
    if (macdRising) leaderScore += 2;
    if ((latest.mfi14 ?? 0) > 65) leaderScore += 2;
    const turnover = latest.turnover != null ? Number(latest.turnover) : 0;
    const turnover10 = latest.turnover10 ?? 0;
    if (turnover10 > 0 && turnover > turnover10) leaderScore += 1;
    leaderScore = Math.min(9, leaderScore);

    // LeaderScore Sub-tiers
    let leaderSubTier: MomentumSymbolItem["leaderSubTier"] = null;
    if (leaderScore >= 5 && leaderScore <= 6) {
      if (ez < 8) leaderSubTier = "A";
      else if (ez <= 12) leaderSubTier = "B";
      else leaderSubTier = "C";
    }

    // Compression
    const isCompression = latest.bandWidth20 != null && latest.bandWidth20 < 0.06;
    const isStrongCompression = latest.bandWidth20 != null && latest.bandWidth20 < 0.04;
    const isEarlyBreakout = isCompression && rsiRising && mfiRising;

    // BandWidth Zone
    const bw = latest.bandWidth20 != null ? latest.bandWidth20 * 100 : 0; // convert to %
    const bandWidthZone: MomentumSymbolItem["bandWidthZone"] =
      bw < 4 ? "strong_compression" :
      bw < 6 ? "compression" :
      bw < 12 ? "normal" :
      bw < 20 ? "elevated" :
      bw < 30 ? "high" :
      "extreme";

    // SMA200 Rising Gate
    const histSma200 = sma200HistMap.get(symbol);
    const sma200Rising = histSma200 == null || latest.sma200 == null
      ? true  // pass by default if no historical data
      : latest.sma200 > histSma200;

    // Phase
    let phase: MomentumSymbolItem["phase"];
    if (isCompression) {
      phase = "compression";
    } else if (daysAbove6 >= 3 && ez > 8) {
      phase = "extended";
    } else if (daysAbove6 >= 2 && leaderScore >= 5) {
      phase = "expansion";
    } else {
      phase = "early";
    }

    items.push({
      symbol,
      companyName: latest.companyName,
      companySector: latest.companySector,
      dailyScore: latestScore,
      trendQuality,
      leaderScore,
      persistence,
      phase,
      isLeader: leaderScore >= 7,
      isCompression,
      isStrongCompression,
      isEarlyBreakout,
      ez,
      rsi14: latest.rsi14,
      bandWidth20: latest.bandWidth20,
      mfi14: latest.mfi14,
      macdDeclining,
      leaderSubTier,
      bandWidthZone,
      sma200Rising,
    });
  }

  // Sort by leaderScore DESC, trendQuality DESC
  items.sort((a, b) => b.leaderScore - a.leaderScore || b.trendQuality - a.trendQuality);

  return { tradeDate: tradeDateStr, marketType, count: items.length, items };
}

// --- Stage 0 Anticipation Layer ---

type AnticipationDbRow = {
  symbol: string;
  tradeDate: Date;
  closingPrice: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  macdHist: number | null;
  mfi14: number | null;
  ez: number | null;
  bandWidth20: number | null;
  stochK14: number | null;
  stochD14: number | null;
  turnover10: number | null;
  companyName: string | null;
};

function detectSignalA(latest: AnticipationDbRow, prev: AnticipationDbRow | null): boolean {
  // Structural gate: SMA20 > SMA50
  if (latest.sma20 == null || latest.sma50 == null || latest.sma20 <= latest.sma50) return false;
  // %K crosses above %D below 30
  if (latest.stochK14 == null || latest.stochD14 == null) return false;
  if (prev == null || prev.stochK14 == null || prev.stochD14 == null) return false;
  const crossover = prev.stochK14 <= prev.stochD14 && latest.stochK14 > latest.stochD14;
  if (!crossover || latest.stochK14 >= 30) return false;
  // RSI 35–55
  const rsi = latest.rsi14 ?? 0;
  if (rsi < 35 || rsi > 55) return false;
  // MACD Hist negative
  if (latest.macdHist == null || latest.macdHist >= 0) return false;
  return true;
}

function detectSignalB(latest: AnticipationDbRow, prev: AnticipationDbRow | null): boolean {
  // Strong structure: SMA20 > SMA50 AND Close > SMA200
  if (latest.sma20 == null || latest.sma50 == null || latest.sma20 <= latest.sma50) return false;
  if (latest.closingPrice == null || latest.sma200 == null || latest.closingPrice <= latest.sma200) return false;
  // %K 40–65 rising
  if (latest.stochK14 == null || latest.stochK14 < 40 || latest.stochK14 > 65) return false;
  if (prev == null || prev.stochK14 == null || latest.stochK14 <= prev.stochK14) return false;
  // %K > %D
  if (latest.stochD14 == null || latest.stochK14 <= latest.stochD14) return false;
  // RSI 45–60
  const rsi = latest.rsi14 ?? 0;
  if (rsi < 45 || rsi > 60) return false;
  // MACD turning (hist rising)
  if (latest.macdHist == null || prev.macdHist == null || latest.macdHist <= prev.macdHist) return false;
  return true;
}

function detectSignalC(latest: AnticipationDbRow, histRows: AnticipationDbRow[]): boolean {
  // Close > SMA200
  if (latest.closingPrice == null || latest.sma200 == null || latest.closingPrice <= latest.sma200) return false;
  if (latest.stochK14 == null) return false;

  // Find a row 5–10 days ago with lower close price but higher stochastic (bullish divergence)
  // histRows are sorted desc, so index 5-10 are 5-10 days back
  for (let i = 5; i <= Math.min(10, histRows.length - 1); i++) {
    const older = histRows[i];
    if (!older) continue;
    if (older.closingPrice == null || older.stochK14 == null) continue;
    // Price made lower low
    if (latest.closingPrice >= older.closingPrice) continue;
    // Stochastic made higher low (bullish divergence)
    if (latest.stochK14 > older.stochK14) return true;
  }
  return false;
}

export async function fetchAnticipationSymbols(
  marketType = "STOCK",
  tradeDate?: string,
): Promise<AnticipationResponse> {
  const date = tradeDate
    ? new Date(tradeDate)
    : await getLastTradeDate(marketType);
  const tradeDateStr = toDateStr(date);

  // Fetch last 20 trading days for stochastic crossover + divergence detection
  const rows = await prisma.$queryRaw<AnticipationDbRow[]>`
    WITH last20 AS (
      SELECT DISTINCT "tradeDate"
      FROM "TaseSecuritiesEndOfDayTradingData"
      WHERE "tradeDate" <= ${date} AND "marketType" = ${marketType}
      ORDER BY "tradeDate" DESC
      LIMIT 20
    )
    SELECT
      t.symbol,
      t."tradeDate",
      t."closingPrice",
      t."sma20", t."sma50", t."sma200",
      t."rsi14", t."macdHist", t."mfi14",
      t."ez", t."bandWidth20",
      t."stochK14", t."stochD14",
      t."turnover10",
      s."companyName"
    FROM "TaseSecuritiesEndOfDayTradingData" t
    LEFT JOIN "TaseSymbol" s ON t.symbol = s.symbol
    WHERE t."tradeDate" IN (SELECT "tradeDate" FROM last20)
      AND t."marketType" = ${marketType}
      AND t."turnover10" IS NOT NULL
      AND t."turnover10" >= 1500000
  `;

  if (rows.length === 0) {
    return { tradeDate: tradeDateStr, marketType, count: 0, items: [] };
  }

  // Group by symbol
  const bySymbol = new Map<string, AnticipationDbRow[]>();
  for (const row of rows) {
    const arr = bySymbol.get(row.symbol) ?? [];
    arr.push(row);
    bySymbol.set(row.symbol, arr);
  }

  const allDates = [...new Set(rows.map((r) => toDateStr(r.tradeDate)))].sort().reverse();
  const latestDateStr = allDates[0]!;

  // Get momentum symbols to exclude (DailyScore >= 6 on latest day)
  const momentumSymbols = new Set<string>();
  for (const [symbol, symbolRows] of bySymbol) {
    const latestRow = symbolRows.find((r) => toDateStr(r.tradeDate) === latestDateStr);
    if (latestRow && computeDailyScore(latestRow) >= 6) {
      momentumSymbols.add(symbol);
    }
  }

  const items: AnticipationSymbolItem[] = [];

  for (const [symbol, symbolRows] of bySymbol) {
    if (momentumSymbols.has(symbol)) continue;

    symbolRows.sort((a, b) => b.tradeDate.getTime() - a.tradeDate.getTime());
    const latest = symbolRows[0]!;
    if (toDateStr(latest.tradeDate) !== latestDateStr) continue;
    const prev = symbolRows.length > 1 ? symbolRows[1]! : null;

    // Detect signals
    const signals: AnticipationSignal[] = [];
    if (detectSignalA(latest, prev)) signals.push({ type: "A", label: "Stoch Crossover <30" });
    if (detectSignalB(latest, prev)) signals.push({ type: "B", label: "Rising Stoch 40-65" });
    if (detectSignalC(latest, symbolRows)) signals.push({ type: "C", label: "Bullish Divergence" });

    if (signals.length === 0) continue;

    // Stage 0 scoring
    let stage0Score = 0;
    // Signal points: A=3, B=3, C=2
    for (const sig of signals) {
      if (sig.type === "A") stage0Score += 3;
      else if (sig.type === "B") stage0Score += 3;
      else if (sig.type === "C") stage0Score += 2;
    }

    // Structural bonuses
    const sma20AboveSma50 = latest.sma20 != null && latest.sma50 != null && latest.sma20 > latest.sma50;
    const closeAboveSma200 = latest.closingPrice != null && latest.sma200 != null && latest.closingPrice > latest.sma200;
    if (sma20AboveSma50) stage0Score += 2;
    if (closeAboveSma200) stage0Score += 1;
    // MACD turning
    if (prev != null && latest.macdHist != null && prev.macdHist != null && latest.macdHist > prev.macdHist) stage0Score += 1;
    // BW < 8%
    if (latest.bandWidth20 != null && latest.bandWidth20 < 0.08) stage0Score += 1;
    // RSI 40-55
    const rsi = latest.rsi14 ?? 0;
    if (rsi >= 40 && rsi <= 55) stage0Score += 1;

    if (stage0Score < 3) continue;

    const priority: AnticipationSymbolItem["priority"] =
      stage0Score >= 9 ? "HIGH" :
      stage0Score >= 6 ? "WATCH" :
      "RADAR";

    items.push({
      symbol,
      companyName: latest.companyName,
      stage0Score,
      priority,
      signals,
      stochK14: latest.stochK14,
      stochD14: latest.stochD14,
      rsi14: latest.rsi14,
      macdHist: latest.macdHist,
      bandWidth20: latest.bandWidth20,
      sma20AboveSma50,
      closeAboveSma200,
    });
  }

  items.sort((a, b) => b.stage0Score - a.stage0Score);

  return { tradeDate: tradeDateStr, marketType, count: items.length, items };
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
    select: { ...EOD_SELECT, taseSymbol: { select: { companyName: true, companySector: true, companySubSector: true } } },
    orderBy: [{ symbol: "asc" }, { tradeDate: "asc" }],
  });

  return {
    symbols: symbols ?? [],
    count: rows.length,
    dateFrom: toDateStr(from),
    dateTo: toDateStr(to),
    items: rows.map((row) => ({
      ...rowToStockData(row),
      companyName: row.taseSymbol?.companyName ?? null,
      sector: row.taseSymbol?.companySector ?? null,
      subSector: row.taseSymbol?.companySubSector ?? null,
    })),
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
      select: { ...EOD_SELECT, taseSymbol: { select: { companyName: true, companySector: true, companySubSector: true } } },
      orderBy: { symbol: "asc" },
    });
    return {
      symbols,
      count: rows.length,
      dateFrom: dateStr,
      dateTo: dateStr,
      items: rows.map((row) => ({
        ...rowToStockData(row),
        companyName: row.taseSymbol?.companyName ?? null,
        sector: row.taseSymbol?.companySector ?? null,
        subSector: row.taseSymbol?.companySubSector ?? null,
      })),
    };
  }

  // 1W / 1M / 3M: compute period change via LAG window function
  const N = HEATMAP_PERIOD_OFFSETS[period];
  const limit = N + 1;
  const symbolParam = Prisma.join(symbols);

  type SidebarRow = {
    symbol: string;
    closingprice: number | null;
    marketcap: bigint | null;
    change: number | null;
  };

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
      CAST("closingPrice" AS FLOAT8) AS closingprice,
      CAST("marketCap" AS BIGINT) AS marketcap,
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
    tradeDate: dateStr,
    symbol: r.symbol,
    securityId: 0,
    change: r.change != null ? Number(r.change) : null,
    closingPrice: r.closingprice != null ? Number(r.closingprice) : null,
    marketCap: r.marketcap != null ? Number(r.marketcap) : null,
    turnover: null,
    basePrice: null,
    openingPrice: null,
    high: null,
    low: null,
    changeValue: null,
    volume: null,
    minContPhaseAmount: null,
    listedCapital: null,
    marketType: null,
    rsi14: null,
    macd: null,
    macdSignal: null,
    macdHist: null,
    cci20: null,
    mfi14: null,
    turnover10: null,
    sma20: null,
    sma50: null,
    sma200: null,
    stddev20: null,
    upperBollingerBand20: null,
    lowerBollingerBand20: null,
    bandWidth20: null,
    stochK14: null,
    stochD14: null,
    ez: null,
    companyName: null,
    sector: null,
    subSector: null,
  }));

  return {
    symbols,
    count: items.length,
    dateFrom: dateStr,
    dateTo: dateStr,
    items,
  };
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
  const change =
    open != null && open !== 0 && close != null
      ? ((close - open) / open) * 100
      : null;
  return {
    tradeDate: toDateStr(row.tradeDate),
    symbol,
    securityId: 0,
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
    turnover: null,
    basePrice: null,
    changeValue: null,
    marketCap: null,
    minContPhaseAmount: null,
    listedCapital: null,
    marketType: null,
    rsi14: null,
    macd: null,
    macdSignal: null,
    macdHist: null,
    cci20: null,
    mfi14: null,
    turnover10: null,
    stddev20: null,
    upperBollingerBand20: null,
    lowerBollingerBand20: null,
    bandWidth20: null,
    stochK14: null,
    stochD14: null,
    companyName: null,
    sector: null,
    subSector: null,
  };
}

async function fetchCandlestickAggregated(
  symbol: string,
  from: Date,
  to: Date,
  timeframe: "3D" | "1W" | "1M" | "3M",
): Promise<AggRow[]> {
  const periodDays =
    timeframe === "3D" ? 3 :
    timeframe === "1W" ? 7 :
    timeframe === "1M" ? 31 :
    92; // 3M
  const lookbackDays = 200 * periodDays;
  const extendedFrom = new Date(from);
  extendedFrom.setDate(extendedFrom.getDate() - lookbackDays);

  if (timeframe === "3D") {
    return prisma.$queryRaw<AggRow[]>`
      WITH numbered AS (
        SELECT
          "tradeDate", "openingPrice", "high", "low", "closingPrice", "volume",
          "ez",
          (ROW_NUMBER() OVER (ORDER BY "tradeDate") - 1) AS row_idx
        FROM "TaseSecuritiesEndOfDayTradingData"
        WHERE symbol = ${symbol} AND "tradeDate" BETWEEN ${extendedFrom} AND ${to}
      ),
      bucketed AS (
        SELECT *, row_idx / 3 AS bucket FROM numbered
      ),
      ranked AS (
        SELECT *,
          ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY "tradeDate" ASC)  AS rn_asc,
          ROW_NUMBER() OVER (PARTITION BY bucket ORDER BY "tradeDate" DESC) AS rn_desc
        FROM bucketed
      ),
      agg AS (
        SELECT
          MAX("tradeDate")                                              AS "tradeDate",
          MAX(CASE WHEN rn_asc  = 1 THEN "openingPrice" END)          AS "openingPrice",
          MAX("high")                                                   AS "high",
          MIN("low")                                                    AS "low",
          MAX(CASE WHEN rn_desc = 1 THEN "closingPrice" END)           AS "closingPrice",
          SUM("volume")::bigint                                         AS "volume",
          AVG("ez")                                                     AS "ez",
          bucket
        FROM ranked
        GROUP BY bucket
      )
      SELECT * FROM (
        SELECT
          "tradeDate", "openingPrice", "high", "low", "closingPrice", "volume", "ez",
          AVG("closingPrice") OVER (ORDER BY bucket ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS "sma20",
          AVG("closingPrice") OVER (ORDER BY bucket ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS "sma50",
          AVG("closingPrice") OVER (ORDER BY bucket ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS "sma200",
          bucket
        FROM agg
      ) sub
      WHERE "tradeDate" >= ${from}
      ORDER BY bucket
    `;
  }

  const truncUnit =
    timeframe === "1W" ? "week" : timeframe === "1M" ? "month" : "quarter";

  return prisma.$queryRaw<AggRow[]>`
    WITH d AS (
      SELECT
        "tradeDate", "openingPrice", "high", "low", "closingPrice", "volume",
        "ez",
        DATE_TRUNC(${truncUnit}, "tradeDate"::timestamp) AS period,
        ROW_NUMBER() OVER (PARTITION BY DATE_TRUNC(${truncUnit}, "tradeDate"::timestamp) ORDER BY "tradeDate" ASC)  AS rn_asc,
        ROW_NUMBER() OVER (PARTITION BY DATE_TRUNC(${truncUnit}, "tradeDate"::timestamp) ORDER BY "tradeDate" DESC) AS rn_desc
      FROM "TaseSecuritiesEndOfDayTradingData"
      WHERE symbol = ${symbol} AND "tradeDate" BETWEEN ${extendedFrom} AND ${to}
    ),
    agg AS (
      SELECT
        MAX("tradeDate")                                              AS "tradeDate",
        MAX(CASE WHEN rn_asc  = 1 THEN "openingPrice" END)          AS "openingPrice",
        MAX("high")                                                   AS "high",
        MIN("low")                                                    AS "low",
        MAX(CASE WHEN rn_desc = 1 THEN "closingPrice" END)           AS "closingPrice",
        SUM("volume")::bigint                                         AS "volume",
        AVG("ez")                                                     AS "ez",
        period
      FROM d
      GROUP BY period
    )
    SELECT * FROM (
      SELECT
        "tradeDate", "openingPrice", "high", "low", "closingPrice", "volume", "ez",
        AVG("closingPrice") OVER (ORDER BY period ROWS BETWEEN 19 PRECEDING AND CURRENT ROW) AS "sma20",
        AVG("closingPrice") OVER (ORDER BY period ROWS BETWEEN 49 PRECEDING AND CURRENT ROW) AS "sma50",
        AVG("closingPrice") OVER (ORDER BY period ROWS BETWEEN 199 PRECEDING AND CURRENT ROW) AS "sma200",
        period
      FROM agg
    ) sub
    WHERE "tradeDate" >= ${from}
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
    const aggRows = await fetchCandlestickAggregated(
      symbol,
      from,
      to,
      timeframe,
    );
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
  marketcap: bigint | null;
  companyname: string | null;
  companysector: string;
  companysubsector: string | null;
  change: number | null;
};

export async function fetchSectorHeatmap(
  marketType = "STOCK",
  tradeDate?: string,
  period: HeatmapPeriod = "1D",
): Promise<SectorHeatmapResponse> {
  const date = tradeDate
    ? new Date(tradeDate)
    : await getLastTradeDate(marketType);
  const dateStr = toDateStr(date);

  if (period === "1D") {
    const rows = await prisma.taseSecuritiesEndOfDayTradingData.findMany({
      where: { tradeDate: date, marketType },
      select: {
        symbol: true,
        marketCap: true,
        change: true,
        taseSymbol: {
          select: {
            companyName: true,
            companySector: true,
            companySubSector: true,
          },
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

    return {
      tradeDate: dateStr,
      marketType,
      period,
      count: items.length,
      items,
    };
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
      CAST("marketCap" AS BIGINT) AS marketcap,
      "companyName" AS companyname,
      "companySector" AS companysector,
      "companySubSector" AS companysubsector,
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
    companyName: r.companyname,
    marketCap: r.marketcap != null ? Number(r.marketcap) : null,
    change: r.change != null ? Number(r.change) : null,
    sector: r.companysector,
    subSector: r.companysubsector,
  }));

  return { tradeDate: dateStr, marketType, period, count: items.length, items };
}

export async function resolveSymbolAndSecurityId(
  securityIdOrSymbol: string | number,
): Promise<{ symbol: string; securityId: number }> {
  const isNumeric =
    typeof securityIdOrSymbol === "number" ||
    (typeof securityIdOrSymbol === "string" && /^\d+$/.test(securityIdOrSymbol));

  if (isNumeric) {
    const id = typeof securityIdOrSymbol === "number" ? securityIdOrSymbol : parseInt(securityIdOrSymbol, 10);
    const row = await prisma.taseSymbol.findUnique({ where: { securityId: id }, select: { symbol: true, securityId: true } });
    if (!row) throw new Error(`No symbol found for securityId: ${id}`);
    return { symbol: row.symbol, securityId: row.securityId };
  }

  const sym = (securityIdOrSymbol as string).toUpperCase();
  const row = await prisma.taseSymbol.findUnique({ where: { symbol: sym }, select: { symbol: true, securityId: true } });
  if (!row) throw new Error(`No securityId found for symbol: ${sym}`);
  return { symbol: row.symbol, securityId: row.securityId };
}

export const dbProviders: TaseDataProviders = {
  fetchEndOfDay,
  fetchMarketSpirit,
  fetchMomentumSymbols,
  fetchAnticipationSymbols,
  fetchEndOfDaySymbols,
  fetchEndOfDaySymbolsByDate,
  fetchCandlestick,
  fetchSectorHeatmap,
  resolveSymbol: resolveSymbolAndSecurityId,
};
