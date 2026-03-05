/**
 * My Position Candlestick Widget
 * Candlestick chart with sidebar for the user's portfolio symbols.
 */
import type { SymbolsCandlestickConfig } from "./shared/SymbolsCandlestickApp";
import { renderSymbolsCandlestickApp } from "./shared/SymbolsCandlestickApp";

const config: SymbolsCandlestickConfig = {
  toolName: "get-my-position-end-of-day-data",
};

renderSymbolsCandlestickApp(config);
