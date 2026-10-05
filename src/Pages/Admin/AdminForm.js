import "./umova-theme.css";
import "./AdminPages.css";

// Small helpers shared by the Money pages.

// <Field label="Amount"><input .../></Field> — the label wraps the control, so
// tapping the label focuses it. Styled by umova-theme.css (.ua-field) + .up-label.
export function Field({ label, hint, span2, children }) {
  return (
    <label className={`ua-field ${span2 ? "span-2" : ""}`}>
      <span className="up-label">{label}</span>
      {children}
      {hint && <small className="up-hint">{hint}</small>}
    </label>
  );
}

export const kes = (v) =>
  Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Supplier/customer invoices and fixed assets. An "approved" invoice is posted
// but still unpaid, so it reads as a warning, not a success.
export function statusTone(s) {
  const v = String(s || "").toLowerCase();
  if (["paid", "active"].includes(v)) return "success";
  if (["approved", "partially_paid", "pending"].includes(v)) return "warning";
  if (["rejected", "cancelled", "disposed", "failed"].includes(v)) return "danger";
  return "neutral";
}
// General-ledger rows (Withdrawal history): APPROVED is the finished state.
export const ledgerTone = (s) => (String(s).toUpperCase() === "APPROVED" ? "success" : String(s).toUpperCase() === "POSTED" ? "neutral" : "warning");
export const statusLabel = (s) => String(s || "—").replace(/_/g, " ");
