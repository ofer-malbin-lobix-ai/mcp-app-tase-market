/**
 * My Positions Manager Widget
 * Allows users to add, edit, and delete portfolio positions.
 * Columns: Symbol | Start Date | Amount | Actions (Edit / Delete)
 */
import type { McpUiHostContext } from "@modelcontextprotocol/ext-apps";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { WidgetLayout, handleSubscriptionRedirect, SubscriptionBanner } from "../../components/WidgetLayout";
import type { TFunction } from "../../components/useLanguage";
import { useLanguage } from "../../components/useLanguage";
import styles from "./my-positions-manager-widget.module.css";

// ─── Types ──────────────────────────────────────────────────────────

interface UserPosition {
  symbol: string;
  startDate: string;
  amount: number;
  avgEntryPrice?: number;
  alloc?: number;
  side?: "long" | "short";
}

interface UserPositionsData {
  positions: UserPosition[];
  count: number;
  error?: string;
}

interface FormState {
  symbol: string;
  startDate: string;
  amount: string;
  avgEntryPrice: string;
  alloc: string;
  side: "long" | "short";
}

interface FormErrors {
  symbol?: string;
  startDate?: string;
  amount?: string;
  avgEntryPrice?: string;
  alloc?: string;
}

// ─── Extraction ─────────────────────────────────────────────────────

function extractPositionsData(result: CallToolResult | null | undefined): UserPositionsData | null {
  try {
    if (!result) return null;
    if (result.structuredContent) {
      const d = result.structuredContent as unknown as UserPositionsData;
      if (Array.isArray(d?.positions)) return d;
    }
    const textContent = result.content?.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") return null;
    let parsed = JSON.parse(textContent.text);
    // ChatGPT double-wrap: { text: "{actual JSON}" }
    if (parsed && typeof parsed.text === "string" && !parsed.positions) {
      parsed = JSON.parse(parsed.text);
    }
    if (parsed && Array.isArray(parsed.positions)) return parsed as UserPositionsData;
    return null;
  } catch {
    return null;
  }
}

// ─── Formatters ─────────────────────────────────────────────────────

function fmtAmount(v: number): string {
  return v.toLocaleString();
}

function fmtPrice(v: number | undefined): string {
  if (v === undefined || v === null) return "—";
  return v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Validation ──────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateForm(form: FormState, isEdit: boolean, t: TFunction): FormErrors {
  const errors: FormErrors = {};
  if (!isEdit && !form.symbol.trim()) {
    errors.symbol = t("positions.symbolRequired");
  }
  if (!DATE_RE.test(form.startDate)) {
    errors.startDate = t("positions.dateFormat");
  }
  const amount = parseFloat(form.amount);
  if (isNaN(amount) || amount <= 0) {
    errors.amount = t("positions.amountPositive");
  }
  if (form.avgEntryPrice.trim()) {
    const price = parseFloat(form.avgEntryPrice);
    if (isNaN(price) || price <= 0) {
      errors.avgEntryPrice = t("positions.pricePositive");
    }
  }
  if (form.alloc.trim()) {
    const alloc = parseFloat(form.alloc);
    if (isNaN(alloc) || alloc < 0 || alloc > 100) {
      errors.alloc = t("positions.stopLossRange");
    }
  }
  return errors;
}

// ─── Main App ────────────────────────────────────────────────────────

function MyPositionsManagerApp() {
  const { language, dir, toggle, t } = useLanguage();
  const [data, setData] = useState<UserPositionsData | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<FormState>({ symbol: "", startDate: "", amount: "", avgEntryPrice: "", alloc: "", side: "long" });
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [subscribeUrl, setSubscribeUrl] = useState<string | null>(null);
  const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();

  const { app, error } = useApp({
    appInfo: { name: "My Positions Manager", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});
      app.ontoolinput = async () => {};

      app.ontoolresult = async (result) => {
        try {
          if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
          const extracted = extractPositionsData(result);
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
    app.callServerTool({ name: "get-my-positions", arguments: {} })
      .then((result) => {
        if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
        const extracted = extractPositionsData(result);
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

  // ─── Refresh positions from server ──────────────────────────────

  const refreshPositions = useCallback(async () => {
    if (!app || typeof app.callServerTool !== "function") return;
    const result = await app.callServerTool({ name: "get-my-positions", arguments: {} });
    if (handleSubscriptionRedirect(result, app, setSubscribeUrl)) return;
    const extracted = extractPositionsData(result);
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
    setForm({ symbol: "", startDate: "", amount: "", avgEntryPrice: "", alloc: "", side: "long" });
    setFormErrors({});
    setIsEditing(false);
    setShowForm(true);
  }, []);

  const handleEditClick = useCallback((pos: UserPosition) => {
    setForm({
      symbol: pos.symbol,
      startDate: pos.startDate,
      amount: String(pos.amount),
      avgEntryPrice: pos.avgEntryPrice !== undefined ? String(pos.avgEntryPrice) : "",
      alloc: pos.alloc !== undefined ? String(pos.alloc) : "",
      side: pos.side ?? "long",
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
        amount: parseFloat(form.amount),
        side: form.side,
      };
      if (form.avgEntryPrice.trim()) {
        args.avgEntryPrice = parseFloat(form.avgEntryPrice);
      }
      if (form.alloc.trim()) {
        args.alloc = parseFloat(form.alloc);
      }
      await app.callServerTool({
        name: "set-my-position",
        arguments: args,
      });
      setShowForm(false);
      setFormErrors({});
      await refreshPositions();
    } catch (e) {
      console.error("Save failed:", e);
    } finally {
      setIsSaving(false);
    }
  }, [app, form, isEditing, refreshPositions]);

  const handleDelete = useCallback(async (symbol: string) => {
    if (!app || typeof app.callServerTool !== "function") return;
    setIsDeleting(symbol);
    try {
      await app.callServerTool({
        name: "delete-my-position",
        arguments: { symbol },
      });
      await refreshPositions();
    } catch (e) {
      console.error("Delete failed:", e);
    } finally {
      setIsDeleting(null);
    }
  }, [app, refreshPositions]);

  const handleFieldChange = useCallback((field: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormErrors((prev) => ({ ...prev, [field]: undefined }));
  }, []);

  // ─── Render ──────────────────────────────────────────────────────

  if (error) return <div className={styles.error}><strong>ERROR:</strong> {error.message}</div>;
  if (!app) return <div className={styles.loading}>{t("layout.connecting")}</div>;
  if (subscribeUrl !== null) return (
    <WidgetLayout title="TASE Market" app={app} hostContext={hostContext} language={language} dir={dir} onLanguageToggle={toggle}>
      <SubscriptionBanner subscribeUrl={subscribeUrl} app={app} />
    </WidgetLayout>
  );

  const positions = data?.positions ?? [];
  const isBusy = isSaving || isDeleting !== null;

  return (
    <WidgetLayout
      title={t("home.tool.myPositionsManager")}
      subtitle={data ? `${positions.length} position${positions.length !== 1 ? "s" : ""}` : undefined}
      app={app}
      hostContext={hostContext}
      language={language}
      dir={dir}
      onLanguageToggle={toggle}
    >
      {!showForm && (
        <div className={styles.addBtnWrapper}>
          <button className={styles.addBtn} onClick={handleAddClick} disabled={isBusy}>
            {t("positions.addBtn")}
          </button>
        </div>
      )}

      <div className={styles.navRow}>
        {[
          { label: t("nav.table"), prompt: "call show-my-position-table-widget" },
          { label: t("nav.candlestick"), prompt: "call show-my-position-candlestick-widget" },
          { label: t("nav.endOfDay"), prompt: "call show-my-position-end-of-day-widget" },
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
          <div className={styles.formTitle}>{isEditing ? t("positions.editPosition") : t("positions.addPosition")}</div>
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
              {t("positions.startDate")}
              <input
                className={`${styles.input} ${formErrors.startDate ? styles.inputError : ""}`}
                value={form.startDate}
                onChange={(e) => handleFieldChange("startDate", e.target.value)}
                placeholder="YYYY-MM-DD"
                maxLength={10}
              />
              {formErrors.startDate && <span className={styles.fieldError}>{formErrors.startDate}</span>}
            </label>
            <label className={styles.label}>
              {t("positions.amount")}
              <input
                className={`${styles.input} ${formErrors.amount ? styles.inputError : ""}`}
                type="number"
                min="0"
                step="any"
                value={form.amount}
                onChange={(e) => handleFieldChange("amount", e.target.value)}
                placeholder="e.g. 100"
              />
              {formErrors.amount && <span className={styles.fieldError}>{formErrors.amount}</span>}
            </label>
            <label className={styles.label}>
              {t("positions.avgEntryPrice")}
              <input
                className={`${styles.input} ${formErrors.avgEntryPrice ? styles.inputError : ""}`}
                type="number"
                min="0"
                step="any"
                value={form.avgEntryPrice}
                onChange={(e) => handleFieldChange("avgEntryPrice", e.target.value)}
                placeholder="e.g. 52.30"
              />
              {formErrors.avgEntryPrice && <span className={styles.fieldError}>{formErrors.avgEntryPrice}</span>}
            </label>
            <label className={styles.label}>
              {t("positions.allocPct")}
              <input
                className={`${styles.input} ${formErrors.alloc ? styles.inputError : ""}`}
                type="number"
                min="0"
                max="100"
                step="any"
                value={form.alloc}
                onChange={(e) => handleFieldChange("alloc", e.target.value)}
                placeholder="e.g. 25"
              />
              {formErrors.alloc && <span className={styles.fieldError}>{formErrors.alloc}</span>}
            </label>
            <label className={styles.label}>
              {t("positions.side")}
              <div className={styles.sideToggle}>
                <button
                  type="button"
                  className={`${styles.sideBtn} ${form.side === "long" ? styles.sideBtnActive : ""}`}
                  onClick={() => setForm((prev) => ({ ...prev, side: "long" }))}
                >
                  {t("positions.long")}
                </button>
                <button
                  type="button"
                  className={`${styles.sideBtn} ${form.side === "short" ? styles.sideBtnActiveShort : ""}`}
                  onClick={() => setForm((prev) => ({ ...prev, side: "short" }))}
                >
                  {t("positions.short")}
                </button>
              </div>
            </label>
          </div>
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
        <div className={styles.loading}>{t("common.loadingPositions")}</div>
      ) : !authError && positions.length === 0 ? (
        <div className={styles.empty}>{t("positions.noPositions")}</div>
      ) : !authError ? (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={`${styles.th} ${styles.thLeft}`}>{t("eod.col.symbol")}</th>
                <th className={`${styles.th} ${styles.thLeft}`}>{t("positions.side")}</th>
                <th className={`${styles.th} ${styles.thLeft}`}>{t("positions.startDate")}</th>
                <th className={styles.th}>{t("positions.amount")}</th>
                <th className={styles.th}>{t("positions.avgEntryPrice")}</th>
                <th className={styles.th}>{t("positions.allocPct")}</th>
                <th className={`${styles.th} ${styles.thActions}`}>{t("positions.actions")}</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => {
                return (
                <tr key={pos.symbol} className={styles.tr}>
                  <td className={`${styles.tdLeft} ${styles.tdSymbol}`}>{pos.symbol}</td>
                  <td className={styles.tdLeft}>
                    <span className={pos.side === "short" ? styles.sideShort : styles.sideLong}>
                      {(pos.side ?? "long").toUpperCase()}
                    </span>
                  </td>
                  <td className={styles.tdLeft}>{pos.startDate}</td>
                  <td className={styles.td}>{fmtAmount(pos.amount)}</td>
                  <td className={styles.td}>{fmtPrice(pos.avgEntryPrice)}</td>
                  <td className={styles.td}>{pos.alloc !== undefined ? pos.alloc.toFixed(1) + "%" : "—"}</td>
                  <td className={styles.tdActions}>
                    <button
                      className={styles.editBtn}
                      onClick={() => handleEditClick(pos)}
                      disabled={isBusy}
                    >
                      {t("common.edit")}
                    </button>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => handleDelete(pos.symbol)}
                      disabled={isBusy}
                    >
                      {isDeleting === pos.symbol ? "..." : t("common.delete")}
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
    <MyPositionsManagerApp />
  </StrictMode>,
);
