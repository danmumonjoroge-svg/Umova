// src/pos-erp/pages/MpesaPage.jsx
//
// Brief section 39/41 -- "M-Pesa" reconciliation view, under My Money.
// Bucketing (Received/Confirmed/Pending/Needs attention, then
// Matched/Unmatched/Pending/Failed lists) matches the brief's own
// example layout. Every figure here comes straight from
// lb_mpesa_transactions -- nothing is estimated or inferred, because
// this is exactly the screen section 39 warns not to guess on
// ("never assume STK request = payment", "never match transactions
// solely because amounts are identical").
//
// "Matched" here means genuinely matched: the row's own sale_id, set
// only by confirm_mpesa_payment() when Safaricom actually confirmed
// that specific request. Nothing on this page does its own amount-based
// matching -- there is no unmatched-PAID case in this design, because a
// sale is never created until the match already exists (see
// phase12_mpesa.sql). "Unmatched" is kept as a labelled section anyway,
// always empty under this design, so if a future change ever creates a
// PAID row with no sale_id, it becomes visible here rather than silently
// disappearing from view.

import React, { useState, useEffect, useCallback } from 'react';
import { Smartphone, Loader2, CheckCircle2, Clock, XCircle, AlertTriangle, Settings as SettingsIcon, ChevronDown, ExternalLink } from 'lucide-react';
import { mpesaService } from '../services/mpesaService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

function fmt(n) { return (Number(n) || 0).toLocaleString(); }
function todayISO() { return new Date().toISOString().slice(0, 10); }

// ============================================================
// Phase 13 -- M-Pesa setup, in the app, for the owner themselves.
//
// This is the entire answer to "how does a client set this up easily":
// paste four things Safaricom gave you when you registered for
// M-Pesa Express, flip one switch, press Save. No CLI, no SQL, no
// Supabase dashboard.
//
// What's on screen is deliberately NOT what's stored. Once a secret
// has been saved, this form shows "Saved (updated 3 days ago)" and a
// blank input -- it never re-displays the actual consumer secret or
// passkey, because there is no code path in this whole system that
// reads those values back out to a browser (see
// schema/phase13_mpesa_client_credentials.sql). Leaving a field blank
// on a later save keeps whatever's already on file; typing something
// new replaces just that one field.
// ============================================================

const FIELD_HELP = {
  shortcode: 'Your till or paybill number.',
  consumerKey: "From Safaricom's Daraja portal, under your M-Pesa Express app.",
  consumerSecret: 'Also from the Daraja portal -- treat this like a password.',
  passkey: 'Safaricom gives you this once your till is approved for M-Pesa Express (Lipa Na M-Pesa Online).',
};

function MpesaSettings({ tenant }) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [savedMsg, setSavedMsg] = useState('');

  const [form, setForm] = useState({
    shortcode: '', environment: 'sandbox', isActive: false,
    consumerKey: '', consumerSecret: '', passkey: '',
  });

  const load = useCallback(async () => {
    if (!tenant?.business_id) return;
    setLoading(true);
    try {
      const cfg = await mpesaService.getConfig(tenant.business_id);
      setConfig(cfg);
      if (cfg) {
        setForm(f => ({ ...f, shortcode: cfg.shortcode || '', environment: cfg.environment || 'sandbox', isActive: !!cfg.is_active }));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (e) => {
    e.preventDefault();
    setError(''); setSavedMsg(''); setSaving(true);
    try {
      const result = await mpesaService.saveConfig({
        tenantId: tenant?.id, businessId: tenant?.business_id,
        shortcode: form.shortcode, environment: form.environment, isActive: form.isActive,
        // Blank means "leave whatever's already saved alone" -- only
        // send a field the owner actually typed something into.
        consumerKey: form.consumerKey || undefined,
        consumerSecret: form.consumerSecret || undefined,
        passkey: form.passkey || undefined,
      });
      setSavedMsg('Saved.');
      // Clear the secret inputs after a successful save -- what's now
      // "in" the form for those three fields is the blank placeholder
      // state, matching that the real value was never displayed here
      // to begin with.
      setForm(f => ({ ...f, consumerKey: '', consumerSecret: '', passkey: '' }));
      setConfig(c => ({ ...(c || {}), ...result, shortcode: form.shortcode, environment: form.environment, is_active: form.isActive }));
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const readyToTurnOn = config?.has_consumer_key && config?.has_consumer_secret && config?.has_passkey && form.shortcode;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl mb-6 overflow-hidden">
      <button
        type="button" onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <span className="font-bold text-slate-800 flex items-center gap-2">
          <SettingsIcon size={17} className="text-slate-400" /> M-Pesa Setup
          {config?.is_active ? (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">On</span>
          ) : (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">Off</span>
          )}
        </span>
        <ChevronDown size={16} className={`text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-slate-100">
          {loading ? (
            <div className="py-6 text-center text-slate-400 text-sm"><Loader2 size={15} className="animate-spin inline mr-2" /> Loading…</div>
          ) : (
            <form onSubmit={handleSave} className="pt-4 space-y-4">
              <p className="text-sm text-slate-500">
                These four things come from Safaricom when you sign up your till or paybill for M-Pesa Express (also called Lipa Na M-Pesa Online). If you don't have them yet, ask your Safaricom business rep, or start at{' '}
                <a href="https://developer.safaricom.co.ke" target="_blank" rel="noreferrer" className="text-emerald-700 underline inline-flex items-center gap-0.5">
                  developer.safaricom.co.ke <ExternalLink size={11} />
                </a>.
              </p>

              {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}
              {savedMsg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm rounded-xl px-4 py-3">{savedMsg}</div>}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Till / Paybill number" help={FIELD_HELP.shortcode}>
                  <input required value={form.shortcode} onChange={e => setForm({ ...form, shortcode: e.target.value })}
                    placeholder="e.g. 174379" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                </Field>

                <Field label="Mode">
                  <select value={form.environment} onChange={e => setForm({ ...form, environment: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm">
                    <option value="sandbox">Test (Sandbox) -- use this until Safaricom approves you for real payments</option>
                    <option value="production">Live -- real customer payments</option>
                  </select>
                </Field>

                <Field label="Consumer Key" help={FIELD_HELP.consumerKey} saved={config?.has_consumer_key}>
                  <input type="password" value={form.consumerKey} onChange={e => setForm({ ...form, consumerKey: e.target.value })}
                    placeholder={config?.has_consumer_key ? 'Saved -- leave blank to keep it' : 'Paste your consumer key'}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                </Field>

                <Field label="Consumer Secret" help={FIELD_HELP.consumerSecret} saved={config?.has_consumer_secret}>
                  <input type="password" value={form.consumerSecret} onChange={e => setForm({ ...form, consumerSecret: e.target.value })}
                    placeholder={config?.has_consumer_secret ? 'Saved -- leave blank to keep it' : 'Paste your consumer secret'}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                </Field>

                <Field label="Passkey" help={FIELD_HELP.passkey} saved={config?.has_passkey}>
                  <input type="password" value={form.passkey} onChange={e => setForm({ ...form, passkey: e.target.value })}
                    placeholder={config?.has_passkey ? 'Saved -- leave blank to keep it' : 'Paste your passkey'}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                </Field>
              </div>

              {config?.credentials_updated_at && (
                <p className="text-xs text-slate-400">Credentials last updated {new Date(config.credentials_updated_at).toLocaleString()}.</p>
              )}

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} disabled={!readyToTurnOn && !form.isActive} />
                Turn M-Pesa on for this business
              </label>
              {!readyToTurnOn && !form.isActive && (
                <p className="text-xs text-amber-600">Fill in the till number and all three credentials above before turning this on.</p>
              )}

              <button type="submit" disabled={saving} className="bg-emerald-800 hover:bg-emerald-900 text-white px-6 py-2.5 rounded-xl font-semibold disabled:opacity-60">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, help, saved, children }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        <label className="text-xs font-semibold text-slate-600">{label}</label>
        {saved && <CheckCircle2 size={12} className="text-emerald-600" />}
      </div>
      {children}
      {help && <p className="text-[11px] text-slate-400 mt-1">{help}</p>}
    </div>
  );
}

const STATUS_META = {
  PENDING: { label: 'Pending', bg: 'bg-amber-50 text-amber-700', Icon: Clock },
  PAID: { label: 'Confirmed', bg: 'bg-emerald-50 text-emerald-700', Icon: CheckCircle2 },
  FAILED: { label: 'Failed', bg: 'bg-red-50 text-red-700', Icon: XCircle },
  CANCELLED: { label: 'Cancelled', bg: 'bg-red-50 text-red-700', Icon: XCircle },
  TIMED_OUT: { label: 'Timed out', bg: 'bg-slate-100 text-slate-500', Icon: Clock },
  NEEDS_ATTENTION: { label: 'Needs attention', bg: 'bg-amber-100 text-amber-800', Icon: AlertTriangle },
};

export default function MpesaPage() {
  const { tenant } = usePosErpAuth();
  const [date, setDate] = useState(todayISO());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    if (!tenant?.business_id) return;
    setLoading(true); setError('');
    try {
      setRows(await mpesaService.getForDate({ businessId: tenant.business_id, date }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenant, date]);

  useEffect(() => { load(); }, [load]);

  const totals = rows.reduce((acc, r) => {
    acc.received += Number(r.amount || 0);
    if (r.status === 'PAID') acc.confirmed += Number(r.amount || 0);
    if (r.status === 'PENDING') acc.pending += Number(r.amount || 0);
    if (r.status === 'NEEDS_ATTENTION') acc.needsAttention += Number(r.amount || 0);
    return acc;
  }, { received: 0, confirmed: 0, pending: 0, needsAttention: 0 });

  const matched = rows.filter(r => r.status === 'PAID' && r.sale_id);
  const unmatched = rows.filter(r => r.status === 'PAID' && !r.sale_id); // see header note -- expected to always be empty under this design
  const pending = rows.filter(r => r.status === 'PENDING');
  const failed = rows.filter(r => ['FAILED', 'CANCELLED', 'TIMED_OUT'].includes(r.status));
  const needsAttention = rows.filter(r => r.status === 'NEEDS_ATTENTION');

  const handleGiveUp = async (row) => {
    setBusyId(row.id);
    try {
      await mpesaService.markNeedsAttention(row.id, 'Marked by owner from the M-Pesa screen');
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap justify-between items-center gap-3 mb-4">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Smartphone size={22} className="text-emerald-700" /> M-Pesa
        </h1>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-sm" />
      </div>

      {error && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

      <MpesaSettings tenant={tenant} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-400 uppercase">Received</div>
          <div className="text-xl font-black text-slate-800">{fmt(totals.received)}</div>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-400 uppercase">Confirmed</div>
          <div className="text-xl font-black text-emerald-700">{fmt(totals.confirmed)}</div>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-400 uppercase">Pending</div>
          <div className="text-xl font-black text-amber-700">{fmt(totals.pending)}</div>
        </div>
        <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
          <div className="text-xs font-bold text-slate-400 uppercase">Needs attention</div>
          <div className="text-xl font-black text-red-600">{fmt(totals.needsAttention)}</div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-10 text-slate-500"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</div>
      ) : (
        <div className="space-y-6">
          <Section title={`Matched (${matched.length})`} empty="No confirmed payments yet today.">
            {matched.map(r => (
              <Row key={r.id} r={r} extra={r.sale ? `Sale #${r.sale.sale_number}` : null} />
            ))}
          </Section>

          {unmatched.length > 0 && (
            <Section title={`Unmatched (${unmatched.length})`} tone="amber" empty="">
              {unmatched.map(r => <Row key={r.id} r={r} extra="No matching sale — check this manually" />)}
            </Section>
          )}

          <Section title={`Pending (${pending.length})`} empty="Nothing waiting on a customer right now.">
            {pending.map(r => (
              <Row key={r.id} r={r} extra="Waiting for confirmation"
                action={<button disabled={busyId === r.id} onClick={() => handleGiveUp(r)} className="text-xs font-bold text-slate-500 hover:text-red-600">
                  {busyId === r.id ? 'Saving…' : "Give up on this"}
                </button>} />
            ))}
          </Section>

          {needsAttention.length > 0 && (
            <Section title={`Needs attention (${needsAttention.length})`} tone="amber" empty="">
              {needsAttention.map(r => <Row key={r.id} r={r} extra={r.result_desc} />)}
            </Section>
          )}

          <Section title={`Failed / Cancelled (${failed.length})`} empty="No failed payments today.">
            {failed.map(r => <Row key={r.id} r={r} extra={r.result_desc} />)}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({ title, children, empty }) {
  const items = React.Children.toArray(children);
  return (
    <div>
      <h2 className="font-bold text-slate-700 mb-2 text-sm uppercase tracking-wide">{title}</h2>
      <div className="bg-white border border-slate-100 rounded-2xl divide-y divide-slate-100">
        {items.length === 0 ? <div className="px-4 py-6 text-center text-slate-400 text-sm">{empty}</div> : items}
      </div>
    </div>
  );
}

function Row({ r, extra, action }) {
  const meta = STATUS_META[r.status] || STATUS_META.PENDING;
  return (
    <div className="px-4 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-800">
          KES {(Number(r.amount) || 0).toLocaleString()} — {r.customer?.name || r.phone}
        </div>
        <div className="text-xs text-slate-400">
          {new Date(r.requested_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
          {r.mpesa_receipt_number ? ` · ${r.mpesa_receipt_number}` : ''}
          {extra ? ` · ${extra}` : ''}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {action}
        <span className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-full whitespace-nowrap ${meta.bg}`}>
          <meta.Icon size={11} /> {meta.label}
        </span>
      </div>
    </div>
  );
}
