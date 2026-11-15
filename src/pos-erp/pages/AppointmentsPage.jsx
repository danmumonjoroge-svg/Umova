// src/pos-erp/pages/AppointmentsPage.jsx
//
// Phase 6 — appointments (brief §49). Phase 54: the customer may pick who serves them (optional). "Complete" does
// not take money here: it opens the Sell page with this booking loaded (customer, service, provider), and payment
// happens there like every other sale. When that sale is saved the database marks the booking COMPLETED and writes
// the provider's commission to payroll.

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Loader2, Plus, X } from 'lucide-react';
import { useAppointments, useServices, useProviders } from '../hooks/useSalon';
import { useCustomers } from '../hooks/useCustomers';
import { singleFlight } from '../utils/singleFlight';
import ContactActions from '../components/ContactActions';
import Sheet from '../components/workspace/Sheet';

const EMPTY_FORM = { customer_id: '', product_id: '', appointment_date: new Date().toISOString().slice(0, 10), appointment_time: '10:00', employee_id: '', notes: '' };

const STATUS_COLORS = {
  SCHEDULED: 'bg-slate-100 text-slate-600', CONFIRMED: 'bg-amber-50 text-amber-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700', CANCELLED: 'bg-red-50 text-red-700', NO_SHOW: 'bg-red-50 text-red-700',
};

function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function AppointmentsPage() {
  const { appointments, loading, error, create, setStatus, reschedule } = useAppointments();
  const navigate = useNavigate();
  const { providers } = useProviders();
  const [moving, setMoving] = useState(null); // appointment being rescheduled
  const [moveWhen, setMoveWhen] = useState({ date: '', time: '' });
  const [moveError, setMoveError] = useState('');
  const apptPurpose = (a) => a.status === 'CANCELLED' ? 'APPOINTMENT_CANCELLED' : (a.reschedule_count > 0 ? 'APPOINTMENT_RESCHEDULED' : (a.status === 'SCHEDULED' ? 'APPOINTMENT_CONFIRMATION' : 'APPOINTMENT_REMINDER'));
  const { services } = useServices();
  const { customers } = useCustomers();

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const selectedService = services.find(s => s.id === form.product_id);
  const chosenProvider = providers.find(p => p.id === form.employee_id) || null;

  const submit = singleFlight('AppointmentsPage.submit', async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.customer_id || !form.product_id) { setFormError('Select a customer and a service.'); return; }
    setSaving(true);
    try {
      await create({
        customer_id: form.customer_id,
        product_id: form.product_id,
        staff_id: chosenProvider?.staff_id || (!form.employee_id ? selectedService?.service_details?.default_staff_id : null) || null,
        employee_id: form.employee_id || null, // optional: blank = "any available staff"
        provider_name: chosenProvider?.name || null,
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
  });

  // One place takes payment: the Sell page. It loads this booking (?appointment=) with its customer, service and provider.
  const completeInSell = (appt) => navigate(`/pos/sell?appointment=${appt.id}`);

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <CalendarClock size={22} className="text-amber-600" /> Appointments
          </h1>
          <p className="text-slate-500 text-sm">Book, track, and complete service bookings. Payment is taken on the Sell page.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-[0_2px_0_0_rgba(251,191,36,0.6)]"
        >
          <Plus size={16} /> Book Appointment
        </button>
      </div>

      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
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
                <td className="px-5 py-3 text-slate-500">{a.provider_name || a.staff?.name || 'Any'}</td>
                <td className="px-5 py-3 text-center">
                  <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${STATUS_COLORS[a.status] || 'bg-slate-100'}`}>{a.status.replace('_', ' ')}</span>
                </td>
                <td className="px-5 py-3 text-right whitespace-nowrap">
                  <span className="inline-flex align-middle mr-3"><ContactActions size="sm" recipient={{ kind: 'CUSTOMER', id: a.customer?.id || a.customer_id, name: a.customer?.name, phone: a.customer?.phone, email: a.customer?.email }} purpose={apptPurpose(a)} reference={{ type: 'APPOINTMENT', id: a.id, label: a.service?.name }} /></span>
                  {['SCHEDULED', 'CONFIRMED'].includes(a.status) && (
                    <button onClick={() => { setMoving(a); setMoveWhen({ date: a.appointment_date, time: (a.appointment_time || '').slice(0, 5) }); setMoveError(''); }} className="text-slate-500 text-xs hover:underline mr-3">Reschedule</button>
                  )}
                  {a.status === 'SCHEDULED' && (
                    <button onClick={() => setStatus(a.id, 'CONFIRMED')} className="text-slate-500 text-xs hover:underline mr-3">Confirm</button>
                  )}
                  {['SCHEDULED', 'CONFIRMED'].includes(a.status) && (
                    <>
                      <button onClick={() => completeInSell(a)} className="text-emerald-700 text-xs font-semibold hover:underline mr-3">Complete &amp; Sell</button>
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

      {moving && (
        <Sheet title="Reschedule appointment" onClose={() => setMoving(null)}>
          <div className="space-y-3">
            <p className="text-sm text-[#4A5240]">{moving.customer?.name} · {moving.service?.name}. Currently {moving.appointment_date} {moving.appointment_time?.slice(0, 5)}. The original time stays on record.</p>
            {moveError && <div className="bg-[#FBE4E0] text-[#8F2E24] text-sm rounded-lg px-3 py-2">{moveError}</div>}
            <div className="flex gap-2">
              <input type="date" value={moveWhen.date} onChange={e => setMoveWhen({ ...moveWhen, date: e.target.value })} className="flex-1 border border-[#E3DBB8] rounded-xl px-3 min-h-[48px]" />
              <input type="time" value={moveWhen.time} onChange={e => setMoveWhen({ ...moveWhen, time: e.target.value })} className="w-32 border border-[#E3DBB8] rounded-xl px-3 min-h-[48px]" />
            </div>
            <button onClick={async () => { try { await reschedule(moving.id, moveWhen); setMoving(null); } catch (err) { setMoveError(err.message); } }}
              className="w-full min-h-[48px] rounded-xl bg-[#1F6B45] text-white font-semibold border-b-2 border-[#C9A227]">Save new time</button>
            <p className="text-xs text-[#8A8A70]">Afterwards use the message buttons on that row to tell the customer.</p>
          </div>
        </Sheet>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={submit} className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
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
            {providers.length > 0 && (
              <label className="block text-xs text-slate-500">
                Who should serve them? (optional)
                <select value={form.employee_id} onChange={e => setForm({ ...form, employee_id: e.target.value })} className="mt-1 w-full border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-800">
                  <option value="">Any available staff</option>
                  {providers.map(p => <option key={p.id} value={p.id}>{p.name}{p.job_title ? ` — ${p.job_title}` : ''}</option>)}
                </select>
              </label>
            )}
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

    </div>
  );
}
