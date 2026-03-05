import { Router } from "express";
import type { Request, Response } from "express";

const TASE_DATA_HUB_LAST_UPDATE_URL =
  "https://datawise.tase.co.il/v1/securities-trading-data/last-updated";

// Shape returned by the TASE Data Hub last-update API
export interface TaseDataHubLastUpdateItem {
  date: string;
  lastSaleTime: string | null;
  securityId: number;
  securityStatusId: string | null;
  securityLastPrice: number | null;
  securityPercentageChange: number | null;
  auctionLastSaleVolume: number | null;
  lastSaleVolume: number | null;
  securityDailyAggVolume: number | null;
  securityDailyAggValue: number | null;
  securityDailyNumTrades: number | null;
  tradingPhaseId: string | null;
  priceTypeId: string | null;
}

interface TaseDataHubLastUpdateResponse {
  securitiesLastUpdate?: {
    result: TaseDataHubLastUpdateItem[];
    total: number;
  };
  getSecuritiesLastUpdate?: {
    result: TaseDataHubLastUpdateItem[];
    total: number;
  };
}

/**
 * Fetch last-update trading data from TASE Data Hub.
 * Pass-through API — no DB storage.
 * @param securityId Optional — if omitted, returns all securities.
 */
export async function fetchLastUpdate(securityId?: number): Promise<TaseDataHubLastUpdateItem[]> {
  const apiKey = process.env.TASE_DATA_HUB_API_KEY;
  if (!apiKey) {
    throw new Error("TASE_DATA_HUB_API_KEY environment variable is not set");
  }

  const url = securityId != null
    ? `${TASE_DATA_HUB_LAST_UPDATE_URL}?securityId=${securityId}`
    : TASE_DATA_HUB_LAST_UPDATE_URL;
  console.error(`[fetch-last-update-from-tase-data-hub] Fetching from: ${url}`);

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

  const data = (await response.json()) as TaseDataHubLastUpdateResponse;
  const payload = data.securitiesLastUpdate ?? data.getSecuritiesLastUpdate;
  const items = payload?.result ?? [];

  console.error(`[fetch-last-update-from-tase-data-hub] Received ${items.length} items${securityId != null ? ` for securityId ${securityId}` : ""}`);

  return items;
}

/**
 * Creates an Express router with the /api/fetch-last-update-from-tase-data-hub endpoint.
 * GET /api/fetch-last-update-from-tase-data-hub?securityId=22   (optional param)
 */
export function createFetchLastUpdateFromTaseDataHubRouter(): Router {
  const router = Router();

  router.get("/api/fetch-last-update-from-tase-data-hub", async (req: Request, res: Response) => {
    try {
      const securityIdParam = req.query.securityId as string | undefined;
      let securityId: number | undefined;

      if (securityIdParam) {
        securityId = parseInt(securityIdParam, 10);
        if (isNaN(securityId)) {
          res.status(400).json({
            status: "error",
            message: "securityId must be a number",
          });
          return;
        }
      }

      const items = await fetchLastUpdate(securityId);
      res.json({ securityId: securityId ?? null, items, total: items.length });
    } catch (error) {
      console.error("[fetch-last-update-from-tase-data-hub] Error:", error);
      res.status(500).json({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return router;
}
