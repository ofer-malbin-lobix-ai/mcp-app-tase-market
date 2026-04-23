/**
 * Watchlist Manager Widget
 * Allows users to add, edit, and delete watchlist items.
 * Columns: Symbol | Start Date | Note | Actions (Edit / Delete)
 */
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WidgetLayout } from "../../components/WidgetLayout";
import { useLanguage, type TFunction } from "../../components/useLanguage";
import styles from "./watchlist-manager-widget.module.css";

// ─── Types ──────────────────────────────────────────────────────────

interface UserWatchlistItem {
  symbol: string;
  startDate: string;
  note?: string;
}

interface UserWatchlistData {
  watchlist: UserWatchlistItem[];
  count: number;
  error?: string;
}

interface FormState {
  symbol: string;
  startDate: string;
  note: string;
}

interface FormErrors {
  symbol?: string;
  startDate?: string;
}

// ─── Extraction ─────────────────────────────────────────────────────

function extractWatchlistData(result: CallToolResult | null | undefined): UserWatchlistData | null {
  try {
    if (!result) return null;
    if (result.structuredContent) {
      const d = result.structuredContent as unknown as UserWatchlistData;
      if (Array.isArray(d?.watchlist)) return d;
    }
    const textContent = result.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;
    let parsed = JSON.parse(textContent.text);
    // ChatGPT double-wrap: { text: "{actual JSON}" }
    if (parsed && typeof parsed.text === "string" && !parsed.watchlist) {
      parsed = JSON.parse(parsed.text);
    }
    if (parsed && Array.isArray(parsed.watchlist)) return parsed as UserWatchlistData;
    return null;
  } catch {
    return null;
  }
}

// ─── Validation ──────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateForm(form: FormState, isEdit: boolean, t: TFunction): FormErrors {
  const errors: FormErrors = {};
  if (!isEdit && !form.symbol.trim()) {
    errors.symbol = t("watchlist.symbolRequired");
  }
  if (!DATE_RE.test(form.startDate)) {
    errors.startDate = t("watchlist.dateFormat");
  }
  return errors;
}

// ─── Main App ────────────────────────────────────────────────────────

function WatchlistManagerApp() {
  const { language, dir, toggle, t } = useLanguage();
  const [data, setData] = useState<UserWatchlistData | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<FormState>({ symbol: "", startDate: "", note: "" });
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "Watchlist Manager", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});
      app.ontoolinput = async () => {};

      app.ontoolresult = async (result) => {
        try {
          const extracted = extractWatchlistData(result);
          if (extracted) {
            if (extracted.error) {
              setAuthError(extracted.error);
            } else {
              setData(extracted);
              setAuthError(null);
            }
          } else {
            setNeedsAutoFetch(true);
          }
        } catch (e) {
          console.error("ontoolresult error:", e);
          setNeedsAutoFetch(true);
        }
      };

      app.ontoolcancelled = (params) => {
        console.info("Tool call cancelled:", params.reason);
      };

      app.onerror = console.error;

      app.onhostcontextchanged = (params) => {
        setHostContext((prev) => ({ ...prev, ...params }));
      };
    },
  });

  // Auto-fetch fallback
  useEffect(() => {
    if (!needsAutoFetch || !app) return;
    setNeedsAutoFetch(false);
    if (typeof app.callServerTool !== "function") return;
    app.callServerTool({ name: "get-watchlist", arguments: {} })
      .then((result) => {
        const extracted = extractWatchlistData(result);
        if (extracted) {
          if (extracted.error) {
            setAuthError(extracted.error);
          } else {
            setData(extracted);
            setAuthError(null);
          }
        }
      })
      .catch((e) => console.error("Auto-fetch failed:", e));
  }, [needsAutoFetch, app]);

  useHostStyles(app ?? null);

  useEffect(() => {
    if (app) setHostContext(app.getHostContext());
  }, [app]);

  // ─── Refresh watchlist from server ──────────────────────────────

  const refreshWatchlist = useCallback(async () => {
    if (!app || typeof app.callServerTool !== "function") return;
    const result = await app.callServerTool({ name: "get-watchlist", arguments: {} });
    const extracted = extractWatchlistData(result);
    if (extracted) {
      if (extracted.error) {
        setAuthError(extracted.error);
      } else {
        setData(extracted);
        setAuthError(null);
      }
    }
  }, [app]);

  // ─── Form handlers ───────────────────────────────────────────────

  const handleAddClick = useCallback(() => {
    setForm({ symbol: "", startDate: "", note: "" });
    setFormErrors({});
    setIsEditing(false);
    setShowForm(true);
  }, []);

  const handleEditClick = useCallback((item: UserWatchlistItem) => {
    setForm({
      symbol: item.symbol,
      startDate: item.startDate,
      note: item.note ?? "",
    });
    setFormErrors({});
    setIsEditing(true);
    setShowForm(true);
  }, []);

  const handleCancel = useCallback(() => {
    setShowForm(false);
    setFormErrors({});
  }, []);

  const handleSave = useCallback(async () => {
    const errors = validateForm(form, isEditing, t);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    if (!app || typeof app.callServerTool !== "function") return;
    setIsSaving(true);
    try {
      const args: Record<string, unknown> = {
        symbol: form.symbol.trim().toUpperCase(),
        startDate: form.startDate,
      };
      if (form.note.trim()) {
        args.note = form.note.trim();
      }
      await app.callServerTool({
        name: "set-watchlist-item",
        arguments: args,
      });
      setShowForm(false);
      setFormErrors({});
      await refreshWatchlist();
    } catch (e) {
      console.error("Save failed:", e);
    } finally {
      setIsSaving(false);
    }
  }, [app, form, isEditing, refreshWatchlist]);

  const handleDelete = useCallback(async (symbol: string) => {
    if (!app || typeof app.callServerTool !== "function") return;
    setIsDeleting(symbol);
    try {
      await app.callServerTool({
        name: "delete-watchlist-item",
        arguments: { symbol },
      });
      await refreshWatchlist();
    } catch (e) {
      console.error("Delete failed:", e);
    } finally {
      setIsDeleting(null);
    }
  }, [app, refreshWatchlist]);

  const handleFieldChange = useCallback((field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormErrors((prev) => ({ ...prev, [field]: undefined }));
  }, []);

  // ─── Render ──────────────────────────────────────────────────────

  if (error) return <div className={styles.error}><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div className={styles.loading}>{t("layout.connecting")}</div>;

  const watchlist = data?.watchlist ?? [];
  const isBusy = isSaving || isDeleting !== null;

  return (
    <WidgetLayout
      title={t("home.tool.watchlistManager")}
      subtitle={data ? `${watchlist.length} item${watchlist.length !== 1 ? "s" : ""}` : undefined}
      app={app}
      hostContext={hostContext}
      language={language}
      dir={dir}
      onLanguageToggle={toggle}
    >
      {!showForm && (
        <div className={styles.addBtnWrapper}>
          <button className={styles.addBtn} onClick={handleAddClick} disabled={isBusy}>
            {t("watchlist.addToWatchlist")}
          </button>
        </div>
      )}

      <div className={styles.navRow}>
        {[
          { label: t("nav.table"), prompt: "call show-watchlist-table-widget" },
          { label: t("nav.candlestick"), prompt: "call show-watchlist-candlestick-widget" },
          { label: t("nav.endOfDay"), prompt: "call show-watchlist-end-of-day-widget" },
        ].map((nav) => (
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

      {authError && (
        <div className={styles.authError}>
          <strong>Authentication required:</strong> {authError}
        </div>
      )}

      {!authError && showForm && (
        <div className={styles.formPanel}>
          <div className={styles.formTitle}>{isEditing ? t("watchlist.editItem") : t("watchlist.addItem")}</div>
          <div className={styles.formRow}>
            <label className={styles.label}>
              {t("eod.col.symbol")}
              <input
                className={`${styles.input} ${formErrors.symbol ? styles.inputError : ""}`}
                value={form.symbol}
                onChange={(e) => handleFieldChange("symbol", e.target.value)}
                disabled={isEditing}
                placeholder={t("common.eg") + " TEVA"}
                maxLength={20}
              />
              {formErrors.symbol && <span className={styles.fieldError}>{formErrors.symbol}</span>}
            </label>
            <label className={styles.label}>
              {t("watchlist.startDate")}
              <input
                className={`${styles.input} ${formErrors.startDate ? styles.inputError : ""}`}
                value={form.startDate}
                onChange={(e) => handleFieldChange("startDate", e.target.value)}
                placeholder="YYYY-MM-DD"
                maxLength={10}
              />
              {formErrors.startDate && <span className={styles.fieldError}>{formErrors.startDate}</span>}
            </label>
          </div>
          <label className={styles.label} style={{ marginTop: "0.5rem" }}>
            {t("watchlist.note")}
            <textarea
              className={styles.textarea}
              value={form.note}
              onChange={(e) => handleFieldChange("note", e.target.value)}
              placeholder="Optional note..."
              rows={2}
              maxLength={500}
            />
          </label>
          <div className={styles.formActions}>
            <button className={styles.saveBtn} onClick={handleSave} disabled={isSaving}>
              {isSaving ? t("common.saving") : t("common.save")}
            </button>
            <button className={styles.cancelBtn} onClick={handleCancel} disabled={isSaving}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      )}

      {!authError && !data ? (
        <div className={styles.loading}>{t("common.loadingWatchlist")}</div>
      ) : !authError && watchlist.length === 0 ? (
        <div className={styles.empty}>{t("watchlist.noItems")}</div>
      ) : !authError ? (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={`${styles.th} ${styles.thLeft}`}>{t("eod.col.symbol")}</th>
                <th className={`${styles.th} ${styles.thLeft}`}>{t("watchlist.startDate")}</th>
                <th className={`${styles.th} ${styles.thLeft}`}>{t("watchlist.note")}</th>
                <th className={`${styles.th} ${styles.thActions}`}>{t("watchlist.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {watchlist.map((item) => {
                return (
                <tr key={item.symbol} className={styles.tr}>
                  <td className={`${styles.tdLeft} ${styles.tdSymbol}`}>{item.symbol}</td>
                  <td className={styles.tdLeft}>{item.startDate}</td>
                  <td className={`${styles.tdLeft} ${styles.tdNote}`} title={item.note ?? ""}>
                    {item.note ?? "—"}
                  </td>
                  <td className={styles.tdActions}>
                    <button
                      className={styles.editBtn}
                      onClick={() => handleEditClick(item)}
                      disabled={isBusy}
                    >
                      {t("common.edit")}
                    </button>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => handleDelete(item.symbol)}
                      disabled={isBusy}
                    >
                      {isDeleting === item.symbol ? "..." : t("common.delete")}
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </WidgetLayout>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WatchlistManagerApp />
  </StrictMode>,
);
