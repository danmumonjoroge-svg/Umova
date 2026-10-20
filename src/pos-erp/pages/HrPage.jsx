// Staff records: employees, daily attendance and leave. Salary is shown and editable only to people who
// hold the payroll permission; the database enforces that, this page only follows it.
import React, { useCallback, useEffect, useState } from 'react';
import { hrService } from '../services/hrService';
import { usePermissions } from '../navigation/PermissionsContext';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { singleFlight } from '../utils/singleFlight';

const todayNairobi = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
const STATUSES = [['PRESENT', 'Present'], ['LATE', 'Late'], ['ABSENT', 'Absent'], ['LEAVE', 'On leave'], ['OFF', 'Day off']];
const LEAVE_TYPES = [['ANNUAL', 'Annual'], ['SICK', 'Sick'], ['MATERNITY', 'Maternity'], ['PATERNITY', 'Paternity'], ['UNPAID', 'Unpaid'], ['OTHER', 'Other']];
const EMPTY = { full_name: '', employee_no: '', phone: '', job_title: '', employment_type: 'PERMANENT', start_date: '', basic_salary: '', tax_pin: '', nssf_no: '', sha_no: '', national_id: '', status: 'ACTIVE' };
const inp = 'mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm';

export default function HrPage() {
  const { tenant } = usePosErpAuth();
  const { can } = usePermissions();
  const business = tenant?.business_id;
  const [tab, setTab] = useState('people');
  const [emps, setEmps] = useState(null);
  const [leave, setLeave] = useState([]);
  const [att, setAtt] = useState([]);
  const [day, setDay] = useState(todayNairobi());
  const [edit, setEdit] = useState(null);
  const [lv, setLv] = useState({ employee: '', type: 'ANNUAL', from: '', to: '', reason: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canSalary = can('payroll.access');

  const load = useCallback(async () => {
    if (!business) return;
    try {
      setEmps(await hrService.listEmployees(business));
      setLeave(await hrService.listLeave(business));
      setAtt(await hrService.attendanceMonth(business, day));
      setError('');
    } catch (e) { setError(e.message); setEmps([]); }
  }, [business, day]);
  useEffect(() => { load(); }, [load]);

  const act = (key, fn) => singleFlight(key, async () => {
    setBusy(true); setError('');
    try { await fn(); await load(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  });
  const saveEmp = act('hr-save', async () => {
    const d = { ...edit }; if (!canSalary) delete d.basic_salary;
    await hrService.saveEmployee(business, edit.id, d); setEdit(null);
  });
  const mark = (id, status) => act(`hr-att-${id}`, () => hrService.setAttendance(id, day, status))();
  const reqLeave = act('hr-leave', async () => {
    await hrService.requestLeave(lv.employee, lv.type, lv.from, lv.to, lv.reason); setLv({ employee: '', type: 'ANNUAL', from: '', to: '', reason: '' });
  });
  const decide = (id, ok) => act(`hr-dec-${id}`, () => hrService.decideLeave(id, ok))();

  if (!can('employees.manage')) return <div className="p-6 text-center text-sm text-slate-600">Only the owner, or someone the owner has allowed, can open staff records.</div>;
  const active = (emps || []).filter((x) => x.status === 'ACTIVE');
  const todayStatus = (id) => att.find((a) => a.employee_id === id && a.work_date === day)?.status;

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-3">
      <h1 className="text-lg font-bold text-slate-900">Staff records</h1>
      <div className="flex gap-2">
        {[['people', 'People'], ['attendance', 'Attendance'], ['leave', 'Leave']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-full text-sm ${tab === k ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}>{l}</button>
        ))}
      </div>
      {error && <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-xl p-3">{error}</div>}
      {emps === null && <p className="text-sm text-slate-500">Loading…</p>}

      {tab === 'people' && (
        <div className="space-y-2">
          <button type="button" onClick={() => setEdit({ ...EMPTY })} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm">Add a person</button>
          {(emps || []).map((p) => (
            <div key={p.id} className="bg-white border border-slate-200 rounded-2xl p-3 flex justify-between gap-2 items-center">
              <div className="min-w-0">
                <p className="font-semibold truncate">{p.full_name} {p.status === 'LEFT' && <span className="text-xs text-slate-500">(left)</span>}</p>
                <p className="text-xs text-slate-500">{[p.employee_no, p.job_title, p.employment_type].filter(Boolean).join(' · ')}{canSalary && p.basic_salary != null ? ` · KES ${Number(p.basic_salary).toLocaleString('en-KE')}/month` : ''}</p>
              </div>
              <button type="button" onClick={() => setEdit({ ...EMPTY, ...Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v ?? ''])) })} className="text-sm underline">Edit</button>
            </div>
          ))}
          {emps && emps.length === 0 && <p className="text-sm text-slate-500">No one added yet.</p>}
        </div>
      )}

      {tab === 'attendance' && (
        <div className="space-y-2">
          <label className="text-sm">Day <input type="date" value={day} max={todayNairobi()} onChange={(e) => setDay(e.target.value)} className="ml-2 border border-slate-300 rounded-lg px-2 py-1" /></label>
          {active.map((p) => (
            <div key={p.id} className="bg-white border border-slate-200 rounded-2xl p-3">
              <p className="font-semibold text-sm">{p.full_name}</p>
              <div className="flex gap-1 flex-wrap mt-1">
                {STATUSES.map(([k, l]) => (
                  <button key={k} type="button" disabled={busy} onClick={() => mark(p.id, k)} className={`px-2.5 py-1 rounded-full text-xs ${todayStatus(p.id) === k ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'}`}>{l}</button>
                ))}
              </div>
            </div>
          ))}
          {active.length === 0 && <p className="text-sm text-slate-500">No active staff.</p>}
        </div>
      )}

      {tab === 'leave' && (
        <div className="space-y-3">
          <div className="bg-white border border-slate-200 rounded-2xl p-3 grid sm:grid-cols-2 gap-2">
            <label className="text-sm">Who<select className={inp} value={lv.employee} onChange={(e) => setLv({ ...lv, employee: e.target.value })}><option value="">Choose…</option>{active.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select></label>
            <label className="text-sm">Type<select className={inp} value={lv.type} onChange={(e) => setLv({ ...lv, type: e.target.value })}>{LEAVE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="text-sm">From<input type="date" className={inp} value={lv.from} onChange={(e) => setLv({ ...lv, from: e.target.value })} /></label>
            <label className="text-sm">To<input type="date" className={inp} value={lv.to} onChange={(e) => setLv({ ...lv, to: e.target.value })} /></label>
            <label className="text-sm sm:col-span-2">Reason<input className={inp} value={lv.reason} onChange={(e) => setLv({ ...lv, reason: e.target.value })} /></label>
            <button type="button" disabled={busy || !lv.employee || !lv.from || !lv.to} onClick={reqLeave} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm disabled:opacity-50 sm:col-span-2">Record leave request</button>
          </div>
          {leave.map((l) => (
            <div key={l.id} className="bg-white border border-slate-200 rounded-2xl p-3 flex justify-between gap-2 items-center">
              <div className="text-sm"><p className="font-semibold">{l.employee_name} · {l.leave_type.toLowerCase()}</p><p className="text-xs text-slate-500">{l.from_date} to {l.to_date} ({l.days} day{l.days === 1 ? '' : 's'}) · {l.status.toLowerCase()}</p></div>
              {l.status === 'REQUESTED' && <div className="flex gap-1"><button type="button" disabled={busy} onClick={() => decide(l.id, true)} className="px-2 py-1 rounded-lg bg-emerald-700 text-white text-xs">Approve</button><button type="button" disabled={busy} onClick={() => decide(l.id, false)} className="px-2 py-1 rounded-lg bg-slate-200 text-xs">Refuse</button></div>}
            </div>
          ))}
        </div>
      )}

      {edit && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-2">
          <div className="bg-white rounded-2xl p-4 w-full max-w-lg max-h-[90vh] overflow-auto space-y-2">
            <p className="font-bold">{edit.id ? 'Edit person' : 'Add a person'}</p>
            <div className="grid grid-cols-2 gap-2">
              {[['full_name', 'Full name'], ['employee_no', 'Employee no.'], ['phone', 'Phone'], ['job_title', 'Job title'], ['start_date', 'Start date', 'date'], ['tax_pin', 'KRA PIN'], ['nssf_no', 'NSSF no.'], ['sha_no', 'SHA no.'], ['national_id', 'National ID']].map(([k, l, t]) => (
                <label key={k} className="text-sm">{l}<input type={t || 'text'} className={inp} value={edit[k] ?? ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></label>
              ))}
              <label className="text-sm">Type<select className={inp} value={edit.employment_type} onChange={(e) => setEdit({ ...edit, employment_type: e.target.value })}>{['PERMANENT', 'CONTRACT', 'CASUAL', 'INTERN'].map((x) => <option key={x}>{x}</option>)}</select></label>
              <label className="text-sm">Status<select className={inp} value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}><option value="ACTIVE">Working</option><option value="LEFT">Left</option></select></label>
              {canSalary && <label className="text-sm col-span-2">Basic salary per month (KES)<input type="number" min="0" step="0.01" className={inp} value={edit.basic_salary ?? ''} onChange={(e) => setEdit({ ...edit, basic_salary: e.target.value })} /></label>}
            </div>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setEdit(null)} className="px-3 py-2 rounded-xl bg-slate-100 text-sm">Cancel</button>
              <button type="button" disabled={busy} onClick={saveEmp} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm disabled:opacity-50">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
