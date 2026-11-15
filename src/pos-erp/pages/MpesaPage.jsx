// src/pos-erp/pages/MpesaPage.jsx
//
// WHERE M-PESA LIVES (My Business redesign): at the till, M-Pesa is a
// PAYMENT MODE -- pick "M-Pesa", then either send the buyer a prompt or
// enter the code when they already paid (components/MpesaPayPanel.jsx).
// THIS page is the back office for it, reached from My Money -> M-Pesa:
// set-up, and the day's records. It also lists payments a cashier
// recorded by hand ("Already paid" + code), which the STK-only view
// used to know nothing about.
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
import { Smartphone, Loader2, CheckCircle2, Clock, XCircle, AlertTriangle, Settings as SettingsIcon, ChevronDown, ChevronLeft, ChevronRight, ExternalLink, ArrowDownLeft, RefreshCw } from 'lucide-react';
import { mpesaService } from '../services/mpesaService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { singleFlight } from '../utils/singleFlight';
import MpesaInbox from '../components/MpesaInbox';
import { usePermissions } from '../navigation/PermissionsContext';

function fmt(n) { return (Number(n) || 0).toLocaleString(); }
function isoLocal(d) { const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; }
function todayISO() { return isoLocal(new Date()); }
function shiftDay(iso, by) { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + by); return isoLocal(d); }
function prettyDay(iso) {
  if (iso === todayISO()) return 'Today';
  if (iso === shiftDay(todayISO(), -1)) return 'Yesterday';
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
const timeOf = (v) => new Date(v).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

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
    shortcode: '', environment: 'sandbox', isActive: false, accountType: 'paybill', tillNumber: '',
    consumerKey: '', consumerSecret: '', passkey: '',
  });

  const load = useCallback(async () => {
    if (!tenant?.business_id) return;
    setLoading(true);
    try {
      const cfg = await mpesaService.getConfig(tenant.business_id);
      setConfig(cfg);
      if (!cfg?.is_active) setOpen(true); // not switched on yet -> show the setup instead of hiding it
      if (cfg) {
        setForm(f => ({ ...f, shortcode: cfg.shortcode || '', environment: cfg.environment || 'sandbox', isActive: !!cfg.is_active, accountType: cfg.account_type || 'paybill', tillNumber: cfg.till_number || '' }));
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { load(); }, [load]);

  const handleSave = singleFlight('MpesaPage.handleSave', async (e) => {
    e.preventDefault();
    setError(''); setSavedMsg(''); setSaving(true);
    try {
      const result = await mpesaService.saveConfig({
        tenantId: tenant?.id, businessId: tenant?.business_id,
        shortcode: form.shortcode, environment: form.environment, isActive: form.isActive,
        accountType: form.accountType, tillNumber: form.tillNumber,
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
  });

  // A credential counts if it is already saved OR typed in now (it is saved together with the switch when Save is pressed).
  const readyToTurnOn = !!form.shortcode && (config?.has_consumer_key || !!form.consumerKey) && (config?.has_consumer_secret || !!form.consumerSecret) && (config?.has_passkey || !!form.passkey);

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
                <Field label="What do customers pay to?">
                  <select value={form.accountType} onChange={e => setForm({ ...form, accountType: e.target.value })} className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm">
                    <option value="paybill">A Paybill number</option>
                    <option value="till">A Till number (Buy Goods)</option>
                  </select>
                </Field>

                <Field label={form.accountType === 'till' ? 'Store / Head Office number' : 'Paybill number'}
                  help={form.accountType === 'till' ? 'The number Safaricom approved your Daraja app for (what you used in Go Live).' : FIELD_HELP.shortcode}>
                  <input required value={form.shortcode} onChange={e => setForm({ ...form, shortcode: e.target.value })}
                    placeholder="e.g. 174379" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                </Field>

                {form.accountType === 'till' && (
                  <Field label="Till number" help="The Buy Goods till number customers pay to. This is where the prompt takes money.">
                    <input required value={form.tillNumber} onChange={e => setForm({ ...form, tillNumber: e.target.value })}
                      placeholder="e.g. 5123456" className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm" />
                  </Field>
                )}

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
  const [manualRows, setManualRows] = useState([]);
  const { can } = usePermissions();
  const [c2bConfig, setC2bConfig] = useState(null);
  const loadC2bConfig = useCallback(() => {
    if (!tenant?.business_id) return;
    mpesaService.getConfig(tenant.business_id).then(setC2bConfig).catch(() => setC2bConfig(null));
  }, [tenant]);
  useEffect(() => { loadC2bConfig(); }, [loadC2bConfig]);

  const load = useCallback(async () => {
    if (!tenant?.business_id) return;
    setLoading(true); setError('');
    try {
      const stk = await mpesaService.getForDate({ businessId: tenant.business_id, date });
      setRows(stk);
      // Codes typed by a cashier at the till. A failure here must not hide the STK records.
      try {
        setManualRows(await mpesaService.getManualForDate({
          businessId: tenant.business_id, date,
          stkReceipts: stk.map((r) => r.mpesa_receipt_number),
          stkSaleIds: stk.map((r) => r.sale_id),
        }));
      } catch (manualErr) {
        console.error('[MpesaPage] manual payments failed to load:', manualErr);
        setManualRows([]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenant, date]);

  useEffect(() => { load(); }, [load]);

  // The old "Received" tile summed EVERY request, failed and cancelled
  // included, so it overstated what came in. First tile is now real money
  // only: confirmed prompts + codes recorded at the till.
  const seenReceipts = new Set();
  const uniqueRows = rows.filter((r) => {
    const k = r.mpesa_receipt_number && String(r.mpesa_receipt_number).trim().toUpperCase();
    if (!k || r.status !== 'PAID') return true;
    if (seenReceipts.has(k)) return false;
    seenReceipts.add(k); return true;
  });
  const totals = uniqueRows.reduce((acc, r) => {
    if (r.status === 'PAID') acc.confirmed += Number(r.amount || 0);
    if (r.status === 'PENDING') acc.pending += Number(r.amount || 0);
    if (r.status === 'NEEDS_ATTENTION') acc.needsAttention += Number(r.amount || 0);
    return acc;
  }, { confirmed: 0, pending: 0, needsAttention: 0 });
  // Typed at the till vs. paid through a customer prompt (see getManualForDate): only the first kind is "typed".
  const typedRows = manualRows.filter((p) => !p.via_prompt);
  const promptExtraRows = manualRows.filter((p) => p.via_prompt);
  const manualTotal = typedRows.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  totals.confirmed += promptExtraRows.reduce((sum, p) => sum + Number(p.amount || 0), 0);

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

  const [filter, setFilter] = useState('all');
  const paidCount = uniqueRows.filter((r) => r.status === 'PAID').length;
  const inCount = paidCount + manualRows.length;
  const inTotal = totals.confirmed + manualTotal;
  const waitCount = pending.length + needsAttention.length;
  const waitTotal = totals.pending + totals.needsAttention;

  // One list for the whole day, newest first, instead of five separate boxes.
  const feed = [
    ...uniqueRows.filter((r) => r.status === 'PAID').map((r) => ({
      key: `s${r.id}`, kind: 'in', at: r.requested_at, amount: r.amount,
      title: r.customer?.name || r.phone || 'Customer', sub: [r.mpesa_receipt_number, r.sale ? `Sale #${r.sale.sale_number}` : null].filter(Boolean).join(' · '), pill: 'Paid', row: r,
    })),
    ...manualRows.map((p) => ({
      key: `m${p.id}`, kind: 'in', at: p.created_at, amount: p.amount,
      title: p.via_prompt ? 'Customer prompt' : 'Code typed at till', sub: p.reference_no || 'no code entered', pill: 'Paid',
    })),
    ...pending.map((r) => ({
      key: `p${r.id}`, kind: 'wait', at: r.requested_at, amount: r.amount,
      title: r.customer?.name || r.phone, sub: 'Waiting for the customer to enter their PIN', pill: 'Waiting', row: r, canGiveUp: true,
    })),
    ...needsAttention.map((r) => ({
      key: `n${r.id}`, kind: 'wait', at: r.requested_at, amount: r.amount,
      title: r.customer?.name || r.phone, sub: 'No reply. If they paid, it will still appear above.', pill: 'No reply', row: r,
    })),
    ...failed.map((r) => ({
      key: `f${r.id}`, kind: 'fail', at: r.requested_at, amount: r.amount,
      title: r.customer?.name || r.phone, sub: r.result_desc || 'Not completed', pill: (STATUS_META[r.status] || {}).label || 'Failed', row: r,
    })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  const shown = filter === 'all' ? feed : feed.filter((f) => f.kind === filter);
  const KIND = {
    in: { bg: 'bg-emerald-100 text-emerald-700', pill: 'bg-emerald-50 text-emerald-700', Icon: ArrowDownLeft, amt: 'text-emerald-700', sign: '+' },
    wait: { bg: 'bg-amber-100 text-amber-700', pill: 'bg-amber-50 text-amber-800', Icon: Clock, amt: 'text-slate-700', sign: '' },
    fail: { bg: 'bg-red-100 text-red-600', pill: 'bg-red-50 text-red-700', Icon: XCircle, amt: 'text-slate-400', sign: '' },
  };
  const giveUpAll = async () => { for (const r of pending) { await handleGiveUp(r); } };
  const chips = [['all', 'All', feed.length], ['in', 'Money in', feed.filter((f) => f.kind === 'in').length], ['wait', 'Waiting', feed.filter((f) => f.kind === 'wait').length], ['fail', 'Failed', feed.filter((f) => f.kind === 'fail').length]];

  return (
    <div className="px-4 py-4 sm:p-6 max-w-3xl mx-auto min-w-0 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="hidden md:flex text-2xl font-bold text-slate-800 items-center gap-2"><Smartphone size={22} className="text-emerald-700" /> M-Pesa</h1>
        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-full p-1 mx-auto md:mx-0">
          <button onClick={() => setDate(shiftDay(date, -1))} aria-label="Previous day" className="w-9 h-9 grid place-items-center rounded-full hover:bg-slate-100"><ChevronLeft size={18} /></button>
          <label className="relative px-3 text-sm font-bold text-slate-800 min-w-[96px] text-center cursor-pointer">
            {prettyDay(date)}
            <input type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} className="absolute inset-0 opacity-0 w-full cursor-pointer" />
          </label>
          <button onClick={() => setDate(shiftDay(date, 1))} disabled={date >= todayISO()} aria-label="Next day" className="w-9 h-9 grid place-items-center rounded-full hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={18} /></button>
        </div>
        <button onClick={load} aria-label="Refresh" className="w-10 h-10 grid place-items-center rounded-full bg-white border border-slate-200 text-slate-600"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3">{error}</div>}

      <div className="rounded-3xl p-5 text-white shadow-sm" style={{ background: 'linear-gradient(135deg,#17553A,#1F6B45)' }}>
        <div className="text-[11px] font-bold uppercase tracking-wider opacity-80">Money received · {prettyDay(date)}</div>
        <div className="mt-1 text-4xl font-black tracking-tight">KES {fmt(inTotal)}</div>
        <div className="text-sm opacity-90">{inCount === 0 ? 'No payments yet' : `${inCount} payment${inCount === 1 ? '' : 's'}`}</div>
        {(totals.confirmed > 0 || manualTotal > 0) && (
          <div className="mt-3 flex gap-2 text-xs">
            <span className="rounded-full bg-white/15 px-3 py-1.5">Customer prompts <b>KES {fmt(totals.confirmed)}</b></span>
            <span className="rounded-full bg-white/15 px-3 py-1.5">Typed at till <b>KES {fmt(manualTotal)}</b></span>
          </div>
        )}
        {waitCount > 0 && (
          <div className="mt-4 rounded-2xl bg-black/15 px-4 py-3 flex items-center justify-between gap-3">
            <div className="text-sm"><b>KES {fmt(waitTotal)}</b> <span className="opacity-90">not paid yet · {waitCount} request{waitCount === 1 ? '' : 's'}</span></div>
            <button onClick={() => setFilter('wait')} className="text-xs font-bold underline underline-offset-2 whitespace-nowrap">View</button>
          </div>
        )}
      </div>

      {/* Money customers sent straight to the till: the cashier matches it to a bill and clears it. */}
      {(can('payments.record') || can('finance.view')) && <MpesaInbox config={c2bConfig} onConfigChanged={loadC2bConfig} />}

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-extrabold text-slate-800">Activity</h2>
          {filter === 'wait' && pending.length > 1 && (
            <button onClick={giveUpAll} disabled={!!busyId} className="text-xs font-bold text-slate-500 hover:text-red-600">Give up on all waiting</button>
          )}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1">
          {chips.map(([k, label, n]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`shrink-0 px-3.5 min-h-[36px] rounded-full text-sm font-bold border ${filter === k ? 'bg-emerald-800 text-white border-emerald-800' : 'bg-white text-slate-600 border-slate-200'}`}>
              {label} <span className={filter === k ? 'opacity-80' : 'text-slate-400'}>{n}</span>
            </button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-10 text-slate-500"><Loader2 size={16} className="animate-spin inline mr-2" /> Loading…</div>
        ) : shown.length === 0 ? (
          <div className="bg-white border border-slate-100 rounded-2xl px-4 py-10 text-center text-slate-400 text-sm">
            {feed.length === 0 ? `No M-Pesa activity ${date === todayISO() ? 'today' : 'on this day'}.` : 'Nothing in this group.'}
          </div>
        ) : (
          <div className="bg-white border border-slate-100 rounded-2xl divide-y divide-slate-100 overflow-hidden">
            {shown.map((f) => {
              const k = KIND[f.kind];
              return (
                <div key={f.key} className="px-4 py-3 flex items-center gap-3">
                  <span className={`w-10 h-10 rounded-full grid place-items-center shrink-0 ${k.bg}`}><k.Icon size={18} /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="text-sm font-bold text-slate-800 truncate">{f.title}</div>
                      <div className={`text-sm font-black whitespace-nowrap ${k.amt}`}>{k.sign}KES {fmt(f.amount)}</div>
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <div className="text-xs text-slate-400 truncate">{timeOf(f.at)}{f.sub ? ` · ${f.sub}` : ''}</div>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap ${k.pill}`}>{f.pill}</span>
                    </div>
                    {f.canGiveUp && (
                      <button disabled={busyId === f.row.id} onClick={() => handleGiveUp(f.row)} className="mt-1 text-xs font-bold text-slate-500 hover:text-red-600">
                        {busyId === f.row.id ? 'Saving…' : 'Give up on this'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {filter === 'wait' && waitCount > 0 && (
          <p className="text-xs text-slate-500 mt-2 px-1">These are requests sent to a customer's phone that were not completed. They are not money in.</p>
        )}
      </section>

      <MpesaSettings tenant={tenant} />
    </div>
  );
}
