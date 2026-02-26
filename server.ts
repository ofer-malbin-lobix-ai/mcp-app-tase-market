import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { clerkClient } from "@clerk/express";
import fs from "node:fs/promises";
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
          count: data.rows.length,
          rows: data.rows,
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

  const server = new McpServer({
    name: "TASE End of Day Server",
    version: "1.0.0",
  });

  // Resource URIs
  const myPositionResourceUri = "ui://tase-end-of-day/my-position-table-widget-v3.html";
  const sectorHeatmapResourceUri = "ui://tase-end-of-day/market-sector-heatmap-widget-v3.html";
  const endOfDayResourceUri = "ui://tase-end-of-day/market-end-of-day-widget-v3.html";
  const marketSpiritResourceUri = "ui://tase-end-of-day/market-spirit-widget-v3.html";
  const uptrendSymbolsResourceUri = "ui://tase-end-of-day/market-uptrend-symbols-widget-v3.html";
  const endOfDaySymbolsResourceUri = "ui://tase-end-of-day/my-position-end-of-day-widget-v3.html";
  const candlestickResourceUri = "ui://tase-end-of-day/symbol-candlestick-widget-v3.html";
  const symbolsCandlestickResourceUri = "ui://tase-end-of-day/my-position-candlestick-widget-v3.html";
  const dashboardResourceUri = "ui://tase-end-of-day/market-dashboard-widget-v3.html";
  const subscriptionResourceUri = "ui://tase-end-of-day/tase-end-of-day-landing-widget-v3.html";
  const myPositionsManagerResourceUri = "ui://tase-end-of-day/my-positions-manager-widget-v1.html";

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
            text: `Displaying ${data.rows.length} stocks for ${data.tradeDate}${data.marketType ? ` (${data.marketType})` : ""}`,
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

  // Data-only tool: Get End of Day Symbols data
  registerAppTool(server,
    "get-my-position-end-of-day-data",
    {
      title: "Get My Position End of Day Data",
      description: "Returns TASE end of day data for specific symbols across a date range. Data only - use show-my-position-end-of-day-widget for visualization.",
      inputSchema: getEndOfDaySymbolsSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchEndOfDaySymbols(args.symbols, args.dateFrom, args.dateTo);
      return formatEndOfDaySymbolsResult(data);
    },
  );

  // UI tool: Show End of Day Symbols data with interactive table
  registerAppTool(server,
    "show-my-position-end-of-day-widget",
    {
      title: "Show My Position End of Day",
      description: "Displays TASE end of day data for specific symbols across a date range with interactive table visualization.",
      inputSchema: getEndOfDaySymbolsSchema,
      _meta: { ui: { resourceUri: endOfDaySymbolsResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await providers.fetchEndOfDaySymbols(args.symbols, args.dateFrom, args.dateTo);
      return formatEndOfDaySymbolsResult(data);
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

  // UI tool: Show Multi-Symbol Candlestick (sidebar table + chart)
  registerAppTool(server,
    "show-my-position-candlestick-widget",
    {
      title: "Show My Position Candlestick",
      description: "Displays a multi-symbol candlestick view: sidebar with symbol table (Last, Chg, Chg%) and a chart area. Click a symbol to view its candlestick chart.",
      inputSchema: {
        symbols: z.array(z.string()).describe("List of stock symbols to display (e.g. ['TEVA', 'LUMI'])"),
        dateFrom: z.string().describe("Start date in YYYY-MM-DD format"),
        dateTo: z.string().optional().describe("End date in YYYY-MM-DD format"),
      },
      _meta: { ui: { resourceUri: symbolsCandlestickResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      // Always fetch sidebar data using the last trade date (args.dateTo may be today or a non-trading day)
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

  // Data-only tool: Get symbols sidebar data with period change
  registerAppTool(server,
    "get-my-position-period-data",
    {
      title: "Get My Position Period Data",
      description: "Returns last price and period change % for a list of symbols. Used by the my-position candlestick widget sidebar.",
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
      if (eod.status === "fulfilled") parts.push(`${eod.value.rows.length} stocks`);
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
      description: "Returns EOD data for a user's portfolio symbols. Period controls the change %: 1D=daily, 1W=weekly (5 trading days), 1M=monthly (21 trading days), 3M=quarterly (63 trading days). Data only - use show-my-position-table-widget for visualization.",
      inputSchema: {
        symbols: z.array(z.string()).describe("List of portfolio symbols (e.g. ['TEVA', 'LUMI'])"),
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

  // UI tool: Show My Position widget
  registerAppTool(server,
    "show-my-position-table-widget",
    {
      title: "Show My Positions Table",
      description: "Displays a user's portfolio symbols as an interactive EOD table with sortable columns (Symbol, Company, Close, Change%, Turnover, RSI, EZ) and period selector (1D/1W/1M/3M).",
      inputSchema: {
        symbols: z.array(z.string()).describe("List of portfolio symbols (e.g. ['TEVA', 'LUMI'])"),
        tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
      },
      _meta: { ui: { resourceUri: myPositionResourceUri } },
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
    "get-user-positions",
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
    "set-user-position",
    {
      title: "Set User Position",
      description: "Adds or updates a portfolio position (upserts by symbol).",
      inputSchema: {
        symbol: z.string().min(1).describe("Stock symbol (e.g. 'TEVA')"),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("Start date in YYYY-MM-DD format"),
        amount: z.number().positive().describe("Number of shares/units held"),
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
      updated.push({ symbol: args.symbol, startDate: args.startDate, amount: args.amount });
      await clerkClient.users.updateUser(userId, {
        privateMetadata: { ...user.privateMetadata, positions: updated },
      });
      return { content: [{ type: "text", text: JSON.stringify({ success: true, positions: updated, count: updated.length }) }] };
    },
  );

  // App-only tool: Delete a user position
  registerAppTool(server,
    "delete-user-position",
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

  // UI tool: Show Subscription landing page
  registerAppTool(server,
    "show-tase-end-of-day-landing-widget",
    {
      title: "Show Subscription",
      description: "Displays the TASE Data Hub subscription landing page with available tools and a subscribe button.",
      inputSchema: {},
      _meta: { ui: { resourceUri: subscriptionResourceUri } },
    },
    async (): Promise<CallToolResult> => {
      const subscribeUrl = options?.subscribeUrl ?? `${process.env.APP_URL ?? "http://localhost:3001"}/subscribe`;
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ subscribeUrl }),
          },
        ],
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
    { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { permissions: { clipboardWrite: {} } } } },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "tase-end-of-day-landing-widget.html"), "utf-8");
      return { contents: [{ uri: subscriptionResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }] };
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

  return server;
}
