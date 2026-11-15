// elimu/communication/academic/GuardianContactActions.jsx
// "Call / SMS / WhatsApp / Email guardian" for a student, to drop onto any academic page (and onto AI 1's student profile).
// Who may see the contacts is decided by the database (elimu_student_contacts): admins, the class teacher, or a teacher of that class.
import React, { useState } from 'react';
import { Phone, MessageSquare, Mail, MessageCircle, Users } from 'lucide-react';

import { academicCommService } from './academicCommService';
import AcademicMessageSheet from './AcademicMessageSheet';
import { ACADEMIC_PURPOSES } from '../templates/academicTemplates';
import Note from '../../academic/components/Note';

export default function GuardianContactActions({ studentId, purpose = 'ELIMU_ACADEMIC_CONCERN', context, reference, label = 'Guardian' }) {
  const [state, setState] = useState({ open: false, loading: false, data: null, error: null });
  const [compose, setCompose] = useState(null); const [p, setP] = useState(purpose);
  const open = async () => {
    setState((s) => ({ ...s, open: true, loading: true, error: null }));
    try { setState({ open: true, loading: false, data: await academicCommService.contacts(studentId), error: null }); }
    catch (e) { setState({ open: true, loading: false, data: null, error: e.message }); }
  };
  if (!state.open) return <button type="button" onClick={open} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1F6B45] bg-white border border-[#E3DBB8] rounded-lg px-2.5 min-h-[34px]"><Users size={13} />{label}</button>;
  const { data } = state;
  const btn = 'inline-flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 min-h-[34px] border border-[#E3DBB8] bg-white text-[#1F6B45]';
  return (
    <div className="rounded-xl border border-[#E3DBB8] bg-white p-2.5 space-y-2">
      {state.loading && <div className="text-xs text-[#6F7461]">Loading…</div>}
      {state.error && <Note tone="bad">{state.error}</Note>}
      {data && !data.guardians.length && <Note tone="warn">No guardian is linked to this student yet.</Note>}
      {data && <label className="block text-[11px] text-[#6F7461]">Reason<select className="w-full border border-[#E3DBB8] rounded-lg min-h-[34px] px-2 text-xs bg-white" value={p} onChange={(e) => setP(e.target.value)}>{ACADEMIC_PURPOSES.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></label>}
      {data?.guardians.map((g) => (
        <div key={g.guardian_id} className="flex flex-wrap items-center gap-1.5">
          <div className="min-w-0 flex-1 text-sm"><b>{g.full_name}</b> <span className="text-xs text-[#6F7461]">{g.relationship}{g.is_primary ? ' · primary' : ''}{g.receives_academic_messages ? '' : ' · opted out of academic messages'}</span></div>
          {g.phone && <a className={btn} href={`tel:${g.phone}`}><Phone size={13} />Call</a>}
          {g.phone && <button type="button" className={btn} onClick={() => setCompose({ g, ch: 'SMS' })}><MessageSquare size={13} />SMS</button>}
          {g.phone && <button type="button" className={btn} onClick={() => setCompose({ g, ch: 'WHATSAPP' })}><MessageCircle size={13} />WhatsApp</button>}
          {g.email && <button type="button" className={btn} onClick={() => setCompose({ g, ch: 'EMAIL' })}><Mail size={13} />Email</button>}
        </div>))}
      {compose && <AcademicMessageSheet purpose={p} guardian={compose.g} student={{ id: data.student.id, full_name: data.student.full_name, admission_number: data.student.admission_number, class_name: data.student.class_name, stream_name: data.student.stream_name, enrollment_id: data.student.enrollment_id }}
        context={context} reference={reference || { type: 'STUDENT', id: data.student.id }} onClose={() => setCompose(null)} />}
    </div>
  );
}
