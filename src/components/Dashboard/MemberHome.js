// src/components/Dashboard/MemberHome.js
//
// The member HOME screen: one balance hero, then grouped cards with sub-cards, instead of one long page.
// Reads what DashboardMain already puts on the Outlet context (memberNo, ledgerMetrics, notifications...), so it
// needs no new queries. Every link is a registered /member route.
import React, { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { Wallet, LineChart, Landmark, FileText, User, Bell, ChevronDown, ShieldCheck, Coins } from "lucide-react";
import { useAuth } from "../../Context/AuthContext";
import ContactCard from "./ContactCard";
import "./MemberHome.css";

const kes = (n) => `KES ${Number(n || 0).toLocaleString()}`;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

/** A grouped card: a titled box holding related sub-cards (compact rows, no repeated balances). */
function Group({ icon: Icon, title, children, span = false, row = false }) {
  return (
    <section className={`mh-card${span ? " mh-span" : ""}`}>
      <header className="mh-card-head">
        <span className="mh-ico"><Icon size={18} /></span>
        <h2>{title}</h2>
      </header>
      <div className={`mh-subs${row ? " mh-subs--row" : ""}`}>{children}</div>
    </section>
  );
}

/** A sub-card: one tappable item inside a group. */
function Sub({ to, icon: Icon, label, note, good = false }) {
  return (
    <Link to={to} className="mh-sub">
      <span className="mh-sub-ico"><Icon size={16} /></span>
      <span className="mh-sub-body">
        <span className="mh-sub-label">{label}</span>
        {note && <span className={`mh-sub-note${good ? " good" : ""}`}>{note}</span>}
      </span>
    </Link>
  );
}

export default function MemberHome() {
  const { profile } = useAuth();
  const ctx = useOutletContext() || {};
  const { memberNo, ledgerMetrics = {}, ledgerLoading = false, notifications = [], unreadNotifications = 0, markNotificationsSeen } = ctx;

  const [showUpdates, setShowUpdates] = useState(false);
  const name = profile?.name || "";
  const firstName = name.trim().split(/\s+/)[0] || "Member";
  const loanActive = (ledgerMetrics.loans || 0) > 0;
  const show = (n) => (ledgerLoading ? "…" : kes(n));

  const toggleUpdates = () => {
    setShowUpdates((v) => !v);
    if (!showUpdates && markNotificationsSeen) markNotificationsSeen();
  };

  return (
    <div className="mh">
      {/* ── HERO: the one number members look for, with the other two as sub-cards ── */}
      <section className="mh-hero" aria-label="Balances">
        <div className="mh-hero-top">
          <div>
            <p className="mh-hi">{greeting()},</p>
            <h1 className="mh-name">{firstName}</h1>
          </div>
          {(memberNo || profile?.member_no) && <span className="mh-chip"><ShieldCheck size={12} /> {memberNo || profile?.member_no}</span>}
        </div>

        <Link to="/member/savings" className="mh-hero-main">
          <span className="mh-hero-label">Savings balance</span>
          <span className="mh-hero-amt">{show(ledgerMetrics.savings)}</span>
        </Link>

        <div className="mh-hero-subs">
          <Link to="/member/shares" className="mh-glass">
            <span className="mh-glass-label">Share capital</span>
            <span className="mh-glass-amt">{show(ledgerMetrics.shares)}</span>
          </Link>
          <Link to="/member/loans" className="mh-glass">
            <span className="mh-glass-label">Loan balance</span>
            <span className="mh-glass-amt">{show(ledgerMetrics.loans)}</span>
          </Link>
        </div>
      </section>

      <section className="mh-card mh-strip">
        <button type="button" className="mh-card-head mh-card-head--btn" onClick={toggleUpdates} aria-expanded={showUpdates}>
          <span className="mh-ico"><Bell size={18} /></span>
          <div>
            <h2>Updates</h2>
            <p className={`mh-card-sub${unreadNotifications > 0 ? " new" : ""}`}>
              {unreadNotifications > 0 ? `${unreadNotifications} new` : notifications.length ? "All read" : "Nothing new"}
            </p>
          </div>
          <ChevronDown size={18} className={`mh-chev${showUpdates ? " mh-rot" : ""}`} />
        </button>
        {showUpdates && (
          <ul className="mh-updates">
            {notifications.length === 0 && <li className="mh-note">No notifications yet.</li>}
            {notifications.slice(0, 5).map((n, i) => (
              <li key={n.id || i}>
                <b>{n.title || "Notification"}</b>
                <span>{n.message || n.body}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mh-grid">
        <Group icon={Wallet} title="Money">
          <Sub to="/member/savings" icon={Wallet} label="Savings" />
          <Sub to="/member/shares" icon={LineChart} label="Shares" />
        </Group>

        <Group icon={Landmark} title="Loans">
          <Sub to="/member/loans" icon={Landmark} label="My loans" note={loanActive ? "Active" : "Clear"} good={!loanActive} />
          <Sub to="/member/loans" icon={Coins} label="Repayments" note={show(ledgerMetrics.interest)} />
        </Group>

        <Group icon={FileText} title="Account" span row>
          <Sub to="/member/statement" icon={FileText} label="Statement" />
          <Sub to="/member/profile" icon={User} label="Profile" />
        </Group>

        <ContactCard name={name} memberNo={memberNo || profile?.member_no} />
      </div>
    </div>
  );
}
