// Admissions: board of applications by stage, a new-application form (atomic: child + guardian + application), and a detail sheet
// with the decision buttons, history, messaging and the final "Admit" step.
import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FitPage, FilterChips, SearchBox, DataCard, CardGrid, LoadingBlock, EmptyBlock, Notice, Sheet, fieldClass, saveBtnCls } from '../services/platform.js';
import { admissionService } from '../services/ElimuAdmissionService.js';
import { setupService } from '../services/ElimuSetupService.js';
import { useAsync, useDebounced } from '../hooks/useAsync.js';
import { useElimuAccess, useElimuSetup } from '../hooks/useElimu.js';
import { StatusPill, Field, Pager } from '../components/ui.jsx';
import ElimuCommunicationPanel from '../components/ElimuCommunicationPanel.jsx';
import { RELATIONSHIPS, GENDERS, formatDate, shortName } from '../utils/format.js';
import { validateApplication, friendlyError } from '../utils/validation.js';

const STAGES = [{ value: '', label: 'All' }, { value: 'SUBMITTED', label: 'New' }, { value: 'IN_REVIEW', label: 'In review' }, { value: 'ACCEPTED', label: 'Accepted' }, { value: 'WAITLISTED', label: 'Waitlist' }, { value: 'REJECTED', label: 'Rejected' }, { value: 'ADMITTED', label: 'Admitted' }];
// What the person can do from each stage (mirrors elimu_admission_transition_ok in 004; the database is the authority).
const NEXT = { SUBMITTED: ['IN_REVIEW', 'ACCEPTED', 'WAITLISTED', 'REJECTED'], IN_REVIEW: ['ACCEPTED', 'WAITLISTED', 'REJECTED'], WAITLISTED: ['ACCEPTED', 'REJECTED'], ACCEPTED: ['WAITLISTED', 'REJECTED'], REJECTED: ['IN_REVIEW'] };
const VERB = { IN_REVIEW: 'Start review', ACCEPTED: 'Accept', WAITLISTED: 'Waitlist', REJECTED: 'Decline' };

export default function AdmissionsPage() {
  const { can } = useElimuAccess(); const [sp] = useSearchParams(); const { settings } = useElimuSetup();
  const [cat, setCat] = useState(''); const [search, setSearch] = useState(''); const q = useDebounced(search); const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(sp.get('new') === '1'); const [open, setOpen] = useState(null);
  const list = useAsync(() => admissionService.list({ category: cat || null, search: q, page }), [cat, q, page]);
  const classes = useAsync(() => setupService.classes(), []);
  const cname = (id) => (classes.data || []).find((c) => c.id === id)?.name || '';
  return (
    <FitPage title="Admissions" subtitle={list.data ? `${list.data.rows.length} shown` : ''} action={can('admissions.manage') && <button type="button" className="px-3 min-h-[40px] rounded-lg bg-[#1F6B45] text-white text-sm font-semibold" onClick={() => setAdding(true)}>New application</button>}
      toolbar={<><SearchBox value={search} onChange={setSearch} placeholder="Child name or application number" /><FilterChips options={STAGES} value={cat} onChange={(v) => { setCat(v); setPage(0); }} /></>}>
      {list.error && <Notice tone="bad">{list.error}</Notice>}
      {list.loading && !list.data ? <LoadingBlock /> : list.data?.rows.length === 0 ? <EmptyBlock>No applications here.</EmptyBlock> :
        <CardGrid>{list.data?.rows.map((a) => <DataCard key={a.id} title={shortName(a.student)} subtitle={`${a.application_no} · ${cname(a.requested_class_id)} · ${formatDate(a.application_date)}`} pill={<StatusPill category={a.status?.category} label={a.status?.label} />}><button type="button" className="text-sm font-semibold text-[#1F6B45] underline" onClick={() => setOpen(a)}>Open</button></DataCard>)}</CardGrid>}
      {list.data && <Pager page={page} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />}
      {adding && <NewApplicationSheet classes={classes.data || []} onClose={() => setAdding(false)} onSaved={() => list.reload()} />}
      {open && <ApplicationSheet app={open} className={cname(open.requested_class_id)} classes={classes.data || []} settings={settings} onClose={() => setOpen(null)} onChanged={() => list.reload()} />}
    </FitPage>
  );
}

function NewApplicationSheet({ classes, onClose, onSaved }) {
  const { period } = useElimuSetup();
  const [f, setF] = useState({ first_name: '', last_name: '', date_of_birth: '', gender: '', previous_school: '', class_id: '', g_first: '', g_last: '', g_phone: '', g_email: '', relationship: 'MOTHER', source: '' });
  const [errors, setErrors] = useState({}); const [top, setTop] = useState(null); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async () => {
    const input = { student: { first_name: f.first_name, last_name: f.last_name, date_of_birth: f.date_of_birth || null, gender: f.gender || null, previous_school: f.previous_school || null },
      guardian: f.g_first ? { first_name: f.g_first, last_name: f.g_last, relationship: f.relationship, contacts: [...(f.g_phone ? [{ kind: 'PHONE', value: f.g_phone, is_primary: true, is_whatsapp: true }] : []), ...(f.g_email ? [{ kind: 'EMAIL', value: f.g_email, is_primary: true }] : [])] } : null,
      requested_class_id: f.class_id, requested_academic_year_id: period?.academic_year_id, source: f.source || null };
    const v = validateApplication(input); setErrors(v.errors); if (!v.ok) return;
    if (!period) { setTop('Set the current academic year first (Settings).'); return; }
    setBusy(true); try { await admissionService.submit(input); onSaved(); onClose(); } catch (e) { setTop(friendlyError(e)); setBusy(false); }
  };
  return (
    <Sheet title="New application" onClose={onClose}>{top && <Notice tone="bad">{top}</Notice>}
      <h3 className="text-xs font-semibold uppercase text-slate-500 mb-2">The child</h3>
      <Field label="First name *" error={errors['first_name']}><input className={fieldClass} value={f.first_name} onChange={set('first_name')} /></Field>
      <Field label="Last name *" error={errors['last_name']}><input className={fieldClass} value={f.last_name} onChange={set('last_name')} /></Field>
      <Field label="Date of birth" error={errors['date_of_birth']}><input type="date" className={fieldClass} value={f.date_of_birth} onChange={set('date_of_birth')} /></Field>
      <Field label="Gender (optional)"><select className={fieldClass} value={f.gender} onChange={set('gender')}><option value="">Not stated</option>{GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="Class applied for *" error={errors.requested_class_id}><select className={fieldClass} value={f.class_id} onChange={set('class_id')}><option value="">Choose…</option>{classes.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Previous school"><input className={fieldClass} value={f.previous_school} onChange={set('previous_school')} /></Field>
      <h3 className="text-xs font-semibold uppercase text-slate-500 mt-4 mb-2">Parent / guardian</h3>
      <Field label="First name"><input className={fieldClass} value={f.g_first} onChange={set('g_first')} /></Field>
      <Field label="Last name" error={errors['guardian.last_name']}><input className={fieldClass} value={f.g_last} onChange={set('g_last')} /></Field>
      <Field label="Relationship"><select className={fieldClass} value={f.relationship} onChange={set('relationship')}>{RELATIONSHIPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      <Field label="Phone" error={errors['guardian.contacts.0']}><input type="tel" className={fieldClass} placeholder="0712 345 678" value={f.g_phone} onChange={set('g_phone')} /></Field>
      <Field label="Email"><input type="email" className={fieldClass} value={f.g_email} onChange={set('g_email')} /></Field>
      <Field label="How did they hear of us?" hint="Walk-in, referral, website…"><input className={fieldClass} value={f.source} onChange={set('source')} /></Field>
      <button type="button" className={`${saveBtnCls} w-full`} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Submit application'}</button>
    </Sheet>
  );
}

function ApplicationSheet({ app, className, classes, settings, onClose, onChanged }) {
  const { can } = useElimuAccess(); const { period } = useElimuSetup();
  const statuses = useAsync(() => setupService.admissionStatuses(), []);
  const hist = useAsync(() => admissionService.history(app.id), [app.id]);
  const fresh = useAsync(() => admissionService.get(app.id), [app.id]);
  const [err, setErr] = useState(null); const [busy, setBusy] = useState(false); const [reason, setReason] = useState(''); const [adm, setAdm] = useState(null); const [done, setDone] = useState(null);
  const cur = fresh.data || app; const cat = cur.status?.category;
  const to = (c) => (statuses.data || []).find((s) => s.category === c && s.is_default && s.is_active);
  const move = async (c) => { setBusy(true); setErr(null); try { await admissionService.setStatus(app.id, to(c).id, { reason }); await Promise.all([fresh.reload(), hist.reload()]); onChanged(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); } };
  const admit = async () => { setBusy(true); setErr(null); try { const r = await admissionService.admit(app.id, { classId: adm.classId, streamId: adm.streamId, academicYearId: period?.academic_year_id }); setDone(r); await Promise.all([fresh.reload(), hist.reload()]); onChanged(); setAdm(null); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(false); } };
  const cls = classes.find((c) => c.id === (adm?.classId || cur.requested_class_id));
  return (
    <Sheet title={`${shortName(cur.student)} · ${cur.application_no}`} onClose={onClose}>
      <div className="mb-2"><StatusPill category={cat} label={cur.status?.label} /> <span className="text-xs text-slate-500 ml-2">for {className}</span></div>
      {err && <Notice tone="bad">{err}</Notice>}
      {done && <Notice tone="good">Admitted. Admission number {done.admission_no || ''}. The student is now Active and enrolled.</Notice>}
      {can('admissions.decide') && NEXT[cat] && statuses.data && (
        <div className="mb-3"><Field label="Note (optional)"><input className={fieldClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
          <div className="flex flex-wrap gap-2">{NEXT[cat].filter(to).map((c) => <button key={c} type="button" disabled={busy} onClick={() => move(c)} className={`px-3 min-h-[44px] rounded-xl text-sm font-medium border ${c === 'ACCEPTED' ? 'bg-[#1F6B45] text-white border-[#1F6B45]' : 'bg-white border-[#E3DBB8]'}`}>{VERB[c]}</button>)}</div></div>)}
      {!can('admissions.decide') && NEXT[cat] && <p className="text-xs text-slate-500 mb-3">Decisions are made by the principal or someone with admissions approval.</p>}
      {cat === 'ACCEPTED' && can('admissions.decide') && can('enrollment.manage') && (adm
        ? <div className="rounded-xl bg-[#FBF8EA] border border-[#E3DBB8] p-3 mb-3"><Field label="Class"><select className={fieldClass} value={adm.classId} onChange={(e) => setAdm({ classId: e.target.value, streamId: '' })}>{classes.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            {cls?.elimu_streams?.length > 0 && <Field label="Stream"><select className={fieldClass} value={adm.streamId} onChange={(e) => setAdm({ ...adm, streamId: e.target.value })}><option value="">None</option>{cls.elimu_streams.filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></Field>}
            <button type="button" disabled={busy || !period} className={`${saveBtnCls} w-full`} onClick={admit}>Admit and enrol</button>{!period && <p className="text-xs text-red-600 mt-1">Set the current academic year first.</p>}</div>
        : <button type="button" className={`${saveBtnCls} w-full mb-3`} onClick={() => setAdm({ classId: cur.requested_class_id, streamId: '' })}>Admit this student…</button>)}
      <h3 className="text-xs font-semibold uppercase text-slate-500 mt-2 mb-1">Contact the family</h3>
      <ElimuCommunicationPanel student={cur.student} application={cur} klass={{ name: className }} settings={settings}
        purpose={cat === 'ACCEPTED' ? 'ELIMU_ADMISSION_OFFER' : cat === 'ADMITTED' ? 'ELIMU_WELCOME' : cat === 'SUBMITTED' ? 'ELIMU_ADMISSION_RECEIVED' : 'ELIMU_ADMISSION_UPDATE'} />
      <h3 className="text-xs font-semibold uppercase text-slate-500 mt-4 mb-1">Stage history</h3>
      <ul className="text-xs text-slate-600 space-y-1">{(hist.data || []).map((h) => <li key={h.id}>{formatDate(h.changed_at)}{h.note ? ` — ${h.note}` : ''}</li>)}</ul>
    </Sheet>
  );
}
