// src/pos-erp/pages/MetersPage.jsx
//
// Phase 5 — water/electricity meters (brief §47). Recording a reading
// bills it immediately as a one-off charge against the meter's customer
// (meterService.recordReadingAndBill) — "that charge becomes a normal
// customer charge" per the brief, flowing into the same receivable/
// statement view Phase 2 already built.

import React, { useState } from 'react';
import { Gauge, Loader2, Plus, X } from 'lucide-react';
import { useMeters, useUnits } from '../hooks/useProperty';
import { useCustomers } from '../hooks/useCustomers';

const METER_TYPES = ['WATER', 'ELECTRICITY', 'OTHER'];
const EMPTY_METER_FORM = { meter_number: '', meter_type: 'WATER', rate: '', unit_id: '', customer_id: '' };

function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function MetersPage() {
  const { meters, loading, error, create, recordReadingAndBill } = useMeters();
  const { units } = useUnits();
  const { customers } = useCustomers();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_METER_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [readingMeter, setReadingMeter] = useState(null);
  const [previousReading, setPreviousReading] = useState('');
  const [currentReading, setCurrentReading] = useState('');
  const [readingError, setReadingError] = useState('');
  const [readingBusy, setReadingBusy] = useState(false);
  const [billedSummary, setBilledSummary] = useState(null);

  const submitMeter = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.meter_number.trim()) { setFormError('Enter a meter number.'); return; }
    setSaving(true);
    try {
      await create({
        meter_number: form.meter_number,
        meter_type: form.meter_type,
        rate: parseFloat(form.rate) || 0,
        unit_id: form.unit_id || null,
        customer_id: form.customer_id || null,
      });
      setShowForm(false);
      setForm(EMPTY_METER_FORM);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openReading = (meter) => {
    setReadingMeter(meter);
    setPreviousReading('');
    setCurrentReading('');
    setReadingError('');
  };

  const submitReading = async (e) => {
    e.preventDefault();
    setReadingError('');
    if (previousReading === '' || currentReading === '') { setReadingError('Enter both readings.'); return; }
    setReadingBusy(true);
    try {
      const result = await recordReadingAndBill(readingMeter, {
        previousReading: parseFloat(previousReading),
        currentReading: parseFloat(currentReading),
      });
      setReadingMeter(null);
      setBilledSummary({ meter: readingMeter, consumption: result.reading.consumption, charge: result.reading.charge_amount, billed: !!result.invoiceId });
    } catch (err) {
      setReadingError(err.message);
    } finally {
      setReadingBusy(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Gauge size={22} className="text-amber-600" /> Meters
          </h1>
          <p className="text-slate-500 text-sm">Water and electricity meters — a reading becomes a customer charge.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-[0_2px_0_0_rgba(251,191,36,0.6)]"
        >
          <Plus size={16} /> Add Meter
        </button>
      </div>

      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>}

      {billedSummary && (
        <div className="mb-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-xl p-4 flex justify-between items-center">
          <span>
            {billedSummary.meter.meter_number}: {billedSummary.consumption} units × rate ={' '}
            <strong>{fmt(billedSummary.charge)}</strong>
            {billedSummary.billed ? ' — billed to customer.' : ' — no customer on this meter, not billed.'}
          </span>
          <button onClick={() => setBilledSummary(null)} className="text-emerald-600 hover:text-emerald-800"><X size={16} /></button>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-3">Meter</th><th className="text-left px-5 py-3">Type</th>
              <th className="text-left px-5 py-3">Unit</th><th className="text-left px-5 py-3">Customer</th>
              <th className="text-right px-5 py-3">Rate</th><th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={6} className="text-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin inline mr-2" /> Loading…</td></tr>}
            {!loading && meters.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-400">No meters yet.</td></tr>}
            {meters.map(m => (
              <tr key={m.id}>
                <td className="px-5 py-3 font-semibold text-slate-800">{m.meter_number}</td>
                <td className="px-5 py-3 text-slate-500">{m.meter_type}</td>
                <td className="px-5 py-3 text-slate-500">{m.unit?.unit_number || '—'}</td>
                <td className="px-5 py-3 text-slate-600">{m.customer?.name || <span className="text-slate-400">Unassigned</span>}</td>
                <td className="px-5 py-3 text-right">{fmt(m.rate)}</td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => openReading(m)} className="text-amber-700 text-xs font-semibold hover:underline">Record Reading</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={submitMeter} className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-800">Add Meter</h3>
              <button type="button" onClick={() => setShowForm(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            {formError && <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2">{formError}</div>}
            <input required autoFocus placeholder="Meter number" value={form.meter_number} onChange={e => setForm({ ...form, meter_number: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
            <select value={form.meter_type} onChange={e => setForm({ ...form, meter_type: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2">
              {METER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <input required type="number" step="0.01" min="0" placeholder="Rate per unit" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
            <select value={form.unit_id} onChange={e => setForm({ ...form, unit_id: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2">
              <option value="">No unit</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.unit_number}</option>)}
            </select>
            <select value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2">
              <option value="">No customer yet</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button type="submit" disabled={saving} className="w-full bg-emerald-800 hover:bg-emerald-900 text-white py-2.5 rounded-xl font-semibold disabled:opacity-60 shadow-[0_2px_0_0_rgba(251,191,36,0.6)]">
              {saving ? 'Saving…' : 'Save Meter'}
            </button>
          </form>
        </div>
      )}

      {readingMeter && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form onSubmit={submitReading} className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-5 space-y-3">
            <h3 className="font-bold text-lg text-slate-800">Record Reading — {readingMeter.meter_number}</h3>
            {!readingMeter.customer_id && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">No customer assigned to this meter — the reading will be saved but not billed.</p>
            )}
            {readingError && <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2">{readingError}</div>}
            <div>
              <label className="text-xs text-slate-500">Previous reading</label>
              <input required type="number" step="0.01" value={previousReading} onChange={e => setPreviousReading(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
            </div>
            <div>
              <label className="text-xs text-slate-500">Current reading</label>
              <input required autoFocus type="number" step="0.01" value={currentReading} onChange={e => setCurrentReading(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setReadingMeter(null)} className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-xl">Cancel</button>
              <button type="submit" disabled={readingBusy} className="flex-1 bg-emerald-800 hover:bg-emerald-900 text-white py-2 rounded-xl font-semibold disabled:opacity-60">{readingBusy ? 'Saving…' : 'Save & Bill'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
