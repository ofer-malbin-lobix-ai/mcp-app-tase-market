/**
 * Settings Widget
 * Shows subscription status, host info, and company link.
 */
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useEffect, useState } from "react";
import { WidgetLayout } from "../components/WidgetLayout";
import { createRoot } from "react-dom/client";
import styles from "./tase-market-settings-widget.module.css";

interface SubscriptionData {
  subscribeUrl: string;
  needsSubscription?: boolean;
}

function extractSubscriptionData(callToolResult: CallToolResult | null | undefined): SubscriptionData | null {
  try {
    if (!callToolResult) return null;
    const textContent = callToolResult.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;
    // ChatGPT double-wraps text content: {"text": "{actual JSON}"} — unwrap if needed
    let parsed = JSON.parse(textContent.text);
    if (parsed && typeof parsed.text === "string" && !parsed.subscribeUrl) {
      parsed = JSON.parse(parsed.text);
    }
    if (parsed?.subscribeUrl) return parsed as SubscriptionData;
    return null;
  } catch {
    return null;
  }
}

function hasToken(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).searchParams.has("token");
  } catch {
    return false;
  }
}

function SettingsApp() {
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "TASE Data Hub", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});

      app.ontoolresult = async (result) => {
        try {
          const subData = extractSubscriptionData(result);
          if (subData) {
            setData(subData);
          } else {
            setNeedsAutoFetch(true);
          }
        } catch (e) {
          console.error("ontoolresult error:", e);
          setNeedsAutoFetch(true);
        }
      };

      app.ontoolcancelled = () => {};
      app.onerror = console.error;

      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  useHostStyles(app ?? null);

  useEffect(() => {
    if (app) {
      setHostContext(app.getHostContext());
    }
  }, [app]);

  useEffect(() => {
    if (!needsAutoFetch || !app) return;
    setNeedsAutoFetch(false);
    (async () => {
      try {
        const result = await app.callServerTool({ name: "get-tase-market-settings-data", arguments: {} });
        const subData = extractSubscriptionData(result as CallToolResult);
        if (subData) setData(subData);
      } catch (e) {
        console.error("auto-fetch settings failed:", e);
      }
    })();
  }, [needsAutoFetch, app]);

  if (error) return <div className={styles.error}><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div className={styles.loading}>Connecting...</div>;

  return <SettingsInner data={data} hostContext={hostContext} app={app} />;
}

interface SettingsInnerProps {
  data: SubscriptionData | null;
  hostContext?: McpUiHostContext;
  app: NonNullable<ReturnType<typeof useApp>["app"]>;
}

function SettingsInner({ data, hostContext, app }: SettingsInnerProps) {
  const [copied, setCopied] = useState(false);

  const connectedUrl = hasToken(data?.subscribeUrl) ? data!.subscribeUrl : null;

  return (
    <WidgetLayout title="TASE Market Settings" app={app} hostContext={hostContext}>
      <div className={styles.content}>
      {connectedUrl ? (
        <div className={styles.cta}>
          <button
            className={styles.subscribeButton}
            onClick={async () => {
              try {
                const result = await app.openLink({ url: connectedUrl });
                if (result?.isError) {
                  await navigator.clipboard.writeText(connectedUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }
              } catch {
                try {
                  await navigator.clipboard.writeText(connectedUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                } catch {
                  const el = document.getElementById("subscribe-url");
                  if (el) {
                    const range = document.createRange();
                    range.selectNodeContents(el);
                    const sel = window.getSelection();
                    sel?.removeAllRanges();
                    sel?.addRange(range);
                  }
                }
              }
            }}
          >
            {copied ? "Copied!" : data?.needsSubscription ? "Subscribe Now" : "Subscription"}
          </button>
        </div>
      ) : (
        <div className={styles.notConnected}>
          <p>Go to the server to subscribe and access all tools.</p>
        </div>
      )}

      <footer className={styles.footer}>
        {(() => {
          const hv = app.getHostVersion();
          return hv ? <div className={styles.debugHost}>Host: {hv.name} v{hv.version}</div> : null;
        })()}
        <button
          className={styles.companyLink}
          onClick={async () => {
            try {
              const result = await app.openLink({ url: "https://www.lobix.ai" });
              if (result?.isError) {
                await navigator.clipboard.writeText("https://www.lobix.ai");
              }
            } catch {
              try {
                await navigator.clipboard.writeText("https://www.lobix.ai");
              } catch { /* ignore */ }
            }
          }}
        >
          www.lobix.ai
        </button>
      </footer>
      </div>
    </WidgetLayout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>,
);
