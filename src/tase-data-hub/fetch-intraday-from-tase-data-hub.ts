import { Router } from "express";
import type { Request, Response } from "express";

const TASE_DATA_HUB_INTRADAY_URL =
  "https://datawise.tase.co.il/v1/securities-trading-data/intraday";

// Shape returned by the TASE Data Hub intraday API
interface TaseDataHubIntradayItem {
  date: string;
  lastSaleTime: string | null;
  securityId: number;
  securityStatusId: string | null;
  securityLastRate: number | null;
  securityPercentageChange: number | null;
  auctionLastSaleVolume: number | null;
  lastSaleVolume: number | null;
  securityDailyAggVolume: number | null;
  securityDailyAggValue: number | null;
  securityDailyNumTrades: number | null;
  tradingPhaseId: string | null;
  priceTypeId: string | null;
}

interface TaseDataHubIntradayResponse {
  securitiesIntraday?: {
    result: TaseDataHubIntradayItem[];
    total: number;
  };
  getSecuritiesIntraday?: {
    result: TaseDataHubIntradayItem[];
    total: number;
  };
}

/**
 * Fetch intraday trading data from TASE Data Hub for a single security.
 * Pass-through API — no DB storage.
 */
export async function fetchIntraday(securityId: number, securityStatusId = "A", tradingPhaseId = "T"): Promise<TaseDataHubIntradayItem[]> {
  const apiKey = process.env.TASE_DATA_HUB_API_KEY;
  if (!apiKey) {
    throw new Error("TASE_DATA_HUB_API_KEY environment variable is not set");
  }

  const params = new URLSearchParams({ securityId: String(securityId) });
  if (securityStatusId) params.set("securityStatusId", securityStatusId);
  if (tradingPhaseId) params.set("tradingPhaseId", tradingPhaseId);
  const url = `${TASE_DATA_HUB_INTRADAY_URL}?${params}`;
  console.error(`[fetch-intraday-from-tase-data-hub] Fetching from: ${url}`);

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

  const data = (await response.json()) as TaseDataHubIntradayResponse;
  const payload = data.securitiesIntraday ?? data.getSecuritiesIntraday;
  const items = payload?.result ?? [];

  console.error(`[fetch-intraday-from-tase-data-hub] Received ${items.length} items for securityId ${securityId}`);

  return items;
}

/**
 * Creates an Express router with the /api/fetch-intraday-from-tase-data-hub endpoint.
 * GET /api/fetch-intraday-from-tase-data-hub?securityId=22&securityStatusId=A&tradingPhaseId=T
 */
export function createFetchIntradayFromTaseDataHubRouter(): Router {
  const router = Router();

  router.get("/api/fetch-intraday-from-tase-data-hub", async (req: Request, res: Response) => {
    try {
      const securityIdParam = req.query.securityId as string | undefined;
      if (!securityIdParam) {
        res.status(400).json({
          status: "error",
          message: "Missing required query parameter: securityId",
        });
        return;
      }

      const securityId = parseInt(securityIdParam, 10);
      if (isNaN(securityId)) {
        res.status(400).json({
          status: "error",
          message: "securityId must be a number",
        });
        return;
      }

      const securityStatusId = (req.query.securityStatusId as string) || "A";
      const tradingPhaseId = (req.query.tradingPhaseId as string) || "T";

      const items = await fetchIntraday(securityId, securityStatusId, tradingPhaseId);
      res.json({ securityId, items, total: items.length });
    } catch (error) {
      console.error("[fetch-intraday-from-tase-data-hub] Error:", error);
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
