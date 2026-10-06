import { useMemo, useState } from "react";
import "./umova-theme.css";

// Shared Admin UI primitives. Styles live in umova-theme.css (ua-* classes).

export function AdminPageHeader({ title, subtitle, actions }) {
  return (
    <div className="ua-page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {actions && <div className="ua-page-header-actions">{actions}</div>}
    </div>
  );
}

export function SectionCard({ title, subtitle, actions, children }) {
  return (
    <section className="ua-card">
      {(title || actions) && (
        <div className="ua-card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <div className="ua-card-sub">{subtitle}</div>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

// trend: optional { text, direction: "up" | "down" }. Pass only real,
// computed values — never placeholder trends.
export function KpiCard({ label, value, foot, trend }) {
  return (
    <div className="ua-kpi">
      <div className="ua-kpi-label">{label}</div>
      <div className="ua-kpi-value">{value}</div>
      {trend ? (
        <div className={`ua-kpi-foot ${trend.direction || ""}`}>{trend.text}</div>
      ) : (
        foot && <div className="ua-kpi-foot">{foot}</div>
      )}
    </div>
  );
}

export function PrimaryButton({ children, block, className = "", ...rest }) {
  return (
    <button type="button" className={`ua-btn ua-btn-primary ${block ? "ua-btn-block" : ""} ${className}`} {...rest}>
      {children}
    </button>
  );
}

export function SecondaryButton({ children, block, className = "", ...rest }) {
  return (
    <button type="button" className={`ua-btn ua-btn-secondary ${block ? "ua-btn-block" : ""} ${className}`} {...rest}>
      {children}
    </button>
  );
}

// tone: success | warning | danger | neutral
export function StatusBadge({ tone = "neutral", children }) {
  return <span className={`ua-badge ua-badge-${tone}`}>{children}</span>;
}

export function EmptyState({ title = "Nothing here yet", message }) {
  return (
    <div className="ua-empty">
      <strong>{title}</strong>
      {message}
    </div>
  );
}

export function LoadingState({ message = "Loading…" }) {
  return (
    <div className="ua-loading" role="status">
      <div className="ua-spinner" />
      {message}
    </div>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}) {
  if (!open) return null;
  return (
    <div className="ua-dialog-backdrop" onClick={onCancel}>
      <div className="ua-dialog" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p>{message}</p>
        <div className="ua-dialog-actions">
          <button type="button" className="ua-btn ua-btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`ua-btn ${danger ? "ua-btn-danger" : "ua-btn-primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ───────── shared helpers for form/list pages ─────────

export const kes = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const todayISO = () => new Date().toISOString().slice(0, 10);

// Inline result message. result = { ok: boolean, text: string } | null.
// Pages set ok:true ONLY after the post/save promise has resolved.
export function Banner({ result, onClose }) {
  if (!result) return null;
  return (
    <div className={`ua-banner ${result.ok ? "ok" : "bad"}`} role="status">
      <span>{result.text}</span>
      <button type="button" onClick={onClose} aria-label="Dismiss">✕</button>
    </div>
  );
}

// Page wrapper: consistent padding/width, intro line, optional banner.
export function Page({ intro, result, onCloseResult, children }) {
  return (
    <div className="ua-page">
      {intro && <p className="ua-intro">{intro}</p>}
      <Banner result={result} onClose={onCloseResult} />
      {children}
    </div>
  );
}

// Labelled form field. span2 = full width on tablet+ two-column forms.
export function Field({ label, hint, span2, htmlFor, children }) {
  return (
    <div className={`ua-field ${span2 ? "span-2" : ""}`}>
      {label && <label htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && <small className="ua-hint">{hint}</small>}
    </div>
  );
}

// Segmented tabs / choice buttons. items: [{ key, label, count? }]
export function Tabs({ value, onChange, items, className = "" }) {
  return (
    <div className={`ua-tabs ${className}`} role="tablist">
      {items.map((it) => (
        <button key={it.key} type="button" role="tab" aria-selected={value === it.key}
          className={value === it.key ? "on" : ""} onClick={() => onChange(it.key)}>
          {it.label}{it.count != null && <span className="ua-tab-count">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

// Member search + select (replaces the unusable "all members" dropdown).
export function MemberPicker({ members, value, onChange, label = "Member", id = "ua-member" }) {
  const [q, setQ] = useState("");
  const selected = members.find((m) => m.member_no === value) || null;
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s || selected) return [];
    return members.filter((m) => `${m.member_no} ${m.name || ""}`.toLowerCase().includes(s)).slice(0, 6);
  }, [members, q, selected]);

  return (
    <div className="ua-field">
      <label htmlFor={id}>{label}</label>
      {selected ? (
        <div className="ua-chip">
          <div><strong>{selected.name || selected.member_no}</strong><small>{selected.member_no}</small></div>
          <button type="button" onClick={() => { onChange(""); setQ(""); }}>Change</button>
        </div>
      ) : (
        <>
          <input id={id} type="search" autoComplete="off" placeholder="Search name or member no."
            value={q} onChange={(e) => setQ(e.target.value)} />
          {matches.length > 0 && (
            <ul className="ua-matches">
              {matches.map((m) => (
                <li key={m.id || m.member_no}>
                  <button type="button" onClick={() => { onChange(m.member_no); setQ(""); }}>
                    <strong>{m.name || "—"}</strong><small>{m.member_no}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {q.trim() && matches.length === 0 && <small className="ua-hint">No member matches “{q}”.</small>}
        </>
      )}
    </div>
  );
}
