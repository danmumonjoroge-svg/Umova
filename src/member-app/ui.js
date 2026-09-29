import React from "react";
import { Link } from "react-router-dom";

export const kes = (n) =>
  `KES ${Number(n || 0).toLocaleString("en-KE", { maximumFractionDigits: 2 })}`;

export const shortDate = (d) => {
  const t = d ? new Date(d) : null;
  return t && !isNaN(t) && t.getFullYear() > 2000
    ? t.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })
    : "—";
};

export function PageHeader({ title, description }) {
  return (
    <header>
      <h1 className="uma-h1">{title}</h1>
      {description && <p className="uma-sub">{description}</p>}
    </header>
  );
}

export function Card({ title, amount, note, tone, children, to, cta }) {
  return (
    <section className={`uma-card${tone === "green" ? " uma-card--green" : ""}`}>
      {title && <h3>{title}</h3>}
      {amount !== undefined && <div className="uma-amt">{amount}</div>}
      {note && <div className="uma-note">{note}</div>}
      {children}
      {to && (
        <div className="uma-actions">
          <Link className={`uma-btn${tone === "green" ? " uma-btn--gold" : " uma-btn--ghost"}`} to={to}>{cta}</Link>
        </div>
      )}
    </section>
  );
}

// One transaction row, from a ledger row produced by useMemberLedger.
export function TxRow({ tx, label }) {
  const isIn = tx.direction === "in";
  return (
    <div className="uma-row">
      <div>
        <b>{tx.description || tx.narration || label}</b>
        <div className="uma-note">{shortDate(tx.date)}{label && tx.description ? ` · ${label}` : ""}</div>
      </div>
      <div className={isIn ? "uma-in" : "uma-out"} style={{ fontVariantNumeric: "tabular-nums", fontWeight: 600 }}>
        {isIn ? "+" : "−"}{Number(tx.amount || 0).toLocaleString("en-KE")}
      </div>
    </div>
  );
}

// Real balance history only: drawn from the ledger's own running balances.
// Fewer than 2 dated points → renders nothing (never implies history).
export function BalanceTrend({ transactions = [] }) {
  const pts = transactions
    .filter((t) => t.date && !isNaN(new Date(t.date)) && Number.isFinite(t.runningBalance))
    .slice(-24);
  if (pts.length < 2) return null;
  const vals = pts.map((p) => p.runningBalance);
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const w = 300, h = 70;
  const line = pts.map((p, i) => `${(i / (pts.length - 1)) * w},${h - 6 - ((p.runningBalance - min) / span) * (h - 12)}`).join(" ");
  return (
    <div style={{ marginTop: 12 }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} role="img" aria-label="Savings balance over time">
        <polyline points={line} fill="none" stroke="#237A52" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <div className="uma-note">Balance after each transaction · {shortDate(pts[0].date)} – {shortDate(pts[pts.length - 1].date)}</div>
    </div>
  );
}
