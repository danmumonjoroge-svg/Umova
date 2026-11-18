// elimu/audit/pages/ActivityLogPage.jsx -- who did what and when (school management only). Read-only; CSV download.
import React, { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, Notice, fieldClass } from '../../services/platform.js';
import { useAsync } from '../../hooks/useAsync.js';
import { activityService, actionLabel } from '../services/activityService.js';
import { downloadCsv } from '../../attendance/reports/export.js';
import { friendlyError } from '../../utils/validation.js';

const iso = (d) => d.toISOString().slice(0, 10);
const when = (v) => (v ? new Date(v).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const COLS = [
  { key: 'at', label: 'When', fmt: (v) => (v ? new Date(v).toISOString().replace('T', ' ').slice(0, 19) : '') },
  { key: 'actor_name', label: 'Who' }, { key: 'action', label: 'Action', fmt: (v) => actionLabel(v) },
  { key: 'detail', label: 'Detail', fmt: (v) => (v ? JSON.stringify(v) : '') },
];

export default function ActivityLogPage() {
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 6 * 864e5))); const [to, setTo] = useState(() => iso(new Date())); const [action, setAction] = useState('');
  const { data, loading, error } = useAsync(() => activityService.list({ from, to, action }), [from, to, action]);
  const rows = data?.rows || []; const actions = data?.actions || [];
  return (
    <FitPage title="Activity log" icon={ScrollText} subtitle="Who did what in the school system">
      <div className="space-y-3">
        <div className="rounded-2xl border border-[#E3DBB8] bg-white p-3 grid grid-cols-2 gap-2">
          <label className="text-xs">From<input type="date" className={fieldClass} value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-xs">To<input type="date" className={fieldClass} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          <select className={`${fieldClass} col-span-2`} value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>{actions.map((a) => <option key={a} value={a}>{actionLabel(a)}</option>)}</select>
        </div>
        {error && <Notice tone="bad">{friendlyError(error)}</Notice>}
        {loading ? <LoadingBlock /> : rows.length === 0 ? <EmptyBlock title="No activity in this period" /> : (<>
          <div className="flex items-center justify-between text-xs text-[#6F7461]"><span>{rows.length} entr{rows.length === 1 ? 'y' : 'ies'}{rows.length >= 300 ? ' (latest 300; narrow the dates to see others)' : ''}</span>
            <button type="button" className="min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[#E3DBB8] bg-white" onClick={() => downloadCsv(`activity-${from}-to-${to}.csv`, COLS, rows)}>Download CSV</button></div>
          <ul className="space-y-2">{rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-[#E3DBB8] bg-white p-3 text-sm">
              <div className="flex justify-between gap-2"><b>{actionLabel(r.action)}</b><span className="text-xs text-[#6F7461]">{when(r.at)}</span></div>
              <div className="text-xs text-[#6F7461]">By {r.actor_name || 'the system'}</div>
              {r.detail && Object.keys(r.detail).length > 0 && <div className="text-xs mt-1 break-words">{Object.entries(r.detail).filter(([k]) => k !== 'module').map(([k, v]) => `${k.replace(/_/g, ' ')}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}</div>}
            </li>))}</ul></>)}
      </div>
    </FitPage>
  );
}
