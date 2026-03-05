/**
 * Symbols End of Day Widget
 * Displays Tel Aviv Stock Exchange end of day data for specific symbols on a single trade date.
 */
import type { EndOfDayAppConfig } from "./shared/EndOfDayApp";
import { renderEndOfDayApp } from "./shared/EndOfDayApp";

const config: EndOfDayAppConfig = {
  toolName: "get-symbols-end-of-day-data",
  passSymbolsOnRefresh: true,
};

renderEndOfDayApp(config);
