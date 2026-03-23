/**
 * Watchlist Candlestick Widget
 * Candlestick chart with sidebar for the user's watchlist symbols.
 */
import type { SymbolsCandlestickConfig } from "../shared/SymbolsCandlestickApp";
import { renderSymbolsCandlestickApp } from "../shared/SymbolsCandlestickApp";

const config: SymbolsCandlestickConfig = {
  toolName: "get-watchlist-end-of-day-data",
  symbolDatesToolName: "get-watchlist",
  navButtons: [
    { label: "Manager", prompt: "call show-watchlist-manager-widget" },
    { label: "Table", prompt: "call show-watchlist-table-widget" },
    { label: "End of Day", prompt: "call show-watchlist-end-of-day-widget" },
  ],
};

renderSymbolsCandlestickApp(config);
