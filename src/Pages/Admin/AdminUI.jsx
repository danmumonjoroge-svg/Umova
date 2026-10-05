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
