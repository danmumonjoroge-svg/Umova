// elimu/report_cards/components/StudentAcademicHistory.jsx — Academic year -> Term -> Class -> Subject -> Assessments -> Result for one student.
// EXPOSED for the foundation's student profile: <StudentAcademicHistory studentId={id} />. Reads only published results unless told otherwise.
import React from 'react';
import { LoadingBlock, EmptyBlock } from '../../../components/CardKit';
import { useLoad } from '../../../components/network/networkKit';
import { reportCardService, nestHistory } from '../services/reportCardService';
import Note from '../../academic/components/Note';

export default function StudentAcademicHistory({ studentId, publishedOnly = true }) {
  const { data, loading, error } = useLoad(() => reportCardService.studentHistory(studentId, publishedOnly), [studentId, publishedOnly]);
  if (loading) return <LoadingBlock />; if (error) return <Note tone="bad">{error.message}</Note>;
  const years = nestHistory(data?.entries); if (!years.length) return <EmptyBlock>No {publishedOnly ? 'published ' : ''}results yet.</EmptyBlock>;
  return (
    <div className="space-y-3">{years.map((y) => (
      <div key={y.id}><div className="font-bold text-[#23382B]">{y.name}</div>
        {y.terms.map((t) => (
          <details key={t.enrollment_id + t.id} className="bg-white border border-[#E3DBB8] rounded-xl p-2.5 mt-1.5">
            <summary className="cursor-pointer text-sm"><b>{t.name}</b> · {t.class_name}{t.stream_name ? ` ${t.stream_name}` : ''} · {t.mean_percentage != null ? `${t.mean_percentage}% (${t.overall_grade ?? '—'})` : 'incomplete'}{t.class_position ? ` · ${t.class_position}/${t.class_size}` : ''}</summary>
            {t.subjects.map((s) => (
              <div key={s.subject_id} className="mt-1.5 text-sm"><div className="flex justify-between"><span>{s.subject}</span><b>{s.completeness === 'COMPLETE' ? `${s.percentage}% ${s.grade ?? ''}` : 'incomplete'}</b></div>
                <ul className="text-xs text-[#6F7461] ml-3">{(s.assessments || []).map((a) => <li key={a.assessment_id}>{a.name}: {a.mark_status === 'PRESENT' ? `${a.obtained_marks}/${a.max_marks}` : a.mark_status.toLowerCase().replace('_', ' ')} · weight {a.weight}%</li>)}</ul></div>))}
          </details>))}
      </div>))}</div>
  );
}
