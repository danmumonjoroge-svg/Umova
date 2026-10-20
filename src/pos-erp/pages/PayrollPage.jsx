// Payroll: statutory rates, monthly runs, approval and payslips. Pay is worked out in the database from the
// rates table. A run cannot be approved until every rate in force for that month has been confirmed by the
// owner against the official source. The system records pay; it does not move money.
import React, { useCallback, useEffect, useState } from 'react';
import { payrollService } from '../services/hrService';
import { settingsService } from '../services/settingsService';
import { usePermissions } from '../navigation/PermissionsContext';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { singleFlight } from '../utils/singleFlight';
import { printDocument, escapeHtml } from '../utils/printDocument';
import { businessHeaderHtml } from '../utils/businessHeader';

const money = (n) => Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const CODE_LABEL = { PAYE_BANDS: 'PAYE tax bands', PERSONAL_RELIEF: 'Personal relief', NSSF: 'NSSF', SHIF: 'SHIF (health)', HOUSING_LEVY: 'Housing levy' };
const monthBounds = (ym) => { const [y, m] = ym.split('-').map(Number); const last = new Date(y, m, 0).getDate(); return [`${ym}-01`, `${ym}-${String(last).padStart(2, '0')}`]; };
const thisMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date()).slice(0, 7);
const inp = 'mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm';

export function payslipHtml(biz, run, l) {
  const row = (a, b, strong) => `<tr><td${strong ? ' class="bold"' : ''}>${escapeHtml(a)}</td><td class="right${strong ? ' bold' : ''}">${escapeHtml(b)}</td></tr>`;
  return `${businessHeaderHtml(biz)}
    <div class="divider"></div>
    <div class="center bold" style="font-size:14px;">Payslip</div>
    <div class="center muted">${escapeHtml(run.period_start)} to ${escapeHtml(run.period_end)}</div>
    <div style="margin-top:6px;"><span class="bold">${escapeHtml(l.employee_name)}</span><br/>${escapeHtml(l.job_title || '')}</div>
    <div class="muted">${[l.tax_pin && `KRA PIN ${l.tax_pin}`, l.nssf_no && `NSSF ${l.nssf_no}`, l.sha_no && `SHA ${l.sha_no}`].filter(Boolean).map(escapeHtml).join(' · ')}</div>
    <div class="divider"></div>
    <table>
      ${row('Basic pay', money(l.basic))}${row('Allowances', money(l.allowances))}${row('Gross pay', money(l.gross), true)}
      ${row('NSSF', `- ${money(l.nssf)}`)}${row('SHIF', `- ${money(l.shif)}`)}${row('Housing levy', `- ${money(l.housing)}`)}
      ${row('Taxable pay', money(l.taxable))}${row('Tax before relief', money(l.paye_before_relief))}${row('Personal relief', `- ${money(l.relief)}`)}${row('PAYE', `- ${money(l.paye)}`)}
      ${Number(l.other_deductions) > 0 ? row('Other deductions', `- ${money(l.other_deductions)}`) : ''}
    </table>
    <div class="divider"></div>
    <table>${row('NET PAY (KES)', money(l.net), true)}</table>
    <div class="muted" style="margin-top:8px;">Employer also pays NSSF ${money(l.employer_nssf)} and housing levy ${money(l.employer_housing)}.</div>
    ${run.status === 'DRAFT' ? '<div class="center bold" style="margin-top:8px;">DRAFT — NOT APPROVED</div>' : ''}`;
}

export default function PayrollPage() {
  const { tenant } = usePosErpAuth();
  const { can } = usePermissions();
  const business = tenant?.business_id;
  const [tab, setTab] = useState('runs');
  const [rates, setRates] = useState([]);
  const [runs, setRuns] = useState(null);
  const [open, setOpen] = useState(null);
  const [month, setMonth] = useState(thisMonth());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rateForm, setRateForm] = useState(null);
  const canRun = can('payroll.access');

  const load = useCallback(async () => {
    if (!business) return;
    try { setRates(await payrollService.listRates()); setRuns(await payrollService.listRuns(business)); setError(''); }
    catch (e) { setError(e.message); setRuns([]); }
  }, [business]);
  useEffect(() => { load(); }, [load]);
  const openRun = async (id) => { try { setOpen(await payrollService.getRun(id)); } catch (e) { setError(e.message); } };

  const act = (key, fn) => singleFlight(key, async () => {
    setBusy(true); setError('');
    try { await fn(); await load(); if (open) await openRun(open.run.id); } catch (e) { setError(e.message); } finally { setBusy(false); }
  });
  const create = act('pr-create', async () => { const [s, e] = monthBounds(month); const r = await payrollService.createRun(business, s, e); await openRun(r.id); });
  const confirm = (r) => act(`pr-conf-${r.code}-${r.effective_from}`, () => payrollService.confirmRate(r.code, r.effective_from))();
  const saveRate = act('pr-rate', async () => {
    let params; try { params = JSON.parse(rateForm.params); } catch { throw new Error('The figures are not valid. Keep the same shape as the current rate.'); }
    await payrollService.setRate(rateForm.code, rateForm.from, params, rateForm.source); setRateForm(null);
  });
  const approve = act('pr-approve', () => payrollService.approve(open.run.id));
  const paid = act('pr-paid', () => payrollService.markPaid(open.run.id));
  const cancel = act('pr-cancel', async () => { const reason = window.prompt('Why is this run being cancelled?'); if (!reason) return; await payrollService.cancel(open.run.id, reason); setOpen(null); });
  const saveLine = (l, a, o) => act(`pr-line-${l.id}`, () => payrollService.editLine(l.id, Number(a) || 0, Number(o) || 0, l.notes))();
  const printSlip = async (l) => {
    try {
      const biz = await settingsService.getBusinessProfile(business).catch(() => null);
      printDocument(`Payslip — ${l.employee_name}`, payslipHtml(biz, open.run, l));
    } catch (e) { setError(e.message); }
  };

  if (!can('payroll.access')) return <div className="p-6 text-center text-sm text-slate-600">Payroll is open only to the owner, or someone the owner has allowed.</div>;
  const unconfirmed = rates.filter((r) => !r.confirmed_at);

  return (
    <div className="p-4 max-w-4xl mx-auto space-y-3">
      <h1 className="text-lg font-bold text-slate-900">Payroll</h1>
      <p className="text-xs text-slate-500">Pay is worked out from the rates below. The system records pay and prints payslips; it does not send money or file returns with KRA, NSSF or SHA.</p>
      {unconfirmed.length > 0 && <div className="text-sm bg-amber-50 text-amber-900 border border-amber-200 rounded-xl p-3">{unconfirmed.length} rate(s) are not yet confirmed. The starting rates came from public summaries. Check each against KRA, NSSF and SHA, then confirm. A run cannot be approved until then.</div>}
      {error && <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-xl p-3">{error}</div>}
      <div className="flex gap-2">{[['runs', 'Pay runs'], ['rates', 'Rates']].map(([k, l]) => <button key={k} type="button" onClick={() => { setTab(k); setOpen(null); }} className={`px-3 py-1.5 rounded-full text-sm ${tab === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{l}</button>)}</div>

      {tab === 'rates' && (
        <div className="space-y-2">
          {rates.map((r) => (
            <div key={`${r.code}${r.effective_from}`} className="bg-white border border-slate-200 rounded-2xl p-3 space-y-1">
              <div className="flex justify-between gap-2 flex-wrap"><p className="font-semibold">{CODE_LABEL[r.code] || r.code} <span className="text-xs text-slate-500">from {r.effective_from}</span></p>
                {r.confirmed_at ? <span className="text-xs text-emerald-700">Confirmed{r.confirmed_by_name ? ` by ${r.confirmed_by_name}` : ''}</span> : (canRun && <button type="button" disabled={busy} onClick={() => confirm(r)} className="px-2 py-1 rounded-lg bg-emerald-700 text-white text-xs">Confirm after checking</button>)}</div>
              <pre className="text-xs bg-slate-50 rounded-lg p-2 overflow-auto whitespace-pre-wrap">{JSON.stringify(r.params)}</pre>
              <p className="text-xs text-slate-500">Source: {r.source}</p>
              {canRun && <button type="button" className="text-xs underline" onClick={() => setRateForm({ code: r.code, from: r.effective_from, params: JSON.stringify(r.params), source: '' })}>Change or add a new rate</button>}
            </div>
          ))}
        </div>
      )}

      {tab === 'runs' && !open && (
        <div className="space-y-2">
          {canRun && (
            <div className="bg-white border border-slate-200 rounded-2xl p-3 flex gap-2 items-end flex-wrap">
              <label className="text-sm">Month<input type="month" className={inp} value={month} onChange={(e) => setMonth(e.target.value)} /></label>
              <button type="button" disabled={busy} onClick={create} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm disabled:opacity-50">Prepare pay run</button>
            </div>
          )}
          {(runs || []).map((r) => (
            <button key={r.id} type="button" onClick={() => openRun(r.id)} className="w-full text-left bg-white border border-slate-200 rounded-2xl p-3 flex justify-between gap-2">
              <span><span className="font-semibold">{r.period_start.slice(0, 7)}</span> · {r.status.toLowerCase()}{r.self_approved ? ' (owner approved own run)' : ''}</span>
              <span className="tabular-nums text-sm">{r.totals?.employees} staff · net KES {money(r.totals?.net)}</span>
            </button>
          ))}
          {runs && runs.length === 0 && <p className="text-sm text-slate-500">No pay runs yet.</p>}
        </div>
      )}

      {tab === 'runs' && open && (
        <div className="space-y-2">
          <button type="button" onClick={() => setOpen(null)} className="text-sm underline">← All pay runs</button>
          <div className="bg-white border border-slate-200 rounded-2xl p-3">
            <p className="font-bold">{open.run.period_start} to {open.run.period_end} · {open.run.status.toLowerCase()}</p>
            <p className="text-sm text-slate-600">Gross {money(open.run.totals?.gross)} · PAYE {money(open.run.totals?.paye)} · NSSF {money(open.run.totals?.nssf)} · SHIF {money(open.run.totals?.shif)} · Housing {money(open.run.totals?.housing)} · <b>Net {money(open.run.totals?.net)}</b></p>
            <p className="text-xs text-slate-500">Employer cost with its own NSSF and levy: KES {money(open.run.totals?.employer_cost)}</p>
            {canRun && <div className="flex gap-2 mt-2 flex-wrap">
              {open.run.status === 'DRAFT' && <button type="button" disabled={busy} onClick={approve} className="px-3 py-2 rounded-xl bg-emerald-700 text-white text-sm">Approve</button>}
              {open.run.status === 'APPROVED' && <button type="button" disabled={busy} onClick={paid} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm">Mark as paid</button>}
              {['DRAFT', 'APPROVED'].includes(open.run.status) && <button type="button" disabled={busy} onClick={cancel} className="px-3 py-2 rounded-xl bg-slate-200 text-sm">Cancel run</button>}
            </div>}
          </div>
          {open.lines.map((l) => <LineCard key={l.id} l={l} editable={canRun && open.run.status === 'DRAFT'} busy={busy} onSave={saveLine} onPrint={printSlip} />)}
        </div>
      )}

      {rateForm && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-2">
          <div className="bg-white rounded-2xl p-4 w-full max-w-lg space-y-2">
            <p className="font-bold">New rate: {CODE_LABEL[rateForm.code]}</p>
            <p className="text-xs text-slate-500">Choose the date it starts. Earlier months keep the rate they used. A changed rate must be confirmed again.</p>
            <label className="text-sm block">Starts on<input type="date" className={inp} value={rateForm.from} onChange={(e) => setRateForm({ ...rateForm, from: e.target.value })} /></label>
            <label className="text-sm block">Figures<textarea rows={4} className={`${inp} font-mono text-xs`} value={rateForm.params} onChange={(e) => setRateForm({ ...rateForm, params: e.target.value })} /></label>
            <label className="text-sm block">Where does this come from? (required)<input className={inp} value={rateForm.source} onChange={(e) => setRateForm({ ...rateForm, source: e.target.value })} placeholder="e.g. KRA public notice, 1 July 2026" /></label>
            <div className="flex gap-2 justify-end"><button type="button" onClick={() => setRateForm(null)} className="px-3 py-2 rounded-xl bg-slate-100 text-sm">Cancel</button><button type="button" disabled={busy || rateForm.source.trim().length < 5} onClick={saveRate} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm disabled:opacity-50">Save</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function LineCard({ l, editable, busy, onSave, onPrint }) {
  const [a, setA] = useState(String(l.allowances ?? 0));
  const [o, setO] = useState(String(l.other_deductions ?? 0));
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3 space-y-1">
      <div className="flex justify-between gap-2"><p className="font-semibold">{l.employee_name}</p><p className="font-bold tabular-nums">Net {money(l.net)}</p></div>
      <p className="text-xs text-slate-500">Basic {money(l.basic)} + allowances {money(l.allowances)} = gross {money(l.gross)} · NSSF {money(l.nssf)} · SHIF {money(l.shif)} · Housing {money(l.housing)} · PAYE {money(l.paye)}{Number(l.other_deductions) > 0 ? ` · Other ${money(l.other_deductions)}` : ''}</p>
      {editable && (
        <div className="flex gap-2 items-end flex-wrap">
          <label className="text-xs">Allowances<input type="number" min="0" step="0.01" className={inp} value={a} onChange={(e) => setA(e.target.value)} /></label>
          <label className="text-xs">Other deductions<input type="number" min="0" step="0.01" className={inp} value={o} onChange={(e) => setO(e.target.value)} /></label>
          <button type="button" disabled={busy} onClick={() => onSave(l, a, o)} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs">Recalculate</button>
        </div>
      )}
      <button type="button" onClick={() => onPrint(l)} className="text-xs underline">Print payslip</button>
    </div>
  );
}
