import React from "react";
import { ArrowLeft, ChevronRight, Loader2, WifiOff, Info } from "lucide-react";

export const Spinner = ({ label }) => (
  <div className="cm-loading"><Loader2 size={22} className="spin" />{label && <span>{label}</span>}</div>
);

// A card that is an action, not a KPI box: icon, title, live value, one verb.
export function ActionCard({ icon: Icon, title, value, sub, action, onClick, tone = "", badge, disabled }) {
  return (
    <button type="button" className={`cm-card ${tone}`} onClick={onClick} disabled={disabled}>
      <span className="cm-card-icon">{Icon && <Icon size={20} />}</span>
      <span className="cm-card-body">
        <span className="cm-card-title">{title}{badge ? <em className="cm-badge">{badge}</em> : null}</span>
        {value != null && <span className="cm-card-value">{value}</span>}
        {sub && <span className="cm-card-sub">{sub}</span>}
        {action && <span className="cm-card-action">{action} <ChevronRight size={14} /></span>}
      </span>
    </button>
  );
}

export const CardGrid = ({ children }) => <div className="cm-card-grid">{children}</div>;

export const SectionTitle = ({ children, right }) => (
  <div className="cm-section-title"><h3>{children}</h3>{right}</div>
);

// Sub-screen frame: back control + title, used on every workspace sub-view.
export function ViewFrame({ title, onBack, backLabel = "Back", children }) {
  return (
    <div className="cm-view">
      <div className="cm-view-head">
        <button type="button" className="cm-back" onClick={onBack} aria-label={backLabel}><ArrowLeft size={18} /> <span>{backLabel}</span></button>
        <h2>{title}</h2>
      </div>
      <div className="cm-view-body">{children}</div>
    </div>
  );
}

export const WorkspaceHeader = ({ title, subtitle }) => (
  <div className="cm-ws-head"><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
);

export const EmptyState = ({ icon: Icon = Info, children }) => (
  <div className="cm-empty"><Icon size={22} /><p>{children}</p></div>
);

export const Notice = ({ tone = "info", icon: Icon = Info, children }) => (
  <div className={`cm-notice ${tone}`}><Icon size={15} /><div>{children}</div></div>
);

// Shown whenever what's on screen came from this device's cache, not the server.
export function StaleNote({ fromCache, cachedAt, online }) {
  if (!fromCache) return null;
  const when = cachedAt ? new Date(cachedAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "earlier";
  return (
    <Notice tone="warn" icon={WifiOff}>
      {online ? "Refreshing… showing what was saved on this device" : "You're offline. Showing what was saved on this device"} ({when}). Figures may be out of date.
    </Notice>
  );
}

export const Pill = ({ tone = "neutral", children }) => <span className={`cm-pill ${tone}`}>{children}</span>;
