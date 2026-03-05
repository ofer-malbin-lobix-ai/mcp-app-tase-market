import { Router } from "express";
import type { Request, Response } from "express";
import { prisma } from "../db/db.js";

const TASE_DATA_HUB_SYMBOLS_URL =
  "https://datawise.tase.co.il/v1/basic-securities/trade-securities-list";

// Shape returned by the TASE Data Hub basic-securities API
interface TaseDataHubSymbolItem {
  symbol: string;
  securityId: number;
  isin: string;
  securityName?: string | null;
  companySuperSector?: string | null;
  companySector?: string | null;
  companySubSector?: string | null;
  companyName?: string | null;
}

interface TaseDataHubSymbolsResponse {
  tradeSecuritiesList: {
    result: TaseDataHubSymbolItem[];
    total: number;
  };
}

/**
 * Fetch symbol metadata from TASE Data Hub and upsert into TaseSymbol table.
 */
export async function fetchAndStoreSymbols(date: string): Promise<{ fetched: number; upserted: number }> {
  const apiKey = process.env.TASE_DATA_HUB_API_KEY;
  if (!apiKey) {
    throw new Error("TASE_DATA_HUB_API_KEY environment variable is not set");
  }

  const [year, month, day] = date.split("-");
  const url = `${TASE_DATA_HUB_SYMBOLS_URL}/${year}/${month}/${day}`;
  console.error(`[fetch-symbols-from-tase-data-hub] Fetching from: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "Accept-Language": "en-US",
      apikey: apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`TASE Data Hub API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as TaseDataHubSymbolsResponse;
  const items = data.tradeSecuritiesList.result;

  console.error(`[fetch-symbols-from-tase-data-hub] Received ${items.length} symbols for date ${date}`);

  // The basic-securities API returns Hebrew ticker symbols (e.g. "IBI.ס183"),
  // but TaseSecuritiesEndOfDayTradingData uses Latin symbols (e.g. "IBI.F183").
  // Use securityId as the bridge: look up the most-recent Latin symbol per securityId.
  const eodRows = await prisma.$queryRaw<{ securityId: number; symbol: string }[]>`
    SELECT DISTINCT ON ("securityId") "securityId", symbol
    FROM "TaseSecuritiesEndOfDayTradingData"
    ORDER BY "securityId", "tradeDate" DESC
  `;
  const securityIdToSymbol = new Map(eodRows.map((r) => [r.securityId, r.symbol]));

  console.error(`[fetch-symbols-from-tase-data-hub] EOD table has ${securityIdToSymbol.size} distinct securityIds`);

  // Map API items to Latin symbols; skip items with no EOD match
  const values = items
    .map((item) => ({
      symbol: securityIdToSymbol.get(item.securityId),
      securityId: item.securityId,
      isin: item.isin,
      securityName: item.securityName ?? null,
      companySuperSector: item.companySuperSector ?? null,
      companySector: item.companySector ?? null,
      companySubSector: item.companySubSector ?? null,
      companyName: item.companyName ?? null,
    }))
    .filter((v): v is typeof v & { symbol: string } => v.symbol != null);

  console.error(`[fetch-symbols-from-tase-data-hub] ${values.length} items matched to Latin symbols`);

  if (values.length === 0) {
    return { fetched: items.length, upserted: 0 };
  }

  // Build parameterized VALUES list
  const placeholders = values
    .map(
      (_, i) =>
        `($${i * 8 + 1}, $${i * 8 + 2}, $${i * 8 + 3}, $${i * 8 + 4}, $${i * 8 + 5}, $${i * 8 + 6}, $${i * 8 + 7}, $${i * 8 + 8}, NOW())`,
    )
    .join(", ");

  const params = values.flatMap((v) => [
    v.symbol,
    v.securityId,
    v.isin,
    v.securityName,
    v.companySuperSector,
    v.companySector,
    v.companySubSector,
    v.companyName,
  ]);

  const sql = `
    INSERT INTO "TaseSymbol" (symbol, "securityId", isin, "securityName", "companySuperSector", "companySector", "companySubSector", "companyName", "updatedAt")
    VALUES ${placeholders}
    ON CONFLICT (symbol) DO UPDATE SET
      "securityId" = EXCLUDED."securityId",
      isin = EXCLUDED.isin,
      "securityName" = EXCLUDED."securityName",
      "companySuperSector" = EXCLUDED."companySuperSector",
      "companySector" = EXCLUDED."companySector",
      "companySubSector" = EXCLUDED."companySubSector",
      "companyName" = EXCLUDED."companyName",
      "updatedAt" = NOW()
  `;

  // Clear old records (may have Hebrew symbols) and reinsert with Latin symbols atomically
  await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM "TaseSymbol"`,
    prisma.$executeRawUnsafe(sql, ...params),
  ]);

  console.error(`[fetch-symbols-from-tase-data-hub] Upserted ${values.length} symbols with Latin symbols`);
  return { fetched: items.length, upserted: values.length };
}

/**
 * Creates an Express router with the /api/fetch-symbols-from-tase-data-hub endpoint.
 * GET /api/fetch-symbols-from-tase-data-hub?date=YYYY-MM-DD
 * If no date is provided, defaults to today (Israel time).
 */
export function createFetchSymbolsFromTaseDataHubRouter(): Router {
  const router = Router();

  router.get("/api/fetch-symbols-from-tase-data-hub", async (req: Request, res: Response) => {
    try {
      const date =
        (req.query.date as string) ??
        new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
      const result = await fetchAndStoreSymbols(date);
      res.json({ status: "ok", date, ...result });
    } catch (error) {
      console.error("[fetch-symbols-from-tase-data-hub] Error:", error);
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
