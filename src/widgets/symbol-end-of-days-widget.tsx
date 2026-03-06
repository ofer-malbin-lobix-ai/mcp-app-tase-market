/**
 * Symbol End of Days Widget
 * Displays Tel Aviv Stock Exchange end of day data for a single symbol across a date range.
 */
import type { EndOfDaysAppConfig } from "./shared/EndOfDaysApp";
import { renderEndOfDaysApp } from "./shared/EndOfDaysApp";

const config: EndOfDaysAppConfig = {
  toolName: "get-symbol-end-of-days-data",
};

renderEndOfDaysApp(config);
