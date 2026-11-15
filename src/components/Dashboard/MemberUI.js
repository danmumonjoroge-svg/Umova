// src/components/Dashboard/MemberUI.js
//
// Shared building blocks for the member pages, so Savings / Shares / Loans / Statement / Profile look like the
// home screen: a balance hero, grouped cards, sub-cards, month-grouped transaction lists. Presentation only:
// no data fetching and no business logic lives here. Styles are in MemberUI.css, scoped to `.mu`.

import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowDownLeft, ArrowUpRight, Search, AlertCircle, ShieldCheck, ChevronDown } from "lucide-react";
import "./MemberUI.css";

export const kes = (n) => `KES ${Number(n || 0).toLocaleString()}`;

/** Balance hero: the one number the page is about, plus glass sub-cards for the supporting figures. */
export function PageHero({ eyebrow, title, chip, label, amount, note, subs = [] }) {
  return (
    <section className="mu-hero" aria-label={label}>
      {(eyebrow || title || chip) && (
        <div className="mu-hero-top">
          <div>
            {eyebrow && <p className="mu-eyebrow">{eyebrow}</p>}
            {title && <h1 className="mu-title">{title}</h1>}
          </div>
          {chip && <span className="mu-chip"><ShieldCheck size={12} /> {chip}</span>}
        </div>
      )}
      <div className="mu-hero-main">
        <span className="mu-hero-label">{label}</span>
        <span className="mu-hero-amt">{amount}</span>
        {note && <span className="mu-hero-note">{note}</span>}
      </div>
      {subs.length > 0 && (
        <div className="mu-hero-subs" style={{ gridTemplateColumns: `repeat(${Math.min(subs.length, 2)}, minmax(0, 1fr))` }}>
          {subs.map((s) => (
            <div key={s.label} className="mu-glass">
              <span className="mu-glass-label">{s.label}</span>
              <span className="mu-glass-amt">{s.value}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Switch between a few views of one page (e.g. Savings / Shares / Loans). Labels only, so it always fits a phone. */
export function Tabs({ items, value, onChange, label = "View" }) {
  return (
    <div className="mu-tabs" role="tablist" aria-label={label}>
      {items.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={value === t.key}
          className={`mu-tab${value === t.key ? " on" : ""}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** A card whose body is hidden until tapped: keeps detail figures one tap away instead of on screen all at once. */
export function Collapse({ icon: Icon, title, hint, span = false, children }) {
  return (
    <details className={`mu-card mu-collapse${span ? " mu-span" : ""}`}>
      <summary className="mu-card-head">
        {Icon && <span className="mu-ico"><Icon size={18} /></span>}
        <div className="mu-card-titles">
          <h2>{title}</h2>
          {hint && <p className="mu-card-sub">{hint}</p>}
        </div>
        <ChevronDown size={18} className="mu-collapse-chev" />
      </summary>
      <div className="mu-collapse-body">{children}</div>
    </details>
  );
}

/** A titled card that groups related content. */
export function Card({ icon: Icon, title, hint, right, span = false, children }) {
  return (
    <section className={`mu-card${span ? " mu-span" : ""}`}>
      {(title || Icon) && (
        <header className="mu-card-head">
          {Icon && <span className="mu-ico"><Icon size={18} /></span>}
          <div className="mu-card-titles">
            <h2>{title}</h2>
            {hint && <p className="mu-card-sub">{hint}</p>}
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

/** A small tile inside a card: label, value, optional note. Becomes a link or a button when given `to` / `onClick`. */
export function SubCard({ label, value, note, tone, to, onClick, icon: Icon }) {
  const body = (
    <>
      <span className="mu-sub-label">{Icon && <Icon size={14} />}{label}</span>
      {value != null && <span className={`mu-sub-value${tone ? ` ${tone}` : ""}`}>{value}</span>}
      {note && <span className={`mu-sub-note${tone ? ` ${tone}` : ""}`}>{note}</span>}
    </>
  );
  if (to) return <Link to={to} className="mu-sub">{body}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className="mu-sub">{body}</button>;
  return <div className="mu-sub">{body}</div>;
}

export const SubGrid = ({ cols = 2, children }) => (
  <div className={`mu-subgrid cols-${cols}`} style={{ "--cols": cols }}>{children}</div>
);

/** Read-only profile-style row. */
export function Field({ label, value, mono = false }) {
  return (
    <div className="mu-field">
      <span className="mu-field-label">{label}</span>
      <span className={`mu-field-value${mono ? " mono" : ""}`}>{value || <i>Not provided</i>}</span>
    </div>
  );
}

export function Pill({ tone = "gold", children }) {
  return <span className={`mu-pill mu-pill--${tone}`}>{children}</span>;
}

export function ProgressBar({ percent = 0 }) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  return (
    <div className="mu-progress" role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}>
      <div className="mu-progress-fill" style={{ width: `${p}%` }} />
    </div>
  );
}

export function SearchBar({ value, onChange, placeholder }) {
  return (
    <label className="mu-search">
      <Search size={16} />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder} />
    </label>
  );
}

export function PageLoading({ text = "Loading…" }) {
  return (
    <div className="mu mu-center" role="status">
      <div className="mu-spin" />
      <p className="mu-note">{text}</p>
    </div>
  );
}

export function PageNotice({ tone = "bad", title, children, action }) {
  return (
    <div className="mu">
      <div className={`mu-notice mu-notice--${tone}`}>
        <AlertCircle size={20} />
        <div>
          <b>{title}</b>
          {children && <p>{children}</p>}
          {action}
        </div>
      </div>
    </div>
  );
}

const monthKey = (d) => {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "undated" : `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (d) => {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? "Undated" : dt.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
};
const dayLabel = (d) => {
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? String(d || "—") : dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
};

/**
 * Transactions grouped by month, in the order given (pass newest first).
 * rows: [{ id, date, ref, desc, mode, amount, isIn, balance }]
 */
export function StatementList({ rows, empty = "No transactions yet.", money = (n) => Number(n || 0).toLocaleString() }) {
  const groups = useMemo(() => {
    const out = [];
    const byKey = new Map();
    rows.forEach((r) => {
      const k = monthKey(r.date);
      if (!byKey.has(k)) { const g = { key: k, label: monthLabel(r.date), inn: 0, out: 0, items: [] }; byKey.set(k, g); out.push(g); }
      const g = byKey.get(k);
      g.items.push(r);
      if (r.isIn) g.inn += Number(r.amount || 0); else g.out += Number(r.amount || 0);
    });
    return out;
  }, [rows]);

  if (rows.length === 0) return <p className="mu-empty">{empty}</p>;

  return (
    <div className="mu-list">
      {groups.map((g) => (
        <section key={g.key} className="mu-month">
          <header className="mu-month-head">
            <b>{g.label}</b>
            <span>
              {g.inn > 0 && <i className="in">+{money(g.inn)}</i>}
              {g.out > 0 && <i className="out">−{money(g.out)}</i>}
            </span>
          </header>
          <ul>
            {g.items.map((r) => (
              <li key={r.id} className="mu-tx">
                <span className={`mu-tx-ico ${r.isIn ? "in" : "out"}`}>{r.isIn ? <ArrowUpRight size={16} /> : <ArrowDownLeft size={16} />}</span>
                <span className="mu-tx-body">
                  <span className="mu-tx-desc">{r.desc}</span>
                  <span className="mu-tx-meta">{[dayLabel(r.date), r.ref, r.mode].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="mu-tx-amts">
                  <span className={`mu-tx-amt ${r.isIn ? "in" : "out"}`}>{r.isIn ? "+" : "−"}{money(r.amount)}</span>
                  {r.balance != null && <span className="mu-tx-bal">Bal {money(r.balance)}</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
