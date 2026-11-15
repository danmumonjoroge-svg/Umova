// ElimuCommunicationPanel — "who can I contact about this student, and what has already been said". Used on student, guardian,
// application and (later) class/attendance/fee screens. Pass studentId, guardianId or applicationId.
import React from 'react';
import { LoadingBlock, EmptyBlock, Notice } from '../services/platform.js';
import { communicationService } from '../communication/ElimuCommunicationService.js';
import { guardianService } from '../services/ElimuGuardianService.js';
import { useAsync } from '../hooks/useAsync.js';
import { formatDateTime, relationshipLabel } from '../utils/format.js';
import { displayPhone } from '../utils/phone.js';
import ElimuContactActions from './ElimuContactActions.jsx';

const ICON_WORD = { SMS: 'SMS', WHATSAPP: 'WhatsApp', EMAIL: 'Email', CALL: 'Call' };

export function CommunicationHistory({ studentId, guardianId, applicationId, reloadKey }) {
  const { data, loading, error } = useAsync(() => communicationService.history({ studentId, guardianId, applicationId }), [studentId, guardianId, applicationId, reloadKey]);
  if (loading && !data) return <LoadingBlock />;
  if (error && !data) return <Notice tone="bad">{error}</Notice>;
  if (!data?.length) return <EmptyBlock>No messages or calls yet.</EmptyBlock>;
  return (
    <ul className="divide-y divide-[#EFE8C8]">
      {data.map((h) => (
        <li key={h.entry_id} className="py-2.5">
          <div className="flex items-center justify-between gap-2 text-xs text-slate-500"><span className="font-semibold text-[#23382B]">{ICON_WORD[h.channel]}{h.recipient_name ? ` · ${h.recipient_name}` : ''}</span><span>{formatDateTime(h.at)}</span></div>
          {h.subject && <div className="text-sm font-medium mt-0.5">{h.subject}</div>}
          {h.body && <div className="text-sm text-slate-700 mt-0.5 whitespace-pre-line line-clamp-3">{h.body}</div>}
          <div className="text-[11px] mt-1 text-slate-500">{h.status_label}{h.was_edited ? ' · edited' : ''}{h.consent_override ? ' · emergency override' : ''}</div>
        </li>
      ))}
    </ul>
  );
}

export default function ElimuCommunicationPanel({ student, application, klass, settings, purpose }) {
  const [tick, setTick] = React.useState(0);
  const g = useAsync(() => (student ? guardianService.forStudent(student.id) : Promise.resolve([])), [student?.id, tick]);
  const ov = useAsync(() => communicationService.loadOverrides().catch(() => []), []);
  return (
    <div>
      {g.loading && !g.data ? <LoadingBlock /> : null}
      {g.error && <Notice tone="bad">{g.error}</Notice>}
      {(g.data || []).map((gd) => (
        <div key={gd.id} className="mb-3 rounded-xl border border-[#E3DBB8] bg-white p-3">
          <div className="flex items-baseline justify-between mb-2"><div className="font-semibold text-sm">{gd.first_name} {gd.last_name}</div><div className="text-xs text-slate-500">{relationshipLabel(gd.link?.relationship)}{gd.link?.guardian_rank === 1 ? ' · primary' : ''}{gd.link?.is_emergency_contact ? ' · emergency' : ''}</div></div>
          <div className="text-xs text-slate-500 mb-2">{gd.contacts.filter((c) => c.kind === 'PHONE').map((c) => displayPhone(c.value)).join(' · ') || 'No phone'}</div>
          <ElimuContactActions guardian={gd} student={student} application={application} klass={klass} purpose={purpose} settings={settings} overrides={ov.data || []} onDone={() => setTick((t) => t + 1)} />
        </div>
      ))}
      {g.data && g.data.length === 0 && <EmptyBlock>No guardian on record. Add one to contact the family.</EmptyBlock>}
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mt-4 mb-1">History</h3>
      <CommunicationHistory studentId={student?.id} reloadKey={tick} />
    </div>
  );
}
