// src/pos-erp/pages/RecurringChargesPage.jsx
//
// Phase 5 — recurring charges & billing (brief §45-46). charge_name is
// free text on purpose (confirmed in the schema comment) — this is
// deliberately NOT a "Rent Module", it's a generic recurring-charge
// engine that happens to get used for rent/water/garbage/etc.

import React, { useState } from 'react';
import { Repeat, Loader2, Plus, X } from 'lucide-react';
import { useRecurringCharges, useChargeInvoices, useUnits } from '../hooks/useProperty';
import { useCustomers } from '../hooks/useCustomers';

const FREQUENCIES = ['MONTHLY', 'WEEKLY', 'QUARTERLY', 'ANNUALLY', 'ONE_OFF'];
const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'CARD', 'BANK', 'VOUCHER', 'OTHER'];
const EMPTY_FORM = { customer_id: '', unit_id: '', charge_name: 'Rent', amount: '', frequency: 'MONTHLY', due_day: '5' };
const EMPTY_PAYMENT = { amount: '', payment_method: 'CASH', reference_no: '' };

function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_COLORS = {
  DUE: 'bg-slate-100 text-slate-600', PARTIALLY_PAID: 'bg-amber-50 text-amber-700',
  PAID: 'bg-emerald-50 text-emerald-700', OVERDUE: 'bg-red-50 text-red-700',
  WAIVED: 'bg-slate-100 text-slate-400', CANCELLED: 'bg-slate-100 text-slate-400',
};

export default function RecurringChargesPage() {
  const { charges, loading, error, create, setStatus, generateInvoice } = useRecurringCharges();
  const { invoices, recordPayment } = useChargeInvoices();
  const { customers } = useCustomers();
  const { units } = useUnits();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [genError, setGenError] = useState('');
  const [genBusyId, setGenBusyId] = useState(null);

  const [payingInvoice, setPayingInvoice] = useState(null);
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT);
  const [paymentError, setPaymentError] = useState('');
  const [paying, setPaying] = useState(false);

  const currentPeriod = new Date().toISOString().slice(0, 8) + '01'; // first of this month

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.customer_id) { setFormError('Select a customer.'); return; }
    if (!form.amount || Number(form.amount) <= 0) { setFormError('Enter a valid amount.'); return; }
    setSaving(true);
    try {
      await create({
        customer_id: form.customer_id,
        unit_id: form.unit_id || null,
        charge_name: form.charge_name,
        amount: parseFloat(form.amount),
        frequency: form.frequency,
        due_day: form.frequency === 'ONE_OFF' ? null : parseInt(form.due_day, 10) || null,
      });
      setShowForm(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async (charge) => {
    setGenError('');
    setGenBusyId(charge.id);
    try {
      await generateInvoice(charge.id, currentPeriod);
    } catch (err) {
      setGenError(err.message);
    } finally {
      setGenBusyId(null);
    }
  };

  const openPayment = (invoice) => {
    setPayingInvoice(invoice);
    setPaymentForm({ ...EMPTY_PAYMENT, amount: String(Number(invoice.amount) - Number(invoice.paid_amount || 0)) });
    setPaymentError('');
  };

  const submitPayment = async (e) => {
    e.preventDefault();
    setPaymentError('');
    setPaying(true);
    try {
      await recordPayment(payingInvoice.id, {
        amount: parseFloat(paymentForm.amount),
        paymentMethod: paymentForm.payment_method,
        referenceNo: paymentForm.reference_no,
      });
      setPayingInvoice(null);
    } catch (err) {
      setPaymentError(err.message);
    } finally {
      setPaying(false);
    }
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Repeat size={22} className="text-amber-600" /> Recurring Charges
          </h1>
          <p className="text-slate-500 text-sm">Rent, water, garbage, service charges — anything billed on a schedule.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-[0_2px_0_0_rgba(251,191,36,0.6)]"
        >
          <Plus size={16} /> New Charge
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>}
      {genError && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{genError}</div>}

      {/* Charge definitions */}
      <section className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-3">Charge</th><th className="text-left px-5 py-3">Customer</th>
              <th className="text-left px-5 py-3">Unit</th><th className="text-right px-5 py-3">Amount</th>
              <th className="text-left px-5 py-3">Frequency</th><th className="text-center px-5 py-3">Status</th><th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={7} className="text-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin inline mr-2" /> Loading…</td></tr>}
            {!loading && charges.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-slate-400">No recurring charges set up yet.</td></tr>}
            {charges.map(c => (
              <tr key={c.id}>
                <td className="px-5 py-3 font-medium text-slate-800">{c.charge_name}</td>
                <td className="px-5 py-3 text-slate-600">{c.customer?.name}</td>
                <td className="px-5 py-3 text-slate-500">{c.unit?.unit_number || '—'}</td>
                <td className="px-5 py-3 text-right">{fmt(c.amount)}</td>
                <td className="px-5 py-3 text-slate-500">{c.frequency.replace('_', ' ')}</td>
                <td className="px-5 py-3 text-center">
                  <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${c.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{c.status}</span>
                </td>
                <td className="px-5 py-3 text-right whitespace-nowrap">
                  {c.status === 'ACTIVE' && (
                    <button onClick={() => handleGenerate(c)} disabled={genBusyId === c.id} className="text-amber-700 text-xs font-semibold hover:underline mr-3 disabled:opacity-50">
                      {genBusyId === c.id ? 'Generating…' : 'Bill this period'}
                    </button>
                  )}
                  <button onClick={() => setStatus(c.id, c.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE')} className="text-slate-400 text-xs hover:text-slate-600">
                    {c.status === 'ACTIVE' ? 'Pause' : 'Resume'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Generated invoices */}
      <section>
        <h2 className="font-bold text-slate-800 mb-3">Invoices</h2>
        <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
              <tr>
                <th className="text-left px-5 py-3">Period</th><th className="text-left px-5 py-3">Charge</th>
                <th className="text-left px-5 py-3">Customer</th><th className="text-right px-5 py-3">Amount</th>
                <th className="text-right px-5 py-3">Paid</th><th className="text-center px-5 py-3">Status</th><th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-slate-400">No invoices generated yet.</td></tr>}
              {invoices.map(inv => (
                <tr key={inv.id}>
                  <td className="px-5 py-3 text-slate-600">{new Date(inv.period).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</td>
                  <td className="px-5 py-3 text-slate-700">{inv.charge?.charge_name}</td>
                  <td className="px-5 py-3 text-slate-600">{inv.customer?.name}</td>
                  <td className="px-5 py-3 text-right">{fmt(inv.amount)}</td>
                  <td className="px-5 py-3 text-right text-slate-500">{fmt(inv.paid_amount)}</td>
                  <td className="px-5 py-3 text-center">
                    <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${STATUS_COLORS[inv.status] || 'bg-slate-100 text-slate-500'}`}>{inv.status}</span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    {['DUE', 'PARTIALLY_PAID', 'OVERDUE'].includes(inv.status) && (
                      <button onClick={() => openPayment(inv)} className="text-amber-700 text-xs font-semibold hover:underline">Record Payment</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={submit} className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-800">New Recurring Charge</h3>
              <button type="button" onClick={() => setShowForm(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            {formError && <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2">{formError}</div>}
            <select required value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2">
              <option value="">Select customer *</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select value={form.unit_id} onChange={e => setForm({ ...form, unit_id: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2">
              <option value="">No unit</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
            </select>
            <input required placeholder="Charge name (e.g. Rent, Water)" value={form.charge_name} onChange={e => setForm({ ...form, charge_name: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
            <input required type="number" step="0.01" min="0.01" placeholder="Amount" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
            <select value={form.frequency} onChange={e => setForm({ ...form, frequency: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2">
              {FREQUENCIES.map(f => <option key={f} value={f}>{f.replace('_', ' ')}</option>)}
            </select>
            {form.frequency !== 'ONE_OFF' && (
              <input type="number" min="1" max="31" placeholder="Due day of month (e.g. 5)" value={form.due_day} onChange={e => setForm({ ...form, due_day: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
            )}
            <button type="submit" disabled={saving} className="w-full bg-emerald-800 hover:bg-emerald-900 text-white py-2.5 rounded-xl font-semibold disabled:opacity-60 shadow-[0_2px_0_0_rgba(251,191,36,0.6)]">
              {saving ? 'Saving…' : 'Save Charge'}
            </button>
          </form>
        </div>
      )}

      {payingInvoice && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form onSubmit={submitPayment} className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <h3 className="font-bold text-lg text-slate-800">Record Payment</h3>
            <p className="text-sm text-slate-500">
              {payingInvoice.customer?.name} — {payingInvoice.charge?.charge_name}, balance <span className="font-bold text-amber-700">{fmt(Number(payingInvoice.amount) - Number(payingInvoice.paid_amount || 0))}</span>
            </p>
            {paymentError && <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2">{paymentError}</div>}
            <input required autoFocus type="number" step="0.01" min="0.01" value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
            <select value={paymentForm.payment_method} onChange={e => setPaymentForm({ ...paymentForm, payment_method: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2">
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select>
            <input placeholder="Reference no. (optional)" value={paymentForm.reference_no} onChange={e => setPaymentForm({ ...paymentForm, reference_no: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setPayingInvoice(null)} className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-xl">Cancel</button>
              <button type="submit" disabled={paying} className="flex-1 bg-emerald-800 hover:bg-emerald-900 text-white py-2 rounded-xl font-semibold disabled:opacity-60">{paying ? 'Saving…' : 'Save'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
