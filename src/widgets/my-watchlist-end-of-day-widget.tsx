/**
 * My Watchlist End of Day Widget
 * Displays Tel Aviv Stock Exchange end of day data for watchlist symbols.
 */
import type { EndOfDayAppConfig } from "./shared/EndOfDayApp";
import { renderEndOfDayApp } from "./shared/EndOfDayApp";

const config: EndOfDayAppConfig = {
  toolName: "get-my-watchlist-end-of-day-data",
};

renderEndOfDayApp(config);
