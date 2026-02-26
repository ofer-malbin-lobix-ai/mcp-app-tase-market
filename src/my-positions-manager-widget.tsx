/**
 * My Positions Manager Widget
 * Allows users to add, edit, and delete portfolio positions stored in Clerk privateMetadata.
 * Columns: Symbol | Start Date | Amount | Actions (Edit / Delete)
 */
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import styles from "./my-positions-manager-widget.module.css";

// ─── Types ──────────────────────────────────────────────────────────

interface UserPosition {
  symbol: string;
  startDate: string;
  amount: number;
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
}

interface FormErrors {
  symbol?: string;
  startDate?: string;
  amount?: string;
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

// ─── Validation ──────────────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateForm(form: FormState, isEdit: boolean): FormErrors {
  const errors: FormErrors = {};
  if (!isEdit && !form.symbol.trim()) {
    errors.symbol = "Symbol is required";
  }
  if (!DATE_RE.test(form.startDate)) {
    errors.startDate = "Date must be YYYY-MM-DD";
  }
  const amount = parseFloat(form.amount);
  if (isNaN(amount) || amount <= 0) {
    errors.amount = "Amount must be a positive number";
  }
  return errors;
}

// ─── Main App ────────────────────────────────────────────────────────

function MyPositionsManagerApp() {
  const [data, setData] = useState<UserPositionsData | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [needsAutoFetch, setNeedsAutoFetch] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [form, setForm] = useState<FormState>({ symbol: "", startDate: "", amount: "" });
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState<string | null>(null);

  const { app, error } = useApp({
    appInfo: { name: "My Positions Manager", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (app) => {
      app.onteardown = async () => ({});
      app.ontoolinput = async () => {};

      app.ontoolresult = async (result) => {
        try {
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
    },
  });

  // Auto-fetch fallback
  useEffect(() => {
    if (!needsAutoFetch || !app) return;
    setNeedsAutoFetch(false);
    if (typeof app.callServerTool !== "function") return;
    app.callServerTool({ name: "get-user-positions", arguments: {} })
      .then((result) => {
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

  // ─── Refresh positions from server ──────────────────────────────

  const refreshPositions = useCallback(async () => {
    if (!app || typeof app.callServerTool !== "function") return;
    const result = await app.callServerTool({ name: "get-user-positions", arguments: {} });
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
    setForm({ symbol: "", startDate: "", amount: "" });
    setFormErrors({});
    setIsEditing(false);
    setShowForm(true);
  }, []);

  const handleEditClick = useCallback((pos: UserPosition) => {
    setForm({ symbol: pos.symbol, startDate: pos.startDate, amount: String(pos.amount) });
    setFormErrors({});
    setIsEditing(true);
    setShowForm(true);
  }, []);

  const handleCancel = useCallback(() => {
    setShowForm(false);
    setFormErrors({});
  }, []);

  const handleSave = useCallback(async () => {
    const errors = validateForm(form, isEditing);
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    if (!app || typeof app.callServerTool !== "function") return;
    setIsSaving(true);
    try {
      await app.callServerTool({
        name: "set-user-position",
        arguments: {
          symbol: form.symbol.trim().toUpperCase(),
          startDate: form.startDate,
          amount: parseFloat(form.amount),
        },
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
        name: "delete-user-position",
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
  if (!app) return <div className={styles.loading}>Connecting...</div>;

  const positions = data?.positions ?? [];
  const isBusy = isSaving || isDeleting !== null;

  return (
    <main className={styles.main}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>My Positions Manager</h1>
          {data && (
            <div className={styles.subtitle}>
              {positions.length} position{positions.length !== 1 ? "s" : ""}
            </div>
          )}
        </div>
        {!showForm && (
          <button className={styles.addBtn} onClick={handleAddClick} disabled={isBusy}>
            + Add Position
          </button>
        )}
      </div>

      {authError && (
        <div className={styles.authError}>
          <strong>Authentication required:</strong> {authError}
        </div>
      )}

      {!authError && showForm && (
        <div className={styles.formPanel}>
          <div className={styles.formTitle}>{isEditing ? "Edit Position" : "Add Position"}</div>
          <div className={styles.formRow}>
            <label className={styles.label}>
              Symbol
              <input
                className={`${styles.input} ${formErrors.symbol ? styles.inputError : ""}`}
                value={form.symbol}
                onChange={(e) => handleFieldChange("symbol", e.target.value)}
                disabled={isEditing}
                placeholder="e.g. TEVA"
                maxLength={20}
              />
              {formErrors.symbol && <span className={styles.fieldError}>{formErrors.symbol}</span>}
            </label>
            <label className={styles.label}>
              Start Date
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
              Amount
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
          </div>
          <div className={styles.formActions}>
            <button className={styles.saveBtn} onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving..." : "Save"}
            </button>
            <button className={styles.cancelBtn} onClick={handleCancel} disabled={isSaving}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {!authError && !data ? (
        <div className={styles.loading}>Loading positions...</div>
      ) : !authError && positions.length === 0 ? (
        <div className={styles.empty}>No positions yet. Click "+ Add Position" to get started.</div>
      ) : !authError ? (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={`${styles.th} ${styles.thLeft}`}>Symbol</th>
                <th className={`${styles.th} ${styles.thLeft}`}>Start Date</th>
                <th className={styles.th}>Amount</th>
                <th className={`${styles.th} ${styles.thActions}`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => (
                <tr key={pos.symbol} className={styles.tr}>
                  <td className={`${styles.tdLeft} ${styles.tdSymbol}`}>{pos.symbol}</td>
                  <td className={styles.tdLeft}>{pos.startDate}</td>
                  <td className={styles.td}>{fmtAmount(pos.amount)}</td>
                  <td className={styles.tdActions}>
                    <button
                      className={styles.editBtn}
                      onClick={() => handleEditClick(pos)}
                      disabled={isBusy}
                    >
                      Edit
                    </button>
                    <button
                      className={styles.deleteBtn}
                      onClick={() => handleDelete(pos.symbol)}
                      disabled={isBusy}
                    >
                      {isDeleting === pos.symbol ? "..." : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MyPositionsManagerApp />
  </StrictMode>,
);
