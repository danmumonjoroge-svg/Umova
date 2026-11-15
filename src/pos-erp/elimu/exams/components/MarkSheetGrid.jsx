// elimu/exams/components/MarkSheetGrid.jsx — the marks-entry grid. Enter moves to the next student. A blank is never zero:
// leaving marks empty keeps the student PENDING; Absent / Exempted / Not submitted are explicit choices.
import React, { useRef } from 'react';
import { AlertTriangle, Smartphone } from 'lucide-react';
import { MARK_STATUS, MARK_STATUS_LABEL, MARK_STATUS_HELP } from '../utils/markValidation';

const tone = { PRESENT: 'text-[#1F6B45]', ABSENT: 'text-[#A3352A]', EXEMPTED: 'text-[#6F5A12]', NOT_SUBMITTED: 'text-[#A14B00]', PENDING: 'text-[#6F7461]' };

export default function MarkSheetGrid({ rows, maxMarks, readOnly, onEdit, onHistory, onResolve }) {
  const refs = useRef({});
  const focusNext = (i) => { const n = rows[i + 1]; if (n && refs.current[n.enrollment_id]) refs.current[n.enrollment_id].focus(); };
  return (
    <div className="overflow-x-auto rounded-xl border border-[#E3DBB8] bg-white">
      <table className="w-full text-sm min-w-[640px]">
        <thead className="bg-[#FBF7E4] text-[#6F7461] text-[11px] uppercase tracking-wide">
          <tr><th className="text-left px-2 py-2">Adm. no</th><th className="text-left px-2 py-2">Student</th><th className="text-left px-2 py-2 w-36">Status</th>
            <th className="text-left px-2 py-2 w-28">Marks / {maxMarks}</th><th className="text-left px-2 py-2">Remarks</th><th className="w-8" /></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const locked = readOnly || r.entry_status === 'SUBMITTED';
            return (
              <React.Fragment key={r.enrollment_id}>
                <tr className={`border-t border-[#F0E9C8] ${r.error ? 'bg-[#FDF1EF]' : r.dirty ? 'bg-[#FFFCEB]' : ''}`}>
                  <td className="px-2 py-1.5 font-mono text-xs">{r.admission_number}</td>
                  <td className="px-2 py-1.5">{r.student_name}
                    {r.entry_status === 'SUBMITTED' && <span className="ml-2 text-[10px] font-bold text-[#1F6B45] bg-[#E6F2EB] rounded px-1.5 py-0.5">Submitted</span>}
                    {r.localState === 'PENDING' && <span className="ml-2 text-[10px] font-bold text-[#A14B00] bg-[#FFF3DC] rounded px-1.5 py-0.5 inline-flex items-center gap-1"><Smartphone size={10} />On this phone, not sent</span>}
                    {r.localState && r.localState !== 'PENDING' && <span className="ml-2 text-[10px] font-bold text-[#A3352A] bg-[#FBE4E0] rounded px-1.5 py-0.5">Needs attention</span>}
                  </td>
                  <td className="px-2 py-1.5">
                    <select aria-label={`Status for ${r.student_name}`} disabled={locked} value={r.mark_status} title={MARK_STATUS_HELP[r.mark_status]}
                      onChange={(e) => onEdit(r.enrollment_id, { mark_status: e.target.value })} className={`w-full border border-[#E3DBB8] rounded-lg min-h-[38px] px-1.5 bg-white ${tone[r.mark_status]}`}>
                      {Object.keys(MARK_STATUS).map((k) => <option key={k} value={k}>{MARK_STATUS_LABEL[k]}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5">
                    <input ref={(el) => { refs.current[r.enrollment_id] = el; }} inputMode="decimal" aria-label={`Marks for ${r.student_name}`} disabled={locked || r.mark_status !== 'PRESENT' && r.mark_status !== 'PENDING'}
                      value={r.marksText} placeholder={r.mark_status === 'PENDING' ? 'blank' : '—'}
                      onChange={(e) => onEdit(r.enrollment_id, { marksText: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); focusNext(i); } }}
                      className="w-full border border-[#E3DBB8] rounded-lg min-h-[38px] px-2 text-right tabular-nums disabled:bg-[#F4F1E3]" />
                  </td>
                  <td className="px-2 py-1.5"><input disabled={locked} value={r.remarks || ''} onChange={(e) => onEdit(r.enrollment_id, { remarks: e.target.value })} aria-label={`Remarks for ${r.student_name}`}
                    className="w-full border border-[#E3DBB8] rounded-lg min-h-[38px] px-2 disabled:bg-[#F4F1E3]" /></td>
                  <td className="px-1"><button type="button" onClick={() => onHistory?.(r)} className="text-[#6F7461] hover:text-[#1F6B45] text-xs" title="Change history">⏱</button></td>
                </tr>
                {(r.error || (r.localState && r.localState !== 'PENDING')) && (
                  <tr className="bg-[#FDF1EF]"><td colSpan={6} className="px-3 pb-2 text-xs text-[#A3352A]"><AlertTriangle size={12} className="inline mr-1" />{r.error || r.localMessage}
                    {r.pendingId && r.localState && r.localState !== 'PENDING' && onResolve && (
                      <span className="ml-3 inline-flex gap-2"><button type="button" className="underline" onClick={() => onResolve(r.pendingId, 'keepMine')}>Keep mine</button><button type="button" className="underline" onClick={() => onResolve(r.pendingId, 'useServer')}>Use the saved one</button></span>)}
                  </td></tr>
                )}
              </React.Fragment>
            );
          })}
          {!rows.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-[#6F7461]">No students found for this assessment.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
