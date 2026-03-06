import type { App } from "@modelcontextprotocol/ext-apps";
import styles from "./nav-row.module.css";

export interface NavItem {
  label: string;
  prompt: string;
}

export function NavRow({ app, items }: { app: App; items: NavItem[] }) {
  return (
    <div className={styles.navRow}>
      {items.map((nav) => (
        <button
          key={nav.label}
          className={styles.navBtn}
          onClick={async () => {
            try {
              await app.sendMessage({
                role: "user",
                content: [{ type: "text", text: nav.prompt }],
              });
            } catch (e) {
              console.error("sendMessage failed:", e);
            }
          }}
        >
          {nav.label}
        </button>
      ))}
    </div>
  );
}
