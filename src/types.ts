// Shared response types used by server.ts and src/db-api.ts

export interface StockData {
  tradeDate: string;
  symbol: string;
  securityId: number;
  change: number | null;
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
  bandWidth20: number | null;
  ez: number | null;
  companyName: string | null;
  sector: string | null;
  subSector: string | null;
}

export interface EndOfDayResult {
  items: StockData[];
  tradeDate: string;
  marketType: string | null;
}

export interface MarketSpiritResponse {
  tradeDate: string;
  marketType: string;
  // New breadth metrics
  momentumBreadth: number;      // % of universe with DailyScore >= 6
  moneyFlowBreadth: number;     // % with MFI > 60
  compressionBreadth: number;   // % with bandWidth < 6%
  regime: "weak" | "early" | "healthy" | "overextended";
  // Legacy fields kept for backward compat
  score: "Defense" | "Selective" | "Attack" | null;
  adv: number | null;
  adLine: number | null;
}

export interface MomentumSymbolItem {
  symbol: string;
  companyName: string | null;
  // Scores
  dailyScore: number;          // 0-8
  trendQuality: number;        // 0-10
  leaderScore: number;         // 0-9
  // Classification
  persistence: "strong" | "confirmed" | "new";  // 3/3, 2/3, 1/3
  phase: "compression" | "early" | "expansion" | "extended";
  isLeader: boolean;           // leaderScore >= 7
  isCompression: boolean;      // bandWidth < 6%
  // Key indicators
  ez: number;
  rsi14: number | null;
  bandWidth20: number | null;
  mfi14: number | null;
}

export interface MomentumResponse {
  tradeDate: string;
  marketType: string;
  count: number;
  items: MomentumSymbolItem[];
}

export interface UptrendSymbolItem {
  symbol: string;
  ez: number;
}

export interface UptrendSymbolsResponse {
  tradeDate: string;
  marketType: string;
  count: number;
  items: UptrendSymbolItem[];
}

export type CandlestickTimeframe = "1D" | "3D" | "1W" | "1M" | "3M";

export interface IntradayItem {
  date: string;
  lastSaleTime: string | null;
  securityId: number;
  securityLastRate: number | null;
  securityPercentageChange: number | null;
  lastSaleVolume: number | null;
  securityDailyAggVolume: number | null;
  securityDailyAggValue: number | null;
  securityDailyNumTrades: number | null;
}

export type IntradayTimeframe = "1m" | "3m" | "5m" | "10m" | "30m" | "1h";

export interface IntradayCandlestickResponse {
  symbol: string;
  securityId: number;
  count: number;
  items: IntradayItem[];
}

export interface CandlestickResponse {
  symbol: string;
  count: number;
  dateFrom: string | null;
  dateTo: string | null;
  timeframe: CandlestickTimeframe;
  items: StockData[];
}

export interface EndOfDaySymbolsResponse {
  symbols: string[];
  count: number;
  dateFrom: string | null;
  dateTo: string | null;
  items: StockData[];
}

export type HeatmapPeriod = "1D" | "1W" | "1M" | "3M";

export interface SymbolHeatmapItem {
  symbol: string;
  companyName: string | null;
  marketCap: number | null;
  change: number | null;
  sector: string;
  subSector: string | null;
}

export interface SectorHeatmapResponse {
  tradeDate: string;
  marketType: string;
  period: HeatmapPeriod;
  count: number;
  items: SymbolHeatmapItem[];
}

export interface TaseDataProviders {
  fetchEndOfDay(marketType?: string, tradeDate?: string): Promise<EndOfDayResult>;
  fetchMarketSpirit(marketType?: string, tradeDate?: string): Promise<MarketSpiritResponse>;
  fetchUptrendSymbols(marketType?: string, tradeDate?: string): Promise<UptrendSymbolsResponse>;
  fetchMomentumSymbols(marketType?: string, tradeDate?: string): Promise<MomentumResponse>;
  fetchEndOfDaySymbols(symbols?: string[], dateFrom?: string, dateTo?: string): Promise<EndOfDaySymbolsResponse>;
  fetchEndOfDaySymbolsByDate(symbols: string[], tradeDate?: string, period?: HeatmapPeriod): Promise<EndOfDaySymbolsResponse>;
  fetchCandlestick(symbol: string, dateFrom?: string, dateTo?: string, timeframe?: CandlestickTimeframe): Promise<CandlestickResponse>;
  fetchSectorHeatmap(marketType?: string, tradeDate?: string, period?: HeatmapPeriod): Promise<SectorHeatmapResponse>;
  resolveSymbol(securityIdOrSymbol: string | number): Promise<{ symbol: string; securityId: number }>;
}

export interface UserPosition {
  symbol: string;
  startDate: string; // YYYY-MM-DD
  amount: number;
  avgEntryPrice?: number;
  alloc?: number; // position value in %
  side?: "long" | "short";
}

export interface UserPositionsResponse {
  positions: UserPosition[];
  count: number;
  error?: string;
}

export interface UserWatchlistItem {
  symbol: string;
  startDate: string; // YYYY-MM-DD
  note?: string;
}

export interface UserWatchlistResponse {
  watchlist: UserWatchlistItem[];
  count: number;
  error?: string;
}
