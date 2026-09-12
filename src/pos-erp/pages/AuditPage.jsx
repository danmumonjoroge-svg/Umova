// src/pos-erp/pages/AuditPage.jsx
//
// Phase 8 — audit trail (brief §60). See services/auditService.js for
// why this only shows tenant/auth lifecycle events today, not every
// data-level edit the brief lists — stated in the UI too, not just code
// comments, so nobody mistakes a narrow log for a complete one.

import React from 'react';
import { ShieldCheck, Loader2 } from 'lucide-react';
import { useAudit } from '../hooks/useSettings';

export default function AuditPage() {
  const { entries, loading, error } = useAudit();

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2 mb-1">
        <ShieldCheck size={22} className="text-amber-600" /> Audit Log
      </h1>
      <p className="text-slate-500 text-sm mb-2">Tenant and account-level events.</p>
      <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-6">
        Currently covers registration and account lifecycle events. Day-to-day actions — product/price edits, stock
        adjustments, sales, purchases, returns, expenses, customer/supplier edits — aren't logged here yet.
      </p>

      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-3">Date</th><th className="text-left px-5 py-3">Action</th>
              <th className="text-left px-5 py-3">Entity</th><th className="text-left px-5 py-3">Actor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={4} className="text-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin inline mr-2" /> Loading…</td></tr>}
            {!loading && entries.length === 0 && <tr><td colSpan={4} className="text-center py-10 text-slate-400">No entries yet.</td></tr>}
            {entries.map(e => (
              <tr key={e.id}>
                <td className="px-5 py-3 whitespace-nowrap text-slate-500">{new Date(e.created_at).toLocaleString()}</td>
                <td className="px-5 py-3 font-medium text-slate-800">{e.action}</td>
                <td className="px-5 py-3 text-slate-500">{e.entity_type || '—'}</td>
                <td className="px-5 py-3 text-slate-500">{e.actor_type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
