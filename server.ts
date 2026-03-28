import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type {
  StockData,
  EndOfDayResult,
  MarketSpiritResponse,
  MomentumResponse,
  AnticipationResponse,
  EndOfDaySymbolsResponse,
  CandlestickResponse,
  CandlestickTimeframe,
  HeatmapPeriod,
  SectorHeatmapResponse,
  SymbolHeatmapItem,
  TaseDataProviders,
  IntradayCandlestickResponse,
} from "./src/types.js";

// Re-export types for consumers
export type {
  StockData,
  EndOfDayResult,
  MarketSpiritResponse,
  MomentumResponse,
  AnticipationResponse,
  EndOfDaySymbolsResponse,
  CandlestickResponse,
  CandlestickTimeframe,
  SectorHeatmapResponse,
  SymbolHeatmapItem,
  TaseDataProviders,
};

// @ts-ignore — imported from source at runtime (not compiled by tsc)
import indicesData from "./src/data/indices.json" with { type: "json" };
// @ts-ignore — imported from source at runtime (not compiled by tsc)
import { fetchIntraday } from "./src/tase-data-hub/fetch-intraday-from-tase-data-hub.js";
// @ts-ignore — imported from source at runtime (not compiled by tsc)
import { fetchLastUpdate } from "./src/tase-data-hub/fetch-last-update-from-tase-data-hub.js";
// @ts-ignore — imported from source at runtime (not compiled by tsc)
import { prisma } from "./src/db/db.js";
// @ts-ignore — imported from source at runtime (not compiled by tsc)
import { ensureUser, getUserPositions, getUserPositionSymbols as dbGetUserPositionSymbols, upsertPosition, deletePosition, getUserWatchlist, getUserWatchlistSymbols as dbGetUserWatchlistSymbols, upsertWatchlistItem, deleteWatchlistItem } from "./src/db/user-db.js";

// Works both from source (server.ts) and compiled (dist/server.js)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = __filename.endsWith(".ts")
  ? path.join(__dirname, "dist")
  : __dirname;

// CSP metadata for widget resources
function buildResourceUiMeta(domain?: string) {
  const meta: Record<string, unknown> = {
    csp: {
      connectDomains: [] as string[],
      resourceDomains: [] as string[],
    },
  };
  if (domain) meta.domain = domain;
  return meta;
}

// Built lazily inside createServer based on domain option
let RESOURCE_UI_META: Record<string, unknown>;
let RESOURCE_CONFIG: { mimeType: string; _meta: { ui: Record<string, unknown> } };

// Helper: build resource content item with CSP/domain metadata
function resourceContent(uri: string, html: string) {
  return { contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html, _meta: { ui: RESOURCE_UI_META } }] };
}

// Tool annotations for ChatGPT app submission
const READ_ONLY_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const DELETE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

// Input schemas
const getTaseDataSchema = {
  tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
};

const getSectorHeatmapSchema = {
  tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
  period: z.enum(["1D", "1W", "1M", "3M"]).optional().describe("Change period: 1D=daily, 1W=weekly (5 trading days), 1M=monthly (21 trading days), 3M=quarterly (63 trading days). Default: 1D"),
};

const getMarketSpiritSchema = {
  tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
};

const getMomentumSchema = {
  tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
};

const getAnticipationSchema = {
  tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
};

const getEndOfDaySymbolsSchema = {
  symbols: z.array(z.string()).optional().describe("List of stock symbols to query (e.g. ['TEVA', 'LUMI'])"),
  dateFrom: z.string().optional().describe("Start date in YYYY-MM-DD format. If not provided, defaults to the last available trading day."),
  dateTo: z.string().optional().describe("End date in YYYY-MM-DD format. If not provided, defaults to the last available trading day."),
};

const getCandlestickSchema = {
  symbol: z.string().describe("Stock symbol (e.g. 'TEVA')"),
  dateFrom: z.string().optional().describe("Start date in YYYY-MM-DD format"),
  dateTo: z.string().optional().describe("End date in YYYY-MM-DD format"),
  timeframe: z.enum(["1D", "3D", "1W", "1M", "3M"]).optional().describe("Candle timeframe: 1D (daily), 3D (3-day), 1W (weekly), 1M (monthly), 3M (quarterly). Defaults to 1D."),
};

const getIntradayCandlestickSchema = {
  securityIdOrSymbol: z.union([z.string(), z.number()]).describe("Stock symbol (e.g. 'TEVA') or securityId (e.g. 22)"),
};

const getIndexSectorBreakdownSchema = {
  tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
  indexId: z.number().optional().describe("TASE index ID (e.g. 137 for TA-125, 142 for TA-35). Default: 137 (TA-125)."),
};

const getIndexEndOfDaySchema = {
  tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
  indexId: z.number().optional().describe("TASE index ID (e.g. 137 for TA-125, 142 for TA-35). Default: 137 (TA-125)."),
};

const getIndexLastUpdateSchema = {
  indexId: z.number().optional().describe("TASE index ID (e.g. 137 for TA-125, 142 for TA-35). Default: 137 (TA-125)."),
};

const getIndexSectorHeatmapSchema = {
  tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
  period: z.enum(["1D", "1W", "1M", "3M"]).optional().describe("Change period: 1D=daily, 1W=weekly, 1M=monthly, 3M=quarterly. Default: 1D"),
  indexId: z.number().optional().describe("TASE index ID (e.g. 137 for TA-125, 142 for TA-35). Default: 137 (TA-125)."),
};

// Score descriptions for Market Spirit
const SCORE_DESCRIPTIONS: Record<string, string> = {
  Defense: "Bearish market conditions - consider defensive positions",
  Selective: "Neutral market conditions - be selective with positions",
  Attack: "Bullish market conditions - favorable for aggressive positions",
};

// Format helpers
function formatTaseDataResult(data: EndOfDayResult): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          tradeDate: data.tradeDate,
          count: data.items.length,
          items: data.items,
        }, null, 2),
      },
    ],
  };
}

const REGIME_DESCRIPTIONS: Record<string, string> = {
  weak: "Low momentum breadth — risk-off environment",
  early: "Early momentum building — selective opportunities emerging",
  healthy: "Healthy momentum breadth — favorable environment for trend-following",
  overextended: "Broad momentum — watch for overextension and mean reversion",
  avoid: "Extreme volatility — avoid new positions",
  attack: "Strong breadth with low volatility — full offense",
  selective: "Moderate breadth — selective opportunities",
  neutral: "Borderline breadth with elevated volatility — proceed with caution",
  defense: "Low breadth — defensive positioning",
};

function formatMarketSpiritResult(data: MarketSpiritResponse): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          tradeDate: data.tradeDate,
          score: data.score,
          description: data.score ? SCORE_DESCRIPTIONS[data.score] : "Unable to determine market spirit",
          adv: data.adv ?? null,
          adLine: data.adLine ?? null,
          momentumBreadth: data.momentumBreadth,
          moneyFlowBreadth: data.moneyFlowBreadth,
          compressionBreadth: data.compressionBreadth,
          regime: data.regime,
          regimeDescription: REGIME_DESCRIPTIONS[data.regime] ?? null,
          avgBandWidth: data.avgBandWidth ?? null,
          positionSizing: data.positionSizing ?? null,
        }, null, 2),
      },
    ],
  };
}

function formatAnticipationResult(data: AnticipationResponse): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          tradeDate: data.tradeDate,
          count: data.count,
          items: data.items,
        }, null, 2),
      },
    ],
  };
}

function formatMomentumResult(data: MomentumResponse): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          tradeDate: data.tradeDate,
          count: data.count,
          items: data.items,
        }, null, 2),
      },
    ],
  };
}

function formatEndOfDaySymbolsResult(data: EndOfDaySymbolsResponse): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          symbols: data.symbols,
          count: data.count,
          dateFrom: data.dateFrom,
          dateTo: data.dateTo,
          items: data.items,
        }, null, 2),
      },
    ],
  };
}

function formatCandlestickResult(data: CandlestickResponse): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          symbol: data.symbol,
          count: data.count,
          dateFrom: data.dateFrom,
          dateTo: data.dateTo,
          items: data.items,
        }),
      },
    ],
  };
}

/**
 * Creates a new MCP server instance.
 * Requires a `providers` object for data fetching (use dbProviders from src/db-api.ts).
 */
export function createServer(options: { subscribeUrl?: string; providers: TaseDataProviders; domain?: string }): McpServer {
  const { providers } = options;

  // Initialize resource UI metadata with optional domain
  RESOURCE_UI_META = buildResourceUiMeta(options.domain);
  RESOURCE_CONFIG = { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: RESOURCE_UI_META } };

  function getUserIdFromExtra(extra: { authInfo?: { extra?: Record<string, unknown> } }): string | null {
    const authExtra = extra?.authInfo?.extra;
    if (!authExtra) return null;

    // Auth0 token: use native sub claim as user ID
    const sub = authExtra.sub;
    if (sub && typeof sub === "string") return sub;

    return null;
  }

  function getEmailFromExtra(extra: { authInfo?: { extra?: Record<string, unknown> } }): string | undefined {
    const authExtra = extra?.authInfo?.extra;
    if (!authExtra) return undefined;
    const email = authExtra.email;
    return typeof email === "string" ? email : undefined;
  }

  // Ensure user exists in DB
  async function ensureUserFromExtra(extra: any): Promise<string | null> {
    const userId = getUserIdFromExtra(extra);
    if (!userId) return null;
    const email = getEmailFromExtra(extra);
    await ensureUser(userId, email);
    return userId;
  }

  async function getUserPositionSymbolsFromExtra(extra: any): Promise<{ symbols: string[]; error?: string }> {
    const userId = await ensureUserFromExtra(extra);
    if (!userId) return { symbols: [], error: "Not authenticated" };
    const symbols = await dbGetUserPositionSymbols(userId);
    return { symbols };
  }

  async function getUserWatchlistSymbolsFromExtra(extra: any): Promise<{ symbols: string[]; error?: string }> {
    const userId = await ensureUserFromExtra(extra);
    if (!userId) return { symbols: [], error: "Not authenticated" };
    const symbols = await dbGetUserWatchlistSymbols(userId);
    return { symbols };
  }

  const server = new McpServer({
    name: "TASE End of Day Server",
    version: "1.0.0",
  });

  // Resource URIs — version derived from content hash at build time
  const WIDGET_VERSION = JSON.parse(readFileSync(path.join(DIST_DIR, "widget-version.json"), "utf-8")).version;
  const myPositionResourceUri = `ui://tase-end-of-day/my-position-table-widget-ver-${WIDGET_VERSION}.html`;
  const sectorHeatmapResourceUri = `ui://tase-end-of-day/market-sector-heatmap-widget-ver-${WIDGET_VERSION}.html`;
  const endOfDayResourceUri = `ui://tase-end-of-day/market-end-of-day-widget-ver-${WIDGET_VERSION}.html`;
  const marketSpiritResourceUri = `ui://tase-end-of-day/market-spirit-widget-ver-${WIDGET_VERSION}.html`;
  const momentumResourceUri = `ui://tase-end-of-day/market-momentum-widget-ver-${WIDGET_VERSION}.html`;
  const anticipationResourceUri = `ui://tase-end-of-day/market-anticipation-widget-ver-${WIDGET_VERSION}.html`;
  const endOfDaySymbolsResourceUri = `ui://tase-end-of-day/my-position-end-of-day-widget-ver-${WIDGET_VERSION}.html`;
  const candlestickResourceUri = `ui://tase-end-of-day/symbol-candlestick-widget-ver-${WIDGET_VERSION}.html`;
  const symbolsCandlestickResourceUri = `ui://tase-end-of-day/my-position-candlestick-widget-ver-${WIDGET_VERSION}.html`;
  const subscriptionResourceUri = `ui://tase-end-of-day/tase-market-home-widget-ver-${WIDGET_VERSION}.html`;
  const settingsResourceUri = `ui://tase-end-of-day/tase-market-settings-widget-ver-${WIDGET_VERSION}.html`;
  const myPositionsManagerResourceUri = `ui://tase-end-of-day/my-positions-manager-widget-ver-${WIDGET_VERSION}.html`;
  const symbolsCandlestickWidgetResourceUri = `ui://tase-end-of-day/symbols-candlestick-widget-ver-${WIDGET_VERSION}.html`;
  const symbolsTableResourceUri = `ui://tase-end-of-day/symbols-table-widget-ver-${WIDGET_VERSION}.html`;
  const symbolEndOfDaysResourceUri = `ui://tase-end-of-day/symbol-end-of-days-widget-ver-${WIDGET_VERSION}.html`;
  const symbolsEndOfDayResourceUri = `ui://tase-end-of-day/symbols-end-of-day-widget-ver-${WIDGET_VERSION}.html`;
  const intradayCandlestickResourceUri = `ui://tase-end-of-day/symbol-intraday-candlestick-widget-ver-${WIDGET_VERSION}.html`;
  const marketLastUpdateResourceUri = `ui://tase-end-of-day/market-last-update-widget-ver-${WIDGET_VERSION}.html`;
  const watchlistManagerResourceUri = `ui://tase-end-of-day/watchlist-manager-widget-ver-${WIDGET_VERSION}.html`;
  const watchlistTableResourceUri = `ui://tase-end-of-day/watchlist-table-widget-ver-${WIDGET_VERSION}.html`;
  const watchlistEndOfDayResourceUri = `ui://tase-end-of-day/watchlist-end-of-day-widget-ver-${WIDGET_VERSION}.html`;
  const watchlistCandlestickResourceUri = `ui://tase-end-of-day/watchlist-candlestick-widget-ver-${WIDGET_VERSION}.html`;
  const indexSectorBreakdownResourceUri = `ui://tase-end-of-day/index-sector-breakdown-widget-ver-${WIDGET_VERSION}.html`;
  const indexEndOfDayResourceUri = `ui://tase-end-of-day/index-end-of-day-widget-ver-${WIDGET_VERSION}.html`;
  const indexSectorHeatmapResourceUri = `ui://tase-end-of-day/index-sector-heatmap-widget-ver-${WIDGET_VERSION}.html`;
  const indexCandlestickResourceUri = `ui://tase-end-of-day/index-candlestick-widget-ver-${WIDGET_VERSION}.html`;
  const indexLastUpdateResourceUri = `ui://tase-end-of-day/index-last-update-widget-ver-${WIDGET_VERSION}.html`;

  // Data-only tool: Get TASE end of day data
  registerAppTool(server,
    "get-market-end-of-day-data",
    {
      title: "Get Market End of Day Data",
      description: "Returns TASE end of day data including prices, volume, and technical indicators. Data only - use show-market-end-of-day-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getTaseDataSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchEndOfDay(args.tradeDate);
      return formatTaseDataResult(data);
    },
  );

  // UI tool: Show TASE end of day data with interactive table
  registerAppTool(server,
    "show-market-end-of-day-widget",
    {
      title: "Show Market End of Day",
      description: "Displays Tel Aviv Stock Exchange end of day data with interactive table visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getTaseDataSchema,
      _meta: { ui: { resourceUri: endOfDayResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchEndOfDay(args.tradeDate);
      return {
        content: [
          {
            type: "text",
            text: `Displaying ${data.items.length} stocks for ${data.tradeDate}`,
          },
        ],
      };
    },
  );

  // Data-only tool: Get Market Spirit data
  registerAppTool(server,
    "get-market-spirit-data",
    {
      title: "Get Market Spirit Data",
      description: "Returns TASE Market Spirit indicator: Defense (bearish, score 0-2), Selective (neutral, score 3-4), or Attack (bullish, score 5-6). Data only - use show-market-spirit-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getMarketSpiritSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchMarketSpirit(args.tradeDate);
      return formatMarketSpiritResult(data);
    },
  );

  // UI tool: Show Market Spirit traffic light visualization
  registerAppTool(server,
    "show-market-spirit-widget",
    {
      title: "Show Market Spirit",
      description: "Displays TASE Market Spirit as an interactive traffic light. Red = Defense (bearish), Yellow = Selective (neutral), Green = Attack (bullish).",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getMarketSpiritSchema,
      _meta: { ui: { resourceUri: marketSpiritResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchMarketSpirit(args.tradeDate);
      return {
        content: [
          {
            type: "text",
            text: `Market Spirit: ${data.score ?? "Unknown"} for ${data.tradeDate}`,
          },
        ],
      };
    },
  );

  // Data-only tool: Get Momentum Symbols
  registerAppTool(server,
    "get-market-momentum-data",
    {
      title: "Get Market Momentum Data",
      description: "Returns TASE momentum scanner: scored and classified symbols with persistence filtering, trend quality, leader identification, and compression detection. Data only - use show-market-momentum-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getMomentumSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchMomentumSymbols(args.tradeDate);
      return formatMomentumResult(data);
    },
  );

  // UI tool: Show Momentum Symbols widget
  registerAppTool(server,
    "show-market-momentum-widget",
    {
      title: "Show Market Momentum",
      description: "Displays TASE momentum scanner with scored symbols, persistence filtering, leader identification, and compression detection.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getMomentumSchema,
      _meta: { ui: { resourceUri: momentumResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchMomentumSymbols(args.tradeDate);
      return {
        content: [
          {
            type: "text",
            text: `Momentum Scanner: ${data.count} symbols for ${data.tradeDate}`,
          },
        ],
      };
    },
  );

  // Data-only tool: Get Anticipation Symbols
  registerAppTool(server,
    "get-market-anticipation-data",
    {
      title: "Get Market Anticipation Data",
      description: "Returns Stage 0 anticipation symbols: pre-uptrend setups identified via Stochastic %K/%D crossovers, rising momentum, and bullish divergences. Identifies potential uptrend candidates 2–5 days before the momentum scanner fires. Data only - use show-market-anticipation-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getAnticipationSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchAnticipationSymbols(args.tradeDate);
      return formatAnticipationResult(data);
    },
  );

  // UI tool: Show Anticipation Symbols widget
  registerAppTool(server,
    "show-market-anticipation-widget",
    {
      title: "Show Market Anticipation",
      description: "Displays Stage 0 anticipation scanner showing pre-uptrend setups with Stochastic signals, priority ratings, and scoring.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getAnticipationSchema,
      _meta: { ui: { resourceUri: anticipationResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchAnticipationSymbols(args.tradeDate);
      return {
        content: [
          {
            type: "text",
            text: `Anticipation Scanner: ${data.count} symbols for ${data.tradeDate}`,
          },
        ],
      };
    },
  );

  // Data-only tool: Get End of Day Symbols data (single date)
  registerAppTool(server,
    "get-my-position-end-of-day-data",
    {
      title: "Get My Position End of Day Data",
      description: "Returns TASE end of day data for the user's portfolio symbols on a single trade date. Data only - use show-my-position-end-of-day-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserPositionSymbolsFromExtra(extra);
      if (error) return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
      if (symbols.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "No positions found" }) }] };
      const data = await providers.fetchEndOfDaySymbolsByDate(symbols, args.tradeDate, "1D");
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items }),
        }],
      };
    },
  );

  // UI tool: Show End of Day Symbols data with interactive table (single date)
  registerAppTool(server,
    "show-my-position-end-of-day-widget",
    {
      title: "Show My Position End of Day",
      description: "Displays TASE end of day data for the user's portfolio symbols on a single trade date with full interactive DataTable (all columns, summary cards, date selector, column visibility).",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { resourceUri: endOfDaySymbolsResourceUri } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserPositionSymbolsFromExtra(extra);
      if (error) return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
      if (symbols.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "No positions found" }) }] };
      const data = await providers.fetchEndOfDaySymbolsByDate(symbols, args.tradeDate, "1D");
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items }),
        }],
      };
    },
  );

  // Data-only tool: Get Candlestick data
  registerAppTool(server,
    "get-symbol-candlestick-data",
    {
      title: "Get Candlestick Data",
      description: "Returns TASE candlestick chart data (OHLCV) for a single symbol across a date range. Data only - use show-symbol-candlestick-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getCandlestickSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchCandlestick(args.symbol, args.dateFrom, args.dateTo, args.timeframe as CandlestickTimeframe | undefined);
      return formatCandlestickResult(data);
    },
  );

  // UI tool: Show Candlestick chart
  registerAppTool(server,
    "show-symbol-candlestick-widget",
    {
      title: "Show Symbol Candlestick Chart",
      description: "Displays a candlestick chart for a single TASE symbol across a date range with OHLCV data.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getCandlestickSchema,
      _meta: { ui: { resourceUri: candlestickResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchCandlestick(args.symbol, args.dateFrom, args.dateTo, args.timeframe as CandlestickTimeframe | undefined);
      return formatCandlestickResult(data);
    },
  );

  // Data-only tool: Get Intraday Candlestick data
  registerAppTool(server,
    "get-symbol-intraday-candlestick-data",
    {
      title: "Get Symbol Intraday Candlestick Data",
      description: "Returns TASE intraday trading data for a single symbol/securityId. Raw tick data for client-side candlestick aggregation. Data only - use show-symbol-intraday-candlestick-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getIntradayCandlestickSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const { symbol, securityId } = await providers.resolveSymbol(args.securityIdOrSymbol);
      const items = await fetchIntraday(securityId);
      const response: IntradayCandlestickResponse = { symbol, securityId, count: items.length, items };
      return { content: [{ type: "text", text: JSON.stringify(response) }] };
    },
  );

  // UI tool: Show Intraday Candlestick chart
  registerAppTool(server,
    "show-symbol-intraday-candlestick-widget",
    {
      title: "Show Symbol Intraday Candlestick",
      description: "Displays an intraday candlestick chart for a single TASE symbol with configurable timeframes (1m, 3m, 5m, 10m, 30m, 1h). Auto-refreshes every 30 minutes.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getIntradayCandlestickSchema,
      _meta: { ui: { resourceUri: intradayCandlestickResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const { symbol, securityId } = await providers.resolveSymbol(args.securityIdOrSymbol);
      const items = await fetchIntraday(securityId);
      const response: IntradayCandlestickResponse = { symbol, securityId, count: items.length, items };
      return { content: [{ type: "text", text: JSON.stringify(response) }] };
    },
  );

  // Data-only tool: Get Market Last Update trading data
  registerAppTool(server,
    "get-market-last-update-data",
    {
      title: "Get Market Last Update Data",
      description: "Returns TASE last-update trading data for all securities including last price, change%, volume, and trading phase. Data only - use show-market-last-update-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {},
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (): Promise<CallToolResult> => {
      const items = await fetchLastUpdate();
      // Bulk-resolve symbols via TaseSymbol table
      const securityIds = items.map((item: { securityId: number }) => item.securityId);
      const symbols = await prisma.taseSymbol.findMany({
        where: { securityId: { in: securityIds } },
        select: { securityId: true, symbol: true },
      });
      const symbolMap = new Map(symbols.map((s: { securityId: number; symbol: string }) => [s.securityId, s.symbol]));
      const enrichedItems = items.map((item: { securityId: number }) => ({
        ...item,
        symbol: symbolMap.get(item.securityId) ?? null,
      }));
      return { content: [{ type: "text", text: JSON.stringify({ count: enrichedItems.length, items: enrichedItems }) }] };
    },
  );

  // UI tool: Show Market Last Update widget
  registerAppTool(server,
    "show-market-last-update-widget",
    {
      title: "Show Market Last Update",
      description: "Displays TASE last-update trading data with interactive table visualization showing real-time prices, changes, and volume.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {},
      _meta: { ui: { resourceUri: marketLastUpdateResourceUri } },
    },
    async (): Promise<CallToolResult> => {
      const items = await fetchLastUpdate();
      // Bulk-resolve symbols via TaseSymbol table
      const securityIds = items.map((item: { securityId: number }) => item.securityId);
      const symbols = await prisma.taseSymbol.findMany({
        where: { securityId: { in: securityIds } },
        select: { securityId: true, symbol: true },
      });
      const symbolMap = new Map(symbols.map((s: { securityId: number; symbol: string }) => [s.securityId, s.symbol]));
      const enrichedItems = items.map((item: { securityId: number }) => ({
        ...item,
        symbol: symbolMap.get(item.securityId) ?? null,
      }));
      return { content: [{ type: "text", text: JSON.stringify({ count: enrichedItems.length, items: enrichedItems }) }] };
    },
  );

  // UI tool: Show Symbols Candlestick (sidebar table + chart)
  registerAppTool(server,
    "show-my-position-candlestick-widget",
    {
      title: "Show My Position Candlestick",
      description: "Displays a candlestick view for the user's portfolio: sidebar with symbol table (Last, Chg, Chg%) and a chart area. Click a symbol to view its candlestick chart.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        dateFrom: z.string().optional().describe("Start date in YYYY-MM-DD format. If not provided, each symbol defaults to its position start date."),
        dateTo: z.string().optional().describe("End date in YYYY-MM-DD format"),
      },
      _meta: { ui: { resourceUri: symbolsCandlestickResourceUri } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserPositionSymbolsFromExtra(extra);
      if (error) return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
      if (symbols.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "No positions found" }) }] };
      // Always fetch sidebar data using the last trade date (args.dateTo may be today or a non-trading day)
      const data = await providers.fetchEndOfDaySymbolsByDate(symbols);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              symbols: data.symbols,
              count: data.count,
              dateFrom: args.dateFrom,
              dateTo: args.dateTo ?? data.dateTo,
              items: data.items,
            }),
          },
        ],
      };
    },
  );

  // Data-only tool: Get symbols sidebar data with period change
  registerAppTool(server,
    "get-my-position-period-data",
    {
      title: "Get My Position Period Data",
      description: "Returns last price and period change % for the user's portfolio symbols. Used by the my-position candlestick widget sidebar.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format (default: last trading day)"),
        period: z.enum(["1D", "1W", "1M", "3M"]).optional().describe("Change period: 1D=daily, 1W=weekly (5 days), 1M=monthly (21 days), 3M=quarterly (63 days). Default: 1D"),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserPositionSymbolsFromExtra(extra);
      if (error) return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
      if (symbols.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "No positions found" }) }] };
      const data = await providers.fetchEndOfDaySymbolsByDate(symbols, args.tradeDate, args.period as HeatmapPeriod | undefined);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items }),
        }],
      };
    },
  );

  // Data-only tool: Get Sector Heatmap data
  registerAppTool(server,
    "get-market-sector-heatmap-data",
    {
      title: "Get Market Sector Heatmap Data",
      description: "Returns TASE stock data grouped by sector and sub-sector with marketCap and change % for heatmap visualization. Data only - use show-market-sector-heatmap-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getSectorHeatmapSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchSectorHeatmap(args.tradeDate, args.period as HeatmapPeriod | undefined);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              tradeDate: data.tradeDate,
              count: data.count,
              items: data.items,
            }),
          },
        ],
      };
    },
  );

  // UI tool: Show Sector Heatmap treemap widget
  registerAppTool(server,
    "show-market-sector-heatmap-widget",
    {
      title: "Show Market Sector Heatmap",
      description: "Displays TASE stocks as a nested treemap heatmap: sectors → sub-sectors → symbols. Rectangles sized by market cap, colored by change %. Click to drill down.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getSectorHeatmapSchema,
      _meta: { ui: { resourceUri: sectorHeatmapResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchSectorHeatmap(args.tradeDate, args.period as HeatmapPeriod | undefined);
      return {
        content: [
          {
            type: "text",
            text: `Sector heatmap: ${data.count} stocks for ${data.tradeDate}`,
          },
        ],
      };
    },
  );

  // Data-only tool: Get My Position data
  registerAppTool(server,
    "get-my-position-table-data",
    {
      title: "Get My Position Table Data",
      description: "Returns EOD data for the user's portfolio symbols enriched with position metadata (avgEntryPrice, startDate, amount, side) for P&L calculation. Data only - use show-my-position-table-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const userId = await ensureUserFromExtra(extra);
      if (!userId) return { content: [{ type: "text", text: JSON.stringify({ error: "Not authenticated" }) }] };
      const positions = await getUserPositions(userId);
      if (positions.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "No positions found" }) }] };
      const symbols = positions.map(p => p.symbol);
      const data = await providers.fetchEndOfDaySymbolsByDate(symbols, args.tradeDate, "1D");
      const positionsMap: Record<string, { avgEntryPrice?: number | null; startDate: string; amount: number; side?: string | null }> = {};
      for (const p of positions) {
        positionsMap[p.symbol] = { avgEntryPrice: p.avgEntryPrice, startDate: p.startDate, amount: p.amount, side: p.side };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items, positions: positionsMap }),
        }],
      };
    },
  );

  // UI tool: Show My Position widget
  registerAppTool(server,
    "show-my-position-table-widget",
    {
      title: "Show My Positions Table",
      description: "Displays the user's portfolio P&L table with sortable columns (Symbol, SecID, Company, Close, Avg Price, Profit/Loss, %, Period).",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { resourceUri: myPositionResourceUri } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const userId = await ensureUserFromExtra(extra);
      if (!userId) return { content: [{ type: "text", text: JSON.stringify({ error: "Not authenticated" }) }] };
      const positions = await getUserPositions(userId);
      if (positions.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "No positions found" }) }] };
      const symbols = positions.map(p => p.symbol);
      const data = await providers.fetchEndOfDaySymbolsByDate(symbols, args.tradeDate, "1D");
      const positionsMap: Record<string, { avgEntryPrice?: number | null; startDate: string; amount: number; side?: string | null }> = {};
      for (const p of positions) {
        positionsMap[p.symbol] = { avgEntryPrice: p.avgEntryPrice, startDate: p.startDate, amount: p.amount, side: p.side };
      }
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items, positions: positionsMap }),
        }],
      };
    },
  );

  // Data-only tool: Get Symbols End of Days data
  registerAppTool(server,
    "get-symbols-end-of-days-data",
    {
      title: "Get Symbols End of Days Data",
      description: "Returns TASE end of day data for specific symbols across a date range. Data only - use show-symbols-end-of-days-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getEndOfDaySymbolsSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchEndOfDaySymbols(args.symbols, args.dateFrom, args.dateTo);
      return formatEndOfDaySymbolsResult(data);
    },
  );

  // Data-only tool: Get symbols sidebar data with period change
  registerAppTool(server,
    "get-symbols-period-data",
    {
      title: "Get Symbols Period Data",
      description: "Returns last price and period change % for a list of symbols. Used by the symbols candlestick widget sidebar.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        symbols: z.array(z.string()).describe("List of stock symbols"),
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format (default: last trading day)"),
        period: z.enum(["1D", "1W", "1M", "3M"]).optional().describe("Change period: 1D=daily, 1W=weekly (5 days), 1M=monthly (21 days), 3M=quarterly (63 days). Default: 1D"),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchEndOfDaySymbolsByDate(args.symbols, args.tradeDate, args.period as HeatmapPeriod | undefined);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items }),
        }],
      };
    },
  );

  // UI tool: Show Symbols Candlestick (sidebar table + chart)
  registerAppTool(server,
    "show-symbols-candlestick-widget",
    {
      title: "Show Symbols Candlestick",
      description: "Displays a candlestick view: sidebar with symbol table (Last, Chg, Chg%) and a chart area. Click a symbol to view its candlestick chart.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        symbols: z.array(z.string()).describe("List of stock symbols to display (e.g. ['TEVA', 'LUMI'])"),
        dateFrom: z.string().describe("Start date in YYYY-MM-DD format"),
        dateTo: z.string().optional().describe("End date in YYYY-MM-DD format"),
      },
      _meta: { ui: { resourceUri: symbolsCandlestickWidgetResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchEndOfDaySymbolsByDate(args.symbols);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              symbols: data.symbols,
              count: data.count,
              dateFrom: args.dateFrom,
              dateTo: args.dateTo ?? data.dateTo,
              items: data.items,
            }),
          },
        ],
      };
    },
  );

  // Data-only tool: Get Symbols Table data
  registerAppTool(server,
    "get-symbols-table-data",
    {
      title: "Get Symbols Table Data",
      description: "Returns EOD data for specified symbols. Period controls the change %: 1D=daily, 1W=weekly (5 trading days), 1M=monthly (21 trading days), 3M=quarterly (63 trading days). Data only - use show-symbols-table-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        symbols: z.array(z.string()).describe("List of stock symbols (e.g. ['TEVA', 'LUMI'])"),
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
        period: z.enum(["1D", "1W", "1M", "3M"]).optional().describe("Change period: 1D=daily, 1W=weekly (5 days), 1M=monthly (21 days), 3M=quarterly (63 days). Default: 1D"),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchEndOfDaySymbolsByDate(args.symbols, args.tradeDate, args.period as HeatmapPeriod | undefined);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items }),
        }],
      };
    },
  );

  // UI tool: Show Symbols Table widget
  registerAppTool(server,
    "show-symbols-table-widget",
    {
      title: "Show Symbols Table",
      description: "Displays specified symbols as an interactive EOD table with sortable columns (Symbol, Company, Close, Change%, Turnover, RSI, EZ) and period selector (1D/1W/1M/3M).",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        symbols: z.array(z.string()).describe("List of stock symbols (e.g. ['TEVA', 'LUMI'])"),
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { resourceUri: symbolsTableResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchEndOfDaySymbolsByDate(args.symbols, args.tradeDate, "1D");
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items }),
        }],
      };
    },
  );

  // Data-only tool: Get Symbol End of Days data (single symbol, date range)
  registerAppTool(server,
    "get-symbol-end-of-days-data",
    {
      title: "Get Symbol End of Days Data",
      description: "Returns TASE end of day data for a single symbol across a date range. Data only - use show-symbol-end-of-days-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        symbol: z.string().describe("Stock symbol (e.g. 'TEVA')"),
        dateFrom: z.string().optional().describe("Start date in YYYY-MM-DD format. If not provided, defaults to the last available trading day."),
        dateTo: z.string().optional().describe("End date in YYYY-MM-DD format. If not provided, defaults to the last available trading day."),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchEndOfDaySymbols([args.symbol], args.dateFrom, args.dateTo);
      return formatEndOfDaySymbolsResult(data);
    },
  );

  // UI tool: Show Symbol End of Days widget (single symbol, date range) (single symbol, date range)
  registerAppTool(server,
    "show-symbol-end-of-days-widget",
    {
      title: "Show Symbol End of Days",
      description: "Displays TASE end of day data for a single symbol across a date range with full interactive DataTable (all columns, summary cards, date selector, column visibility).",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        symbol: z.string().describe("Stock symbol (e.g. 'TEVA')"),
        dateFrom: z.string().optional().describe("Start date in YYYY-MM-DD format. If not provided, defaults to the last available trading day."),
        dateTo: z.string().optional().describe("End date in YYYY-MM-DD format. If not provided, defaults to the last available trading day."),
      },
      _meta: { ui: { resourceUri: symbolEndOfDaysResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchEndOfDaySymbols([args.symbol], args.dateFrom, args.dateTo);
      return formatEndOfDaySymbolsResult(data);
    },
  );

  // Data-only tool: Get Symbols End of Day data (single date)
  registerAppTool(server,
    "get-symbols-end-of-day-data",
    {
      title: "Get Symbols End of Day Data",
      description: "Returns TASE end of day data for specific symbols on a single trade date. Data only - use show-symbols-end-of-day-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        symbols: z.array(z.string()).describe("List of stock symbols (e.g. ['TEVA', 'LUMI'])"),
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchEndOfDaySymbolsByDate(args.symbols, args.tradeDate, "1D");
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items }),
        }],
      };
    },
  );

  // UI tool: Show Symbols End of Day widget (single date, full DataTable)
  registerAppTool(server,
    "show-symbols-end-of-day-widget",
    {
      title: "Show Symbols End of Day",
      description: "Displays TASE end of day data for specific symbols on a single trade date with full interactive DataTable (all columns, summary cards, date selector, column visibility).",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        symbols: z.array(z.string()).describe("List of stock symbols (e.g. ['TEVA', 'LUMI'])"),
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { resourceUri: symbolsEndOfDayResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchEndOfDaySymbolsByDate(args.symbols, args.tradeDate, "1D");
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items }),
        }],
      };
    },
  );

  // Data tool: Get user positions
  registerAppTool(server,
    "get-my-positions",
    {
      title: "Get User Positions",
      description: "Returns the user's saved portfolio positions (symbol, start date, amount) stored in their profile.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {},
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (_args, extra): Promise<CallToolResult> => {
      const userId = await ensureUserFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ positions: [], count: 0, error: "Not authenticated" }) }] };
      }
      const positions = await getUserPositions(userId);
      return { content: [{ type: "text", text: JSON.stringify({ positions, count: positions.length }) }] };
    },
  );

  // App-only tool: Upsert a user position
  registerAppTool(server,
    "set-my-position",
    {
      title: "Set User Position",
      description: "Adds or updates a portfolio position (upserts by symbol).",
      annotations: WRITE_ANNOTATIONS,
      inputSchema: {
        symbol: z.string().min(1).describe("Stock symbol (e.g. 'TEVA')"),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Start date in YYYY-MM-DD format"),
        amount: z.number().positive().describe("Number of shares/units held"),
        avgEntryPrice: z.number().positive().optional().describe("Average entry price per share"),
        alloc: z.number().min(0).max(100).optional().describe("Position allocation in %"),
        side: z.enum(["long", "short"]).optional().describe("Position side: long or short"),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const userId = await ensureUserFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Not authenticated" }) }] };
      }
      const updated = await upsertPosition(userId, {
        symbol: args.symbol,
        startDate: args.startDate,
        amount: args.amount,
        avgEntryPrice: args.avgEntryPrice,
        alloc: args.alloc,
        side: args.side,
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, positions: updated, count: updated.length }) }] };
    },
  );

  // App-only tool: Delete a user position
  registerAppTool(server,
    "delete-my-position",
    {
      title: "Delete User Position",
      description: "Removes a portfolio position by symbol.",
      annotations: DELETE_ANNOTATIONS,
      inputSchema: {
        symbol: z.string().min(1).describe("Stock symbol to remove (e.g. 'TEVA')"),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const userId = await ensureUserFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Not authenticated" }) }] };
      }
      const updated = await deletePosition(userId, args.symbol);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, positions: updated, count: updated.length }) }] };
    },
  );

  // UI tool: Show My Positions Manager widget
  registerAppTool(server,
    "show-my-positions-manager-widget",
    {
      title: "Show My Positions Manager",
      description: "Displays the portfolio positions manager interface.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {},
      _meta: { ui: { resourceUri: myPositionsManagerResourceUri } },
    },
    async (_args, extra): Promise<CallToolResult> => {
      const userId = await ensureUserFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ positions: [], count: 0, error: "Not authenticated" }) }] };
      }
      const positions = await getUserPositions(userId);
      return { content: [{ type: "text", text: JSON.stringify({ positions, count: positions.length }) }] };
    },
  );

  // ─── Watchlist CRUD tools ──────────────────────────────────────────

  // Data tool: Get user watchlist
  registerAppTool(server,
    "get-watchlist",
    {
      title: "Get User Watchlist",
      description: "Returns the user's saved watchlist items (symbol, start date, note) stored in their profile.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {},
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (_args, extra): Promise<CallToolResult> => {
      const userId = await ensureUserFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ watchlist: [], count: 0, error: "Not authenticated" }) }] };
      }
      const watchlist = await getUserWatchlist(userId);
      return { content: [{ type: "text", text: JSON.stringify({ watchlist, count: watchlist.length }) }] };
    },
  );

  // App-only tool: Upsert a watchlist item
  registerAppTool(server,
    "set-watchlist-item",
    {
      title: "Set User Watchlist Item",
      description: "Adds or updates a watchlist item (upserts by symbol).",
      annotations: WRITE_ANNOTATIONS,
      inputSchema: {
        symbol: z.string().min(1).describe("Stock symbol (e.g. 'TEVA')"),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Start date in YYYY-MM-DD format"),
        note: z.string().max(500).optional().describe("Optional note for the watchlist item"),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const userId = await ensureUserFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Not authenticated" }) }] };
      }
      const updated = await upsertWatchlistItem(userId, {
        symbol: args.symbol,
        startDate: args.startDate,
        note: args.note,
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, watchlist: updated, count: updated.length }) }] };
    },
  );

  // App-only tool: Delete a watchlist item
  registerAppTool(server,
    "delete-watchlist-item",
    {
      title: "Delete User Watchlist Item",
      description: "Removes a watchlist item by symbol.",
      annotations: DELETE_ANNOTATIONS,
      inputSchema: {
        symbol: z.string().min(1).describe("Stock symbol to remove (e.g. 'TEVA')"),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const userId = await ensureUserFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Not authenticated" }) }] };
      }
      const updated = await deleteWatchlistItem(userId, args.symbol);
      return { content: [{ type: "text", text: JSON.stringify({ success: true, watchlist: updated, count: updated.length }) }] };
    },
  );

  // UI tool: Show Watchlist Manager widget
  registerAppTool(server,
    "show-watchlist-manager-widget",
    {
      title: "Show Watchlist Manager",
      description: "Displays the watchlist manager interface.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {},
      _meta: { ui: { resourceUri: watchlistManagerResourceUri } },
    },
    async (_args, extra): Promise<CallToolResult> => {
      const userId = await ensureUserFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ watchlist: [], count: 0, error: "Not authenticated" }) }] };
      }
      const watchlist = await getUserWatchlist(userId);
      return { content: [{ type: "text", text: JSON.stringify({ watchlist, count: watchlist.length }) }] };
    },
  );

  // ─── Watchlist data tools ──────────────────────────────────────────

  // Data-only tool: Get Watchlist Table Data
  registerAppTool(server,
    "get-watchlist-table-data",
    {
      title: "Get Watchlist Table Data",
      description: "Returns EOD data for the user's watchlist symbols. Period controls the change %: 1D=daily, 1W=weekly (5 trading days), 1M=monthly (21 trading days), 3M=quarterly (63 trading days). Data only - use show-watchlist-table-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
        period: z.enum(["1D", "1W", "1M", "3M"]).optional().describe("Change period: 1D=daily, 1W=weekly (5 days), 1M=monthly (21 days), 3M=quarterly (63 days). Default: 1D"),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserWatchlistSymbolsFromExtra(extra);
      if (error) return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
      if (symbols.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "No watchlist items found" }) }] };
      const data = await providers.fetchEndOfDaySymbolsByDate(symbols, args.tradeDate, args.period as HeatmapPeriod | undefined);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items }),
        }],
      };
    },
  );

  // UI tool: Show Watchlist Table widget
  registerAppTool(server,
    "show-watchlist-table-widget",
    {
      title: "Show Watchlist Table",
      description: "Displays the user's watchlist symbols as an interactive EOD table with sortable columns (Symbol, Company, Close, Change%, Turnover, RSI, EZ) and period selector (1D/1W/1M/3M).",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { resourceUri: watchlistTableResourceUri } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserWatchlistSymbolsFromExtra(extra);
      if (error) return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
      if (symbols.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "No watchlist items found" }) }] };
      const data = await providers.fetchEndOfDaySymbolsByDate(symbols, args.tradeDate, "1D");
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items }),
        }],
      };
    },
  );

  // Data-only tool: Get Watchlist End of Day Data
  registerAppTool(server,
    "get-watchlist-end-of-day-data",
    {
      title: "Get Watchlist End of Day Data",
      description: "Returns TASE end of day data for the user's watchlist symbols on a single trade date. Data only - use show-watchlist-end-of-day-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserWatchlistSymbolsFromExtra(extra);
      if (error) return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
      if (symbols.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "No watchlist items found" }) }] };
      const data = await providers.fetchEndOfDaySymbolsByDate(symbols, args.tradeDate, "1D");
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items }),
        }],
      };
    },
  );

  // UI tool: Show Watchlist End of Day widget (single date)
  registerAppTool(server,
    "show-watchlist-end-of-day-widget",
    {
      title: "Show Watchlist End of Day",
      description: "Displays TASE end of day data for the user's watchlist symbols on a single trade date with full interactive DataTable (all columns, summary cards, date selector, column visibility).",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { resourceUri: watchlistEndOfDayResourceUri } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserWatchlistSymbolsFromExtra(extra);
      if (error) return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
      if (symbols.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "No watchlist items found" }) }] };
      const data = await providers.fetchEndOfDaySymbolsByDate(symbols, args.tradeDate, "1D");
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items }),
        }],
      };
    },
  );

  // Data-only tool: Get Watchlist Period Data
  registerAppTool(server,
    "get-watchlist-period-data",
    {
      title: "Get Watchlist Period Data",
      description: "Returns last price and period change % for the user's watchlist symbols. Used by the watchlist candlestick widget sidebar.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format (default: last trading day)"),
        period: z.enum(["1D", "1W", "1M", "3M"]).optional().describe("Change period: 1D=daily, 1W=weekly (5 days), 1M=monthly (21 days), 3M=quarterly (63 days). Default: 1D"),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserWatchlistSymbolsFromExtra(extra);
      if (error) return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
      if (symbols.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "No watchlist items found" }) }] };
      const data = await providers.fetchEndOfDaySymbolsByDate(symbols, args.tradeDate, args.period as HeatmapPeriod | undefined);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items }),
        }],
      };
    },
  );

  // UI tool: Show Watchlist Candlestick widget
  registerAppTool(server,
    "show-watchlist-candlestick-widget",
    {
      title: "Show Watchlist Candlestick",
      description: "Displays a candlestick view for the user's watchlist: sidebar with symbol table (Last, Chg, Chg%) and a chart area. Click a symbol to view its candlestick chart.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        dateFrom: z.string().optional().describe("Start date in YYYY-MM-DD format. If not provided, each symbol defaults to its watchlist start date."),
        dateTo: z.string().optional().describe("End date in YYYY-MM-DD format"),
      },
      _meta: { ui: { resourceUri: watchlistCandlestickResourceUri } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserWatchlistSymbolsFromExtra(extra);
      if (error) return { content: [{ type: "text", text: JSON.stringify({ error }) }] };
      if (symbols.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "No watchlist items found" }) }] };
      const data = await providers.fetchEndOfDaySymbolsByDate(symbols);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              symbols: data.symbols,
              count: data.count,
              dateFrom: args.dateFrom,
              dateTo: args.dateTo ?? data.dateTo,
              items: data.items,
            }),
          },
        ],
      };
    },
  );

  // UI tool: Show Home page with tool cards
  registerAppTool(server,
    "show-tase-market-home-widget",
    {
      title: "Show TASE Market Home",
      description: "Displays the TASE Data Hub home page with available tools and a subscribe button.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {},
      _meta: { ui: { resourceUri: subscriptionResourceUri } },
    },
    async (): Promise<CallToolResult> => {
      return {
        content: [{ type: "text", text: "TASE Market Tools home page" }],
      };
    },
  );

  // Data-only tool: Get settings data (subscription URL)
  registerAppTool(server,
    "get-tase-market-settings-data",
    {
      title: "Get TASE Market Settings Data",
      description: "Returns TASE Market settings data including subscription URL.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {},
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (): Promise<CallToolResult> => {
      const subscribeUrl = options?.subscribeUrl ?? `${process.env.APP_URL ?? "http://localhost:3001"}/subscribe`;
      return {
        content: [{ type: "text", text: JSON.stringify({ subscribeUrl }) }],
      };
    },
  );

  // Data-only tool: Get Index Sector Breakdown data
  registerAppTool(server,
    "get-index-sector-breakdown-data",
    {
      title: "Get Index Sector Breakdown Data",
      description: "Returns TASE index constituents grouped by sector for a specific index, filtered by index ID. Data only - use show-index-sector-breakdown-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getIndexSectorBreakdownSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args: { tradeDate?: string; indexId?: number }): Promise<CallToolResult> => {
      const indexId = args.indexId ?? 137;
      const data = await providers.fetchEndOfDay(args.tradeDate);
      const filtered = data.items.filter((item: StockData) => item.indices?.includes(indexId));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              tradeDate: data.tradeDate,
              indexId,
              count: filtered.length,
              items: filtered,
            }, null, 2),
          },
        ],
      };
    },
  );

  // UI tool: Show Index Sector Breakdown widget
  registerAppTool(server,
    "show-index-sector-breakdown-widget",
    {
      title: "Show Index Sector Breakdown",
      description: "Displays TASE index constituents grouped by sector with summary cards and accordion layout.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getIndexSectorBreakdownSchema,
      _meta: { ui: { resourceUri: indexSectorBreakdownResourceUri } },
    },
    async (args: { tradeDate?: string; indexId?: number }): Promise<CallToolResult> => {
      const indexId = args.indexId ?? 137;
      const data = await providers.fetchEndOfDay(args.tradeDate);
      const filtered = data.items.filter((item: StockData) => item.indices?.includes(indexId));
      return {
        content: [
          {
            type: "text",
            text: `Displaying ${filtered.length} stocks in index ${indexId} for ${data.tradeDate}`,
          },
        ],
      };
    },
  );

  // UI tool: Show Index End of Day widget
  registerAppTool(server,
    "show-index-end-of-day-widget",
    {
      title: "Show Index End of Day",
      description: "Displays TASE index constituents in a flat DataTable with index selector dropdown.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getIndexSectorBreakdownSchema,
      _meta: { ui: { resourceUri: indexEndOfDayResourceUri } },
    },
    async (args: { tradeDate?: string; indexId?: number }): Promise<CallToolResult> => {
      const indexId = args.indexId ?? 137;
      const data = await providers.fetchEndOfDay(args.tradeDate);
      const filtered = data.items.filter((item: StockData) => item.indices?.includes(indexId));
      return {
        content: [
          {
            type: "text",
            text: `Displaying ${filtered.length} stocks in index ${indexId} for ${data.tradeDate}`,
          },
        ],
      };
    },
  );

  // Data-only tool: Get Index Sector Heatmap data
  registerAppTool(server,
    "get-index-sector-heatmap-data",
    {
      title: "Get Index Sector Heatmap Data",
      description: "Returns TASE index constituents with heatmap data (marketCap, change %) filtered by index ID for treemap visualization. Data only - use show-index-sector-heatmap-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getIndexSectorHeatmapSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args: { tradeDate?: string; indexId?: number; period?: string }): Promise<CallToolResult> => {
      const indexId = args.indexId ?? 137;
      const [heatmapData, eodData] = await Promise.all([
        providers.fetchSectorHeatmap(args.tradeDate, args.period as HeatmapPeriod | undefined),
        providers.fetchEndOfDay(args.tradeDate),
      ]);
      const indexSymbols = new Set(
        eodData.items.filter((item: StockData) => item.indices?.includes(indexId)).map((item: StockData) => item.symbol)
      );
      const filtered = heatmapData.items.filter((item: any) => indexSymbols.has(item.symbol));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              tradeDate: heatmapData.tradeDate,
              indexId,
              period: args.period ?? "1D",
              count: filtered.length,
              items: filtered,
            }),
          },
        ],
      };
    },
  );

  // UI tool: Show Index Sector Heatmap widget
  registerAppTool(server,
    "show-index-sector-heatmap-widget",
    {
      title: "Show Index Sector Heatmap",
      description: "Displays TASE index constituents as a nested treemap heatmap: sectors -> sub-sectors -> symbols. Rectangles sized by market cap, colored by change %. Click to drill down. Includes index selector dropdown.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getIndexSectorHeatmapSchema,
      _meta: { ui: { resourceUri: indexSectorHeatmapResourceUri } },
    },
    async (args: { tradeDate?: string; indexId?: number; period?: string }): Promise<CallToolResult> => {
      const indexId = args.indexId ?? 137;
      const [heatmapData, eodData] = await Promise.all([
        providers.fetchSectorHeatmap(args.tradeDate, args.period as HeatmapPeriod | undefined),
        providers.fetchEndOfDay(args.tradeDate),
      ]);
      const indexSymbols = new Set(
        eodData.items.filter((item: StockData) => item.indices?.includes(indexId)).map((item: StockData) => item.symbol)
      );
      const filtered = heatmapData.items.filter((item: any) => indexSymbols.has(item.symbol));
      return {
        content: [
          {
            type: "text",
            text: `Index sector heatmap: ${filtered.length} stocks in index ${indexId} for ${heatmapData.tradeDate}`,
          },
        ],
      };
    },
  );

  // ─── Index Candlestick tools ──────────────────────────────────────

  // Data-only tool: Get Index End of Day Data (sidebar data for index candlestick)
  registerAppTool(server,
    "get-index-end-of-day-data",
    {
      title: "Get Index End of Day Data",
      description: "Returns EOD data for all constituents of a TASE index. Data only - use show-index-candlestick-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getIndexEndOfDaySchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args: { tradeDate?: string; indexId?: number }): Promise<CallToolResult> => {
      const indexId = args.indexId ?? 137;
      const data = await providers.fetchEndOfDay(args.tradeDate);
      const filtered = data.items.filter((item: StockData) => item.indices?.includes(indexId));
      const symbols = filtered.map((item: StockData) => item.symbol);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            symbols,
            count: filtered.length,
            dateFrom: null,
            dateTo: data.tradeDate,
            items: filtered,
          }),
        }],
      };
    },
  );

  // Data-only tool: Get Index Period Data (sidebar period change)
  registerAppTool(server,
    "get-index-period-data",
    {
      title: "Get Index Period Data",
      description: "Returns last price and period change % for index constituents. Used by the index candlestick widget sidebar.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format (default: last trading day)"),
        period: z.enum(["1D", "1W", "1M", "3M"]).optional().describe("Change period: 1D=daily, 1W=weekly (5 days), 1M=monthly (21 days), 3M=quarterly (63 days). Default: 1D"),
        indexId: z.number().optional().describe("TASE index ID (e.g. 137 for TA-125, 142 for TA-35). Default: 137 (TA-125)."),
        symbols: z.array(z.string()).optional().describe("List of symbols. If provided, uses these directly instead of resolving from index."),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args: { tradeDate?: string; period?: string; indexId?: number; symbols?: string[] }): Promise<CallToolResult> => {
      let symbols = args.symbols;
      if (!symbols?.length) {
        const indexId = args.indexId ?? 137;
        const data = await providers.fetchEndOfDay(args.tradeDate);
        symbols = data.items.filter((item: StockData) => item.indices?.includes(indexId)).map((item: StockData) => item.symbol);
      }
      const data = await providers.fetchEndOfDaySymbolsByDate(symbols, args.tradeDate, args.period as HeatmapPeriod | undefined);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ symbols: data.symbols, count: data.count, dateFrom: data.dateFrom, dateTo: data.dateTo, items: data.items }),
        }],
      };
    },
  );

  // UI tool: Show Index Candlestick widget
  registerAppTool(server,
    "show-index-candlestick-widget",
    {
      title: "Show Index Candlestick",
      description: "Displays a candlestick view for TASE index constituents: sidebar with symbol table (Last, Chg%) and chart area. Click a symbol to view its candlestick chart. Includes index selector dropdown.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getIndexEndOfDaySchema,
      _meta: { ui: { resourceUri: indexCandlestickResourceUri } },
    },
    async (args: { tradeDate?: string; indexId?: number }): Promise<CallToolResult> => {
      const indexId = args.indexId ?? 137;
      const data = await providers.fetchEndOfDay(args.tradeDate);
      const filtered = data.items.filter((item: StockData) => item.indices?.includes(indexId));
      const symbols = filtered.map((item: StockData) => item.symbol);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            symbols,
            count: filtered.length,
            dateFrom: null,
            dateTo: data.tradeDate,
            items: filtered,
          }),
        }],
      };
    },
  );

  // Data-only tool: Get Index Last Update trading data
  registerAppTool(server,
    "get-index-last-update-data",
    {
      title: "Get Index Last Update Data",
      description: "Returns TASE last-update trading data for index constituents including last price, change%, volume, and trading phase. Data only - use show-index-last-update-widget for visualization.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getIndexLastUpdateSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args: { indexId?: number }): Promise<CallToolResult> => {
      const indexId = args.indexId ?? 137;
      const [lastUpdateItems, eodData] = await Promise.all([
        fetchLastUpdate(),
        providers.fetchEndOfDay(),
      ]);
      const indexSecurityIds = new Set(
        eodData.items
          .filter((item: StockData) => item.indices?.includes(indexId))
          .map((item: StockData) => item.securityId),
      );
      const filtered = lastUpdateItems.filter((item: { securityId: number }) => indexSecurityIds.has(item.securityId));
      const securityIds = filtered.map((item: { securityId: number }) => item.securityId);
      const symbols = await prisma.taseSymbol.findMany({
        where: { securityId: { in: securityIds } },
        select: { securityId: true, symbol: true },
      });
      const symbolMap = new Map(symbols.map((s: { securityId: number; symbol: string }) => [s.securityId, s.symbol]));
      const enrichedItems = filtered.map((item: { securityId: number }) => ({
        ...item,
        symbol: symbolMap.get(item.securityId) ?? null,
      }));
      return { content: [{ type: "text", text: JSON.stringify({ indexId, count: enrichedItems.length, items: enrichedItems }) }] };
    },
  );

  // UI tool: Show Index Last Update widget
  registerAppTool(server,
    "show-index-last-update-widget",
    {
      title: "Show Index Last Update",
      description: "Displays TASE last-update trading data for index constituents with interactive table visualization showing real-time prices, changes, and volume. Includes index selector dropdown.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: getIndexLastUpdateSchema,
      _meta: { ui: { resourceUri: indexLastUpdateResourceUri } },
    },
    async (args: { indexId?: number }): Promise<CallToolResult> => {
      const indexId = args.indexId ?? 137;
      const [lastUpdateItems, eodData] = await Promise.all([
        fetchLastUpdate(),
        providers.fetchEndOfDay(),
      ]);
      const indexSecurityIds = new Set(
        eodData.items
          .filter((item: StockData) => item.indices?.includes(indexId))
          .map((item: StockData) => item.securityId),
      );
      const filtered = lastUpdateItems.filter((item: { securityId: number }) => indexSecurityIds.has(item.securityId));
      const securityIds = filtered.map((item: { securityId: number }) => item.securityId);
      const symbols = await prisma.taseSymbol.findMany({
        where: { securityId: { in: securityIds } },
        select: { securityId: true, symbol: true },
      });
      const symbolMap = new Map(symbols.map((s: { securityId: number; symbol: string }) => [s.securityId, s.symbol]));
      const enrichedItems = filtered.map((item: { securityId: number }) => ({
        ...item,
        symbol: symbolMap.get(item.securityId) ?? null,
      }));
      return { content: [{ type: "text", text: JSON.stringify({ indexId, count: enrichedItems.length, items: enrichedItems }) }] };
    },
  );

  // Data-only tool: Get indices list data
  registerAppTool(server,
    "get-indices-list-data",
    {
      title: "Get Indices List Data",
      description: "Returns a list of TASE indices with index ID and name. Supports English and Hebrew.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {
        language: z.enum(["en", "he"]).optional().default("en").describe("Language for index names: 'en' (English) or 'he' (Hebrew)"),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args: { language: "en" | "he" }): Promise<CallToolResult> => {
      const list = indicesData[args.language];
      return {
        content: [{ type: "text", text: JSON.stringify(list) }],
      };
    },
  );

  // UI tool: Show Tase Market Settings widget
  registerAppTool(server,
    "show-tase-market-settings-widget",
    {
      title: "Show TASE Market Settings",
      description: "Displays the TASE Market settings page with subscription, account info, and app settings.",
      annotations: READ_ONLY_ANNOTATIONS,
      inputSchema: {},
      _meta: { ui: { resourceUri: settingsResourceUri } },
    },
    async (): Promise<CallToolResult> => {
      const subscribeUrl = options?.subscribeUrl ?? `${process.env.APP_URL ?? "http://localhost:3001"}/subscribe`;
      return {
        content: [{ type: "text", text: JSON.stringify({ subscribeUrl }) }],
      };
    },
  );

  // Register resources
  const readWidget = (uri: string, file: string) =>
    async () => resourceContent(uri, await fs.readFile(path.join(DIST_DIR, "src", "widgets", file), "utf-8"));

  registerAppResource(server, myPositionResourceUri, myPositionResourceUri, RESOURCE_CONFIG, readWidget(myPositionResourceUri, "my-position-table/my-position-table-widget.html"));
  registerAppResource(server, sectorHeatmapResourceUri, sectorHeatmapResourceUri, RESOURCE_CONFIG, readWidget(sectorHeatmapResourceUri, "market-sector-heatmap/market-sector-heatmap-widget.html"));
  registerAppResource(server, endOfDayResourceUri, endOfDayResourceUri, RESOURCE_CONFIG, readWidget(endOfDayResourceUri, "market-end-of-day/market-end-of-day-widget.html"));
  registerAppResource(server, marketSpiritResourceUri, marketSpiritResourceUri, RESOURCE_CONFIG, readWidget(marketSpiritResourceUri, "market-spirit/market-spirit-widget.html"));
  registerAppResource(server, momentumResourceUri, momentumResourceUri, RESOURCE_CONFIG, readWidget(momentumResourceUri, "market-momentum/market-momentum-widget.html"));
  registerAppResource(server, anticipationResourceUri, anticipationResourceUri, RESOURCE_CONFIG, readWidget(anticipationResourceUri, "market-anticipation/market-anticipation-widget.html"));
  registerAppResource(server, endOfDaySymbolsResourceUri, endOfDaySymbolsResourceUri, RESOURCE_CONFIG, readWidget(endOfDaySymbolsResourceUri, "my-position-end-of-day/my-position-end-of-day-widget.html"));
  registerAppResource(server, candlestickResourceUri, candlestickResourceUri, RESOURCE_CONFIG, readWidget(candlestickResourceUri, "symbol-candlestick/symbol-candlestick-widget.html"));
  registerAppResource(server, symbolsCandlestickResourceUri, symbolsCandlestickResourceUri, RESOURCE_CONFIG, readWidget(symbolsCandlestickResourceUri, "my-position-candlestick/my-position-candlestick-widget.html"));
  registerAppResource(server, subscriptionResourceUri, subscriptionResourceUri, RESOURCE_CONFIG, readWidget(subscriptionResourceUri, "tase-market-home/tase-market-home-widget.html"));
  registerAppResource(server, settingsResourceUri, settingsResourceUri, { ...RESOURCE_CONFIG, _meta: { ui: { ...RESOURCE_UI_META, permissions: { clipboardWrite: {} } } } }, readWidget(settingsResourceUri, "tase-market-settings/tase-market-settings-widget.html"));
  registerAppResource(server, myPositionsManagerResourceUri, myPositionsManagerResourceUri, RESOURCE_CONFIG, readWidget(myPositionsManagerResourceUri, "my-positions-manager/my-positions-manager-widget.html"));
  registerAppResource(server, symbolsCandlestickWidgetResourceUri, symbolsCandlestickWidgetResourceUri, RESOURCE_CONFIG, readWidget(symbolsCandlestickWidgetResourceUri, "symbols-candlestick/symbols-candlestick-widget.html"));
  registerAppResource(server, symbolsTableResourceUri, symbolsTableResourceUri, RESOURCE_CONFIG, readWidget(symbolsTableResourceUri, "symbols-table/symbols-table-widget.html"));
  registerAppResource(server, symbolEndOfDaysResourceUri, symbolEndOfDaysResourceUri, RESOURCE_CONFIG, readWidget(symbolEndOfDaysResourceUri, "symbol-end-of-days/symbol-end-of-days-widget.html"));
  registerAppResource(server, symbolsEndOfDayResourceUri, symbolsEndOfDayResourceUri, RESOURCE_CONFIG, readWidget(symbolsEndOfDayResourceUri, "symbols-end-of-day/symbols-end-of-day-widget.html"));
  registerAppResource(server, intradayCandlestickResourceUri, intradayCandlestickResourceUri, RESOURCE_CONFIG, readWidget(intradayCandlestickResourceUri, "symbol-intraday-candlestick/symbol-intraday-candlestick-widget.html"));
  registerAppResource(server, marketLastUpdateResourceUri, marketLastUpdateResourceUri, RESOURCE_CONFIG, readWidget(marketLastUpdateResourceUri, "market-last-update/market-last-update-widget.html"));
  registerAppResource(server, watchlistManagerResourceUri, watchlistManagerResourceUri, RESOURCE_CONFIG, readWidget(watchlistManagerResourceUri, "watchlist-manager/watchlist-manager-widget.html"));
  registerAppResource(server, watchlistTableResourceUri, watchlistTableResourceUri, RESOURCE_CONFIG, readWidget(watchlistTableResourceUri, "watchlist-table/watchlist-table-widget.html"));
  registerAppResource(server, watchlistEndOfDayResourceUri, watchlistEndOfDayResourceUri, RESOURCE_CONFIG, readWidget(watchlistEndOfDayResourceUri, "watchlist-end-of-day/watchlist-end-of-day-widget.html"));
  registerAppResource(server, watchlistCandlestickResourceUri, watchlistCandlestickResourceUri, RESOURCE_CONFIG, readWidget(watchlistCandlestickResourceUri, "watchlist-candlestick/watchlist-candlestick-widget.html"));
  registerAppResource(server, indexSectorBreakdownResourceUri, indexSectorBreakdownResourceUri, RESOURCE_CONFIG, readWidget(indexSectorBreakdownResourceUri, "index-sector-breakdown/index-sector-breakdown-widget.html"));
  registerAppResource(server, indexEndOfDayResourceUri, indexEndOfDayResourceUri, RESOURCE_CONFIG, readWidget(indexEndOfDayResourceUri, "index-end-of-day/index-end-of-day-widget.html"));
  registerAppResource(server, indexSectorHeatmapResourceUri, indexSectorHeatmapResourceUri, RESOURCE_CONFIG, readWidget(indexSectorHeatmapResourceUri, "index-sector-heatmap/index-sector-heatmap-widget.html"));
  registerAppResource(server, indexCandlestickResourceUri, indexCandlestickResourceUri, RESOURCE_CONFIG, readWidget(indexCandlestickResourceUri, "index-candlestick/index-candlestick-widget.html"));
  registerAppResource(server, indexLastUpdateResourceUri, indexLastUpdateResourceUri, RESOURCE_CONFIG, readWidget(indexLastUpdateResourceUri, "index-last-update/index-last-update-widget.html"));

  return server;
}
