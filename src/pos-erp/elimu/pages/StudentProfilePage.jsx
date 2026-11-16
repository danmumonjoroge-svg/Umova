import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FitPage, LoadingBlock, Notice, EmptyBlock, saveBtnCls, fieldClass, Sheet } from '../services/platform.js';
import { studentService } from '../services/ElimuStudentService.js';
import { setupService } from '../services/ElimuSetupService.js';
import { enrollmentService } from '../services/ElimuEnrollmentService.js';
import { useAsync } from '../hooks/useAsync.js';
import { useElimuAccess, useElimuSetup } from '../hooks/useElimu.js';
import { Avatar, StatusPill, Field } from '../components/ui.jsx';
import StudentFormSheet from '../components/StudentFormSheet.jsx';
import GuardianFormSheet from '../components/GuardianFormSheet.jsx';
import ElimuCommunicationPanel from '../components/ElimuCommunicationPanel.jsx';
import { fullName, formatDate, ageFrom } from '../utils/format.js';
import { friendlyError } from '../utils/validation.js';
import { studentTabs } from '../registry.js';

export default function StudentProfilePage({ basePath = '/elimu' }) {
  const { id } = useParams(); const { can } = useElimuAccess(); const { settings, period } = useElimuSetup();
  const [tab, setTab] = useState('overview'); const [edit, setEdit] = useState(false); const [addG, setAddG] = useState(false); const [statusSheet, setStatusSheet] = useState(false); const [enrolSheet, setEnrolSheet] = useState(false);
  const r = useAsync(() => studentService.get(id), [id]);
  const statuses = useAsync(() => setupService.studentStatuses(), []);
  const photo = useAsync(() => (r.data?.student?.photo_path ? studentService.photoUrl(r.data.student.photo_path) : Promise.resolve(null)), [r.data?.student?.photo_path]);
  if (r.loading && !r.data) return <LoadingBlock />;
  if (r.error && !r.data) return <Notice tone="bad">{r.error}</Notice>;
  const { student: s, directory: d, enrollments, statusHistory } = r.data;
  const tabs = [['overview', 'Overview'], ['guardians', 'Guardians & contact'], ['history', 'History'], ...studentTabs().filter((t) => can(t.action || 'students.view')).map((t) => [t.key, t.label])];
  const extra = studentTabs().find((t) => t.key === tab);
  return (
    <FitPage title={fullName(s)} subtitle={[s.admission_no, d?.class_name && `${d.class_name}${d.stream_name ? ` · ${d.stream_name}` : ''}`].filter(Boolean).join(' · ') || 'Student profile'}
      action={<div className="flex items-center gap-2"><Link to={`${basePath}/students`} className="hidden sm:inline-flex min-h-[40px] items-center px-3 rounded-xl border border-[#E3DBB8] bg-white text-sm text-[#405346]">← Directory</Link>{can('students.manage') && <button type="button" className="px-3 min-h-[40px] rounded-xl border border-[#E3DBB8] bg-white text-sm font-semibold" onClick={() => setEdit(true)}>Edit profile</button>}</div>}
      summary={<div className="rounded-2xl border border-[#E3DBB8] bg-white p-3 sm:p-4 flex items-center gap-3"><Avatar person={s} url={photo.data} size={60} /><div className="min-w-0 flex-1"><div className="text-sm font-bold text-[#23382B]">{fullName(s)}</div><div className="text-xs text-slate-500 mt-0.5">{s.admission_no || 'No admission number'}{d?.class_name ? ` · ${d.class_name}${d.stream_name ? ` ${d.stream_name}` : ''}` : ' · Not currently enrolled'}</div><div className="mt-1.5"><StatusPill category={d?.status_category} label={d?.status_label} /></div></div></div>}>
      {s.date_of_birth && <div className="mb-3 text-xs text-slate-500">Date of birth: {formatDate(s.date_of_birth)} · {ageFrom(s.date_of_birth)} years</div>}
      <div className="flex gap-1 overflow-x-auto mb-3 pb-1" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 min-h-[40px] rounded-xl text-sm font-medium whitespace-nowrap ${tab === k ? 'bg-[#1F6B45] text-white shadow-sm' : 'bg-white border border-[#E3DBB8] text-[#405346]'}`}>{l}</button>)}</div>

      {tab === 'overview' && (
        <div className="space-y-3">
          <div className="bg-white border border-[#E3DBB8] rounded-xl p-3 text-sm space-y-1.5">
            <Row k="Preferred name" v={s.preferred_name} /><Row k="Gender" v={s.gender === 'F' ? 'Female' : s.gender === 'M' ? 'Male' : null} /><Row k="Admission date" v={s.admission_date && formatDate(s.admission_date)} /><Row k="Previous school" v={s.previous_school} /><Row k="Notes" v={s.notes} />
          </div>
          {can('students.manage') && <div className="grid grid-cols-2 gap-2"><button type="button" className="min-h-[44px] rounded-xl border border-[#E3DBB8] bg-white text-sm font-medium" onClick={() => setStatusSheet(true)}>Change status</button>{can('enrollment.manage') && period && d?.status_category === 'ACTIVE' && !d?.enrollment_id && <button type="button" className={`${saveBtnCls}`} onClick={() => setEnrolSheet(true)}>Enrol for {period.academic_year_name}</button>}</div>}
          {settings.collect_care_notes && can('students.care') && <CareNotes studentId={id} />}
        </div>
      )}
      {tab === 'guardians' && (<div><ElimuCommunicationPanel student={{ ...s, class_name: d?.class_name }} klass={d ? { name: d.class_name } : null} settings={settings} />{can('guardians.manage') && <button type="button" className="mt-3 w-full min-h-[44px] rounded-xl border border-dashed border-[#C9A227] text-sm font-medium" onClick={() => setAddG(true)}>Add guardian</button>}</div>)}
      {tab === 'history' && (
        <div className="space-y-4">
          <section><h3 className="text-xs font-semibold uppercase text-slate-500 mb-1">Classes by year</h3>{enrollments.length === 0 ? <EmptyBlock>Not enrolled yet.</EmptyBlock> : <ul className="bg-white border border-[#E3DBB8] rounded-xl divide-y divide-[#EFE8C8]">{enrollments.map((e) => <li key={e.enrollment_id} className="px-3 py-2.5 text-sm flex justify-between"><span>{e.academic_year_name}{e.term_name ? ` · ${e.term_name}` : ''} — <b>{e.class_name}{e.stream_name ? ` ${e.stream_name}` : ''}</b></span><span className="text-xs text-slate-500">{e.status.toLowerCase().replace('_', ' ')}</span></li>)}</ul>}</section>
          <section><h3 className="text-xs font-semibold uppercase text-slate-500 mb-1">Status changes</h3>{statusHistory.length === 0 ? <EmptyBlock>No changes yet.</EmptyBlock> : <ul className="bg-white border border-[#E3DBB8] rounded-xl divide-y divide-[#EFE8C8]">{statusHistory.map((h) => <li key={h.id} className="px-3 py-2.5 text-xs"><span className="text-slate-500">{formatDate(h.effective_date || h.changed_at)}</span>{h.reason ? ` — ${h.reason}` : ''}</li>)}</ul>}</section>
        </div>
      )}
      {extra?.render && extra.render({ student: s, directory: d })}
      {edit && <StudentFormSheet student={s} statuses={statuses.data || []} onClose={() => setEdit(false)} onSaved={() => r.reload()} />}
      {addG && <GuardianFormSheet studentId={s.id} onClose={() => setAddG(false)} onSaved={() => r.reload()} />}
      {statusSheet && <StatusSheet student={s} current={d} statuses={statuses.data || []} onClose={() => setStatusSheet(false)} onDone={() => r.reload()} />}
      {enrolSheet && <EnrolSheet student={s} period={period} onClose={() => setEnrolSheet(false)} onDone={() => r.reload()} />}
    </FitPage>
  );
}

const Row = ({ k, v }) => (v ? <div className="flex justify-between gap-3"><span className="text-slate-500">{k}</span><span className="text-right">{v}</span></div> : null);

function CareNotes({ studentId }) {
  const r = useAsync(() => studentService.careNotes(studentId), [studentId]);
  const [f, setF] = useState(null); const [msg, setMsg] = useState(null);
  const v = f || r.data || {};
  const save = async () => { try { await studentService.saveCareNotes(studentId, { medical_alert: v.medical_alert || null, emergency_instructions: v.emergency_instructions || null }); setMsg('Saved.'); r.reload(); } catch (e) { setMsg(friendlyError(e)); } };
  return (
    <div className="bg-white border border-[#E3DBB8] rounded-xl p-3"><h3 className="text-sm font-semibold mb-1">Care notes</h3><p className="text-[11px] text-slate-500 mb-2">Keep this short and only what staff must know in an emergency. Visible to staff with care access only.</p>
      <Field label="Medical alert"><textarea rows={2} maxLength={500} className={`${fieldClass} py-2`} value={v.medical_alert || ''} onChange={(e) => setF({ ...v, medical_alert: e.target.value })} /></Field>
      <Field label="Emergency instructions"><textarea rows={2} maxLength={500} className={`${fieldClass} py-2`} value={v.emergency_instructions || ''} onChange={(e) => setF({ ...v, emergency_instructions: e.target.value })} /></Field>
      <button type="button" className={`${saveBtnCls} px-4`} onClick={save}>Save</button>{msg && <span className="ml-3 text-xs text-slate-500">{msg}</span>}</div>
  );
}

function StatusSheet({ student, current, statuses, onClose, onDone }) {
  const [sid, setSid] = useState(''); const [reason, setReason] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await studentService.changeStatus(student.id, sid, reason, date); onDone(); onClose(); } catch (e) { setErr(friendlyError(e)); setBusy(false); } };
  return (
    <Sheet title="Change status" onClose={onClose}>{err && <Notice tone="bad">{err}</Notice>}
      <Field label="New status"><select className={fieldClass} value={sid} onChange={(e) => setSid(e.target.value)}><option value="">Choose…</option>{statuses.filter((s) => s.is_active && s.id !== current?.status_id).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>
      <Field label="Effective date"><input type="date" className={fieldClass} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Reason"><input className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <p className="text-[11px] text-slate-500 mb-3">If the student has left, their open class enrolment is closed. The history is kept.</p>
      <button type="button" className={`${saveBtnCls} w-full`} disabled={!sid || busy} onClick={go}>Save</button></Sheet>
  );
}

function EnrolSheet({ student, period, onClose, onDone }) {
  const classes = useAsync(() => setupService.classes(), []);
  const [cid, setCid] = useState(''); const [stid, setStid] = useState(''); const [err, setErr] = useState(null); const [busy, setBusy] = useState(false);
  const cls = (classes.data || []).find((c) => c.id === cid);
  const go = async () => { setBusy(true); try { const r = await enrollmentService.enroll({ academicYearId: period.academic_year_id, classId: cid, streamId: stid || null, studentIds: [student.id] }); if (r.skipped?.length) throw new Error(r.skipped[0].reason); onDone(); onClose(); } catch (e) { setErr(friendlyError(e)); setBusy(false); } };
  return (
    <Sheet title={`Enrol for ${period.academic_year_name}`} onClose={onClose}>{err && <Notice tone="bad">{err}</Notice>}
      <Field label="Class"><select className={fieldClass} value={cid} onChange={(e) => { setCid(e.target.value); setStid(''); }}><option value="">Choose…</option>{(classes.data || []).filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      {cls?.elimu_streams?.length > 0 && <Field label="Stream"><select className={fieldClass} value={stid} onChange={(e) => setStid(e.target.value)}><option value="">None</option>{cls.elimu_streams.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
      <button type="button" className={`${saveBtnCls} w-full`} disabled={!cid || busy} onClick={go}>Enrol</button></Sheet>
  );
}
