import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { clerkClient } from "@clerk/express";
import fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
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
  UserPosition,
  UserWatchlistItem,
  IntradayCandlestickResponse,
} from "./src/types.js";

// Re-export types for consumers
export type {
  StockData,
  EndOfDayResult,
  MarketSpiritResponse,
  UptrendSymbolsResponse,
  EndOfDaySymbolsResponse,
  CandlestickResponse,
  CandlestickTimeframe,
  SectorHeatmapResponse,
  SymbolHeatmapItem,
  TaseDataProviders,
};

// @ts-ignore — imported from source at runtime (not compiled by tsc)
import { fetchIntraday } from "./src/tase-data-hub/fetch-intraday-from-tase-data-hub.js";
// @ts-ignore — imported from source at runtime (not compiled by tsc)
import { fetchLastUpdate } from "./src/tase-data-hub/fetch-last-update-from-tase-data-hub.js";
// @ts-ignore — imported from source at runtime (not compiled by tsc)
import { prisma } from "./src/db/db.js";

// Works both from source (server.ts) and compiled (dist/server.js)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = __filename.endsWith(".ts")
  ? path.join(__dirname, "dist")
  : __dirname;

// Input schemas
const getTaseDataSchema = {
  marketType: z.enum(["STOCK", "BOND", "TASE UP STOCK", "LOAN"]).optional().describe("Market type filter"),
  tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
};

const getSectorHeatmapSchema = {
  marketType: z.enum(["STOCK", "BOND", "TASE UP STOCK", "LOAN"]).optional().describe("Market type filter (default: STOCK)"),
  tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
  period: z.enum(["1D", "1W", "1M", "3M"]).optional().describe("Change period: 1D=daily, 1W=weekly (5 trading days), 1M=monthly (21 trading days), 3M=quarterly (63 trading days). Default: 1D"),
};

const getMarketSpiritSchema = {
  marketType: z.enum(["STOCK", "BOND", "TASE UP STOCK", "LOAN"]).optional().describe("Market type filter (default: STOCK)"),
  tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
};

const getUptrendSymbolsSchema = {
  marketType: z.enum(["STOCK", "BOND", "TASE UP STOCK", "LOAN"]).optional().describe("Market type filter (default: STOCK)"),
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
          marketType: data.marketType,
          count: data.items.length,
          items: data.items,
        }, null, 2),
      },
    ],
  };
}

function formatMarketSpiritResult(data: MarketSpiritResponse): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          tradeDate: data.tradeDate,
          marketType: data.marketType,
          score: data.score,
          description: data.score ? SCORE_DESCRIPTIONS[data.score] : "Unable to determine market spirit",
          adv: data.adv ?? null,
          adLine: data.adLine ?? null,
        }, null, 2),
      },
    ],
  };
}

function formatUptrendSymbolsResult(data: UptrendSymbolsResponse): CallToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          tradeDate: data.tradeDate,
          marketType: data.marketType,
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
export function createServer(options: { subscribeUrl?: string; providers: TaseDataProviders }): McpServer {
  const { providers } = options;

  function getUserIdFromExtra(extra: { authInfo?: { extra?: Record<string, unknown> } }): string | null {
    return (extra?.authInfo?.extra?.userId as string) ?? null;
  }

  async function getUserPositionSymbols(extra: any): Promise<{ symbols: string[]; error?: string }> {
    const userId = getUserIdFromExtra(extra);
    if (!userId) return { symbols: [], error: "Not authenticated" };
    const user = await clerkClient.users.getUser(userId);
    const positions = (user.privateMetadata?.positions as UserPosition[] | undefined) ?? [];
    return { symbols: positions.map(p => p.symbol) };
  }

  async function getUserWatchlistSymbols(extra: any): Promise<{ symbols: string[]; error?: string }> {
    const userId = getUserIdFromExtra(extra);
    if (!userId) return { symbols: [], error: "Not authenticated" };
    const user = await clerkClient.users.getUser(userId);
    const watchlist = (user.privateMetadata?.watchlist as UserWatchlistItem[] | undefined) ?? [];
    return { symbols: watchlist.map(w => w.symbol) };
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
  const uptrendSymbolsResourceUri = `ui://tase-end-of-day/market-uptrend-symbols-widget-ver-${WIDGET_VERSION}.html`;
  const endOfDaySymbolsResourceUri = `ui://tase-end-of-day/my-position-end-of-day-widget-ver-${WIDGET_VERSION}.html`;
  const candlestickResourceUri = `ui://tase-end-of-day/symbol-candlestick-widget-ver-${WIDGET_VERSION}.html`;
  const symbolsCandlestickResourceUri = `ui://tase-end-of-day/my-position-candlestick-widget-ver-${WIDGET_VERSION}.html`;
  const dashboardResourceUri = `ui://tase-end-of-day/market-dashboard-widget-ver-${WIDGET_VERSION}.html`;
  const subscriptionResourceUri = `ui://tase-end-of-day/tase-market-landing-widget-ver-${WIDGET_VERSION}.html`;
  const settingsResourceUri = `ui://tase-end-of-day/tase-market-settings-widget-ver-${WIDGET_VERSION}.html`;
  const myPositionsManagerResourceUri = `ui://tase-end-of-day/my-positions-manager-widget-ver-${WIDGET_VERSION}.html`;
  const symbolsCandlestickWidgetResourceUri = `ui://tase-end-of-day/symbols-candlestick-widget-ver-${WIDGET_VERSION}.html`;
  const symbolsTableResourceUri = `ui://tase-end-of-day/symbols-table-widget-ver-${WIDGET_VERSION}.html`;
  const symbolEndOfDaysResourceUri = `ui://tase-end-of-day/symbol-end-of-days-widget-ver-${WIDGET_VERSION}.html`;
  const symbolsEndOfDayResourceUri = `ui://tase-end-of-day/symbols-end-of-day-widget-ver-${WIDGET_VERSION}.html`;
  const intradayCandlestickResourceUri = `ui://tase-end-of-day/symbol-intraday-candlestick-widget-ver-${WIDGET_VERSION}.html`;
  const marketLastUpdateResourceUri = `ui://tase-end-of-day/market-last-update-widget-ver-${WIDGET_VERSION}.html`;
  const myWatchlistManagerResourceUri = `ui://tase-end-of-day/my-watchlist-manager-widget-ver-${WIDGET_VERSION}.html`;
  const myWatchlistTableResourceUri = `ui://tase-end-of-day/my-watchlist-table-widget-ver-${WIDGET_VERSION}.html`;
  const myWatchlistEndOfDayResourceUri = `ui://tase-end-of-day/my-watchlist-end-of-day-widget-ver-${WIDGET_VERSION}.html`;
  const myWatchlistCandlestickResourceUri = `ui://tase-end-of-day/my-watchlist-candlestick-widget-ver-${WIDGET_VERSION}.html`;

  // Data-only tool: Get TASE end of day data
  registerAppTool(server,
    "get-market-end-of-day-data",
    {
      title: "Get Market End of Day Data",
      description: "Returns TASE end of day data including prices, volume, and technical indicators. Data only - use show-market-end-of-day-widget for visualization.",
      inputSchema: getTaseDataSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchEndOfDay(args.marketType, args.tradeDate);
      return formatTaseDataResult(data);
    },
  );

  // UI tool: Show TASE end of day data with interactive table
  registerAppTool(server,
    "show-market-end-of-day-widget",
    {
      title: "Show Market End of Day",
      description: "Displays Tel Aviv Stock Exchange end of day data with interactive table visualization.",
      inputSchema: getTaseDataSchema,
      _meta: { ui: { resourceUri: endOfDayResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchEndOfDay(args.marketType, args.tradeDate);
      return {
        content: [
          {
            type: "text",
            text: `Displaying ${data.items.length} stocks for ${data.tradeDate}${data.marketType ? ` (${data.marketType})` : ""}`,
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
      inputSchema: getMarketSpiritSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchMarketSpirit(args.marketType, args.tradeDate);
      return formatMarketSpiritResult(data);
    },
  );

  // UI tool: Show Market Spirit traffic light visualization
  registerAppTool(server,
    "show-market-spirit-widget",
    {
      title: "Show Market Spirit",
      description: "Displays TASE Market Spirit as an interactive traffic light. Red = Defense (bearish), Yellow = Selective (neutral), Green = Attack (bullish).",
      inputSchema: getMarketSpiritSchema,
      _meta: { ui: { resourceUri: marketSpiritResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchMarketSpirit(args.marketType, args.tradeDate);
      return {
        content: [
          {
            type: "text",
            text: `Market Spirit: ${data.score ?? "Unknown"} for ${data.tradeDate}${data.marketType ? ` (${data.marketType})` : ""}`,
          },
        ],
      };
    },
  );

  // Data-only tool: Get Uptrend Symbols
  registerAppTool(server,
    "get-market-uptrend-symbols-data",
    {
      title: "Get Market Uptrend Symbols Data",
      description: "Returns TASE symbols currently in uptrend with EZ values (% distance from SMA20). Data only - use show-market-uptrend-symbols-widget for visualization.",
      inputSchema: getUptrendSymbolsSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchUptrendSymbols(args.marketType, args.tradeDate);
      return formatUptrendSymbolsResult(data);
    },
  );

  // UI tool: Show Uptrend Symbols list
  registerAppTool(server,
    "show-market-uptrend-symbols-widget",
    {
      title: "Show Market Uptrend Symbols",
      description: "Displays TASE symbols currently in uptrend with EZ values (% distance from SMA20) as an interactive list.",
      inputSchema: getUptrendSymbolsSchema,
      _meta: { ui: { resourceUri: uptrendSymbolsResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchUptrendSymbols(args.marketType, args.tradeDate);
      return {
        content: [
          {
            type: "text",
            text: `Uptrend Symbols: ${data.count} symbols for ${data.tradeDate}${data.marketType ? ` (${data.marketType})` : ""}`,
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
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserPositionSymbols(extra);
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
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { resourceUri: endOfDaySymbolsResourceUri } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserPositionSymbols(extra);
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
      inputSchema: {
        dateFrom: z.string().optional().describe("Start date in YYYY-MM-DD format. If not provided, each symbol defaults to its position start date."),
        dateTo: z.string().optional().describe("End date in YYYY-MM-DD format"),
      },
      _meta: { ui: { resourceUri: symbolsCandlestickResourceUri } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserPositionSymbols(extra);
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
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format (default: last trading day)"),
        period: z.enum(["1D", "1W", "1M", "3M"]).optional().describe("Change period: 1D=daily, 1W=weekly (5 days), 1M=monthly (21 days), 3M=quarterly (63 days). Default: 1D"),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserPositionSymbols(extra);
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

  // UI tool: Show Market Dashboard
  registerAppTool(server,
    "show-market-dashboard-widget",
    {
      title: "Show Market Dashboard",
      description: "Displays a single-page market overview combining Market Spirit, end-of-day stats (gainers/losers), and uptrend symbols count.",
      inputSchema: getTaseDataSchema,
      _meta: { ui: { resourceUri: dashboardResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const [spirit, eod, uptrend] = await Promise.allSettled([
        providers.fetchMarketSpirit(args.marketType, args.tradeDate),
        providers.fetchEndOfDay(args.marketType, args.tradeDate),
        providers.fetchUptrendSymbols(args.marketType, args.tradeDate),
      ]);
      const parts: string[] = [];
      if (spirit.status === "fulfilled") parts.push(`Spirit: ${spirit.value.score ?? "Unknown"}`);
      if (eod.status === "fulfilled") parts.push(`${eod.value.items.length} stocks`);
      if (uptrend.status === "fulfilled") parts.push(`${uptrend.value.count} in uptrend`);
      const tradeDate = spirit.status === "fulfilled" ? spirit.value.tradeDate
        : eod.status === "fulfilled" ? eod.value.tradeDate
        : uptrend.status === "fulfilled" ? uptrend.value.tradeDate : "N/A";
      return {
        content: [
          {
            type: "text",
            text: `Dashboard for ${tradeDate}: ${parts.join(" | ")}`,
          },
        ],
      };
    },
  );

  // Data-only tool: Get Sector Heatmap data
  registerAppTool(server,
    "get-market-sector-heatmap-data",
    {
      title: "Get Market Sector Heatmap Data",
      description: "Returns TASE stock data grouped by sector and sub-sector with marketCap and change % for heatmap visualization. Data only - use show-market-sector-heatmap-widget for visualization.",
      inputSchema: getSectorHeatmapSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchSectorHeatmap(args.marketType, args.tradeDate, args.period as HeatmapPeriod | undefined);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              tradeDate: data.tradeDate,
              marketType: data.marketType,
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
      inputSchema: getSectorHeatmapSchema,
      _meta: { ui: { resourceUri: sectorHeatmapResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchSectorHeatmap(args.marketType, args.tradeDate, args.period as HeatmapPeriod | undefined);
      return {
        content: [
          {
            type: "text",
            text: `Sector heatmap: ${data.count} stocks for ${data.tradeDate} (${data.marketType})`,
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
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const userId = getUserIdFromExtra(extra);
      if (!userId) return { content: [{ type: "text", text: JSON.stringify({ error: "Not authenticated" }) }] };
      const user = await clerkClient.users.getUser(userId);
      const positions = (user.privateMetadata?.positions as UserPosition[] | undefined) ?? [];
      if (positions.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "No positions found" }) }] };
      const symbols = positions.map(p => p.symbol);
      const data = await providers.fetchEndOfDaySymbolsByDate(symbols, args.tradeDate, "1D");
      const positionsMap: Record<string, { avgEntryPrice?: number; startDate: string; amount: number; side?: string }> = {};
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
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { resourceUri: myPositionResourceUri } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const userId = getUserIdFromExtra(extra);
      if (!userId) return { content: [{ type: "text", text: JSON.stringify({ error: "Not authenticated" }) }] };
      const user = await clerkClient.users.getUser(userId);
      const positions = (user.privateMetadata?.positions as UserPosition[] | undefined) ?? [];
      if (positions.length === 0) return { content: [{ type: "text", text: JSON.stringify({ error: "No positions found" }) }] };
      const symbols = positions.map(p => p.symbol);
      const data = await providers.fetchEndOfDaySymbolsByDate(symbols, args.tradeDate, "1D");
      const positionsMap: Record<string, { avgEntryPrice?: number; startDate: string; amount: number; side?: string }> = {};
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

  // Data tool: Get user positions from Clerk privateMetadata
  registerAppTool(server,
    "get-my-positions",
    {
      title: "Get User Positions",
      description: "Returns the user's saved portfolio positions (symbol, start date, amount) stored in their profile.",
      inputSchema: {},
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (_args, extra): Promise<CallToolResult> => {
      const userId = getUserIdFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ positions: [], count: 0, error: "Not authenticated" }) }] };
      }
      const user = await clerkClient.users.getUser(userId);
      const positions = (user.privateMetadata?.positions as UserPosition[] | undefined) ?? [];
      return { content: [{ type: "text", text: JSON.stringify({ positions, count: positions.length }) }] };
    },
  );

  // App-only tool: Upsert a user position
  registerAppTool(server,
    "set-my-position",
    {
      title: "Set User Position",
      description: "Adds or updates a portfolio position (upserts by symbol).",
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
      const userId = getUserIdFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Not authenticated" }) }] };
      }
      const user = await clerkClient.users.getUser(userId);
      const existing = (user.privateMetadata?.positions as UserPosition[] | undefined) ?? [];
      const updated = existing.filter((p) => p.symbol !== args.symbol);
      const pos: UserPosition = { symbol: args.symbol, startDate: args.startDate, amount: args.amount };
      if (args.avgEntryPrice !== undefined) pos.avgEntryPrice = args.avgEntryPrice;
      if (args.alloc !== undefined) pos.alloc = args.alloc;
      if (args.side !== undefined) pos.side = args.side;
      updated.push(pos);
      await clerkClient.users.updateUser(userId, {
        privateMetadata: { ...user.privateMetadata, positions: updated },
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
      inputSchema: {
        symbol: z.string().min(1).describe("Stock symbol to remove (e.g. 'TEVA')"),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const userId = getUserIdFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Not authenticated" }) }] };
      }
      const user = await clerkClient.users.getUser(userId);
      const existing = (user.privateMetadata?.positions as UserPosition[] | undefined) ?? [];
      const updated = existing.filter((p) => p.symbol !== args.symbol);
      await clerkClient.users.updateUser(userId, {
        privateMetadata: { ...user.privateMetadata, positions: updated },
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, positions: updated, count: updated.length }) }] };
    },
  );

  // UI tool: Show My Positions Manager widget
  registerAppTool(server,
    "show-my-positions-manager-widget",
    {
      title: "Show My Positions Manager",
      description: "Displays an interactive manager to add, edit, and delete portfolio positions stored in your profile.",
      inputSchema: {},
      _meta: { ui: { resourceUri: myPositionsManagerResourceUri } },
    },
    async (_args, extra): Promise<CallToolResult> => {
      const userId = getUserIdFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ positions: [], count: 0, error: "Not authenticated" }) }] };
      }
      const user = await clerkClient.users.getUser(userId);
      const positions = (user.privateMetadata?.positions as UserPosition[] | undefined) ?? [];
      return { content: [{ type: "text", text: JSON.stringify({ positions, count: positions.length }) }] };
    },
  );

  // ─── Watchlist CRUD tools ──────────────────────────────────────────

  // Data tool: Get user watchlist from Clerk privateMetadata
  registerAppTool(server,
    "get-my-watchlist",
    {
      title: "Get User Watchlist",
      description: "Returns the user's saved watchlist items (symbol, start date, note) stored in their profile.",
      inputSchema: {},
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (_args, extra): Promise<CallToolResult> => {
      const userId = getUserIdFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ watchlist: [], count: 0, error: "Not authenticated" }) }] };
      }
      const user = await clerkClient.users.getUser(userId);
      const watchlist = (user.privateMetadata?.watchlist as UserWatchlistItem[] | undefined) ?? [];
      return { content: [{ type: "text", text: JSON.stringify({ watchlist, count: watchlist.length }) }] };
    },
  );

  // App-only tool: Upsert a watchlist item
  registerAppTool(server,
    "set-my-watchlist-item",
    {
      title: "Set User Watchlist Item",
      description: "Adds or updates a watchlist item (upserts by symbol).",
      inputSchema: {
        symbol: z.string().min(1).describe("Stock symbol (e.g. 'TEVA')"),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Start date in YYYY-MM-DD format"),
        note: z.string().max(500).optional().describe("Optional note for the watchlist item"),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const userId = getUserIdFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Not authenticated" }) }] };
      }
      const user = await clerkClient.users.getUser(userId);
      const existing = (user.privateMetadata?.watchlist as UserWatchlistItem[] | undefined) ?? [];
      const updated = existing.filter((w) => w.symbol !== args.symbol);
      const item: UserWatchlistItem = { symbol: args.symbol, startDate: args.startDate };
      if (args.note !== undefined) item.note = args.note;
      updated.push(item);
      await clerkClient.users.updateUser(userId, {
        privateMetadata: { ...user.privateMetadata, watchlist: updated },
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, watchlist: updated, count: updated.length }) }] };
    },
  );

  // App-only tool: Delete a watchlist item
  registerAppTool(server,
    "delete-my-watchlist-item",
    {
      title: "Delete User Watchlist Item",
      description: "Removes a watchlist item by symbol.",
      inputSchema: {
        symbol: z.string().min(1).describe("Stock symbol to remove (e.g. 'TEVA')"),
      },
      _meta: { ui: { visibility: ["app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const userId = getUserIdFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ success: false, error: "Not authenticated" }) }] };
      }
      const user = await clerkClient.users.getUser(userId);
      const existing = (user.privateMetadata?.watchlist as UserWatchlistItem[] | undefined) ?? [];
      const updated = existing.filter((w) => w.symbol !== args.symbol);
      await clerkClient.users.updateUser(userId, {
        privateMetadata: { ...user.privateMetadata, watchlist: updated },
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, watchlist: updated, count: updated.length }) }] };
    },
  );

  // UI tool: Show My Watchlist Manager widget
  registerAppTool(server,
    "show-my-watchlist-manager-widget",
    {
      title: "Show My Watchlist Manager",
      description: "Displays an interactive manager to add, edit, and delete watchlist items stored in your profile.",
      inputSchema: {},
      _meta: { ui: { resourceUri: myWatchlistManagerResourceUri } },
    },
    async (_args, extra): Promise<CallToolResult> => {
      const userId = getUserIdFromExtra(extra);
      if (!userId) {
        return { content: [{ type: "text", text: JSON.stringify({ watchlist: [], count: 0, error: "Not authenticated" }) }] };
      }
      const user = await clerkClient.users.getUser(userId);
      const watchlist = (user.privateMetadata?.watchlist as UserWatchlistItem[] | undefined) ?? [];
      return { content: [{ type: "text", text: JSON.stringify({ watchlist, count: watchlist.length }) }] };
    },
  );

  // ─── Watchlist data tools ──────────────────────────────────────────

  // Data-only tool: Get My Watchlist Table Data
  registerAppTool(server,
    "get-my-watchlist-table-data",
    {
      title: "Get My Watchlist Table Data",
      description: "Returns EOD data for the user's watchlist symbols. Period controls the change %: 1D=daily, 1W=weekly (5 trading days), 1M=monthly (21 trading days), 3M=quarterly (63 trading days). Data only - use show-my-watchlist-table-widget for visualization.",
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
        period: z.enum(["1D", "1W", "1M", "3M"]).optional().describe("Change period: 1D=daily, 1W=weekly (5 days), 1M=monthly (21 days), 3M=quarterly (63 days). Default: 1D"),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserWatchlistSymbols(extra);
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

  // UI tool: Show My Watchlist Table widget
  registerAppTool(server,
    "show-my-watchlist-table-widget",
    {
      title: "Show My Watchlist Table",
      description: "Displays the user's watchlist symbols as an interactive EOD table with sortable columns (Symbol, Company, Close, Change%, Turnover, RSI, EZ) and period selector (1D/1W/1M/3M).",
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { resourceUri: myWatchlistTableResourceUri } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserWatchlistSymbols(extra);
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

  // Data-only tool: Get My Watchlist End of Day Data
  registerAppTool(server,
    "get-my-watchlist-end-of-day-data",
    {
      title: "Get My Watchlist End of Day Data",
      description: "Returns TASE end of day data for the user's watchlist symbols on a single trade date. Data only - use show-my-watchlist-end-of-day-widget for visualization.",
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserWatchlistSymbols(extra);
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

  // UI tool: Show My Watchlist End of Day widget (single date)
  registerAppTool(server,
    "show-my-watchlist-end-of-day-widget",
    {
      title: "Show My Watchlist End of Day",
      description: "Displays TASE end of day data for the user's watchlist symbols on a single trade date with full interactive DataTable (all columns, summary cards, date selector, column visibility).",
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { resourceUri: myWatchlistEndOfDayResourceUri } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserWatchlistSymbols(extra);
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

  // Data-only tool: Get My Watchlist Period Data
  registerAppTool(server,
    "get-my-watchlist-period-data",
    {
      title: "Get My Watchlist Period Data",
      description: "Returns last price and period change % for the user's watchlist symbols. Used by the my-watchlist candlestick widget sidebar.",
      inputSchema: {
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format (default: last trading day)"),
        period: z.enum(["1D", "1W", "1M", "3M"]).optional().describe("Change period: 1D=daily, 1W=weekly (5 days), 1M=monthly (21 days), 3M=quarterly (63 days). Default: 1D"),
      },
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserWatchlistSymbols(extra);
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

  // UI tool: Show My Watchlist Candlestick widget
  registerAppTool(server,
    "show-my-watchlist-candlestick-widget",
    {
      title: "Show My Watchlist Candlestick",
      description: "Displays a candlestick view for the user's watchlist: sidebar with symbol table (Last, Chg, Chg%) and a chart area. Click a symbol to view its candlestick chart.",
      inputSchema: {
        dateFrom: z.string().optional().describe("Start date in YYYY-MM-DD format. If not provided, each symbol defaults to its watchlist start date."),
        dateTo: z.string().optional().describe("End date in YYYY-MM-DD format"),
      },
      _meta: { ui: { resourceUri: myWatchlistCandlestickResourceUri } },
    },
    async (args, extra): Promise<CallToolResult> => {
      const { symbols, error } = await getUserWatchlistSymbols(extra);
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

  // UI tool: Show Landing page with tool cards
  registerAppTool(server,
    "show-tase-market-landing-widget",
    {
      title: "Show TASE Market Tools",
      description: "Displays the TASE Data Hub landing page with available tools and a subscribe button.",
      inputSchema: {},
      _meta: { ui: { resourceUri: subscriptionResourceUri } },
    },
    async (): Promise<CallToolResult> => {
      return {
        content: [{ type: "text", text: "TASE Market Tools landing page" }],
      };
    },
  );

  // Data-only tool: Get settings data (subscription URL)
  registerAppTool(server,
    "get-tase-market-settings-data",
    {
      title: "Get TASE Market Settings Data",
      description: "Returns TASE Market settings data including subscription URL.",
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

  // UI tool: Show Settings widget
  registerAppTool(server,
    "show-tase-market-settings-widget",
    {
      title: "Show TASE Market Settings",
      description: "Displays the TASE Market settings page with subscription, account info, and app settings.",
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
  registerAppResource(server,
    myPositionResourceUri, myPositionResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "my-position-table-widget.html"), "utf-8");
      return { contents: [{ uri: myPositionResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    sectorHeatmapResourceUri, sectorHeatmapResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "market-sector-heatmap-widget.html"), "utf-8");
      return { contents: [{ uri: sectorHeatmapResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    endOfDayResourceUri, endOfDayResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "market-end-of-day-widget.html"), "utf-8");
      return { contents: [{ uri: endOfDayResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    marketSpiritResourceUri, marketSpiritResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "market-spirit-widget.html"), "utf-8");
      return { contents: [{ uri: marketSpiritResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    uptrendSymbolsResourceUri, uptrendSymbolsResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "market-uptrend-symbols-widget.html"), "utf-8");
      return { contents: [{ uri: uptrendSymbolsResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    endOfDaySymbolsResourceUri, endOfDaySymbolsResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "my-position-end-of-day-widget.html"), "utf-8");
      return { contents: [{ uri: endOfDaySymbolsResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    candlestickResourceUri, candlestickResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "symbol-candlestick-widget.html"), "utf-8");
      return { contents: [{ uri: candlestickResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    symbolsCandlestickResourceUri, symbolsCandlestickResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "my-position-candlestick-widget.html"), "utf-8");
      return { contents: [{ uri: symbolsCandlestickResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    dashboardResourceUri, dashboardResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "market-dashboard-widget.html"), "utf-8");
      return { contents: [{ uri: dashboardResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    subscriptionResourceUri, subscriptionResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "tase-market-landing-widget.html"), "utf-8");
      return { contents: [{ uri: subscriptionResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    settingsResourceUri, settingsResourceUri,
    { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { permissions: { clipboardWrite: {} } } } },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "tase-market-settings-widget.html"), "utf-8");
      return { contents: [{ uri: settingsResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    myPositionsManagerResourceUri, myPositionsManagerResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "my-positions-manager-widget.html"), "utf-8");
      return { contents: [{ uri: myPositionsManagerResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    symbolsCandlestickWidgetResourceUri, symbolsCandlestickWidgetResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "symbols-candlestick-widget.html"), "utf-8");
      return { contents: [{ uri: symbolsCandlestickWidgetResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    symbolsTableResourceUri, symbolsTableResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "symbols-table-widget.html"), "utf-8");
      return { contents: [{ uri: symbolsTableResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    symbolEndOfDaysResourceUri, symbolEndOfDaysResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "symbol-end-of-days-widget.html"), "utf-8");
      return { contents: [{ uri: symbolEndOfDaysResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    symbolsEndOfDayResourceUri, symbolsEndOfDayResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "symbols-end-of-day-widget.html"), "utf-8");
      return { contents: [{ uri: symbolsEndOfDayResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    intradayCandlestickResourceUri, intradayCandlestickResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "symbol-intraday-candlestick-widget.html"), "utf-8");
      return { contents: [{ uri: intradayCandlestickResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    marketLastUpdateResourceUri, marketLastUpdateResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "market-last-update-widget.html"), "utf-8");
      return { contents: [{ uri: marketLastUpdateResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    myWatchlistManagerResourceUri, myWatchlistManagerResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "my-watchlist-manager-widget.html"), "utf-8");
      return { contents: [{ uri: myWatchlistManagerResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    myWatchlistTableResourceUri, myWatchlistTableResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "my-watchlist-table-widget.html"), "utf-8");
      return { contents: [{ uri: myWatchlistTableResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    myWatchlistEndOfDayResourceUri, myWatchlistEndOfDayResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "my-watchlist-end-of-day-widget.html"), "utf-8");
      return { contents: [{ uri: myWatchlistEndOfDayResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  registerAppResource(server,
    myWatchlistCandlestickResourceUri, myWatchlistCandlestickResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "my-watchlist-candlestick-widget.html"), "utf-8");
      return { contents: [{ uri: myWatchlistCandlestickResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
    },
  );

  return server;
}
