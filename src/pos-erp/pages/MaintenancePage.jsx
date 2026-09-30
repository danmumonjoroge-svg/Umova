// src/pos-erp/pages/MaintenancePage.jsx — My Maintenance
// Costs are posted to the existing expenses (lb_expenses via record_expense) when a job is completed,
// so they reduce profit exactly like anything entered under My Spending.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Wrench, Loader2, Plus, X } from 'lucide-react';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { useUnits } from '../hooks/useProperty';
import { maintenanceService, CATEGORIES, PRIORITIES, STATUS_LABEL, label } from '../services/maintenanceService';

const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' }) : '—');
const PRI = { LOW: 'bg-slate-100 text-slate-600', NORMAL: 'bg-blue-50 text-blue-700', HIGH: 'bg-amber-50 text-amber-700', URGENT: 'bg-red-50 text-red-700' };
const inp = 'w-full border border-slate-200 rounded-lg px-3 py-2 text-sm';
const PAY = [['CASH', 'Cash'], ['MOBILE_MONEY', 'M-Pesa'], ['BANK', 'Bank'], ['OTHER', 'Other']];

export default function MaintenancePage() {
  const { tenant, staffId } = usePosErpAuth();
  const { units } = useUnits();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [unitFilter, setUnitFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [openJob, setOpenJob] = useState(null);

  const load = useCallback(async () => {
    if (!tenant?.business_id) return; setLoading(true);
    try { setJobs(await maintenanceService.getAll({ businessId: tenant.business_id })); } catch (e) { setErr(e.message); }
    setLoading(false);
  }, [tenant]);
  useEffect(() => { load(); }, [load]);

  const stats = useMemo(() => {
    const live = jobs.filter((j) => !['COMPLETED', 'CANCELLED'].includes(j.status));
    const byUnit = {};
    jobs.filter((j) => j.status === 'COMPLETED').forEach((j) => { const k = j.unit?.unit_number || '?'; byUnit[k] = (byUnit[k] || 0) + Number(j.total_cost); });
    return {
      open: live.filter((j) => ['REPORTED', 'OPEN', 'ASSIGNED'].includes(j.status)).length,
      progress: jobs.filter((j) => j.status === 'IN_PROGRESS').length,
      done: jobs.filter((j) => j.status === 'COMPLETED').length,
      urgent: live.filter((j) => j.priority === 'URGENT').length,
      cost: jobs.filter((j) => j.status === 'COMPLETED').reduce((s, j) => s + Number(j.total_cost), 0),
      byUnit: Object.entries(byUnit).sort((a, b) => b[1] - a[1]),
    };
  }, [jobs]);

  const shown = jobs.filter((j) => (!unitFilter || j.unit_id === unitFilter) && (!statusFilter || j.status === statusFilter));
  const unitCost = unitFilter ? shown.filter((j) => j.status === 'COMPLETED').reduce((s, j) => s + Number(j.total_cost), 0) : null;

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div><h1 className="text-xl font-bold text-slate-800 flex items-center gap-2"><Wrench size={20} /> My Maintenance</h1>
          <p className="text-sm text-slate-500">Repairs and jobs for your units.</p></div>
        <button onClick={() => setCreating(true)} className="bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg flex items-center gap-1"><Plus size={16} /> New job</button>
      </div>
      {err && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{err}</div>}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {[['Open', stats.open], ['In progress', stats.progress], ['Completed', stats.done], ['Urgent', stats.urgent], ['Total spent', kes(stats.cost)]].map(([k, v]) => (
          <div key={k} className={`bg-white border rounded-2xl p-3 ${k === 'Urgent' && stats.urgent ? 'border-red-300' : 'border-slate-200'}`}><div className="text-xs text-slate-500">{k}</div><div className="font-bold text-slate-800">{v}</div></div>))}
      </div>
      {stats.byUnit.length > 0 && <div className="bg-white border border-slate-200 rounded-2xl p-3 mb-4 text-sm">
        <div className="text-xs text-slate-500 mb-1">Spent by unit</div>
        <div className="flex flex-wrap gap-x-5 gap-y-1">{stats.byUnit.map(([u, c]) => <span key={u}>Unit {u}: <b>{kes(c)}</b></span>)}</div></div>}

      <div className="flex flex-wrap gap-2 mb-3">
        <select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All units</option>{units.map((u) => <option key={u.id} value={u.id}>Unit {u.unit_number}</option>)}</select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
          <option value="">Any status</option>{Object.entries(STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        {unitCost !== null && <span className="text-sm text-slate-600 self-center">This unit's repairs so far: <b>{kes(unitCost)}</b></span>}
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide"><tr>
          <th className="text-left px-4 py-3">Job</th><th className="text-left px-4 py-3">Unit</th><th className="text-left px-4 py-3">Problem</th>
          <th className="text-center px-4 py-3">Priority</th><th className="text-center px-4 py-3">Status</th><th className="text-right px-4 py-3">Cost</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={6} className="text-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin inline mr-2" />Loading…</td></tr>}
            {!loading && shown.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-400">No jobs here yet.</td></tr>}
            {shown.map((j) => (
              <tr key={j.id} onClick={() => setOpenJob(j)} className="cursor-pointer hover:bg-slate-50">
                <td className="px-4 py-3"><div className="font-semibold text-slate-800">{j.reference_no}</div><div className="text-xs text-slate-500">{day(j.completed_date || j.reported_date)}</div></td>
                <td className="px-4 py-3">{j.unit?.unit_number}</td>
                <td className="px-4 py-3 max-w-xs truncate">{label(j.category)} — {j.description}</td>
                <td className="px-4 py-3 text-center"><span className={`text-[11px] font-bold px-2 py-1 rounded-full ${PRI[j.priority]}`}>{label(j.priority)}</span></td>
                <td className="px-4 py-3 text-center text-xs font-semibold">{STATUS_LABEL[j.status]}</td>
                <td className="px-4 py-3 text-right">{j.status === 'COMPLETED' ? kes(j.total_cost) : '—'}</td></tr>))}
          </tbody></table>
      </div>
      {creating && <NewJob units={units} tenant={tenant} staffId={staffId} onClose={(changed) => { setCreating(false); if (changed) load(); }} />}
      {openJob && <JobDetail job={openJob} staffId={staffId} onClose={(changed) => { setOpenJob(null); if (changed) load(); }} />}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (<div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4">
    <div className="bg-white rounded-t-2xl md:rounded-2xl w-full max-w-md shadow-xl p-5 max-h-[92vh] overflow-y-auto space-y-3">
      <div className="flex items-center justify-between"><h2 className="font-bold text-slate-800">{title}</h2><button onClick={() => onClose(false)}><X size={18} /></button></div>{children}</div></div>);
}

function NewJob({ units, tenant, staffId, onClose }) {
  const [f, setF] = useState({ unitId: '', description: '', category: 'PLUMBING', priority: 'NORMAL', reportedDate: new Date().toISOString().slice(0, 10) });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr('');
    try { await maintenanceService.create({ tenantId: tenant.id, businessId: tenant.business_id, unit: units.find((u) => u.id === f.unitId), ...f, createdBy: staffId }); onClose(true); }
    catch (e) { setErr(e.message); setBusy(false); }
  };
  const unit = units.find((u) => u.id === f.unitId);
  return (<Modal title="New maintenance job" onClose={onClose}>
    <select value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })} className={inp}><option value="">Choose unit…</option>{units.map((u) => <option key={u.id} value={u.id}>Unit {u.unit_number}{u.customer?.name ? ` — ${u.customer.name}` : ''}</option>)}</select>
    {unit && <p className="text-xs text-slate-500">Tenant: {unit.customer?.name || 'none (vacant)'}</p>}
    <textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={inp} rows={3} placeholder="What is the problem?" />
    <div className="grid grid-cols-2 gap-2">
      <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className={inp}>{CATEGORIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select>
      <select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} className={inp}>{PRIORITIES.map((c) => <option key={c} value={c}>{label(c)}</option>)}</select></div>
    <input type="date" value={f.reportedDate} onChange={(e) => setF({ ...f, reportedDate: e.target.value })} className={inp} />
    {err && <p className="text-sm text-red-600">{err}</p>}
    <button disabled={busy} onClick={submit} className="w-full bg-emerald-700 text-white font-semibold py-2 rounded-lg disabled:opacity-50">Save job</button></Modal>);
}

function JobDetail({ job, staffId, onClose }) {
  const [assignee, setAssignee] = useState(job.assigned_to || '');
  const [c, setC] = useState({ labour: job.labour_cost || '', materials: job.materials_cost || '', other: job.other_cost || '', pay: 'CASH', billing: 'BUSINESS', date: new Date().toISOString().slice(0, 10), notes: job.notes || '' });
  const [completing, setCompleting] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const total = (Number(c.labour) || 0) + (Number(c.materials) || 0) + (Number(c.other) || 0);
  const done = ['COMPLETED', 'CANCELLED'].includes(job.status);
  const go = async (fn, close = true) => { setBusy(true); setErr(''); try { await fn(); if (close) onClose(true); } catch (e) { setErr(e.message); } setBusy(false); };
  const step = (s) => go(() => maintenanceService.setStatus(job.id, s, s === 'ASSIGNED' ? assignee : null));

  return (<Modal title={`${job.reference_no} · Unit ${job.unit?.unit_number}`} onClose={onClose}>
    <p className="text-sm text-slate-700">{label(job.category)} — {job.description}</p>
    <p className="text-xs text-slate-500">Reported {day(job.reported_date)} · {label(job.priority)} priority · {STATUS_LABEL[job.status]}{job.customer?.name ? ` · Tenant: ${job.customer.name}` : ''}{job.assigned_to ? ` · Assigned to ${job.assigned_to}` : ''}</p>
    {job.status === 'COMPLETED' && <div className="text-sm border border-slate-200 rounded-xl p-3">Labour {kes(job.labour_cost)} + Materials {kes(job.materials_cost)} + Other {kes(job.other_cost)} = <b>{kes(job.total_cost)}</b>
      <div className="text-xs text-slate-500 mt-1">{job.expense_id ? 'Recorded under My Spending.' : 'No cost.'}{job.billing_choice === 'TENANT' ? ' Also charged to the tenant.' : ''}</div></div>}
    {err && <p className="text-sm text-red-600">{err}</p>}
    {!done && !completing && (<div className="space-y-2">
      <input value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inp} placeholder="Technician / contractor" />
      <div className="flex flex-wrap gap-2">
        {job.status === 'REPORTED' && <button disabled={busy} onClick={() => step('OPEN')} className="border border-slate-200 px-3 py-2 rounded-lg text-sm">Open</button>}
        {['REPORTED', 'OPEN', 'ASSIGNED'].includes(job.status) && <button disabled={busy} onClick={() => step('ASSIGNED')} className="border border-slate-200 px-3 py-2 rounded-lg text-sm">Assign</button>}
        {['OPEN', 'ASSIGNED'].includes(job.status) && <button disabled={busy} onClick={() => step('IN_PROGRESS')} className="border border-slate-200 px-3 py-2 rounded-lg text-sm">Start work</button>}
        <button disabled={busy} onClick={() => setCompleting(true)} className="bg-emerald-700 text-white px-3 py-2 rounded-lg text-sm font-semibold">Complete job</button>
        <button disabled={busy} onClick={() => step('CANCELLED')} className="text-red-600 px-3 py-2 text-sm">Cancel job</button></div></div>)}
    {completing && (<div className="space-y-2">
      {[['labour', 'Labour cost'], ['materials', 'Materials cost'], ['other', 'Other cost']].map(([k, l]) => (
        <input key={k} type="number" min="0" value={c[k]} onChange={(e) => setC({ ...c, [k]: e.target.value })} className={inp} placeholder={`${l} (KES)`} />))}
      <div className="text-sm font-semibold">Total: {kes(total)}</div>
      {total > 0 && <>
        <label className="text-xs text-slate-500">Paid with</label>
        <select value={c.pay} onChange={(e) => setC({ ...c, pay: e.target.value })} className={inp}>{PAY.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <label className="text-xs text-slate-500">Who bears the cost?</label>
        <select value={c.billing} onChange={(e) => setC({ ...c, billing: e.target.value })} className={inp}>
          <option value="BUSINESS">Business expense (default)</option>
          <option value="TENANT" disabled={!job.customer_id}>Charge tenant{!job.customer_id ? ' — no tenant on this job' : ''}</option></select>
        {c.billing === 'TENANT' && <p className="text-xs text-slate-500">The cost is still recorded as your expense; a matching charge is added to the tenant’s account and appears on their next invoice.</p>}</>}
      <input type="date" value={c.date} onChange={(e) => setC({ ...c, date: e.target.value })} className={inp} />
      <textarea value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} className={inp} rows={2} placeholder="Notes" />
      <button disabled={busy} onClick={() => go(() => maintenanceService.complete({ id: job.id, labour: c.labour, materials: c.materials, other: c.other, paymentMethod: c.pay, completedDate: c.date, notes: c.notes, billing: c.billing, createdBy: staffId }))}
        className="w-full bg-emerald-700 text-white font-semibold py-2 rounded-lg disabled:opacity-50">Complete{total > 0 ? ` and record ${kes(total)}` : ''}</button></div>)}
  </Modal>);
}
