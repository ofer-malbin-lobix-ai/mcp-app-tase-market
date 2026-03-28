/**
 * Index End of Day Widget
 * Displays TASE index constituents in a flat DataTable with an index selector dropdown.
 */
import type { EndOfDayAppConfig } from "../shared/EndOfDayApp";
import { renderEndOfDayApp } from "../shared/EndOfDayApp";

const config: EndOfDayAppConfig = {
  toolName: "get-index-sector-breakdown-data",
  titleKey: "home.tool.indexEndOfDay",
  showIndexFilter: true,
  defaultIndexId: 137, // TA-125
  navButtons: [
    { label: "Candlestick", prompt: "call show-index-candlestick-widget" },
    { label: "Sector Breakdown", prompt: "call show-index-sector-breakdown-widget" },
    { label: "Last Update", prompt: "call show-index-last-update-widget" },
    { label: "Sector Heatmap", prompt: "call show-index-sector-heatmap-widget" },
  ],
};

renderEndOfDayApp(config);
