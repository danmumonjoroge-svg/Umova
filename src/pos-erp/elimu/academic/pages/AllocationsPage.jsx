// elimu/academic/pages/AllocationsPage.jsx — subject -> class/stream (+ teacher) and class teachers. Changing a teacher ENDS the old
// assignment and starts a new one: nothing is overwritten, the history stays (tick "show ended" to see it).
import React, { useState } from 'react';
import { Users } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, formCard, inputCls, saveBtnCls, TextBtn } from '../../../components/CardKit';
import { useLoad } from '../../../components/network/networkKit';
import { academicService } from '../services/academicService';
import { useScope } from '../hooks/useScope';
import ScopeBar from '../components/ScopeBar';
import AccessGate from '../components/AccessGate';
import Note from '../components/Note';

export default function AllocationsPage() {
  const s = useScope(); const { scope } = s;
  const lists = useLoad(async () => ({ subjects: await academicService.listSubjects(), staff: await academicService.listStaff() }), []);
  const [showEnded, setShowEnded] = useState(false);
  const alloc = useLoad(() => (scope.yearId && scope.classId ? academicService.listAllocations({ yearId: scope.yearId, classId: scope.classId, includeEnded: showEnded }) : Promise.resolve([])), [scope.yearId, scope.classId, showEnded]);
  const cts = useLoad(() => (scope.yearId ? academicService.listClassTeachers(scope.yearId) : Promise.resolve([])), [scope.yearId]);
  const [f, setF] = useState({ subjectId: '', teacherId: '' }); const [ct, setCt] = useState(''); const [msg, setMsg] = useState(null);
  const staff = lists.data?.staff || []; const staffName = (id) => staff.find((x) => x.id === id)?.name || '—';
  const streamName = (id) => (id ? s.nameOf('streams', id) : 'All streams');
  const wrap = async (fn, ok) => { setMsg(null); try { await fn(); setMsg({ tone: 'good', text: ok }); alloc.reload(); cts.reload(); } catch (e) { setMsg({ tone: 'bad', text: e.message }); } };
  return (
    <FitPage title="Teachers & classes" subtitle="Who teaches which subject" icon={Users} toolbar={<ScopeBar s={s} show={['year', 'class', 'stream']} />}>
      <AccessGate need="config.manage">
        {s.error && <Note tone="warn">{s.error.message}</Note>}
        {scope.classId && (
          <div className={formCard}>
            <div className="text-sm font-bold mb-2">Assign a subject to {s.nameOf('classes', scope.classId)} {scope.streamId ? s.nameOf('streams', scope.streamId) : '(all streams)'}</div>
            <div className="grid gap-2 sm:grid-cols-3">
              <select className={inputCls} value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })}><option value="">Subject…</option>{(lists.data?.subjects || []).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <select className={inputCls} value={f.teacherId} onChange={(e) => setF({ ...f, teacherId: e.target.value })}><option value="">No teacher yet</option>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <button className={saveBtnCls} disabled={!f.subjectId} onClick={() => wrap(() => academicService.assignSubject({ yearId: scope.yearId, classId: scope.classId, streamId: scope.streamId || null, subjectId: f.subjectId, teacherId: f.teacherId || null }), 'Assigned. A previous teacher for this subject (if any) was ended, not deleted.')}>Assign</button>
            </div>
            <div className="grid gap-2 sm:grid-cols-3 mt-3 items-end">
              <select className={inputCls} value={ct} onChange={(e) => setCt(e.target.value)}><option value="">Class teacher…</option>{staff.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
              <button className={saveBtnCls} disabled={!ct} onClick={() => wrap(() => academicService.setClassTeacher(scope.yearId, scope.classId, scope.streamId || null, ct), 'Class teacher set.')}>Set class teacher</button>
              <div className="text-xs text-[#6F7461]">Current: {(cts.data || []).filter((c) => c.class_id === scope.classId && (c.stream_id || '') === (scope.streamId || '')).map((c) => staffName(c.teacher_staff_id)).join(', ') || 'none'}</div>
            </div>
            {msg && <div className="mt-2"><Note tone={msg.tone}>{msg.text}</Note></div>}
          </div>)}
        {!scope.classId && <EmptyBlock>Choose a class to see and change its subjects.</EmptyBlock>}
        {scope.classId && <label className="text-xs flex items-center gap-2 mb-2"><input type="checkbox" checked={showEnded} onChange={(e) => setShowEnded(e.target.checked)} />Show ended assignments (history)</label>}
        {alloc.loading && <LoadingBlock />}
        <div className="space-y-1.5">
          {(alloc.data || []).map((a) => (
            <div key={a.id} className={`flex items-center gap-2 bg-white border border-[#E3DBB8] rounded-xl p-2.5 ${a.status === 'ENDED' ? 'opacity-60' : ''}`}>
              <div className="min-w-0 flex-1 text-sm"><b>{a.subject?.name}</b> · {streamName(a.stream_id)}<div className="text-xs text-[#6F7461]">Teacher: {a.teacher_staff_id ? staffName(a.teacher_staff_id) : 'not assigned'}{a.status === 'ENDED' ? ` · ended ${new Date(a.ended_at).toLocaleDateString()} (${a.ended_reason || ''})` : ''}</div></div>
              {a.status === 'ACTIVE' && <TextBtn tone="danger" onClick={() => { const r = window.prompt('Reason for ending this assignment?'); if (r) wrap(() => academicService.endAllocation(a.id, r), 'Assignment ended (kept in history).'); }}>End</TextBtn>}
            </div>))}
        </div>
      </AccessGate>
    </FitPage>
  );
}
