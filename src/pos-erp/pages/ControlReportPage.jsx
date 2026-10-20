// Owner control report: reversals, cash and M-Pesa differences, staff changes, payroll approvals.
// Read-only. It only shows what the earlier screens recorded, so anything done outside them is not here.
import React, { useCallback, useEffect, useState } from 'react';
import { controlReportService } from '../services/controlReportService';
import { usePermissions } from '../navigation/PermissionsContext';

const money = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayNairobi = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
const daysAgo = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date(Date.now() - n * 864e5));
const LABEL = { STAFF_ROLE_CHANGED: 'Role changed', STAFF_PERMISSION_CHANGED: 'Permission changed', STAFF_STATUS_CHANGED: 'Staff switched on/off' };

function Card({ title, children, flag }) {
  return (
    <section className={`bg-white border rounded-2xl p-3 space-y-1 ${flag ? 'border-amber-300' : 'border-slate-200'}`}>
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}
const Line = ({ k, v, bad }) => <div className="flex justify-between text-sm"><span className="text-slate-600">{k}</span><span className={`tabular-nums ${bad ? 'text-red-700 font-semibold' : ''}`}>{v}</span></div>;

export default function ControlReportPage() {
  const { can } = usePermissions();
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(todayNairobi());
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { setR(await controlReportService.get(from, to)); } catch (e) { setError(e.message); setR(null); } finally { setLoading(false); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  if (!can('audit.view')) return <div className="p-6 text-center text-sm text-slate-600">You do not have permission to see the control report.</div>;
  const rv = r?.reversals, rc = r?.reconciliation, sc = r?.staff_changes, py = r?.payroll;

  return (
    <div className="p-4 max-w-3xl mx-auto space-y-3">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Control report</h1>
        <p className="text-xs text-slate-500">What happened in the period that needs an owner's eye. It shows only what was recorded through these screens. Days run on Nairobi time.</p>
      </div>
      <div className="flex gap-2 items-end flex-wrap text-sm">
        <label>From <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1" /></label>
        <label>To <input type="date" value={to} min={from} max={todayNairobi()} onChange={(e) => setTo(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1" /></label>
        {[7, 30, 90].map((n) => <button key={n} type="button" onClick={() => { setFrom(daysAgo(n)); setTo(todayNairobi()); }} className="px-2 py-1 rounded-full bg-slate-100 text-xs">Last {n} days</button>)}
      </div>
      {error && <div role="alert" className="text-sm bg-red-50 text-red-800 border border-red-200 rounded-xl p-3">{error}</div>}
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {r && (
        <>
          <Card title="Sale reversals" flag={rv.self_approved > 0}>
            <Line k="Requested" v={rv.requested} /><Line k="Approved" v={`${rv.approved} (${money(rv.approved_value)})`} />
            <Line k="Refused" v={rv.refused} /><Line k="Still waiting" v={rv.pending} bad={rv.pending > 0} />
            <Line k="Approved by the same person who asked" v={rv.self_approved} bad={rv.self_approved > 0} />
            {(rv.by_person || []).length > 0 && <div className="pt-1 text-xs text-slate-500">{rv.by_person.map((p) => `${p.name}: ${p.requests} request${p.requests === 1 ? '' : 's'}`).join(' · ')}</div>}
          </Card>
          <Card title="Cash and M-Pesa counts" flag={(rc.days_without_count || []).length > 0 || rc.days_with_difference > 0}>
            <Line k="Days counted" v={`${rc.days_counted} (${rc.signed_off} signed off, ${rc.waiting_sign_off} waiting)`} />
            <Line k="Cash short / over" v={`${money(rc.cash_short)} / ${money(rc.cash_over)}`} bad={rc.cash_short > 0} />
            <Line k="M-Pesa short / over" v={`${money(rc.mpesa_short)} / ${money(rc.mpesa_over)}`} bad={rc.mpesa_short > 0} />
            <Line k="Counts the owner signed off for themselves" v={rc.self_signed} />
            <Line k="Days with sales but no count" v={(rc.days_without_count || []).length} bad={(rc.days_without_count || []).length > 0} />
            {(rc.days_without_count || []).length > 0 && <p className="text-xs text-red-700">{rc.days_without_count.join(', ')}</p>}
          </Card>
          <Card title="Staff changes" flag={sc.permission_changes + sc.role_changes > 0}>
            <Line k="Roles changed" v={sc.role_changes} /><Line k="Permissions changed" v={sc.permission_changes} /><Line k="Staff switched on or off" v={sc.status_changes} />
            {(sc.recent || []).map((a, i) => <p key={i} className="text-xs text-slate-500">{new Date(a.at).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })} · {LABEL[a.action] || a.action} · by {a.by || 'unknown'}</p>)}
          </Card>
          {py && (
            <Card title="Payroll" flag={py.self_approved > 0}>
              <Line k="Pay runs" v={py.runs} /><Line k="Approved or paid" v={py.approved_or_paid} /><Line k="Cancelled" v={py.cancelled} />
              <Line k="Approved by the person who prepared them" v={py.self_approved} bad={py.self_approved > 0} /><Line k="Net pay marked paid" v={money(py.net_paid)} />
            </Card>
          )}
          <Card title="Everything recorded in the audit trail">
            {(r.audit_activity || []).length === 0 && <p className="text-sm text-slate-500">Nothing in this period.</p>}
            {(r.audit_activity || []).map((a) => <Line key={a.action} k={a.action.replace(/_/g, ' ').toLowerCase()} v={a.count} />)}
          </Card>
        </>
      )}
    </div>
  );
}
