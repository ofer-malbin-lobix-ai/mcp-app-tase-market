import { Router } from "express";
import type { Request, Response } from "express";
import cron from "node-cron";
import { prisma } from "../db/db.js";
import { updateTradingDayIndicators } from "../db/indicators.js";
import { fetchAndStoreSymbols } from "./fetch-symbols-from-tase-data-hub.js";

const TASE_DATA_HUB_EOD_URL =
  "https://datawise.tase.co.il/v1/securities/trading/eod/seven-days/by-date";

// Shape returned by the TASE Data Hub API
interface TaseDataHubEodItem {
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
}

interface TaseDataHubEodResponse {
  securitiesEndOfDayTradingData: {
    result: TaseDataHubEodItem[];
  };
}

function getIsraelTime(): string {
  return new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Jerusalem", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function sendTelegramNotification(message: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "HTML" }),
    });
    if (!res.ok) {
      console.error(`[telegram] Failed to send: ${res.status} ${res.statusText}`);
    }
  } catch (error) {
    console.error("[telegram] Error sending notification:", error);
  }
}

/**
 * Fetch EOD data from TASE Data Hub and insert into the database.
 * Uses createMany with skipDuplicates to efficiently bulk-insert rows.
 */
async function fetchAndStoreEod(date: string): Promise<{ fetched: number; created: number }> {
  const apiKey = process.env.TASE_DATA_HUB_API_KEY;
  if (!apiKey) {
    throw new Error("TASE_DATA_HUB_API_KEY environment variable is not set");
  }

  const url = `${TASE_DATA_HUB_EOD_URL}?date=${date}`;
  console.error(`[fetch-end-of-day-from-tase-data-hub] Fetching from: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      apikey: apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`TASE Data Hub API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as TaseDataHubEodResponse;
  const items = data.securitiesEndOfDayTradingData.result;

  console.error(`[fetch-end-of-day-from-tase-data-hub] Received ${items.length} items for date ${date}`);

  const rows = items.map((item) => ({
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
  }));

  const result = await prisma.taseSecuritiesEndOfDayTradingData.createMany({
    data: rows,
    skipDuplicates: true,
  });

  console.error(`[fetch-end-of-day-from-tase-data-hub] Created ${result.count} rows for date ${date} (${items.length - result.count} duplicates skipped)`);
  return { fetched: items.length, created: result.count };
}

function getTodayDateIL(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Jerusalem" });
}

async function runEndOfDayPipeline(date: string): Promise<{ fetched: number; created: number; updated: number; symbolsUpserted: number }> {
  const eodResult = await fetchAndStoreEod(date);
  if (eodResult.created === 0) {
    console.error(`[run-end-of-day-pipeline] No new rows for ${date}, skipping indicators and symbols update`);
    return { ...eodResult, updated: 0, symbolsUpserted: 0 };
  }
  const indicatorsResult = await updateTradingDayIndicators({ tradeDate: date, marketType: "STOCK" });
  const symbolsResult = await fetchAndStoreSymbols(date);
  return { ...eodResult, ...indicatorsResult, symbolsUpserted: symbolsResult.upserted };
}

/**
 * Creates an Express router with the /api/fetch-end-of-day-from-tase-data-hub endpoint.
 * GET /api/fetch-end-of-day-from-tase-data-hub?date=YYYY-MM-DD
 * If no date is provided, defaults to today (Israel time).
 */
export function createFetchEndOfDayFromTaseDataHubRouter(): Router {
  const router = Router();

  router.get("/api/fetch-end-of-day-from-tase-data-hub", async (req: Request, res: Response) => {
    try {
      const date = (req.query.date as string) ?? getTodayDateIL();
      const result = await fetchAndStoreEod(date);
      res.json({ status: "ok", date, ...result });
    } catch (error) {
      console.error("[fetch-end-of-day-from-tase-data-hub] Error:", error);
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/api/run-end-of-day-pipeline", async (req: Request, res: Response) => {
    const date = (req.query.date as string) ?? getTodayDateIL();
    try {
      const result = await runEndOfDayPipeline(date);
      const env = process.env.ENVIRONMENT_NAME || "development";
      await sendTelegramNotification(
        `<b>📊 EOD Pipeline — ${date} [${env}]</b>\n⏰ ${getIsraelTime()} (Israel)\n✅ Fetched: ${result.fetched} | Created: ${result.created} | Updated: ${result.updated} | Symbols: ${result.symbolsUpserted}`
      );
      res.json({ status: "ok", date, ...result });
    } catch (error) {
      console.error("[run-end-of-day-pipeline] Error:", error);
      const env = process.env.ENVIRONMENT_NAME || "development";
      await sendTelegramNotification(
        `<b>📊 EOD Pipeline — ${date} [${env}]</b>\n⏰ ${getIsraelTime()} (Israel)\n❌ Error: ${error instanceof Error ? error.message : String(error)}`
      );
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.get("/api/update-indicators", async (req: Request, res: Response) => {
    try {
      const date = (req.query.date as string) ?? getTodayDateIL();
      const result = await updateTradingDayIndicators({ tradeDate: date, marketType: "STOCK" });
      res.json({ status: "ok", date, ...result });
    } catch (error) {
      console.error("[update-indicators] Error:", error);
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  // Cron: run EOD pipeline every 15 min during post-market hours (Israel time)
  if (process.env.ENABLE_FETCH_TASE_DATA_CRON === "true") {
    const cronCallback = async () => {
      const port = process.env.PORT || "3001";
      const date = getTodayDateIL();
      console.error(`[end-of-day-pipeline-cron] Calling /api/run-end-of-day-pipeline?date=${date}`);
      try {
        const res = await fetch(`http://localhost:${port}/api/run-end-of-day-pipeline?date=${date}`);
        const body = await res.json();
        console.error(`[end-of-day-pipeline-cron] Response:`, body);
      } catch (error) {
        console.error("[end-of-day-pipeline-cron] Error:", error);
      }
    };

    // Mon-Thu 18:00–22:00 every 15 min
    cron.schedule("*/15 18-21 * * 1-4", cronCallback, { timezone: "Asia/Jerusalem" });
    // Friday 14:00–18:00 every 15 min
    cron.schedule("*/15 14-17 * * 5", cronCallback, { timezone: "Asia/Jerusalem" });
    console.error("[end-of-day-pipeline-cron] EOD pipeline scheduled: Mon-Thu 18:00-22:00, Fri 14:00-18:00 (every 15 min, Israel time)");
  } else {
    console.error("[end-of-day-pipeline-cron] Skipped (ENABLE_FETCH_TASE_DATA_CRON is not 'true')");
  }

  return router;
}
