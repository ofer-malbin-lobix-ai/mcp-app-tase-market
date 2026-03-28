/**
 * Index Candlestick Widget
 * Candlestick chart with sidebar for index constituents.
 */
import type { SymbolsCandlestickConfig } from "../shared/SymbolsCandlestickApp";
import { renderSymbolsCandlestickApp } from "../shared/SymbolsCandlestickApp";

const config: SymbolsCandlestickConfig = {
  toolName: "get-index-end-of-day-data",
  showIndexFilter: true,
  defaultIndexId: 137,
  navButtons: [
    { label: "Sector Breakdown", prompt: "call show-index-sector-breakdown-widget" },
    { label: "End of Day", prompt: "call show-index-end-of-day-widget" },
    { label: "Last Update", prompt: "call show-index-last-update-widget" },
    { label: "Sector Heatmap", prompt: "call show-index-sector-heatmap-widget" },
  ],
};

renderSymbolsCandlestickApp(config);
