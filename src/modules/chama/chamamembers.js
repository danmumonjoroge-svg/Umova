import React from "react";
import "./ChamaDashboard.css";

// ============================================================
// MEMBERS PAGE — placeholder
// ============================================================
// Wire this up to your existing member-listing logic
// (e.g. query chama_members for chama.id) following the same
// .cdash-panel / .cdash-* class structure used in
// ChamaDashboard.js for visual consistency.
// ============================================================
export default function ChamaMembers() {
  return (
    <div className="cdash">
      <div className="cdash-panel">
        <div className="cdash-panel-head">
          <div>
            <h2>Members</h2>
            <p>Group member ledgers and contribution history</p>
          </div>
        </div>
        <div className="cdash-empty">
          <p>Member list goes here — wire up to chama_members.</p>
        </div>
      </div>
    </div>
  );
}