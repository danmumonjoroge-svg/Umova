import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ChevronRight, LogOut, Power, Search } from "lucide-react";
import { canExitApp, exitApp } from "../../utils/exitApp";
import { useAuth } from "../../Context/AuthContext";
import { supabase } from "../../supabaseClient";
import {
  APPROVER_ROLES, MORE_KEYS, adminPath, hubPath, moduleByKey, visibleNav,
} from "./adminNav";
import useElimuOwner from "./useElimuOwner";
import "./umova-theme.css";

// Pending counts shown as small badges on cards (approvers only, real data).
function usePendingBadges(isApprover) {
  const [b, setB] = useState({});
  useEffect(() => {
    if (!isApprover) return;
    let alive = true;
    (async () => {
      const out = {};
      try {
        const { data } = await supabase.rpc("list_pos_tenants", { p_status: "pending" });
        if ((data || []).length) out["pos-tenants"] = data.length;
      } catch (e) { /* no badge */ }
      try {
        const { count } = await supabase
          .from("pos_registration_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
        if (count) out["pos-requests"] = count;
      } catch (e) { /* no badge */ }
      try {
        const { data, error } = await supabase.rpc("elimu_owner_unread");
        if (!error && Number(data) > 0) out["elimu/support"] = Number(data);
      } catch (e) { /* not an Elimu owner: no badge */ }
      if (out["pos-tenants"] || out["pos-requests"]) out["pos-admin"] = (out["pos-tenants"] || 0) + (out["pos-requests"] || 0);
      if (alive) setB(out);
    })();
    return () => { alive = false; };
  }, [isApprover]);
  return b;
}

function Badge({ n }) {
  return n ? <span className="ua-hub-badge">{n}</span> : null;
}

// Workspace page: a module's screens as small cards (Money, Loans, Members,
// Accounting, Reports, POS) and the "More" tab, whose rows expand into
// sub-cards so nothing needs a long scrolling list.
export default function AdminHub() {
  const { module } = useParams();
  const { role, logout } = useAuth();
  const isApprover = APPROVER_ROLES.includes(role);
  const elimuOwner = useElimuOwner(isApprover);
  const nav = useMemo(() => visibleNav(isApprover, elimuOwner), [isApprover, elimuOwner]);
  const badges = usePendingBadges(isApprover);
  const [q, setQ] = useState("");
  const [openKey, setOpenKey] = useState(null);

  if (module === "more") {
    const items = MORE_KEYS.map(moduleByKey)
      .map((m) => nav.find((n) => n.key === m?.key))
      .filter(Boolean);
    const s = q.trim().toLowerCase();
    const match = (n) =>
      !s || `${n.label} ${n.blurb || n.desc || ""}`.toLowerCase().includes(s) ||
      (n.children || []).some((c) => `${c.label} ${c.desc}`.toLowerCase().includes(s));

    return (
      <div className="ua-hub">
        <div className="ua-hub-search">
          <Search size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a page…" aria-label="Find a page" />
        </div>

        <div className="ua-hub-list">
          {items.filter(match).map((n) => {
            const Icon = n.icon;
            const kids = n.children
              ? n.children.filter((c) => !s || `${n.label} ${c.label} ${c.desc}`.toLowerCase().includes(s))
              : null;
            const open = !!kids && (openKey === n.key || !!s);
            const total = (n.children || []).reduce((a, c) => a + (badges[c.to] || 0), 0);

            if (!n.children) {
              return (
                <Link key={n.key} to={adminPath(n.to)} className="ua-hub-row">
                  <span className="ua-hub-ico"><Icon size={22} /></span>
                  <span className="ua-hub-txt"><strong>{n.label}</strong><small>{n.blurb || n.desc}</small></span>
                  <ChevronRight size={18} className="ua-hub-chev" />
                </Link>
              );
            }
            return (
              <div key={n.key} className={`ua-hub-group ${open ? "open" : ""}`}>
                <button type="button" className="ua-hub-row" aria-expanded={open}
                  onClick={() => setOpenKey(openKey === n.key ? null : n.key)}>
                  <span className="ua-hub-ico"><Icon size={22} /></span>
                  <span className="ua-hub-txt"><strong>{n.label}</strong><small>{n.blurb}</small></span>
                  <Badge n={total} />
                  <ChevronRight size={18} className="ua-hub-chev ua-hub-chev-turn" />
                </button>
                {open && (
                  <div className="ua-hub-sub-grid">
                    {kids.map((c) => {
                      const CI = c.icon || n.icon;
                      return (
                        <Link key={c.to} to={adminPath(c.to)} className="ua-hub-mini">
                          <span className="ua-hub-ico sm"><CI size={18} /></span>
                          <span><strong>{c.label}</strong><small>{c.desc}</small></span>
                          <Badge n={badges[c.to]} />
                        </Link>
                      );
                    })}
                    <Link to={hubPath(n.key)} className="ua-hub-mini all">Open {n.label} workspace →</Link>
                  </div>
                )}
              </div>
            );
          })}
          {items.filter(match).length === 0 && <p className="ua-hub-sub">Nothing matches “{q}”.</p>}

          <button type="button" className="ua-hub-row ua-hub-signout" onClick={logout}>
            <span className="ua-hub-ico"><LogOut size={22} /></span>
            <span className="ua-hub-txt"><strong>Sign out</strong></span>
          </button>

          {/* Phone app only: leave without signing out. */}
          {canExitApp() && (
            <button type="button" className="ua-hub-row" onClick={exitApp}>
              <span className="ua-hub-ico"><Power size={22} /></span>
              <span className="ua-hub-txt"><strong>Exit app</strong><small>Close the app without signing out</small></span>
            </button>
          )}
        </div>
      </div>
    );
  }

  const mod = nav.find((n) => n.key === module && n.children);
  if (!mod) return <Navigate to="/admin/dashboard" replace />;

  return (
    <div className="ua-hub">
      <p className="ua-hub-sub">{mod.blurb}</p>
      <div className="ua-hub-grid">
        {mod.children.map((c) => {
          const Icon = c.icon || mod.icon;
          return (
            <Link key={c.to} to={adminPath(c.to)} className="ua-hub-card">
              <span className="ua-hub-card-top">
                <span className="ua-hub-ico"><Icon size={22} /></span>
                <Badge n={badges[c.to]} />
              </span>
              <strong>{c.label}</strong>
              <small>{c.desc}</small>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
