// Create / edit a student. Warns about possible duplicates before saving; sensitive fields are minimal by design
// (no religion, ethnicity, national ID...). Medical notes are a separate, setting-gated, permission-gated block.
import React, { useState } from 'react';
import { Sheet, fieldClass, saveBtnCls, Notice } from '../services/platform.js';
import { Field } from './ui.jsx';
import { studentService } from '../services/ElimuStudentService.js';
import { validateStudent, friendlyError } from '../utils/validation.js';
import { GENDERS } from '../utils/format.js';

export default function StudentFormSheet({ student, statuses = [], onClose, onSaved }) {
  const [f, setF] = useState({ first_name: '', middle_name: '', last_name: '', preferred_name: '', date_of_birth: '', gender: '', previous_school: '', notes: '', admission_date: '', status_id: statuses.find((s) => s.category === 'ACTIVE' && s.is_default)?.id || '', admission_no: '', ...student });
  const [errors, setErrors] = useState({}); const [dups, setDups] = useState(null); const [busy, setBusy] = useState(false); const [top, setTop] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const save = async (force = false) => {
    const v = validateStudent(f); setErrors(v.errors); if (!v.ok) return;
    setBusy(true); setTop(null);
    try {
      if (!student && !force) { const d = await studentService.findDuplicates(f); if (d.length) { setDups(d); setBusy(false); return; } }
      const clean = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v]));
      delete clean.id; delete clean.tenant_id; delete clean.business_id; delete clean.created_at; delete clean.updated_at; delete clean.created_by; delete clean.updated_by;
      const row = student ? await studentService.update(student.id, clean) : await studentService.create(clean);
      onSaved?.(row); onClose();
    } catch (e) { setTop(friendlyError(e)); if (e.fields) setErrors(e.fields); } finally { setBusy(false); }
  };

  return (
    <Sheet title={student ? 'Edit student' : 'New student'} onClose={onClose}>
      {top && <Notice tone="bad">{top}</Notice>}
      {dups && (
        <Notice tone="warn">
          <b>This child may already be on record:</b>
          <ul className="mt-1 list-disc pl-5">{dups.map((d) => <li key={d.id}>{d.first_name} {d.last_name}{d.date_of_birth ? ` · born ${d.date_of_birth}` : ''}{d.admission_no ? ` · ${d.admission_no}` : ''}</li>)}</ul>
          <button type="button" className="mt-2 underline" onClick={() => save(true)}>It is a different child — save anyway</button>
        </Notice>
      )}
      <Field label="First name *" error={errors.first_name}><input className={fieldClass} value={f.first_name} onChange={set('first_name')} autoComplete="off" /></Field>
      <Field label="Middle name"><input className={fieldClass} value={f.middle_name || ''} onChange={set('middle_name')} /></Field>
      <Field label="Last name *" error={errors.last_name}><input className={fieldClass} value={f.last_name} onChange={set('last_name')} /></Field>
      <Field label="Preferred name" hint="Used in messages if the child goes by another name."><input className={fieldClass} value={f.preferred_name || ''} onChange={set('preferred_name')} /></Field>
      <Field label="Date of birth" error={errors.date_of_birth}><input type="date" className={fieldClass} value={f.date_of_birth || ''} onChange={set('date_of_birth')} /></Field>
      <Field label="Gender (optional)"><select className={fieldClass} value={f.gender || ''} onChange={set('gender')}><option value="">Not stated</option>{GENDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
      {!student && <Field label="Status"><select className={fieldClass} value={f.status_id} onChange={set('status_id')}>{statuses.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select></Field>}
      <Field label="Admission number" hint="Leave empty to generate the next number."><input className={fieldClass} value={f.admission_no || ''} onChange={set('admission_no')} /></Field>
      <Field label="Admission date"><input type="date" className={fieldClass} value={f.admission_date || ''} onChange={set('admission_date')} /></Field>
      <Field label="Previous school"><input className={fieldClass} value={f.previous_school || ''} onChange={set('previous_school')} /></Field>
      <Field label="Notes"><textarea rows={3} className={`${fieldClass} py-2`} value={f.notes || ''} onChange={set('notes')} /></Field>
      <button type="button" className={`${saveBtnCls} w-full`} disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save student'}</button>
    </Sheet>
  );
}
