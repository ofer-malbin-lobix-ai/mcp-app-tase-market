/**
 * Load historical EOD data from a JSON dump into the database.
 * Uses streaming JSON parser for large files.
 * Usage: npx tsx scripts/load-json.ts <path-to-json-file>
 */
import { createReadStream } from "node:fs";
import { createRequire } from "node:module";
import { prisma } from "../src/db/db.js";

const require = createRequire(import.meta.url);
const { parser } = require("stream-json");
const { streamArray } = require("stream-json/streamers/StreamArray");

const BATCH_SIZE = 500;

interface JsonRow {
  id: string;
  tradeDate: string;
  firstTradingDate: string | null;
  isin: string;
  change: number | null;
  securityId: number;
  turnover: number | null;
  closingPrice: number | null;
  basePrice: number | null;
  openingPrice: number | null;
  high: number | null;
  low: number | null;
  changeValue: number | null;
  transactionsNumber: number | null;
  volume: number | null;
  marketCap: number | null;
  minContPhaseAmount: number | null;
  listedCapital: number | null;
  adjustedClosingPrice: number | null;
  exCode: string | null;
  adjustmentCoefficient: number | null;
  symbol: string;
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
  ez: number | null;
  stddev20: number | null;
  upperBollingerBand20: number | null;
  lowerBollingerBand20: number | null;
}

function toRow(item: JsonRow) {
  return {
    tradeDate: new Date(item.tradeDate.split("T")[0] as string),
    symbol: item.symbol,
    firstTradingDate: item.firstTradingDate ? new Date(item.firstTradingDate.split("T")[0] as string) : null,
    isin: item.isin,
    change: item.change,
    securityId: item.securityId,
    turnover: item.turnover != null ? BigInt(item.turnover) : null,
    closingPrice: item.closingPrice,
    basePrice: item.basePrice,
    openingPrice: item.openingPrice,
    high: item.high,
    low: item.low,
    changeValue: item.changeValue,
    transactionsNumber: item.transactionsNumber,
    volume: item.volume != null ? BigInt(item.volume) : null,
    marketCap: item.marketCap != null ? BigInt(item.marketCap) : null,
    minContPhaseAmount: item.minContPhaseAmount,
    listedCapital: item.listedCapital != null ? BigInt(item.listedCapital) : null,
    adjustedClosingPrice: item.adjustedClosingPrice,
    exCode: item.exCode,
    adjustmentCoefficient: item.adjustmentCoefficient,
    marketType: item.marketType,
    rsi14: item.rsi14,
    macd: item.macd,
    macdSignal: item.macdSignal,
    macdHist: item.macdHist,
    cci20: item.cci20,
    mfi14: item.mfi14,
    turnover10: item.turnover10 ?? null,
    sma20: item.sma20,
    sma50: item.sma50,
    sma200: item.sma200 ?? null,
    ez: item.ez,
    stddev20: item.stddev20,
    upperBollingerBand20: item.upperBollingerBand20,
    lowerBollingerBand20: item.lowerBollingerBand20,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function flushBatch(batch: ReturnType<typeof toRow>[], retries = 3): Promise<number> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const result = await prisma.taseSecuritiesEndOfDayTradingData.createMany({
        data: batch,
        skipDuplicates: true,
      });
      return result.count;
    } catch (error) {
      if (attempt < retries) {
        console.error(`[load-json] Batch failed (attempt ${attempt}/${retries}), retrying in 5s...`);
        await sleep(5000);
      } else {
        throw error;
      }
    }
  }
  return 0;
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npx tsx scripts/load-json.ts <path-to-json-file>");
    process.exit(1);
  }

  const skipRows = parseInt(process.argv[3] ?? "0", 10);
  console.error(`[load-json] Streaming ${filePath}... (skipping first ${skipRows} rows)`);

  const pipeline = createReadStream(filePath).pipe(parser()).pipe(streamArray());

  let batch: ReturnType<typeof toRow>[] = [];
  let totalProcessed = 0;
  let totalCreated = 0;
  let rowIndex = 0;

  for await (const { value } of pipeline) {
    rowIndex++;
    if (rowIndex <= skipRows) continue;
    batch.push(toRow(value as JsonRow));

    if (batch.length >= BATCH_SIZE) {
      totalCreated += await flushBatch(batch);
      totalProcessed += batch.length;
      batch = [];

      if ((totalProcessed / BATCH_SIZE) % 50 === 0) {
        console.error(`[load-json] Progress: ${totalProcessed} processed, ${totalCreated} created`);
      }

      // Small delay to avoid overwhelming the Neon connection pool
      await sleep(100);
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    totalCreated += await flushBatch(batch);
    totalProcessed += batch.length;
  }

  console.error(`[load-json] Done. Total: ${totalProcessed} processed, ${totalCreated} created (${totalProcessed - totalCreated} duplicates skipped)`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
