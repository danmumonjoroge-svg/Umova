// src/pos-erp/pages/UnitsPage.jsx
//
// Phase 5 — property units (brief §44). Assigning an occupant just picks
// an existing lb_customers row (via useCustomers, the same hook
// CustomersPage.jsx uses) — no separate "tenant" record type.

import React, { useState } from 'react';
import { Home, Loader2, Plus, X } from 'lucide-react';
import { useUnits } from '../hooks/useProperty';
import { useCustomers } from '../hooks/useCustomers';

const EMPTY_FORM = { unit_number: '', rent_amount: '', customer_id: '' };

function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function UnitsPage() {
  const { units, loading, error, create, assignCustomer } = useUnits();
  const { customers } = useCustomers();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [assigningId, setAssigningId] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.unit_number.trim()) { setFormError('Enter a unit number.'); return; }
    setSaving(true);
    try {
      await create({
        unit_number: form.unit_number,
        rent_amount: parseFloat(form.rent_amount) || 0,
        customer_id: form.customer_id || null,
      });
      setShowForm(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Home size={22} className="text-amber-600" /> Units
          </h1>
          <p className="text-slate-500 text-sm">Apartments, shops, or rooms you rent out.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-[0_2px_0_0_rgba(251,191,36,0.6)]"
        >
          <Plus size={16} /> Add Unit
        </button>
      </div>

      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-3">Unit</th><th className="text-left px-5 py-3">Occupant</th>
              <th className="text-right px-5 py-3">Rent</th><th className="text-center px-5 py-3">Status</th><th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={5} className="text-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin inline mr-2" /> Loading…</td></tr>}
            {!loading && units.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-slate-400">No units yet — add your first one.</td></tr>}
            {units.map(u => (
              <tr key={u.id}>
                <td className="px-5 py-3 font-semibold text-slate-800">{u.unit_number}</td>
                <td className="px-5 py-3 text-slate-600">{u.customer?.name || <span className="text-slate-400">Vacant</span>}</td>
                <td className="px-5 py-3 text-right">{fmt(u.rent_amount)}</td>
                <td className="px-5 py-3 text-center">
                  <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${u.status === 'OCCUPIED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{u.status}</span>
                </td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => setAssigningId(assigningId === u.id ? null : u.id)} className="text-amber-700 text-sm hover:underline">
                    {u.customer_id ? 'Change' : 'Assign'}
                  </button>
                  {assigningId === u.id && (
                    <select
                      autoFocus
                      defaultValue=""
                      onChange={async (e) => { await assignCustomer(u.id, e.target.value || null); setAssigningId(null); }}
                      className="ml-2 border border-slate-200 rounded-lg px-2 py-1 text-xs"
                    >
                      <option value="">— Vacant —</option>
                      {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={submit} className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-800">Add Unit</h3>
              <button type="button" onClick={() => setShowForm(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            {formError && <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2">{formError}</div>}
            <input
              required autoFocus placeholder="Unit number (e.g. A01)"
              value={form.unit_number} onChange={e => setForm({ ...form, unit_number: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 focus:border-emerald-700 focus:ring-4 focus:ring-amber-100 outline-none"
            />
            <input
              type="number" min="0" placeholder="Rent amount"
              value={form.rent_amount} onChange={e => setForm({ ...form, rent_amount: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2"
            />
            <select
              value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2"
            >
              <option value="">Vacant (assign later)</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="submit" disabled={saving} className="w-full bg-emerald-800 hover:bg-emerald-900 text-white py-2.5 rounded-xl font-semibold disabled:opacity-60 shadow-[0_2px_0_0_rgba(251,191,36,0.6)]">
              {saving ? 'Saving…' : 'Save Unit'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
