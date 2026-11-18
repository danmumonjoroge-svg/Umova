// elimu/gate/pages/GateExitLogPage.jsx -- who left school, when, who released them and who collected them. Read-only; CSV download.
import React, { useState } from 'react';
import { DoorOpen } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, Notice, fieldClass } from '../../services/platform.js';
import { useAsync } from '../../hooks/useAsync.js';
import { gatePassService } from '../services/gatePassService.js';
import { downloadCsv } from '../../attendance/reports/export.js';
import { friendlyError } from '../../utils/validation.js';

const iso = (d) => d.toISOString().slice(0, 10);
const when = (v) => (v ? new Date(v).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
export const EXIT_COLUMNS = [
  { key: 'exited_at', label: 'Left at', fmt: (v) => (v ? new Date(v).toISOString().replace('T', ' ').slice(0, 16) : '') },
  { key: 'student_name', label: 'Student' }, { key: 'admission_no', label: 'Admission no' }, { key: 'class_name', label: 'Class' },
  { key: 'reason', label: 'Reason' }, { key: 'collector_name', label: 'Collected by' }, { key: 'collector_phone', label: 'Collector phone' },
  { key: 'requested_by_name', label: 'Teacher who requested' }, { key: 'parent_decided_at', label: 'Parent accepted at', fmt: (v) => (v ? new Date(v).toISOString().replace('T', ' ').slice(0, 16) : '') },
  { key: 'released_by', label: 'Released by' }, { key: 'exit_note', label: 'Gate note' },
];

export default function GateExitLogPage() {
  const [from, setFrom] = useState(() => iso(new Date(Date.now() - 6 * 864e5))); const [to, setTo] = useState(() => iso(new Date())); const [q, setQ] = useState('');
  const { data, loading, error } = useAsync(() => gatePassService.exitLog(from, to, q.trim() || null), [from, to, q]);
  const rows = data?.rows || [];
  return (
    <FitPage title="Exit log" icon={DoorOpen} subtitle="Every student who left through the gate on a parent-approved pass">
      <div className="space-y-3">
        <div className="rounded-2xl border border-[#E3DBB8] bg-white p-3 grid grid-cols-2 gap-2">
          <label className="text-xs">From<input type="date" className={fieldClass} value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="text-xs">To<input type="date" className={fieldClass} value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          <input className={`${fieldClass} col-span-2`} placeholder="Search student, admission no, class or collector" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {error && <Notice tone="bad">{friendlyError(error)}</Notice>}
        {loading ? <LoadingBlock /> : rows.length === 0 ? <EmptyBlock title="No exits in this period" /> : (<>
          <div className="flex items-center justify-between text-xs text-[#6F7461]"><span>{rows.length} exit{rows.length === 1 ? '' : 's'}</span>
            <button type="button" className="min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[#E3DBB8] bg-white" onClick={() => downloadCsv(`gate-exits-${from}-to-${to}.csv`, EXIT_COLUMNS, rows)}>Download CSV</button></div>
          <ul className="space-y-2">{rows.map((r) => (
            <li key={r.id} className="rounded-2xl border border-[#E3DBB8] bg-white p-3 text-sm">
              <div className="flex justify-between gap-2"><b>{r.student_name}</b><span className="text-xs text-[#6F7461]">{when(r.exited_at)}</span></div>
              <div className="text-xs text-[#6F7461]">{r.admission_no} · {r.class_name} · {r.reason}</div>
              <div className="text-xs mt-1">Collected by {r.collector_name || 'not recorded'}{r.collector_phone ? ` (${r.collector_phone})` : ''}. Requested by {r.requested_by_name || 'a teacher'}{r.parent_decided_at ? `, parent accepted ${when(r.parent_decided_at)}` : ''}. Released by {r.released_by || 'gate'}.</div>
              {r.exit_note && <div className="text-xs italic mt-0.5">{r.exit_note}</div>}
            </li>))}</ul></>)}
      </div>
    </FitPage>
  );
}
