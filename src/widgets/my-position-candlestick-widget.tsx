/**
 * My Position Candlestick Widget
 * Candlestick chart with sidebar for the user's portfolio symbols.
 */
import type { SymbolsCandlestickConfig } from "./shared/SymbolsCandlestickApp";
import { renderSymbolsCandlestickApp } from "./shared/SymbolsCandlestickApp";

const config: SymbolsCandlestickConfig = {
  toolName: "get-my-position-end-of-day-data",
  symbolDatesToolName: "get-my-positions",
  navButtons: [
    { label: "Manager", prompt: "call show-my-positions-manager-widget" },
    { label: "Table", prompt: "call show-my-position-table-widget" },
    { label: "End of Day", prompt: "call show-my-position-end-of-day-widget" },
  ],
};

renderSymbolsCandlestickApp(config);
