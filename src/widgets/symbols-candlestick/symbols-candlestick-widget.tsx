/**
 * Symbols Candlestick Widget
 * Candlestick chart with sidebar for user-specified symbols.
 */
import type { SymbolsCandlestickConfig } from "../shared/SymbolsCandlestickApp";
import { renderSymbolsCandlestickApp } from "../shared/SymbolsCandlestickApp";

const config: SymbolsCandlestickConfig = {
  toolName: "get-symbols-end-of-days-data",
};

renderSymbolsCandlestickApp(config);
