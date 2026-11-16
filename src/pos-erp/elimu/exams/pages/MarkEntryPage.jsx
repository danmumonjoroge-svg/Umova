// elimu/exams/pages/MarkEntryPage.jsx — enter, edit, bulk-save drafts, submit/finalize, unlock, view history. Works offline (see useMarkSheet).
import React, { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { PenLine, Save, CheckCircle2, CloudUpload, Unlock, WifiOff } from 'lucide-react';
import { FitPage, LoadingBlock, SearchBox } from '../../../components/CardKit';
import Sheet from '../../../components/workspace/Sheet';
import { OfflineBanner } from '../../../components/network/networkKit';
import { useMarkSheet } from '../hooks/useMarkSheet';
import { examService } from '../services/examService';
import MarkSheetGrid from '../components/MarkSheetGrid';
import AccessGate from '../../academic/components/AccessGate';
import Note from '../../academic/components/Note';

const btn = 'inline-flex items-center gap-1.5 text-sm font-semibold rounded-xl px-3 min-h-[40px] border disabled:opacity-50';
export default function MarkEntryPage() {
  const { assessmentId } = useParams(); const m = useMarkSheet(assessmentId);
  const [missing, setMissing] = useState(null); const [hist, setHist] = useState(null); const [pick, setPick] = useState('NOT_SUBMITTED');
  const a = m.sheet?.assessment; const submittedAll = m.rows.length > 0 && m.rows.every((r) => r.entry_status === 'SUBMITTED');
  const open = a?.status === 'OPEN';
  const doSubmit = async (remaining) => { const r = await m.submit(remaining); if (r && r.code === 'PENDING_MARKS') setMissing(r.missing); else setMissing(null); };
  const unlock = async () => { const reason = window.prompt('Why must these marks be reopened?'); if (!reason) return; try { await examService.unlockMarks(assessmentId, reason); m.reload(); } catch (e) { m.setNotice({ tone: 'bad', text: e.message }); } };
  const showHist = async (r) => { try { setHist({ r, rows: await examService.markHistory(assessmentId, r.enrollment_id) }); } catch (e) { m.setNotice({ tone: 'bad', text: e.message }); } };
  return (
    <FitPage title={a ? a.name : 'Marks entry'} subtitle={a ? `${a.subject_name} · out of ${a.max_marks} · weight ${a.weight}% · ${a.status}` : ''} icon={PenLine}
      action={<Link to="../assessments" className="text-xs underline">All assessments</Link>}
      toolbar={<div className="space-y-2">
        <div className="flex flex-wrap gap-2 items-center"><div className="flex-1 min-w-[160px]"><SearchBox value={m.search} onChange={m.setSearch} placeholder="Search name or admission no." /></div>
          <button className={`${btn} bg-white text-[#1F6B45] border-[#E3DBB8]`} disabled={!open || m.saving || !m.dirtyCount} onClick={() => m.saveDraft()}><Save size={15} />Save draft{m.dirtyCount ? ` (${m.dirtyCount})` : ''}</button>
          <button className={`${btn} bg-[#1F6B45] text-white border-[#C9A227]`} disabled={!open || m.saving || !m.online || submittedAll} onClick={() => doSubmit(null)}><CheckCircle2 size={15} />Submit</button>
          {(m.sync.waiting > 0 || m.sync.needsAttention > 0) && <button className={`${btn} bg-white text-[#A14B00] border-[#F0D9A8]`} onClick={m.syncNow}><CloudUpload size={15} />Upload {m.sync.waiting} from phone</button>}
          <AccessGate need="marks.unlock">{() => submittedAll || m.rows.some((r) => r.entry_status === 'SUBMITTED') ? <button className={`${btn} bg-white text-[#6F5A12] border-[#E3DBB8]`} onClick={unlock}><Unlock size={15} />Unlock</button> : null}</AccessGate>
        </div>
        <OfflineBanner />
        {m.sync.legacyUnscoped > 0 && <Note tone="warn">{m.sync.legacyUnscoped} older offline mark change(s) have no school identifier. They are being held back for safety and will not sync automatically. Ask an administrator to review this device's offline data before clearing browser storage.</Note>}
        {m.fromCache && <Note tone="warn"><WifiOff size={13} className="inline mr-1" />Showing the last copy saved on this phone. Marks you type are kept here and uploaded later.</Note>}
        {m.notice && <Note tone={m.notice.tone === 'good' ? 'good' : m.notice.tone === 'info' ? 'info' : m.notice.tone}>{m.notice.text}</Note>}
        {a && !open && <Note tone="warn">This assessment is {a.status.toLowerCase()}. {a.status === 'DRAFT' ? 'Open it to enter marks.' : 'Marks can no longer be entered.'}</Note>}
        {m.sheet?.summary && <div className="text-[11px] text-[#6F7461]">{m.sheet.summary.roster} students · {m.sheet.summary.submitted} submitted · {m.sheet.summary.draft} drafts · {m.sheet.summary.pending} waiting for a decision</div>}
      </div>}>
      <AccessGate>
        {m.loading && <LoadingBlock />}{m.error && <Note tone="bad">{m.error}</Note>}
        {a && <MarkSheetGrid rows={m.rows} maxMarks={Number(a.max_marks)} readOnly={!open} onEdit={m.edit} onHistory={showHist} onResolve={m.resolveConflict} />}
        {m.sheet && m.sheet.total > m.pageSize && <div className="flex justify-between mt-2 text-xs"><button disabled={m.page === 0} onClick={() => m.setPage(m.page - 1)}>← Previous</button><span>Page {m.page + 1} of {Math.ceil(m.sheet.total / m.pageSize)}</span><button disabled={(m.page + 1) * m.pageSize >= m.sheet.total} onClick={() => m.setPage(m.page + 1)}>Next →</button></div>}
      </AccessGate>
      {missing && (
        <Sheet title="Some students have no decision yet" onClose={() => setMissing(null)}>
          <p className="text-sm mb-2">A blank is never counted as zero. Choose what these {missing.length} student{missing.length === 1 ? '' : 's'} should be recorded as, or go back and enter their marks.</p>
          <ul className="text-xs max-h-40 overflow-auto mb-2">{missing.map((x) => <li key={x.enrollment_id}>{x.admission_number} · {x.student_name}</li>)}</ul>
          <select className="w-full border border-[#E3DBB8] rounded-xl min-h-[44px] px-2 mb-2" value={pick} onChange={(e) => setPick(e.target.value)}><option value="NOT_SUBMITTED">Not submitted</option><option value="ABSENT">Absent</option><option value="EXEMPTED">Exempted</option></select>
          <button className={`${btn} bg-[#1F6B45] text-white border-[#C9A227] w-full justify-center`} onClick={() => doSubmit(pick)}>Record as {pick.replace('_', ' ').toLowerCase()} and submit</button>
        </Sheet>)}
      {hist && (
        <Sheet title={`History: ${hist.r.student_name}`} onClose={() => setHist(null)}>
          {!hist.rows.length && <p className="text-sm text-[#6F7461]">No changes recorded yet.</p>}
          <ul className="space-y-1.5 text-sm">{hist.rows.map((h, i) => <li key={i} className="border-b border-[#F0E9C8] pb-1"><b>{h.action}</b> · {new Date(h.at).toLocaleString()} · {h.by || '—'}<div className="text-xs text-[#6F7461]">{h.old_status ? `${h.old_status}${h.old_marks != null ? ' ' + h.old_marks : ''} → ` : ''}{h.new_status}{h.new_marks != null ? ' ' + h.new_marks : ''}{h.reason ? ` — ${h.reason}` : ''}</div></li>)}</ul>
        </Sheet>)}
    </FitPage>
  );
}
