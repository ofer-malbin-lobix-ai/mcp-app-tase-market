/**
 * My Watchlist Candlestick Widget
 * Candlestick chart with sidebar for the user's watchlist symbols.
 */
import type { SymbolsCandlestickConfig } from "./shared/SymbolsCandlestickApp";
import { renderSymbolsCandlestickApp } from "./shared/SymbolsCandlestickApp";

const config: SymbolsCandlestickConfig = {
  toolName: "get-my-watchlist-end-of-day-data",
  symbolDatesToolName: "get-my-watchlist",
};

renderSymbolsCandlestickApp(config);
