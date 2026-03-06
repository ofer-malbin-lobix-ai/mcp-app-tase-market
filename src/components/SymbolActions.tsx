import type { App } from "@modelcontextprotocol/ext-apps";
import styles from "./symbol-actions.module.css";

export function SymbolActions({ symbol, app, startDate }: { symbol: string; app: App; startDate?: string | null }) {
  return (
    <span className={styles.rowActions}>
      <button
        className={styles.actionBtn}
        title="Candlestick"
        data-tooltip="Candlestick"
        onClick={() => app.sendMessage({
          role: "user",
          content: [{ type: "text", text: `call show-symbol-candlestick-widget with symbol: "${symbol}"` }],
        })}
      >&#x1F56F;&#xFE0F;</button>
      <button
        className={styles.actionBtn}
        title="Intraday"
        data-tooltip="Intraday"
        onClick={() => app.sendMessage({
          role: "user",
          content: [{ type: "text", text: `call show-symbol-intraday-candlestick-widget with securityIdOrSymbol: "${symbol}"` }],
        })}
      >&#x23F1;&#xFE0F;</button>
      <button
        className={styles.actionBtn}
        title="End of Days"
        data-tooltip="End of Days"
        onClick={() => app.sendMessage({
          role: "user",
          content: [{ type: "text", text: `call show-symbol-end-of-days-widget with symbol: "${symbol}"${startDate ? `, dateFrom: "${startDate}"` : ""}` }],
        })}
      >&#x1F4C5;</button>
    </span>
  );
}
