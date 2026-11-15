// elimu/communication/academic/NotifyGuardiansSheet.jsx
// "Results published" / "Report card available" notices for a set of report cards. Lists every guardian who has not opted out, shows the REAL
// state of any earlier message, and opens the editable composer per guardian. Nothing is sent automatically.
import React, { useState } from 'react';
import Sheet from '../../../components/workspace/Sheet';
import { LoadingBlock } from '../../../components/CardKit';
import { useLoad } from '../../../components/network/networkKit';
import { academicCommService } from './academicCommService';
import AcademicMessageSheet from './AcademicMessageSheet';
import Note from '../../academic/components/Note';

const STATE = { QUEUED: 'Prepared, not sent', OPENED: 'Opened on a phone', SENT: 'Sent (confirmed by staff)', SUBMITTED: 'Submitted to provider', DELIVERED: 'Delivered', READ: 'Read', FAILED: 'Failed', CANCELLED: 'Cancelled' };

export default function NotifyGuardiansSheet({ cardIds, purpose = 'ELIMU_RESULT_PUBLISHED', onClose }) {
  const { data, loading, error, reload } = useLoad(() => academicCommService.targets(cardIds, purpose), [cardIds.join(','), purpose]);
  const [open, setOpen] = useState(null);
  const targets = data?.targets || []; const unpublished = targets.filter((t) => t.status !== 'PUBLISHED');
  return (
    <Sheet title={purpose === 'ELIMU_REPORT_CARD_AVAILABLE' ? 'Tell guardians the report card is ready' : 'Tell guardians the results are published'} onClose={onClose}>
      {loading && <LoadingBlock />}{error && <Note tone="bad">{error.message}</Note>}
      {unpublished.length > 0 && <Note tone="warn">{unpublished.length} of these report cards are not published yet. Guardians should normally only be told after publishing.</Note>}
      {!loading && !targets.length && <Note tone="info">No guardians to notify (none linked, or all opted out).</Note>}
      <div className="space-y-2 mt-2">
        {targets.map((t) => (
          <div key={`${t.card_id}-${t.guardian_id}`} className="flex items-center gap-2 border border-[#E3DBB8] rounded-xl p-2 bg-white">
            <div className="min-w-0 flex-1 text-sm"><b>{t.student_name}</b> <span className="text-xs text-[#6F7461]">{t.admission_number} · {t.class_name}{t.stream_name ? ` ${t.stream_name}` : ''}</span><div className="text-xs text-[#6F7461]">{t.guardian_name} ({t.relationship || 'guardian'}){t.phone ? ` · ${t.phone}` : ''}</div></div>
            <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${t.last_message ? 'bg-[#E6F2EB] text-[#1F6B45]' : 'bg-[#F4F1E3] text-[#6F7461]'}`}>{t.last_message ? STATE[t.last_message.status] || t.last_message.status : 'Not messaged'}</span>
            <button type="button" onClick={() => setOpen(t)} className="text-xs font-semibold text-white bg-[#1F6B45] rounded-lg px-3 min-h-[34px]">{t.last_message ? 'Message again' : 'Message'}</button>
          </div>))}
      </div>
      {open && <AcademicMessageSheet purpose={purpose} guardian={{ guardian_id: open.guardian_id, full_name: open.guardian_name, phone: open.phone, email: open.email }}
        student={{ id: open.student_id, full_name: open.student_name, admission_number: open.admission_number, class_name: open.class_name, stream_name: open.stream_name, enrollment_id: open.enrollment_id }}
        context={{ term: open.term_name, academicYear: open.academic_year }} reference={{ type: 'REPORT_CARD', id: open.card_id, label: `${open.student_name} ${open.term_name}` }} onClose={() => setOpen(null)} onDone={reload} />}
    </Sheet>
  );
}
