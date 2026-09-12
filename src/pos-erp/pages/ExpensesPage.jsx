// src/pos-erp/pages/ExpensesPage.jsx
//
// Phase 4 — expenses (brief §37). Categories come from
// lb_expense_categories (12 real seeded rows: Rent, Electricity, Water,
// Transport, Wages, Airtime, Repairs, Packaging, Cleaning, Licences,
// Marketing, Miscellaneous), not a hardcoded label list.

import React, { useState } from 'react';
import { Receipt, Loader2, Plus, X } from 'lucide-react';
import { useExpenses } from '../hooks/useExpenses';

const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'CARD', 'BANK', 'VOUCHER', 'OTHER'];

const EMPTY_FORM = {
  category_id: '', amount: '', payment_method: 'CASH',
  expense_date: new Date().toISOString().slice(0, 10), description: '',
};

function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ExpensesPage() {
  const { expenses, categories, loading, error, create } = useExpenses();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0);

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.amount || Number(form.amount) <= 0) {
      setFormError('Enter a valid amount.');
      return;
    }
    setSaving(true);
    try {
      await create({
        categoryId: form.category_id || null,
        amount: Number(form.amount),
        paymentMethod: form.payment_method,
        expenseDate: form.expense_date,
        description: form.description || null,
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
            <Receipt size={22} className="text-amber-600" /> Expenses
          </h1>
          <p className="text-slate-500 text-sm">Rent, wages, transport, and everything else that leaves the till.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xs font-bold text-slate-400 uppercase">Total shown</div>
            <div className="text-xl font-black text-slate-800">{fmt(total)}</div>
          </div>
          <button
            onClick={() => setShowForm(true)}
            className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-[0_2px_0_0_rgba(251,191,36,0.6)] transition"
          >
            <Plus size={16} /> Record Expense
          </button>
        </div>
      </div>

      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-3">Date</th><th className="text-left px-5 py-3">Category</th>
              <th className="text-left px-5 py-3">Description</th><th className="text-left px-5 py-3">Method</th>
              <th className="text-left px-5 py-3">Status</th><th className="text-right px-5 py-3">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && (
              <tr><td colSpan={6} className="text-center py-10 text-slate-400">
                <Loader2 size={18} className="animate-spin inline mr-2" /> Loading…
              </td></tr>
            )}
            {!loading && expenses.length === 0 && (
              <tr><td colSpan={6} className="text-center py-10 text-slate-400">No expenses recorded yet.</td></tr>
            )}
            {expenses.map(e => (
              <tr key={e.id}>
                <td className="px-5 py-3 whitespace-nowrap text-slate-600">{e.expense_date}</td>
                <td className="px-5 py-3 text-slate-700">{e.category?.name || '—'}</td>
                <td className="px-5 py-3 text-slate-500">{e.description || '—'}</td>
                <td className="px-5 py-3 text-slate-500">{e.payment_method?.replace('_', ' ')}</td>
                <td className="px-5 py-3">
                  <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${
                    e.status === 'PAID' ? 'bg-emerald-50 text-emerald-700' :
                    e.status === 'REJECTED' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'
                  }`}>{e.status}</span>
                </td>
                <td className="px-5 py-3 text-right font-semibold text-slate-800">{fmt(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={submit} className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-800">Record Expense</h3>
              <button type="button" onClick={() => setShowForm(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            {formError && <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2">{formError}</div>}
            <select
              value={form.category_id}
              onChange={e => setForm({ ...form, category_id: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2"
            >
              <option value="">No category</option>
              {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input
              required autoFocus type="number" step="0.01" min="0.01" placeholder="Amount"
              value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 focus:border-emerald-700 focus:ring-4 focus:ring-amber-100 outline-none"
            />
            <input
              type="date" value={form.expense_date}
              onChange={e => setForm({ ...form, expense_date: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2"
            />
            <select
              value={form.payment_method}
              onChange={e => setForm({ ...form, payment_method: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2"
            >
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select>
            <input
              placeholder="Description (optional)" value={form.description}
              onChange={e => setForm({ ...form, description: e.target.value })}
              className="w-full border border-slate-200 rounded-xl px-3 py-2"
            />
            <button type="submit" disabled={saving} className="w-full bg-emerald-800 hover:bg-emerald-900 text-white py-2.5 rounded-xl font-semibold disabled:opacity-60 shadow-[0_2px_0_0_rgba(251,191,36,0.6)]">
              {saving ? 'Saving…' : 'Save Expense'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
