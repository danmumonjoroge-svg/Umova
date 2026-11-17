// Staff payroll: employees, monthly pay runs (PAYE, NSSF, SHIF, Housing Levy, NITA calculated in the database), approval, payment and remittance.
// Salaries are sensitive: the whole page needs the approve right (bursar, principal). Each step posts its own journal (elimu_1001).
import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useElimuFinance } from '../hooks/useElimuFinance';
import { FitPage, LoadingBlock, EmptyBlock, Notice, DataCard, inputCls } from '../../../components/CardKit';
import Sheet from '../../components/AppSheet.jsx';
import { fromDb, formatMoney, toCents, MoneyError } from '../utils/money';

const M = (v) => formatMoney(fromDb(v));
const today = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);
const PAY = [['BANK', 'Bank'], ['MPESA', 'M-Pesa'], ['CASH_ON_HAND', 'Cash']];
const Btn = ({ children, tone, ...p }) => <button type="button" {...p} className={`px-3 min-h-[38px] rounded-lg text-sm disabled:opacity-50 ${tone === 'solid' ? 'bg-[#1F6B45] text-white' : 'border border-[#1F6B45] text-[#1F6B45]'}`}>{children}</button>;
const monthLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });

function EmployeeSheet({ ctx, emp, onClose, onDone }) {
  const [f, setF] = useState({ name: emp?.name || '', title: emp?.job_title || '', kra: emp?.kra_pin || '', nssf: emp?.nssf_no || '', shif: emp?.shif_no || '', basic: emp ? String(fromDb(emp.basic) / 100) : '', allow: emp ? String(fromDb(emp.allowances) / 100) : '0', paye: emp ? emp.pays_paye : true, active: emp ? emp.is_active : true });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async () => {
    if (f.name.trim().length < 2) return setErr('Enter the employee name.');
    let basic, allow = 0; try { basic = toCents(f.basic); if (f.allow) allow = toCents(f.allow); } catch (e) { return setErr(e instanceof MoneyError ? e.message : 'Enter the pay as a number.'); }
    setBusy(true);
    try { await ctx.api.prSaveEmployee(ctx.businessId, { id: emp?.id, name: f.name.trim(), jobTitle: f.title.trim(), kraPin: f.kra.trim(), nssfNo: f.nssf.trim(), shifNo: f.shif.trim(), basicCents: basic, allowanceCents: allow, paysPaye: f.paye, isActive: f.active });
      await onDone(emp ? 'Employee updated.' : 'Employee added.'); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return <Sheet title={emp ? 'Edit employee' : 'Add employee'} onClose={onClose}>{err && <Notice tone="bad">{err}</Notice>}<div className="space-y-3">
    <input className={inputCls} placeholder="Full name" value={f.name} onChange={set('name')} /><input className={inputCls} placeholder="Job title (optional)" value={f.title} onChange={set('title')} />
    <div className="grid grid-cols-2 gap-2"><input className={inputCls} inputMode="decimal" placeholder="Basic pay / month" value={f.basic} onChange={set('basic')} /><input className={inputCls} inputMode="decimal" placeholder="Allowances / month" value={f.allow} onChange={set('allow')} /></div>
    <div className="grid grid-cols-3 gap-2"><input className={inputCls} placeholder="KRA PIN" value={f.kra} onChange={set('kra')} /><input className={inputCls} placeholder="NSSF no." value={f.nssf} onChange={set('nssf')} /><input className={inputCls} placeholder="SHA no." value={f.shif} onChange={set('shif')} /></div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.paye} onChange={set('paye')} /> Pays PAYE (untick only if exempt)</label>
    {emp && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5" checked={f.active} onChange={set('active')} /> Currently employed</label>}
    <p className="text-xs text-[#6F7461]">Allowances are treated as taxable. Changes apply to pay runs created from now on.</p>
    <button type="button" disabled={busy} onClick={save} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button></div></Sheet>;
}

function SettleSheet({ ctx, run, kind, onClose, onDone }) {
  const pay = kind === 'PAY'; const amt = pay ? run.net : run.statutory;
  const [f, setF] = useState({ date: today(), from: 'BANK', ref: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const go = async () => { setBusy(true); try { await (pay ? ctx.api.prPaySalaries : ctx.api.prRemit)(run.id, f.date, f.from, f.ref.trim()); await onDone(pay ? 'Salaries recorded as paid.' : 'Statutory amounts recorded as remitted.'); onClose(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return <Sheet title={pay ? 'Pay salaries' : 'Remit statutory amounts'} onClose={onClose}>{err && <Notice tone="bad">{err}</Notice>}<div className="space-y-3">
    <p className="text-sm">{pay ? 'Net pay to staff' : 'PAYE, NSSF, SHIF, Housing Levy and NITA'} for {monthLabel(run.period)}: <b>{M(amt)}</b></p>
    <div className="grid grid-cols-2 gap-2"><select className={inputCls} value={f.from} onChange={set('from')}>{PAY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><input className={inputCls} type="date" min={run.period} max={today()} value={f.date} onChange={set('date')} /></div>
    <input className={inputCls} placeholder="Reference (optional)" value={f.ref} onChange={set('ref')} />
    <button type="button" disabled={busy} onClick={go} className="w-full h-12 rounded-2xl bg-[#12261F] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Record'}</button></div></Sheet>;
}

function Slips({ lines }) {
  return <div className="mt-2 overflow-x-auto"><table className="w-full text-xs min-w-[560px]"><thead><tr className="text-left text-[#6F7461]"><th className="py-1">Employee</th><th>Gross</th><th>NSSF</th><th>SHIF</th><th>Housing</th><th>PAYE</th><th>Net</th></tr></thead>
    <tbody>{lines.map((l) => <tr key={l.id} className="border-t border-[#F0ECD9]"><td className="py-1">{l.employee_name}</td><td>{M(l.gross)}</td><td>{M(l.nssf_ee)}</td><td>{M(l.shif)}</td><td>{M(l.housing_ee)}</td><td>{M(l.paye)}</td><td><b>{M(l.net)}</b></td></tr>)}</tbody></table></div>;
}

export default function ElimuPayrollPage() {
  const ctx = useElimuFinance(); const { api, businessId, can, ready } = ctx;
  const [tab, setTab] = useState('runs'); const [emps, setEmps] = useState(null); const [runs, setRuns] = useState(null); const [open, setOpen] = useState(null); const [lines, setLines] = useState({});
  const [sheet, setSheet] = useState(null); const [err, setErr] = useState(null); const [note, setNote] = useState(null); const [month, setMonth] = useState(thisMonth());
  const load = useCallback(async () => {
    try { const [e, r] = await Promise.all([api.list('elimu_pr_employees', businessId, { order: { col: 'name', asc: true }, limit: 500 }), api.list('elimu_pr_runs', businessId, { order: { col: 'period', asc: false }, limit: 60 })]); setEmps(e); setRuns(r); }
    catch (e) { setErr(e.message); setEmps([]); setRuns([]); }
  }, [api, businessId]);
  useEffect(() => { if (ready && can('approve')) load(); }, [ready, can, load]);
  const done = async (m) => { setNote(m); setErr(null); setLines({}); await load(); };
  const show = async (r) => { setOpen(open === r.id ? null : r.id); if (!lines[r.id]) { try { setLines((x) => ({ ...x, [r.id]: [] })); const l = await api.list('elimu_pr_lines', businessId, { order: { col: 'employee_name', asc: true }, limit: 500, filters: { run_id: r.id } }); setLines((x) => ({ ...x, [r.id]: l })); } catch (e) { setErr(e.message); } } };
  const run = async (fn, ok) => { setErr(null); try { await fn(); await done(ok); } catch (e) { setErr(e.message); } };
  if (!ready) return <LoadingBlock />;
  if (!can('approve')) return <FitPage title="Staff & payroll"><Notice tone="gold">Payroll is limited to the bursar and principal.</Notice></FitPage>;
  if (emps === null || runs === null) return <FitPage title="Staff & payroll"><LoadingBlock /></FitPage>;
  const live = runs.filter((r) => r.status !== 'VOIDED'); const active = emps.filter((e) => e.is_active);
  return (
    <FitPage title="Staff & payroll" subtitle="Pay runs, payslips and statutory deductions">
      {err && <Notice tone="bad">{err}</Notice>}{note && <Notice tone="good">{note}</Notice>}
      <div className="flex items-center gap-1.5 mb-3">{[['runs', 'Pay runs'], ['staff', 'Employees']].map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={`h-9 px-3 rounded-full text-sm font-semibold border ${tab === k ? 'bg-[#12261F] text-white border-[#12261F]' : 'bg-white border-[#E3DBB8]'}`}>{l}</button>)}
        <span className="flex-1" />{tab === 'staff' && <Btn tone="solid" onClick={() => setSheet({ emp: null })}><Plus size={14} className="inline" /> Employee</Btn>}</div>
      {tab === 'staff' ? (!emps.length ? <EmptyBlock>No employees yet. Add the staff you pay each month.</EmptyBlock> : emps.map((e) => (
        <button key={e.id} type="button" onClick={() => setSheet({ emp: e })} className="block w-full text-left"><DataCard title={e.name} subtitle={`${e.job_title || 'Staff'}${e.is_active ? '' : ' · no longer employed'}`} big={M(fromDb(e.basic) + fromDb(e.allowances))} metrics={[{ label: 'Basic', value: M(e.basic) }, { label: 'Allowances', value: M(e.allowances) }]} /></button>)))
      : (<>
        <div className="rounded-xl border border-[#E3DBB8] bg-white p-3 mb-3 flex items-end gap-2"><label className="flex-1 text-xs text-[#6F7461]">Start a pay run for<input type="month" max={thisMonth()} className={`${inputCls} mt-1`} value={month} onChange={(e) => setMonth(e.target.value)} /></label>
          <Btn tone="solid" disabled={!active.length} onClick={() => run(() => api.prCreateRun(businessId, `${month}-01`), 'Draft pay run created. Check it, then ask another person to approve.')}>Create</Btn></div>
        {!active.length && <Notice tone="gold">Add at least one employee first.</Notice>}
        {!live.length && !runs.length ? <EmptyBlock>No pay runs yet.</EmptyBlock> : runs.map((r) => {
          const st = r.status === 'VOIDED' ? 'Voided' : r.status === 'DRAFT' ? 'Draft — not posted' : `${r.paid_on ? 'Salaries paid' : 'Salaries unpaid'} · ${r.remitted_on ? 'statutory remitted' : 'statutory not remitted'}`;
          return <div key={r.id} className="rounded-2xl border border-[#E3DBB8] bg-white p-3 mb-2 text-sm">
            <button type="button" className="w-full text-left" onClick={() => show(r)}><div className="flex justify-between"><b>{monthLabel(r.period)}</b><b>{M(r.net)} net</b></div>
              <div className="text-xs text-[#6F7461]">Gross {M(r.gross)} · employer cost {M(r.employer_cost)} · statutory {M(r.statutory)}</div><div className="text-xs mt-0.5">{st}</div></button>
            {open === r.id && (lines[r.id] ? <Slips lines={lines[r.id]} /> : <LoadingBlock />)}
            {r.status !== 'VOIDED' && <div className="flex flex-wrap gap-2 mt-2">
              {r.status === 'DRAFT' && <Btn tone="solid" onClick={() => run(() => api.prApproveRun(r.id), 'Approved and posted to the ledger.')}>Approve</Btn>}
              {r.status === 'APPROVED' && !r.paid_on && <Btn tone="solid" onClick={() => setSheet({ run: r, kind: 'PAY' })}>Pay salaries</Btn>}
              {r.status === 'APPROVED' && !r.remitted_on && <Btn tone="solid" onClick={() => setSheet({ run: r, kind: 'REMIT' })}>Remit statutory</Btn>}
              {!r.paid_on && !r.remitted_on && <Btn onClick={() => { const why = window.prompt('Why is this pay run voided?'); if (why && why.trim().length >= 3) run(() => api.prVoidRun(r.id, why.trim()), 'Pay run voided.'); }}>Void</Btn>}
            </div>}
          </div>; })}
        <p className="text-xs text-[#6F7461] mt-2">Rates used: Kenya 2026 (PAYE bands and personal relief, NSSF 6% to the upper limit, SHIF 2.75% with a 300 minimum, Housing Levy 1.5% each). They are stored as data and a principal can add new rates from a given month; confirm them against KRA, NSSF and SHA.</p></>)}
      {sheet && 'emp' in sheet && <EmployeeSheet ctx={ctx} emp={sheet.emp} onClose={() => setSheet(null)} onDone={done} />}
      {sheet && sheet.run && <SettleSheet ctx={ctx} run={sheet.run} kind={sheet.kind} onClose={() => setSheet(null)} onDone={done} />}
    </FitPage>);
}
