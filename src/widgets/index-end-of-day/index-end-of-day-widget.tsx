/**
 * Index End of Day Widget
 * Displays TASE index constituents in a flat DataTable with an index selector dropdown.
 */
import type { EndOfDayAppConfig } from "../shared/EndOfDayApp";
import { renderEndOfDayApp } from "../shared/EndOfDayApp";

const config: EndOfDayAppConfig = {
  toolName: "get-index-sector-breakdown-data",
  showIndexFilter: true,
  defaultIndexId: 137, // TA-125
};

renderEndOfDayApp(config);
