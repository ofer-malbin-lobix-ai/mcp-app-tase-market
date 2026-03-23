/**
 * Watchlist End of Day Widget
 * Displays Tel Aviv Stock Exchange end of day data for watchlist symbols.
 */
import type { EndOfDayAppConfig } from "../shared/EndOfDayApp";
import { renderEndOfDayApp } from "../shared/EndOfDayApp";

const config: EndOfDayAppConfig = {
  toolName: "get-watchlist-end-of-day-data",
  navButtons: [
    { label: "Manager", prompt: "call show-watchlist-manager-widget" },
    { label: "Table", prompt: "call show-watchlist-table-widget" },
    { label: "Candlestick", prompt: "call show-watchlist-candlestick-widget" },
  ],
};

renderEndOfDayApp(config);
