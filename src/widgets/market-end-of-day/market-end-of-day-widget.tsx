/**
 * Market End of Day Widget
 * Displays Tel Aviv Stock Exchange end of day data with market type filter.
 */
import type { EndOfDayAppConfig } from "../shared/EndOfDayApp";
import { renderEndOfDayApp } from "../shared/EndOfDayApp";

const config: EndOfDayAppConfig = {
  toolName: "get-market-end-of-day-data",
  isMarketView: true,
};

renderEndOfDayApp(config);
