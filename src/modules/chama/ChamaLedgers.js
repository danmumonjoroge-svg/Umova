import React from "react";
import "./ChamaDashboard.css";

// ============================================================
// LEDGERS PAGE — placeholder
// ============================================================
// Wire this up to ChamaStatements.js or chama_contributions
// detail views, following the .cdash-panel structure.
// ============================================================
export default function ChamaLedgers() {
  return (
    <div className="cdash">
      <div className="cdash-panel">
        <div className="cdash-panel-head">
          <div>
            <h2>Ledgers</h2>
            <p>Full contribution and transaction history</p>
          </div>
        </div>
        <div className="cdash-empty">
          <p>Ledger / statement detail goes here — wire up to ChamaStatements.</p>
        </div>
      </div>
    </div>
  );
}