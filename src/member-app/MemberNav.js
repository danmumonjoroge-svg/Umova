import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Home, Wallet, Landmark, FileText, MoreHorizontal, User, LogOut, ShieldCheck } from "lucide-react";
import logo from "../asset/logo/umovalogo.png";

// Which top-level item a route belongs to (sub-pages keep their parent lit).
const PARENT = [
  ["/member/dashboard", "home"],
  ["/member/money", "money"], ["/member/savings", "money"], ["/member/shares", "money"],
  ["/member/loans", "loans"],
  ["/member/statements", "statements"], ["/member/statement", "statements"],
];
const parentOf = (path) => (PARENT.find(([p]) => path.startsWith(p)) || [null, "more"])[1];

const MAIN = [
  { key: "home", label: "Home", icon: Home, to: "/member/dashboard" },
  { key: "money", label: "Money", icon: Wallet, to: "/member/money" },
  { key: "loans", label: "Loans", icon: Landmark, to: "/member/loans" },
  { key: "statements", label: "Statements", icon: FileText, to: "/member/statements" },
];

const Brand = () => (
  <div className="uma-brand">
    <img src={logo} alt="" />
    <div>My SACCO<small>Umova</small></div>
  </div>
);

export function MemberSidebar({ onLogout }) {
  const active = parentOf(useLocation().pathname);
  return (
    <aside className="uma-side" aria-label="Main">
      <Brand />
      {MAIN.map(({ key, label, icon: Icon, to }) => (
        <NavLink key={key} to={to} className={active === key ? "on" : ""}><Icon size={18} />{label}</NavLink>
      ))}
      <NavLink to="/member/profile" className={active === "more" ? "on" : ""}><User size={18} />Profile & more</NavLink>
      <div className="sp" />
      <span className="uma-secure" style={{ color: "#9DBBA9", padding: "0 12px" }}><ShieldCheck size={12} />Secure</span>
      <button className="lnk" onClick={onLogout}><LogOut size={18} />Log out</button>
    </aside>
  );
}

export function MemberMobileNav() {
  const active = parentOf(useLocation().pathname);
  return (
    <nav className="uma-nav" aria-label="Main">
      {MAIN.map(({ key, label, icon: Icon, to }) => (
        <NavLink key={key} to={to} className={active === key ? "on" : ""}><Icon size={22} />{label}</NavLink>
      ))}
      <NavLink to="/member/more" className={active === "more" ? "on" : ""}><MoreHorizontal size={22} />More</NavLink>
    </nav>
  );
}

export { Brand };
