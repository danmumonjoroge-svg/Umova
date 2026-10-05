import { Link, Navigate, useParams } from "react-router-dom";
import { ChevronRight, LogOut } from "lucide-react";
import { useAuth } from "../../Context/AuthContext";
import {
  APPROVER_ROLES, MORE_KEYS, adminPath, hubPath, moduleByKey, visibleNav,
} from "./adminNav";
import "./umova-theme.css";

// Workspace page: a module's pages as tappable cards (the "app home" for
// Money, Loans, Members, Accounting, Reports, and the More tab).
export default function AdminHub() {
  const { module } = useParams();
  const { role, logout } = useAuth();
  const isApprover = APPROVER_ROLES.includes(role);

  if (module === "more") {
    const items = MORE_KEYS.map(moduleByKey).filter((n) => n && (!n.approverOnly || isApprover));
    return (
      <div className="ua-hub">
        <p className="ua-hub-sub">Everything else in Umova Admin</p>
        <div className="ua-hub-list">
          {items.map((n) => {
            const Icon = n.icon;
            const to = n.children ? hubPath(n.key) : adminPath(n.to);
            return (
              <Link key={n.key} to={to} className="ua-hub-row">
                <span className="ua-hub-ico"><Icon size={22} /></span>
                <span className="ua-hub-txt">
                  <strong>{n.label}</strong>
                  <small>{n.blurb || n.desc}</small>
                </span>
                <ChevronRight size={18} className="ua-hub-chev" />
              </Link>
            );
          })}
          <button type="button" className="ua-hub-row ua-hub-signout" onClick={logout}>
            <span className="ua-hub-ico"><LogOut size={22} /></span>
            <span className="ua-hub-txt"><strong>Sign out</strong></span>
          </button>
        </div>
      </div>
    );
  }

  const mod = visibleNav(isApprover).find((n) => n.key === module && n.children);
  if (!mod) return <Navigate to="/admin/dashboard" replace />;

  return (
    <div className="ua-hub">
      <p className="ua-hub-sub">{mod.blurb}</p>
      <div className="ua-hub-grid">
        {mod.children.map((c) => {
          const Icon = c.icon || mod.icon;
          return (
            <Link key={c.to} to={adminPath(c.to)} className="ua-hub-card">
              <span className="ua-hub-ico"><Icon size={22} /></span>
              <strong>{c.label}</strong>
              <small>{c.desc}</small>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
