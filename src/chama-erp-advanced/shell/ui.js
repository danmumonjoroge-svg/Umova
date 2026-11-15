import React, { useState } from "react";
import { ArrowLeft, ChevronRight, ChevronDown, Loader2, WifiOff, Info } from "lucide-react";

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

// -----------------------------------------------------------------------------
// Card + sub-card building blocks. A page is a short stack of <Panel>s (cards),
// and each Panel holds <SubCard>s / <Stat>s / <SubCardList> rows — so no page is
// one long scroll of loose content. Panels fold shut (tap the header) to keep
// long screens short; print always opens them.
// -----------------------------------------------------------------------------
export function Panel({ icon: Icon, title, subtitle, right, badge, tone = "", defaultOpen = true, collapsible = true, children, className = "" }) {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;
  const head = (
    <>
      {Icon && <span className="cm-panel-icon"><Icon size={18} /></span>}
      <span className="cm-panel-titles">
        <span className="cm-panel-title">{title}{badge != null && badge !== "" ? <em className="cm-badge">{badge}</em> : null}</span>
        {subtitle && <span className="cm-panel-sub">{subtitle}</span>}
      </span>
      {right && <span className="cm-panel-right" onClick={(e) => e.stopPropagation()}>{right}</span>}
      {collapsible && <ChevronDown size={18} className="cm-panel-chev" />}
    </>
  );
  return (
    <section className={`cm-panel ${tone} ${isOpen ? "open" : ""} ${className}`}>
      {collapsible
        ? (right
            // A <button> may not contain another <button>, so when the header
            // carries a `right` action it is a div acting as the toggle.
            ? <div role="button" tabIndex={0} className="cm-panel-head" aria-expanded={isOpen}
                onClick={() => setOpen((v) => !v)}
                onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setOpen((v) => !v); } }}>{head}</div>
            : <button type="button" className="cm-panel-head" onClick={() => setOpen((v) => !v)} aria-expanded={isOpen}>{head}</button>)
        : <div className="cm-panel-head static">{head}</div>}
      <div className="cm-panel-body">{children}</div>
    </section>
  );
}

// A smaller card nested inside a Panel. Pass children to put detail inside it.
export function SubCard({ icon: Icon, title, value, sub, tone = "", right, onClick, children }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} className={`cm-sub ${tone} ${onClick ? "tap" : ""}`} onClick={onClick}>
      <span className="cm-sub-top">
        {Icon && <span className="cm-sub-icon"><Icon size={15} /></span>}
        <span className="cm-sub-main">
          <span className="cm-sub-title">{title}</span>
          {sub && <span className="cm-sub-sub">{sub}</span>}
        </span>
        {value != null && <strong className="cm-sub-value">{value}</strong>}
        {right}
        {onClick && <ChevronRight size={15} className="cm-sub-go" />}
      </span>
      {children && <span className="cm-sub-detail">{children}</span>}
    </Tag>
  );
}

export const SubCardList = ({ children }) => <div className="cm-sublist">{children}</div>;

// Small number tiles (replaces long label/value tables).
export const StatGrid = ({ children, cols }) => <div className={`cm-stats ${cols ? `c${cols}` : ""}`}>{children}</div>;
export const Stat = ({ label, value, sub, tone = "" }) => (
  <div className={`cm-stat ${tone}`}><span>{label}</span><strong>{value}</strong>{sub && <small>{sub}</small>}</div>
);

// Tabs for splitting one long page into a few short ones.
export function TabBar({ tabs, value, onChange }) {
  return (
    <div className="cm-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} className={`cm-tab ${value === t.key ? "on" : ""}`} onClick={() => onChange(t.key)}>
          {t.icon && <t.icon size={14} />}{t.label}{t.count != null && t.count !== "" ? <em>{t.count}</em> : null}
        </button>
      ))}
    </div>
  );
}
