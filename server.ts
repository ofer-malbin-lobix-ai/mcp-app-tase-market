import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

// API base URLs
const END_OF_DAY_API_URL = "https://www.professorai.app/api/mcp-endpoint/tase-data-hub/eod/rows/market/date";
const MARKET_SPIRIT_API_URL = "https://www.professorai.app/api/mcp-endpoint/tase-data-hub/eod/market/spirit";
const UPTREND_SYMBOLS_API_URL = "https://www.professorai.app/api/mcp-endpoint/tase-data-hub/eod/symbols/uptrend/date";
const END_OF_DAY_SYMBOLS_API_URL = "https://www.professorai.app/api/mcp-endpoint/tase-data-hub/eod/rows/symbols/range";
const CANDLESTICK_API_URL = "https://www.professorai.app/api/mcp-endpoint/tase-data-hub/eod/charts/symbol/candlestick";

// Define the input schema using Zod
const getTaseDataSchema = {
  marketType: z.enum(["STOCK", "BOND", "TASE UP STOCK", "LOAN"]).optional().describe("Market type filter"),
  tradeDate: z.string().optional().describe("Trade date in YYYY-MM-DD format. If not provided, returns the last available trading day."),
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
};

// Works both from source (server.ts) and compiled (dist/server.js)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DIST_DIR = __filename.endsWith(".ts")
  ? path.join(__dirname, "dist")
  : __dirname;

// TASE end of day data structure (matches Prisma schema exactly)
interface StockData {
  tradeDate: string;
  symbol: string;
  change: number | null;              // percentage change
  turnover: number | null;
  closingPrice: number | null;
  basePrice: number | null;
  openingPrice: number | null;
  high: number | null;
  low: number | null;
  changeValue: number | null;
  volume: number | null;
  marketCap: number | null;
  minContPhaseAmount: number | null;
  listedCapital: number | null;
  marketType: string | null;
  // Technical indicators
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
  stddev20: number | null;
  upperBollingerBand20: number | null;
  lowerBollingerBand20: number | null;
  ez: number | null;
}

// API response structure
interface ApiResponse {
  tradeDate: string;
  marketType: string | null;
  count: number;
  items: StockData[];
}

// Market Spirit response structure
interface MarketSpiritResponse {
  tradeDate: string;
  marketType: string;
  score: "Defense" | "Selective" | "Attack" | null;
  adv: number | null;
  adLine: number | null;
}

// Uptrend Symbols response structure
interface UptrendSymbolItem {
  symbol: string;
  ez: number;
}

interface UptrendSymbolsResponse {
  tradeDate: string;
  marketType: string;
  count: number;
  items: UptrendSymbolItem[];
}
// Candlestick response structure
interface CandlestickResponse {
  symbol: string;
  count: number;
  dateFrom: string | null;
  dateTo: string | null;
  items: StockData[];
}

// End of Day Symbols response structure
interface EndOfDaySymbolsResponse {
  symbols: string[];
  count: number;
  dateFrom: string | null;
  dateTo: string | null;
  items: StockData[];
}

// Score descriptions for Market Spirit
const SCORE_DESCRIPTIONS: Record<string, string> = {
  Defense: "Bearish market conditions - consider defensive positions",
  Selective: "Neutral market conditions - be selective with positions",
  Attack: "Bullish market conditions - favorable for aggressive positions",
};

/**
 * Format TASE end of day data for tool response
 */
function formatTaseDataResult(data: { rows: StockData[]; tradeDate: string; marketType: string | null }): CallToolResult {
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

/**
 * Format Market Spirit data for tool response
 */
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

/**
 * Format Uptrend Symbols data for tool response
 */
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

/**
 * Format End of Day Symbols data for tool response
 */
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

/**
 * Fetch End of Day Symbols data from the API
 */
async function fetchEndOfDaySymbols(symbols?: string[], dateFrom?: string, dateTo?: string): Promise<EndOfDaySymbolsResponse> {
  const params = new URLSearchParams();
  if (symbols) {
    for (const s of symbols) {
      params.append("symbols[]", s);
    }
  }
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);

  const url = params.toString() ? `${END_OF_DAY_SYMBOLS_API_URL}?${params}` : END_OF_DAY_SYMBOLS_API_URL;

  console.error(`Fetching End of Day Symbols from: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const responseData = await response.json() as { payload: string };
  const data = JSON.parse(responseData.payload) as EndOfDaySymbolsResponse;

  return data;
}

/**
 * Format Candlestick data for tool response
 */
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
 * Fetch Candlestick data from the API
 */
async function fetchCandlestick(symbol: string, dateFrom?: string, dateTo?: string): Promise<CandlestickResponse> {
  const params = new URLSearchParams();
  params.set("symbol", symbol);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);

  const url = `${CANDLESTICK_API_URL}?${params}`;

  console.error(`Fetching Candlestick from: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const responseData = await response.json() as { payload: string };
  const data = JSON.parse(responseData.payload) as CandlestickResponse;

  return data;
}

/**
 * Fetch TASE end of day data from the API
 */
async function fetchEndOfDay(marketType?: string, tradeDate?: string): Promise<{ rows: StockData[]; tradeDate: string; marketType: string | null }> {
  const params = new URLSearchParams();
  if (marketType) params.set("marketType", marketType);
  if (tradeDate) params.set("tradeDate", tradeDate);

  const url = params.toString() ? `${END_OF_DAY_API_URL}?${params}` : END_OF_DAY_API_URL;

  console.error(`Fetching TASE data from: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const responseData = await response.json() as { payload: string };
  const data = JSON.parse(responseData.payload) as ApiResponse;

  // Pass through API response items directly (StockData matches ApiRow)
  const rows: StockData[] = data.items;

  return { rows, tradeDate: data.tradeDate, marketType: data.marketType };
}

/**
 * Fetch Market Spirit data from the API
 */
async function fetchMarketSpirit(marketType?: string, tradeDate?: string): Promise<MarketSpiritResponse> {
  const params = new URLSearchParams();
  if (marketType) params.set("marketType", marketType);
  if (tradeDate) params.set("tradeDate", tradeDate);

  const url = params.toString() ? `${MARKET_SPIRIT_API_URL}?${params}` : MARKET_SPIRIT_API_URL;

  console.error(`Fetching Market Spirit from: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const responseData = await response.json() as { payload: string };
  const data = JSON.parse(responseData.payload) as MarketSpiritResponse;

  return data;
}

/**
 * Fetch Uptrend Symbols from the API
 */
async function fetchUptrendSymbols(marketType?: string, tradeDate?: string): Promise<UptrendSymbolsResponse> {
  const params = new URLSearchParams();
  if (marketType) params.set("marketType", marketType);
  if (tradeDate) params.set("tradeDate", tradeDate);

  const url = params.toString() ? `${UPTREND_SYMBOLS_API_URL}?${params}` : UPTREND_SYMBOLS_API_URL;

  console.error(`Fetching Uptrend Symbols from: ${url}`);

  const response = await fetch(url, {
    method: "GET",
    headers: {
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  const responseData = await response.json() as { payload: string };
  const data = JSON.parse(responseData.payload) as UptrendSymbolsResponse;

  return data;
}

/**
 * Creates a new MCP server instance with tools and resources registered.
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: "TASE End of Day Server",
    version: "1.0.0",
  });

  // Two-part registration: tool + resource, tied together by the resource URI.
  const endOfDayResourceUri = "ui://tase-end-of-day/end-of-day-widget-v4.html";
  const marketSpiritResourceUri = "ui://tase-end-of-day/market-spirit-widget-v4.html";
  const uptrendSymbolsResourceUri = "ui://tase-end-of-day/uptrend-symbols-widget-v4.html";
  const endOfDaySymbolsResourceUri = "ui://tase-end-of-day/end-of-day-symbols-widget-v4.html";
  const candlestickResourceUri = "ui://tase-end-of-day/candlestick-widget-v4.html";
  const dashboardResourceUri = "ui://tase-end-of-day/dashboard-widget-v4.html";

  // Data-only tool: Get TASE end of day data (no UI, callable by both model and app)
  registerAppTool(server,
    "get-end-of-day-data",
    {
      title: "Get TASE End of Day Data",
      description: "Returns TASE end of day data including prices, volume, and technical indicators. Data only - use show-end-of-day-widget for visualization.",
      inputSchema: getTaseDataSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await fetchEndOfDay(args.marketType, args.tradeDate);
      return formatTaseDataResult(data);
    },
  );

  // UI tool: Show TASE end of day data with interactive table
  registerAppTool(server,
    "show-end-of-day-widget",
    {
      title: "Show TASE End of Day",
      description: "Displays Tel Aviv Stock Exchange end of day data with interactive table visualization.",
      inputSchema: getTaseDataSchema,
      _meta: { ui: { resourceUri: endOfDayResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await fetchEndOfDay(args.marketType, args.tradeDate);
      // Send only summary to host — widget fetches full data via callServerTool
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

  // Data-only tool: Get Market Spirit data (no UI, callable by both model and app)
  registerAppTool(server,
    "get-market-spirit-data",
    {
      title: "Get Market Spirit Data",
      description: "Returns TASE Market Spirit indicator: Defense (bearish, score 0-2), Selective (neutral, score 3-4), or Attack (bullish, score 5-6). Data only - use show-market-spirit-widget for visualization.",
      inputSchema: getMarketSpiritSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await fetchMarketSpirit(args.marketType, args.tradeDate);
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
      const data = await fetchMarketSpirit(args.marketType, args.tradeDate);
      // Send only summary to host — widget fetches full data via callServerTool
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

  // Data-only tool: Get Uptrend Symbols (no UI, callable by both model and app)
  registerAppTool(server,
    "get-uptrend-symbols-data",
    {
      title: "Get Uptrend Symbols Data",
      description: "Returns TASE symbols currently in uptrend with EZ values (% distance from SMA20). Data only - use show-uptrend-symbols-widget for visualization.",
      inputSchema: getUptrendSymbolsSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await fetchUptrendSymbols(args.marketType, args.tradeDate);
      return formatUptrendSymbolsResult(data);
    },
  );

  // UI tool: Show Uptrend Symbols list
  registerAppTool(server,
    "show-uptrend-symbols-widget",
    {
      title: "Show Uptrend Symbols",
      description: "Displays TASE symbols currently in uptrend with EZ values (% distance from SMA20) as an interactive list.",
      inputSchema: getUptrendSymbolsSchema,
      _meta: { ui: { resourceUri: uptrendSymbolsResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await fetchUptrendSymbols(args.marketType, args.tradeDate);
      // Send only summary to host — widget fetches full data via callServerTool
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

  // Data-only tool: Get End of Day Symbols data (no UI, callable by both model and app)
  registerAppTool(server,
    "get-end-of-day-symbols-data",
    {
      title: "Get End of Day Symbols Data",
      description: "Returns TASE end of day data for specific symbols across a date range. Data only - use show-end-of-day-symbols-widget for visualization.",
      inputSchema: getEndOfDaySymbolsSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await fetchEndOfDaySymbols(args.symbols, args.dateFrom, args.dateTo);
      return formatEndOfDaySymbolsResult(data);
    },
  );

  // UI tool: Show End of Day Symbols data with interactive table
  registerAppTool(server,
    "show-end-of-day-symbols-widget",
    {
      title: "Show End of Day Symbols",
      description: "Displays TASE end of day data for specific symbols across a date range with interactive table visualization.",
      inputSchema: getEndOfDaySymbolsSchema,
      _meta: { ui: { resourceUri: endOfDaySymbolsResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await fetchEndOfDaySymbols(args.symbols, args.dateFrom, args.dateTo);
      // Return full data in text content — widget parses in ontoolresult.
      // Unlike end-of-day API, this API returns empty data with no symbols,
      // so auto-fetch with {} won't work. Full data must come from the show tool.
      return formatEndOfDaySymbolsResult(data);
    },
  );

  // Data-only tool: Get Candlestick data (no UI, callable by both model and app)
  registerAppTool(server,
    "get-symbol-candlestick-data",
    {
      title: "Get Candlestick Data",
      description: "Returns TASE candlestick chart data (OHLCV) for a single symbol across a date range. Data only - use show-symbol-candlestick-widget for visualization.",
      inputSchema: getCandlestickSchema,
      _meta: { ui: { visibility: ["model", "app"] } },
    },
    async (args): Promise<CallToolResult> => {
      const data = await fetchCandlestick(args.symbol, args.dateFrom, args.dateTo);
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
      const data = await fetchCandlestick(args.symbol, args.dateFrom, args.dateTo);
      // Return full data in text content — widget parses in ontoolresult.
      // API requires symbol param, so auto-fetch with {} won't work.
      return formatCandlestickResult(data);
    },
  );

  // UI tool: Show Market Dashboard portal
  registerAppTool(server,
    "show-dashboard-widget",
    {
      title: "Show Market Dashboard",
      description: "Displays a single-page market overview combining Market Spirit, end-of-day stats (gainers/losers), and uptrend symbols count.",
      inputSchema: getTaseDataSchema,
      _meta: { ui: { resourceUri: dashboardResourceUri } },
    },
    async (args): Promise<CallToolResult> => {
      const [spirit, eod, uptrend] = await Promise.allSettled([
        fetchMarketSpirit(args.marketType, args.tradeDate),
        fetchEndOfDay(args.marketType, args.tradeDate),
        fetchUptrendSymbols(args.marketType, args.tradeDate),
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

  // Register the TASE data resource
  registerAppResource(server,
    endOfDayResourceUri,
    endOfDayResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "end-of-day-widget.html"), "utf-8");
      return {
        contents: [{ uri: endOfDayResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  // Register the Market Spirit resource
  registerAppResource(server,
    marketSpiritResourceUri,
    marketSpiritResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "market-spirit-widget.html"), "utf-8");
      return {
        contents: [{ uri: marketSpiritResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  // Register the Uptrend Symbols resource
  registerAppResource(server,
    uptrendSymbolsResourceUri,
    uptrendSymbolsResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "uptrend-symbols-widget.html"), "utf-8");
      return {
        contents: [{ uri: uptrendSymbolsResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  // Register the End of Day Symbols resource
  registerAppResource(server,
    endOfDaySymbolsResourceUri,
    endOfDaySymbolsResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "end-of-day-symbols-widget.html"), "utf-8");
      return {
        contents: [{ uri: endOfDaySymbolsResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  // Register the Candlestick resource
  registerAppResource(server,
    candlestickResourceUri,
    candlestickResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "symbol-candlestick-widget.html"), "utf-8");
      return {
        contents: [{ uri: candlestickResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  // Register the Dashboard resource
  registerAppResource(server,
    dashboardResourceUri,
    dashboardResourceUri,
    { mimeType: RESOURCE_MIME_TYPE },
    async (): Promise<ReadResourceResult> => {
      const html = await fs.readFile(path.join(DIST_DIR, "dashboard-widget.html"), "utf-8");
      return {
        contents: [{ uri: dashboardResourceUri, mimeType: RESOURCE_MIME_TYPE, text: html }],
      };
    },
  );

  return server;
}
