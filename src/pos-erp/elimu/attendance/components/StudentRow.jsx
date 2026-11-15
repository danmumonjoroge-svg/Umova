import React, { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { StatusPill, fieldClass, inputCls } from '../../shared/components/kit';

const QUICK = [['PRESENT', 'P', 'bg-[#1F6B45] text-white', 'Present'], ['ABSENT', 'A', 'bg-[#B23A2E] text-white', 'Absent'], ['LATE', 'L', 'bg-[#C9A227] text-white', 'Late']];
const OFF = 'bg-white text-[#23382B] border border-[#E3DBB8]';

/** One student: big tap targets for the three common marks; "more" for every other status, times and reason. */
export default function StudentRow({ row, selected, onSelect, onMark, statuses, reasons, locked }) {
  const [open, setOpen] = useState(false);
  const flag = row.dirty ? 'border-l-4 border-l-[#C9A227]' : 'border-l-4 border-l-transparent';
  return (
    <div className={`bg-white rounded-xl border border-[#E3DBB8] ${flag} mb-2`}>
      <div className="flex items-center gap-2 px-2.5 py-2">
        {!locked && <input type="checkbox" aria-label={`Select ${row.student_name}`} className="w-5 h-5 shrink-0" checked={!!selected} onChange={() => onSelect(row.enrollment_id)} />}
        <div className="min-w-0 flex-1">
          <div className="text-[14.5px] font-semibold text-[#23382B] truncate">{row.student_name}</div>
          <div className="text-[11.5px] text-[#6F7461] flex items-center gap-1.5">{row.admission_number}{row.status !== 'NOT_MARKED' && <StatusPill status={row.status} />}{row.late_minutes > 0 && <span>· {row.late_minutes} min late</span>}{row.early_minutes > 0 && <span>· left {row.early_minutes} min early</span>}</div>
        </div>
        {!locked && (
          <div className="flex items-center gap-1 shrink-0">
            {QUICK.map(([code, k, on, label]) => (
              <button key={code} aria-label={`${label}: ${row.student_name}`} aria-pressed={row.status === code} onClick={() => onMark(row.enrollment_id, { status: row.status === code ? 'NOT_MARKED' : code })}
                className={`w-11 h-11 rounded-xl text-sm font-bold ${row.status === code ? on : OFF}`}>{k}</button>))}
            <button aria-label="More options" onClick={() => setOpen(!open)} className="w-9 h-11 flex items-center justify-center text-[#6F7461]"><ChevronDown size={18} className={open ? 'rotate-180' : ''} /></button>
          </div>)}
      </div>
      {open && !locked && (
        <div className="px-3 pb-3 grid grid-cols-2 gap-2 border-t border-[#EFE9CD] pt-2">
          <label className="col-span-2 text-[11px] font-bold uppercase text-[#6F7461]">Status
            <select className={fieldClass} value={row.status} onChange={(e) => onMark(row.enrollment_id, { status: e.target.value })}>{statuses.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}</select></label>
          <label className="text-[11px] font-bold uppercase text-[#6F7461]">Arrived<input type="time" className={inputCls} value={row.arrival_time ? String(row.arrival_time).slice(0, 5) : ''} onChange={(e) => onMark(row.enrollment_id, { arrival_time: e.target.value || null })} /></label>
          <label className="text-[11px] font-bold uppercase text-[#6F7461]">Left<input type="time" className={inputCls} value={row.departure_time ? String(row.departure_time).slice(0, 5) : ''} onChange={(e) => onMark(row.enrollment_id, { departure_time: e.target.value || null })} /></label>
          <label className="col-span-2 text-[11px] font-bold uppercase text-[#6F7461]">Reason (if known)
            <select className={fieldClass} value={row.reason_id || ''} onChange={(e) => onMark(row.enrollment_id, { reason_id: e.target.value || null })}><option value="">Not given</option>{reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></label>
          <label className="col-span-2 text-[11px] font-bold uppercase text-[#6F7461]">Note<input className={inputCls} value={row.reason_note || ''} onChange={(e) => onMark(row.enrollment_id, { reason_note: e.target.value })} /></label>
        </div>)}
    </div>
  );
}
