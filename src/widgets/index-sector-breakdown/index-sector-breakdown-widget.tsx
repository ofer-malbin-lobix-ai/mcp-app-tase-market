/**
 * Index Sector Breakdown Widget
 * Displays TASE index constituents with an index selector dropdown.
 */
import type { EndOfDayAppConfig } from "../shared/EndOfDayApp";
import { renderEndOfDayApp } from "../shared/EndOfDayApp";

const config: EndOfDayAppConfig = {
  toolName: "get-index-sector-breakdown-data",
  showIndexFilter: true,
  defaultIndexId: 137, // TA-125
  groupBySector: true,
  navButtons: [
    { label: "Candlestick", prompt: "call show-index-candlestick-widget" },
    { label: "End of Day", prompt: "call show-index-end-of-day-widget" },
    { label: "Last Update", prompt: "call show-index-last-update-widget" },
    { label: "Sector Heatmap", prompt: "call show-index-sector-heatmap-widget" },
  ],
};

renderEndOfDayApp(config);
