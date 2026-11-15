// src/pos-erp/components/EtimsSetupCard.jsx
//
// "Tax invoices (KRA)" setup, in plain words. Steps: 1 PIN  2 KRA approval  3 Connect  4 Ready.
// Steps 2 and 3 are NOT built yet: approval happens in the owner's own KRA account, and "Connect" needs the KRA
// technical specification (Phase 3b). Until then this card only saves the business details and says what is next.
// Nothing here talks to KRA; it only saves to our database through etimsService.
import React, { useEffect, useState } from 'react';
import { Loader2, Save, CheckCircle2, Clock } from 'lucide-react';
import { useEtims } from '../hooks/useEtims';

const inputCls = 'w-full min-h-[44px] px-3 border border-[#DDE3DD] rounded-lg text-sm bg-white';
const labelCls = 'block text-xs font-semibold text-[#68756D] mb-1';

const STEPS = [
  { key: 'pin', label: 'Business details' },
  { key: 'kra', label: 'KRA approval' },
  { key: 'connect', label: 'Connect' },
  { key: 'ready', label: 'Ready' },
];
function stepIndex(s) {
  if (!s?.configured) return 0;
  if (s.status === 'ACTIVE') return 3;
  if (s.status === 'READY_TO_CONNECT') return 2;
  return 1; // WAITING_FOR_KRA and anything else: details saved, waiting on KRA
}

export default function EtimsSetupCard({ canEdit }) {
  const { status, loading, error, saveProfile } = useEtims();
  const [form, setForm] = useState({ kraPin: '', environment: 'sandbox', branchId: '', deviceSerial: '', vatRegistered: false });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  // The PIN is shown masked by the server; the owner retypes it to change it.
  useEffect(() => {
    if (status?.configured) setForm((f) => ({ ...f, environment: status.environment, vatRegistered: !!status.vat_registered }));
  }, [status?.configured, status?.environment, status?.vat_registered]);

  const submit = async (e) => {
    e.preventDefault(); setSaving(true); setErr(null); setMsg(null);
    try { await saveProfile(form); setMsg('Saved. Next: KRA approval.'); setForm((f) => ({ ...f, kraPin: '' })); }
    catch (x) { setErr(x.message); }
    finally { setSaving(false); }
  };

  const idx = stepIndex(status);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  if (loading && !status) return <div className="p-6 text-center text-sm text-[#68756D]"><Loader2 className="animate-spin inline mr-2" size={16} />Loading…</div>;

  return (
    <div className="space-y-3">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">{error}</div>}

      <ol className="bg-white border border-[#DDE3DD] rounded-xl p-3 grid grid-cols-4 gap-1 text-center">
        {STEPS.map((s, i) => (
          <li key={s.key} className={`text-[11px] font-semibold ${i < idx ? 'text-[#1F6B45]' : i === idx ? 'text-[#26352D]' : 'text-[#9AA39C]'}`}>
            <span className={`mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs ${i < idx ? 'bg-[#237A52] text-white' : i === idx ? 'bg-[#C9A227] text-white' : 'bg-[#EEF1EE]'}`}>
              {i < idx ? <CheckCircle2 size={14} /> : i + 1}
            </span>{s.label}
          </li>
        ))}
      </ol>

      {status?.configured && (
        <div className="bg-[#FBF6E4] border border-[#E8D9A0] text-[#6b5516] text-sm rounded-xl p-3 flex gap-2">
          <Clock size={16} className="shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Waiting for KRA</p>
            <p className="text-xs mt-1">Your KRA PIN {status.pin_masked} is saved. Next, KRA must approve your business for eTIMS in your own KRA account. Connecting from here comes in the next update. Nothing changes at the till and no sale is affected.</p>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="bg-white border border-[#DDE3DD] rounded-xl p-4 space-y-3">
        <p className="text-xs text-[#68756D]">These are your business's own KRA details. They are only used to send your own tax invoices.</p>
        <div><label className={labelCls}>Business KRA PIN {status?.configured ? `(saved: ${status.pin_masked})` : ''}</label>
          <input className={inputCls} value={form.kraPin} onChange={set('kraPin')} placeholder={status?.configured ? 'Type again only to change it' : 'Your KRA PIN'} autoCapitalize="characters" required={!status?.configured} disabled={!canEdit} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={labelCls}>Branch ID (from KRA)</label><input className={inputCls} value={form.branchId} onChange={set('branchId')} disabled={!canEdit} /></div>
          <div><label className={labelCls}>Device serial</label><input className={inputCls} value={form.deviceSerial} onChange={set('deviceSerial')} disabled={!canEdit} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3 items-end">
          <div><label className={labelCls}>Mode</label>
            <select className={inputCls} value={form.environment} onChange={set('environment')} disabled={!canEdit}>
              <option value="sandbox">Test (practice)</option><option value="production">Live</option>
            </select></div>
          <label className="flex items-center gap-2 text-sm text-[#26352D] min-h-[44px]">
            <input type="checkbox" className="w-4 h-4 accent-[#237A52]" checked={form.vatRegistered} onChange={set('vatRegistered')} disabled={!canEdit} /> VAT registered
          </label>
        </div>
        {err && <p className="text-sm text-red-700">{err}</p>}
        {msg && <p className="text-sm text-[#17583a]">{msg}</p>}
        {canEdit
          ? <button type="submit" disabled={saving} className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-lg bg-[#237A52] text-white text-sm font-semibold disabled:opacity-60"><Save size={15} />{saving ? 'Saving…' : 'Save'}</button>
          : <p className="text-xs text-[#68756D]">Only the owner or a manager can change this.</p>}
      </form>
    </div>
  );
}
