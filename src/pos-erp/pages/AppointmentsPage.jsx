// src/pos-erp/pages/AppointmentsPage.jsx
//
// Phase 6 — appointments (brief §49). "Complete" runs the appointment's
// service through the existing sale engine (appointmentService.
// completeAndSell → saleService.create(), same code the till uses) —
// requires an open cashier shift, same as the till itself.

import React, { useState } from 'react';
import { CalendarClock, Loader2, Plus, X } from 'lucide-react';
import { useAppointments, useServices } from '../hooks/useSalon';
import { useCustomers } from '../hooks/useCustomers';
import { useCashierShifts } from '../hooks/useCashierShifts';

const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'CARD', 'CREDIT'];
const EMPTY_FORM = { customer_id: '', product_id: '', appointment_date: new Date().toISOString().slice(0, 10), appointment_time: '10:00', notes: '' };

const STATUS_COLORS = {
  SCHEDULED: 'bg-slate-100 text-slate-600', CONFIRMED: 'bg-amber-50 text-amber-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700', CANCELLED: 'bg-red-50 text-red-700', NO_SHOW: 'bg-red-50 text-red-700',
};

function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AppointmentsPage() {
  const { appointments, loading, error, create, setStatus, completeAndSell } = useAppointments();
  const { services } = useServices();
  const { customers } = useCustomers();
  const { activeShift } = useCashierShifts();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const [completing, setCompleting] = useState(null);
  const [completeMethod, setCompleteMethod] = useState('CASH');
  const [completeError, setCompleteError] = useState('');
  const [completeBusy, setCompleteBusy] = useState(false);

  const selectedService = services.find(s => s.id === form.product_id);

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.customer_id || !form.product_id) { setFormError('Select a customer and a service.'); return; }
    setSaving(true);
    try {
      await create({
        customer_id: form.customer_id,
        product_id: form.product_id,
        staff_id: selectedService?.service_details?.default_staff_id || null,
        appointment_date: form.appointment_date,
        appointment_time: form.appointment_time,
        duration_minutes: selectedService?.service_details?.duration_minutes || null,
        notes: form.notes,
      });
      setShowForm(false);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openComplete = (appt) => {
    setCompleting(appt);
    setCompleteMethod('CASH');
    setCompleteError('');
  };

  const submitComplete = async (e) => {
    e.preventDefault();
    setCompleteError('');
    if (!activeShift) { setCompleteError('Open a cashier shift first (same as the till).'); return; }
    setCompleteBusy(true);
    try {
      await completeAndSell(completing, {
        shiftId: activeShift.id,
        unitPrice: Number(completing.service?.selling_price) || 0,
        paymentMethod: completeMethod,
      });
      setCompleting(null);
    } catch (err) {
      setCompleteError(err.message);
    } finally {
      setCompleteBusy(false);
    }
  };

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <CalendarClock size={22} className="text-amber-600" /> Appointments
          </h1>
          <p className="text-slate-500 text-sm">Book, track, and complete service bookings.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-[0_2px_0_0_rgba(251,191,36,0.6)]"
        >
          <Plus size={16} /> Book Appointment
        </button>
      </div>

      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>}
      {!activeShift && (
        <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3">
          No cashier shift is open — appointments can still be booked, but completing one into a sale needs an open shift.
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide">
            <tr>
              <th className="text-left px-5 py-3">Date</th><th className="text-left px-5 py-3">Customer</th>
              <th className="text-left px-5 py-3">Service</th><th className="text-left px-5 py-3">Staff</th>
              <th className="text-center px-5 py-3">Status</th><th />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={6} className="text-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin inline mr-2" /> Loading…</td></tr>}
            {!loading && appointments.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-400">No appointments yet.</td></tr>}
            {appointments.map(a => (
              <tr key={a.id}>
                <td className="px-5 py-3 whitespace-nowrap text-slate-600">{a.appointment_date} {a.appointment_time?.slice(0, 5)}</td>
                <td className="px-5 py-3 text-slate-700">{a.customer?.name}</td>
                <td className="px-5 py-3 text-slate-700">{a.service?.name} <span className="text-slate-400">({fmt(a.service?.selling_price)})</span></td>
                <td className="px-5 py-3 text-slate-500">{a.staff?.name || '—'}</td>
                <td className="px-5 py-3 text-center">
                  <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${STATUS_COLORS[a.status] || 'bg-slate-100'}`}>{a.status.replace('_', ' ')}</span>
                </td>
                <td className="px-5 py-3 text-right whitespace-nowrap">
                  {a.status === 'SCHEDULED' && (
                    <button onClick={() => setStatus(a.id, 'CONFIRMED')} className="text-slate-500 text-xs hover:underline mr-3">Confirm</button>
                  )}
                  {['SCHEDULED', 'CONFIRMED'].includes(a.status) && (
                    <>
                      <button onClick={() => openComplete(a)} className="text-emerald-700 text-xs font-semibold hover:underline mr-3">Complete &amp; Sell</button>
                      <button onClick={() => setStatus(a.id, 'CANCELLED')} className="text-red-500 text-xs hover:underline mr-3">Cancel</button>
                      <button onClick={() => setStatus(a.id, 'NO_SHOW')} className="text-slate-400 text-xs hover:underline">No-show</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={submit} className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-800">Book Appointment</h3>
              <button type="button" onClick={() => setShowForm(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            {formError && <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2">{formError}</div>}
            <select required value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2">
              <option value="">Select customer *</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select required value={form.product_id} onChange={e => setForm({ ...form, product_id: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2">
              <option value="">Select service *</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name} — {fmt(s.selling_price)}</option>)}
            </select>
            <div className="flex gap-2">
              <input required type="date" value={form.appointment_date} onChange={e => setForm({ ...form, appointment_date: e.target.value })} className="flex-1 border border-slate-200 rounded-xl px-3 py-2" />
              <input required type="time" value={form.appointment_time} onChange={e => setForm({ ...form, appointment_time: e.target.value })} className="flex-1 border border-slate-200 rounded-xl px-3 py-2" />
            </div>
            <input placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
            <button type="submit" disabled={saving} className="w-full bg-emerald-800 hover:bg-emerald-900 text-white py-2.5 rounded-xl font-semibold disabled:opacity-60 shadow-[0_2px_0_0_rgba(251,191,36,0.6)]">
              {saving ? 'Saving…' : 'Book'}
            </button>
          </form>
        </div>
      )}

      {completing && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <form onSubmit={submitComplete} className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-5 space-y-3">
            <h3 className="font-bold text-lg text-slate-800">Complete &amp; Sell</h3>
            <p className="text-sm text-slate-500">
              {completing.customer?.name} — {completing.service?.name}, <span className="font-bold text-amber-700">{fmt(completing.service?.selling_price)}</span>
            </p>
            {completeError && <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2">{completeError}</div>}
            <select value={completeMethod} onChange={e => setCompleteMethod(e.target.value)} className="w-full border border-slate-200 rounded-xl px-3 py-2">
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setCompleting(null)} className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-xl">Cancel</button>
              <button type="submit" disabled={completeBusy} className="flex-1 bg-emerald-800 hover:bg-emerald-900 text-white py-2 rounded-xl font-semibold disabled:opacity-60">{completeBusy ? 'Selling…' : 'Sell'}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
