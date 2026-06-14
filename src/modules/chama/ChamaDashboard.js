import React, { useEffect, useState, useMemo, memo } from "react";
import { supabase } from "../../supabaseClient";
import { X, Send, Plus, Landmark } from "lucide-react";
import "./ChamaDashboard.css";

/* ════════════════════════════════════════════════════════════════
   FINANCIAL ENGINE & HELPERS (Kept for logic)
════════════════════════════════════════════════════════════════ */
const FinancialEngine = {
  formatKES: (value) => new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" }).format(Number(value || 0)),
  computeFundsByLocation: (funds = []) => {
    const summary = { total: 0, byLocation: {} };
    funds.forEach(f => {
      const loc = f.fund_location || "Unspecified";
      if (!summary.byLocation[loc]) summary.byLocation[loc] = { current: 0, deposited: 0, withdrawn: 0 };
      summary.byLocation[loc].current += Number(f.current_amount || 0);
      summary.byLocation[loc].deposited += Number(f.total_deposited || 0);
      summary.byLocation[loc].withdrawn += Number(f.total_withdrawn || 0);
      summary.total += Number(f.current_amount || 0);
    });
    return summary;
  }
};

/* ════════════════════════════════════════════════════════════════
   CORRECTED MODAL COMPONENTS (Hooks moved to top)
════════════════════════════════════════════════════════════════ */

export const SendMoneyModal = memo(({ open, onClose, chamaId, members = [], onSend }) => {
  // HOOKS DEFINED AT TOP
  const [formData, setFormData] = useState({ sender_member_id: "", amount: "", reference_code: "", send_to_type: "treasurer" });
  const [loading, setLoading] = useState(false);

  // RETURN NULL ONLY AFTER HOOKS ARE DEFINED
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h3>💸 Send Money</h3>
        <select value={formData.sender_member_id} onChange={e => setFormData({ ...formData, sender_member_id: e.target.value })}>
            <option value="">Select Member...</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
});

export const MerryGoRoundModal = memo(({ open, onClose, merryGoRound = [], members = [], chamaId }) => {
  // HOOKS DEFINED AT TOP
  const [showForm, setShowForm] = useState(false);
  
  // RETURN NULL ONLY AFTER HOOKS ARE DEFINED
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <h3>🔄 Merry-Go-Round</h3>
        <button onClick={() => setShowForm(!showForm)}>Toggle Form</button>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
});

/* ════════════════════════════════════════════════════════════════
   MAIN DASHBOARD COMPONENT
════════════════════════════════════════════════════════════════ */

const ChamaDashboard = ({ chamaId }) => {
  const [data, setData] = useState({ funds: [], members: [], sendMoney: [], merryGoRound: [] });

  useEffect(() => {
    // Data fetching logic here
  }, [chamaId]);

  return (
    <div className="dashboard-container">
      <h1>Umova Dashboard</h1>
      {/* Dashboard UI */}
    </div>
  );
};

export default ChamaDashboard;