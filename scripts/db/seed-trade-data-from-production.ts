/**
 * Seed dev database from production using batch inserts.
 * Usage: npx tsx --env-file=.env.local scripts/db/seed-trade-data-from-production.ts <PROD_DATABASE_URL>
 */
// @ts-ignore — Prisma v7 generates .ts files that confuse tsc; tsx handles them fine
import { PrismaClient } from "../../src/generated/prisma/client.js";
import { PrismaNeon } from "@prisma/adapter-neon";
import { neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { prisma as devPrisma } from "../../src/db/db.js";

neonConfig.webSocketConstructor = ws;

const PROD_URL = process.argv[2];
const DATE_FROM = process.argv[3];
const DATE_TO = process.argv[4];

if (!PROD_URL || !DATE_FROM || !DATE_TO) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/db/seed-trade-data-from-production.ts <PROD_DATABASE_URL> <DATE_FROM> <DATE_TO>");
  console.error("Example: npx tsx --env-file=.env.local scripts/db/seed-trade-data-from-production.ts \"postgresql://...\" 2026-01-01 2026-03-11");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set (should come from .env.local)");
  process.exit(1);
}

const prodAdapter = new PrismaNeon({ connectionString: PROD_URL });
const prodPrisma = new PrismaClient({ adapter: prodAdapter });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function seedSymbols() {
  console.log("Seeding TaseSymbol...");
  const rows = await prodPrisma.taseSymbol.findMany();
  console.log(`  Found ${rows.length} symbols in production`);

  if (rows.length === 0) return;

  // Build parameterized multi-row INSERT (same pattern as fetch-symbols-from-tase-data-hub.ts)
  const placeholders = rows
    .map(
      (_, i) =>
        `($${i * 9 + 1}, $${i * 9 + 2}, $${i * 9 + 3}, $${i * 9 + 4}, $${i * 9 + 5}, $${i * 9 + 6}, $${i * 9 + 7}, $${i * 9 + 8}, $${i * 9 + 9}::int[], NOW())`,
    )
    .join(", ");

  const params = rows.flatMap((r) => [
    r.symbol,
    r.securityId,
    r.isin,
    r.securityName,
    r.companySuperSector,
    r.companySector,
    r.companySubSector,
    r.companyName,
    `{${(r.indices ?? []).join(",")}}`,
  ]);

  const sql = `
    INSERT INTO "TaseSymbol" (symbol, "securityId", isin, "securityName", "companySuperSector", "companySector", "companySubSector", "companyName", indices, "updatedAt")
    VALUES ${placeholders}
    ON CONFLICT (symbol) DO UPDATE SET
      "securityId" = EXCLUDED."securityId",
      isin = EXCLUDED.isin,
      "securityName" = EXCLUDED."securityName",
      "companySuperSector" = EXCLUDED."companySuperSector",
      "companySector" = EXCLUDED."companySector",
      "companySubSector" = EXCLUDED."companySubSector",
      "companyName" = EXCLUDED."companyName",
      indices = EXCLUDED.indices,
      "updatedAt" = NOW()
  `;

  await devPrisma.$transaction([
    devPrisma.$executeRaw`DELETE FROM "TaseSymbol"`,
    devPrisma.$executeRawUnsafe(sql, ...params),
  ]);

  console.log(`  Inserted ${rows.length} symbols`);
}

async function seedTradeData() {
  console.log(`\nSeeding TaseSecuritiesEndOfDayTradingData (${DATE_FROM} to ${DATE_TO})...`);

  // Get distinct trade dates from prod
  const dates: { tradeDate: Date }[] = await prodPrisma.$queryRaw`
    SELECT DISTINCT "tradeDate" FROM "TaseSecuritiesEndOfDayTradingData"
    WHERE "tradeDate" >= ${DATE_FROM}::date AND "tradeDate" <= ${DATE_TO}::date
    ORDER BY "tradeDate"
  `;

  console.log(`  Found ${dates.length} trading days`);
  if (dates.length === 0) return;

  let totalRows = 0;

  for (let i = 0; i < dates.length; i++) {
    const tradeDate = dates[i]!.tradeDate;

    const rows = await prodPrisma.taseSecuritiesEndOfDayTradingData.findMany({
      where: { tradeDate },
    });

    if (rows.length === 0) continue;

    const result = await devPrisma.taseSecuritiesEndOfDayTradingData.createMany({
      data: rows.map((r) => ({
        tradeDate: r.tradeDate,
        symbol: r.symbol,
        firstTradingDate: r.firstTradingDate,
        isin: r.isin,
        change: r.change,
        securityId: r.securityId,
        turnover: r.turnover,
        closingPrice: r.closingPrice,
        basePrice: r.basePrice,
        openingPrice: r.openingPrice,
        high: r.high,
        low: r.low,
        changeValue: r.changeValue,
        transactionsNumber: r.transactionsNumber,
        volume: r.volume,
        marketCap: r.marketCap,
        minContPhaseAmount: r.minContPhaseAmount,
        listedCapital: r.listedCapital,
        adjustedClosingPrice: r.adjustedClosingPrice,
        exCode: r.exCode,
        adjustmentCoefficient: r.adjustmentCoefficient,
        marketType: r.marketType,
        rsi14: r.rsi14,
        macd: r.macd,
        macdSignal: r.macdSignal,
        macdHist: r.macdHist,
        cci20: r.cci20,
        mfi14: r.mfi14,
        turnover10: r.turnover10,
        sma20: r.sma20,
        sma50: r.sma50,
        sma200: r.sma200,
        ez: r.ez,
        stddev20: r.stddev20,
        upperBollingerBand20: r.upperBollingerBand20,
        lowerBollingerBand20: r.lowerBollingerBand20,
      })),
      skipDuplicates: true,
    });

    totalRows += result.count;
    const dateStr = tradeDate.toISOString().split("T")[0];
    console.log(`  Inserted day ${dateStr} (${result.count} rows) [${i + 1}/${dates.length} days]`);

    await sleep(100);
  }

  console.log(`  Trade data done. Total: ${totalRows} rows`);
}

async function main() {
  console.log("Seeding dev database from production...\n");
  await seedSymbols();
  await seedTradeData();
  console.log("\nDone!");
  await prodPrisma.$disconnect();
  await devPrisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Error:", err);
  await prodPrisma.$disconnect().catch(() => {});
  await devPrisma.$disconnect().catch(() => {});
  process.exit(1);
});
