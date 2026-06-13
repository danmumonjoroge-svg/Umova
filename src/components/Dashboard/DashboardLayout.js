import React from "react";
import "./DashboardMain.css";

export default function DashboardLayout({ children, setActivePage, activePage }) {
  return (
    <div className="dashboard-container">
      <aside className="sidebar">
        <h2>My SACCO</h2>
        <ul>
          <li onClick={() => setActivePage("home")} className={activePage === "home" ? "active" : ""}>Home</li>
          <li onClick={() => setActivePage("savings")} className={activePage === "savings" ? "active" : ""}>Savings</li>
          <li onClick={() => setActivePage("loans")} className={activePage === "loans" ? "active" : ""}>Loans</li>
          <li onClick={() => setActivePage("shares")} className={activePage === "shares" ? "active" : ""}>Shares</li>
          <li onClick={() => setActivePage("statement")} className={activePage === "statement" ? "active" : ""}>Statement</li>
          <li onClick={() => setActivePage("profile")} className={activePage === "profile" ? "active" : ""}>Profile</li>
        </ul>
      </aside>
      <main className="dashboard-main">{children}</main>
    </div>
  );
}