// Shared response types used by server.ts and src/db-api.ts

export interface StockData {
  tradeDate: string;
  symbol: string;
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
  ez: number | null;
  companyName: string | null;
  sector: string | null;
  subSector: string | null;
}

export interface EndOfDayResult {
  rows: StockData[];
  tradeDate: string;
  marketType: string | null;
}

export interface MarketSpiritResponse {
  tradeDate: string;
  marketType: string;
  score: "Defense" | "Selective" | "Attack" | null;
  adv: number | null;
  adLine: number | null;
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
  count: number;
  items: SymbolHeatmapItem[];
}

export interface TaseDataProviders {
  fetchEndOfDay(marketType?: string, tradeDate?: string): Promise<EndOfDayResult>;
  fetchMarketSpirit(marketType?: string, tradeDate?: string): Promise<MarketSpiritResponse>;
  fetchUptrendSymbols(marketType?: string, tradeDate?: string): Promise<UptrendSymbolsResponse>;
  fetchEndOfDaySymbols(symbols?: string[], dateFrom?: string, dateTo?: string): Promise<EndOfDaySymbolsResponse>;
  fetchEndOfDaySymbolsByDate(symbols: string[], tradeDate?: string): Promise<EndOfDaySymbolsResponse>;
  fetchCandlestick(symbol: string, dateFrom?: string, dateTo?: string, timeframe?: CandlestickTimeframe): Promise<CandlestickResponse>;
  fetchSectorHeatmap(marketType?: string, tradeDate?: string): Promise<SectorHeatmapResponse>;
}
