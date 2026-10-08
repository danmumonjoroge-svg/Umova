// src/pos-erp/pages/ServicesPage.jsx
//
// Phase 6 — services (brief §28). "Assigned staff" is self-assign only
// (the staff member creating the service can assign themselves as the
// default provider) rather than a full staff picker — there's no
// existing staff-listing service in this codebase, and pos_staff's RLS
// behavior for a general client-side SELECT (as opposed to the
// SECURITY DEFINER get_pos_profile() every other staff read goes
// through) hasn't been confirmed. A real staff-picker belongs with
// Staff management (brief §60), not invented here on an assumption.

import React, { useState } from 'react';
import { Scissors, Loader2, Plus, X, Clock } from 'lucide-react';
import { useServices } from '../hooks/useSalon';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { useCapabilities } from '../navigation/CapabilitiesContext';

const EMPTY_FORM = { kind: 'SERVICE', name: '', selling_price: '', duration_minutes: '', commission_rate: '', assign_self: false };

function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ServicesPage() {
  const { services, loading, error, create } = useServices();
  const { posStaffId, staffName } = usePosErpAuth();
  const { enabled } = useCapabilities();
  // Provider and commission are for service businesses (salon); a hotel selling swimming does not need them.
  const salonOn = enabled.includes('salon');
  const noun = (k) => (k === 'ACTIVITY' ? 'activity' : 'service');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.name.trim()) { setFormError(`Enter a name for the ${noun(form.kind)}.`); return; }
    if (!form.selling_price || Number(form.selling_price) <= 0) { setFormError('Enter a valid price.'); return; }
    setSaving(true);
    try {
      await create({
        kind: form.kind,
        name: form.name,
        selling_price: form.selling_price,
        duration_minutes: form.duration_minutes,
        default_staff_id: form.assign_self ? posStaffId : null,
        commission_rate: form.commission_rate,
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
            <Scissors size={22} className="text-amber-600" /> {salonOn ? 'Services' : 'Services & Activities'}
          </h1>
          <p className="text-slate-500 text-sm">Haircuts, massages, swimming, football, a conference room — sold through the same till as products, or charged to a customer's folio.</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-[0_2px_0_0_rgba(251,191,36,0.6)]"
        >
          <Plus size={16} /> Add
        </button>
      </div>

      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{error}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
        {loading && <div className="col-span-full text-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin inline mr-2" /> Loading…</div>}
        {!loading && services.length === 0 && <div className="col-span-full text-center py-10 text-slate-400">Nothing here yet — add your first service or activity.</div>}
        {services.map(s => (
          <div key={s.id} className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex justify-between items-start mb-1">
              <h3 className="font-semibold text-slate-800">{s.name}{s.service_details?.kind === 'ACTIVITY' && <span className="ml-2 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 align-middle">Activity</span>}</h3>
              <span className="font-bold text-emerald-700">{fmt(s.selling_price)}</span>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              {s.service_details?.duration_minutes && (
                <span className="flex items-center gap-1"><Clock size={12} /> {s.service_details.duration_minutes} min</span>
              )}
              {s.service_details?.staff?.name && <span>Provider: {s.service_details.staff.name}</span>}
              {Number(s.service_details?.commission_rate) > 0 && <span>Commission: {s.service_details.commission_rate}%</span>}
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <form onSubmit={submit} className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-800">Add a {noun(form.kind)}</h3>
              <button type="button" onClick={() => setShowForm(false)}><X size={18} className="text-slate-400" /></button>
            </div>
            {formError && <div className="bg-red-50 text-red-700 text-sm rounded px-3 py-2">{formError}</div>}
            <div className="grid grid-cols-2 gap-1 bg-slate-100 rounded-xl p-1">
              {[['SERVICE', 'Service'], ['ACTIVITY', 'Activity']].map(([k, l]) => (
                <button type="button" key={k} onClick={() => setForm({ ...form, kind: k })} aria-pressed={form.kind === k}
                  className={`min-h-[40px] rounded-lg text-sm font-semibold ${form.kind === k ? 'bg-white shadow-sm text-emerald-800' : 'text-slate-500'}`}>{l}</button>
              ))}
            </div>
            <input required autoFocus placeholder={form.kind === 'ACTIVITY' ? 'Activity name (e.g. Swimming)' : 'Service name (e.g. Haircut)'} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
            <input required type="number" step="0.01" min="0.01" placeholder="Price" value={form.selling_price} onChange={e => setForm({ ...form, selling_price: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
            <input type="number" min="0" placeholder="Duration (minutes, optional)" value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
            {salonOn && <>
              <input type="number" min="0" max="100" placeholder="Commission % (optional)" value={form.commission_rate} onChange={e => setForm({ ...form, commission_rate: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2" />
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={form.assign_self} onChange={e => setForm({ ...form, assign_self: e.target.checked })} />
                I'm the default provider{staffName ? ` (${staffName})` : ''}
              </label>
            </>}
            <button type="submit" disabled={saving} className="w-full bg-emerald-800 hover:bg-emerald-900 text-white py-2.5 rounded-xl font-semibold disabled:opacity-60 shadow-[0_2px_0_0_rgba(251,191,36,0.6)]">
              {saving ? 'Saving…' : `Save ${noun(form.kind)}`}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
