import { prisma } from "./db.js";
import { subDays } from "date-fns";

const LOOKBACK_DAYS = 450;

/* ---------------------------- Indicators ---------------------------- */

function sma(values: (number | null)[], period: number): (number | null)[] {
  const out = new Array(values.length).fill(null) as (number | null)[];
  let sum = 0;
  let count = 0;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += v;
    count++;

    if (count > period) {
      const off = values[i - period]!;
      sum -= off;
      count = period;
    }
    if (count === period) out[i] = sum / period;
  }
  return out;
}

function ez(
  close: (number | null)[],
  sma20Arr: (number | null)[],
): (number | null)[] {
  return close.map((c, i) => {
    const m = sma20Arr[i];
    if (c === null || m === null || !Number.isFinite(c) || !Number.isFinite(m) || m === 0)
      return null;
    return 100 * ((c - m) / m);
  });
}

function stddev(values: (number | null)[], period: number): (number | null)[] {
  const out = new Array(values.length).fill(null) as (number | null)[];
  const window: number[] = [];

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) {
      window.length = 0;
      continue;
    }
    window.push(v);
    if (window.length > period) window.shift();
    if (window.length === period) {
      const mean = window.reduce((a, b) => a + b, 0) / period;
      const variance = window.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
      out[i] = Math.sqrt(variance);
    }
  }
  return out;
}

function rsi(values: (number | null)[], period = 14): (number | null)[] {
  const out = new Array(values.length).fill(null) as (number | null)[];
  let avgGain: number | null = null;
  let avgLoss: number | null = null;

  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1];
    const cur = values[i];
    if (prev === null || cur === null) {
      avgGain = null;
      avgLoss = null;
      continue;
    }

    const change = cur - prev;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    if (i < period) continue;

    if (i === period) {
      let g = 0;
      let l = 0;
      for (let k = 1; k <= period; k++) {
        const a = values[k - 1];
        const b = values[k];
        if (a === null || b === null) {
          g = 0;
          l = 0;
          break;
        }
        const d = b - a;
        g += d > 0 ? d : 0;
        l += d < 0 ? -d : 0;
      }
      avgGain = g / period;
      avgLoss = l / period;
    } else if (avgGain !== null && avgLoss !== null) {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }

    if (avgGain === null || avgLoss === null) continue;
    if (avgLoss === 0) out[i] = 100;
    else {
      const rs = avgGain / avgLoss;
      out[i] = 100 - 100 / (1 + rs);
    }
  }

  return out;
}

function ema(values: (number | null)[], period: number): (number | null)[] {
  const out = new Array(values.length).fill(null) as (number | null)[];
  const k = 2 / (period + 1);
  let prev: number | null = null;

  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null || !Number.isFinite(v)) {
      prev = null;
      continue;
    }

    if (prev === null) {
      if (i + 1 >= period) {
        let ok = true;
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) {
          const w = values[j];
          if (w === null) {
            ok = false;
            break;
          }
          sum += w;
        }
        if (!ok) continue;
        prev = sum / period;
        out[i] = prev;
      }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }

  return out;
}

function macd12269(values: (number | null)[]) {
  const e12 = ema(values, 12);
  const e26 = ema(values, 26);

  const macd = values.map((_, i) => {
    const a = e12[i];
    const b = e26[i];
    return a === null || b === null ? null : a - b;
  });

  const macdSignal = ema(macd, 9);
  const macdHist = macd.map((m, i) => {
    const s = macdSignal[i];
    return m === null || s === null ? null : m - s;
  });

  return { macd, macdSignal, macdHist };
}

function cci(
  high: (number | null)[],
  low: (number | null)[],
  close: (number | null)[],
  period = 20,
): (number | null)[] {
  const out = new Array(close.length).fill(null) as (number | null)[];
  const tp: (number | null)[] = close.map((_, i) => {
    const h = high[i],
      l = low[i],
      c = close[i];
    if (h === null || l === null || c === null) return null;
    return (h + l + c) / 3;
  });

  const tpSma = sma(tp, period);

  for (let i = 0; i < tp.length; i++) {
    if (i + 1 < period) continue;
    const t = tp[i];
    const m = tpSma[i];
    if (t === null || m === null) continue;

    let sumDev = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const w = tp[j];
      if (w === null) {
        sumDev = 0;
        break;
      }
      sumDev += Math.abs(w - m);
    }
    const meanDev = sumDev / period;
    if (meanDev === 0) continue;

    out[i] = (t - m) / (0.015 * meanDev);
  }

  return out;
}

function mfi(
  high: (number | null)[],
  low: (number | null)[],
  close: (number | null)[],
  volume: (number | null)[],
  period = 14,
): (number | null)[] {
  const out = new Array(close.length).fill(null) as (number | null)[];
  const tp: (number | null)[] = close.map((_, i) => {
    const h = high[i],
      l = low[i],
      c = close[i];
    if (h === null || l === null || c === null) return null;
    return (h + l + c) / 3;
  });

  const rmf: (number | null)[] = tp.map((t, i) => {
    const v = volume[i];
    if (t === null || v === null) return null;
    return t * v;
  });

  for (let i = 1; i < tp.length; i++) {
    if (i < period) continue;

    let pos = 0;
    let neg = 0;

    for (let j = i - period + 1; j <= i; j++) {
      const t = tp[j];
      const tPrev = tp[j - 1];
      const f = rmf[j];
      if (t === null || tPrev === null || f === null) {
        pos = 0;
        neg = 0;
        break;
      }
      if (t > tPrev) pos += f;
      else if (t < tPrev) neg += f;
    }

    if (pos === 0 && neg === 0) continue;
    if (neg === 0) out[i] = 100;
    else {
      const mfr = pos / neg;
      out[i] = 100 - 100 / (1 + mfr);
    }
  }

  return out;
}

/* ---------------------------- Public functions ---------------------------- */

async function getTradingIndicators({
  symbol,
  tradeDate,
  fromDate,
}: {
  symbol: string;
  tradeDate: Date;
  fromDate: Date;
}) {
  const rows = await prisma.taseSecuritiesEndOfDayTradingData.findMany({
    where: {
      symbol: symbol,
      tradeDate: { gte: fromDate, lte: tradeDate },
    },
    orderBy: { tradeDate: "asc" },
    select: {
      symbol: true,
      tradeDate: true,
      closingPrice: true,
      high: true,
      low: true,
      volume: true,
      turnover: true,
    },
  });

  const close = rows.map((row) => row.closingPrice ?? null) as (number | null)[];
  const highArr = rows.map((row) => row.high ?? null) as (number | null)[];
  const lowArr = rows.map((row) => row.low ?? null) as (number | null)[];
  const volumeArr = rows.map((row) =>
    row.volume == null ? null : Number(row.volume),
  ) as (number | null)[];
  const turnoverArr = rows.map((row) =>
    row.turnover == null ? null : Number(row.turnover),
  ) as (number | null)[];

  const rsi14Arr = rsi(close, 14);
  const { macd: macdArr, macdSignal: macdSignalArr, macdHist: macdHistArr } = macd12269(close);
  const cci20Arr = cci(highArr, lowArr, close, 20);
  const mfi14Arr = mfi(highArr, lowArr, close, volumeArr, 14);

  const turnover10Arr = sma(turnoverArr, 10);

  const sma20Arr = sma(close, 20);
  const sma50Arr = sma(close, 50);
  const sma200Arr = sma(close, 200);

  const ezArr = ez(close, sma20Arr);

  const stddev20Arr = stddev(close, 20);
  const upperBB20 = stddev20Arr.map((sd, i) => {
    const m = sma20Arr[i];
    if (sd === null || m === null) return null;
    return m + 2 * sd;
  });
  const lowerBB20 = stddev20Arr.map((sd, i) => {
    const m = sma20Arr[i];
    if (sd === null || m === null) return null;
    return m - 2 * sd;
  });

  const idx = rows.length - 1;
  return {
    rsi14: rsi14Arr[idx] ?? null,
    macd: macdArr[idx] ?? null,
    macdSignal: macdSignalArr[idx] ?? null,
    macdHist: macdHistArr[idx] ?? null,
    cci20: cci20Arr[idx] ?? null,
    mfi14: mfi14Arr[idx] ?? null,
    turnover10: turnover10Arr[idx] ?? null,
    sma20: sma20Arr[idx] ?? null,
    sma50: sma50Arr[idx] ?? null,
    sma200: sma200Arr[idx] ?? null,
    ez: ezArr[idx] ?? null,
    stddev20: stddev20Arr[idx] ?? null,
    upperBollingerBand20: upperBB20[idx] ?? null,
    lowerBollingerBand20: lowerBB20[idx] ?? null,
  };
}

export async function updateTradingDayIndicators({
  tradeDate,
  marketType,
}: {
  tradeDate: string;
  marketType: string;
}): Promise<{ updated: number }> {
  const fromDate = new Date(
    subDays(new Date(tradeDate), LOOKBACK_DAYS)
      .toISOString()
      .split("T")[0] as string,
  );

  // Get distinct symbols for the given date and marketType
  const rows = await prisma.taseSecuritiesEndOfDayTradingData.findMany({
    where: {
      tradeDate: new Date(tradeDate),
      marketType: marketType,
    },
    select: { symbol: true },
  });
  const symbols = rows.map((r) => r.symbol);

  console.error(`[indicators] Updating indicators for ${symbols.length} symbols on ${tradeDate} (${marketType})`);

  let updated = 0;

  for (const symbol of symbols) {
    const indicators = await getTradingIndicators({
      symbol,
      tradeDate: new Date(tradeDate),
      fromDate,
    });

    await prisma.taseSecuritiesEndOfDayTradingData.update({
      where: {
        unique_symbol_tradeDate: {
          symbol,
          tradeDate: new Date(tradeDate),
        },
      },
      data: indicators,
    });
    updated++;
  }

  console.error(`[indicators] Updated ${updated} rows for ${tradeDate} (${marketType})`);
  return { updated };
}
