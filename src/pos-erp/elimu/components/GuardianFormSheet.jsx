// Add a guardian to a student (or create a stand-alone guardian). Looks for an existing guardian with the same phone/email first, so one
// parent with three children is ONE record linked three times, not three copies.
import React, { useState } from 'react';
import { Sheet, fieldClass, saveBtnCls, Notice } from '../services/platform.js';
import { Field } from './ui.jsx';
import { guardianService } from '../services/ElimuGuardianService.js';
import { validateGuardian, friendlyError } from '../utils/validation.js';
import { RELATIONSHIPS } from '../utils/format.js';

export default function GuardianFormSheet({ studentId, onClose, onSaved }) {
  const [f, setF] = useState({ first_name: '', last_name: '', phone: '', email: '', relationship: 'MOTHER', is_emergency_contact: true, whatsapp: true, preferred_channel: 'SMS' });
  const [errors, setErrors] = useState({}); const [matches, setMatches] = useState(null); const [busy, setBusy] = useState(false); const [top, setTop] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const contacts = () => [
    ...(f.phone ? [{ kind: 'PHONE', value: f.phone, is_primary: true, is_whatsapp: f.whatsapp }] : []),
    ...(f.email ? [{ kind: 'EMAIL', value: f.email, is_primary: true }] : []),
  ];
  const linkTo = async (guardianId) => { if (studentId) await guardianService.link(studentId, guardianId, { relationship: f.relationship, is_emergency_contact: f.is_emergency_contact }); };

  const save = async (skipMatch = false) => {
    const v = validateGuardian({ ...f, contacts: contacts() }); setErrors(v.errors); if (!v.ok) return;
    setBusy(true); setTop(null);
    try {
      if (!skipMatch) { const m = await guardianService.findMatches(f); if (m.length) { setMatches(m); setBusy(false); return; } }
      const g = await guardianService.create({ first_name: f.first_name, last_name: f.last_name, preferred_channel: f.preferred_channel, contacts: contacts() });
      await linkTo(g.id); onSaved?.(g); onClose();
    } catch (e) { setTop(friendlyError(e)); } finally { setBusy(false); }
  };
  const linkExisting = async (id) => { setBusy(true); try { await linkTo(id); onSaved?.({ id }); onClose(); } catch (e) { setTop(friendlyError(e)); setBusy(false); } };

  return (
    <Sheet title="Add guardian" onClose={onClose}>
      {top && <Notice tone="bad">{top}</Notice>}
      {matches && (
        <Notice tone="warn"><b>Already on record?</b>
          <ul className="mt-1">{matches.map((m) => <li key={m.guardian_id} className="flex items-center justify-between gap-2 py-1"><span>{m.first_name} {m.last_name} <span className="text-xs">(same {m.matched_on})</span></span>{studentId && <button type="button" className="underline" onClick={() => linkExisting(m.guardian_id)}>Use this one</button>}</li>)}</ul>
          <button type="button" className="mt-2 underline" onClick={() => save(true)}>No, this is a different person — create new</button>
        </Notice>
      )}
      <Field label="First name *" error={errors.first_name}><input className={fieldClass} value={f.first_name} onChange={set('first_name')} /></Field>
      <Field label="Last name *" error={errors.last_name}><input className={fieldClass} value={f.last_name} onChange={set('last_name')} /></Field>
      {studentId && <Field label="Relationship"><select className={fieldClass} value={f.relationship} onChange={set('relationship')}>{RELATIONSHIPS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>}
      <Field label="Phone" error={errors['contacts.0']}><input type="tel" inputMode="tel" className={fieldClass} placeholder="0712 345 678" value={f.phone} onChange={set('phone')} /></Field>
      <label className="flex items-center gap-2 text-sm mb-3"><input type="checkbox" checked={f.whatsapp} onChange={set('whatsapp')} /> This number is on WhatsApp</label>
      <Field label="Email"><input type="email" className={fieldClass} value={f.email} onChange={set('email')} /></Field>
      <Field label="Preferred way to be contacted"><select className={fieldClass} value={f.preferred_channel} onChange={set('preferred_channel')}><option value="SMS">SMS</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Email</option><option value="CALL">Phone call</option></select></Field>
      {studentId && <label className="flex items-center gap-2 text-sm mb-3"><input type="checkbox" checked={f.is_emergency_contact} onChange={set('is_emergency_contact')} /> Emergency contact</label>}
      <button type="button" className={`${saveBtnCls} w-full`} disabled={busy} onClick={() => save(false)}>{busy ? 'Saving…' : 'Save guardian'}</button>
    </Sheet>
  );
}
