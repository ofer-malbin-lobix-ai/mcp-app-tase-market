/**
 * My Position End of Day Widget
 * Displays Tel Aviv Stock Exchange end of day data for the user's portfolio symbols.
 */
import type { EndOfDayAppConfig } from "./shared/EndOfDayApp";
import { renderEndOfDayApp } from "./shared/EndOfDayApp";

const config: EndOfDayAppConfig = {
  toolName: "get-my-position-end-of-day-data",
  navButtons: [
    { label: "Manager", prompt: "call show-my-positions-manager-widget" },
    { label: "Table", prompt: "call show-my-position-table-widget" },
    { label: "Candlestick", prompt: "call show-my-position-candlestick-widget" },
  ],
};

renderEndOfDayApp(config);
