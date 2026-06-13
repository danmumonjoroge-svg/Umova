import React from "react";
import "./ChamaDashboard.css";

// ============================================================
// AUDIT PAGE — placeholder
// ============================================================
// This route is treasurer/admin-only (see NAV_ITEMS in
// ChamaDashboardLayout.js). Wire this up to your existing
// TreasurerApprovals.jsx component, or move the pending-approvals
// panel from ChamaDashboard.js here if you'd rather keep the
// Overview page lighter.
// ============================================================
export default function ChamaAudit() {
  return (
    <div className="cdash">
      <div className="cdash-panel">
        <div className="cdash-panel-head">
          <div>
            <h2>Audit</h2>
            <p>Review and approve pending group transactions</p>
          </div>
        </div>
        <div className="cdash-empty">
          <p>Mount TreasurerApprovals.jsx here, or move the approvals panel from the Overview page.</p>
        </div>
      </div>
    </div>
  );
}