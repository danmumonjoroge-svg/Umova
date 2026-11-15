// elimu/shared/hooks/useFoundation.js -- classes/streams, terms, subjects, teachers from the Elimu foundation adapter views.
import { useEffect, useState } from 'react';
import { foundationService } from '../services/foundationService';

export function useFoundation({ subjects = false, teachers = false, terms = false } = {}) {
  const [s, setS] = useState({ loading: true, connected: true, classStreams: [], subjects: [], teachers: [], terms: [], error: null });
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [c, su, te, tr] = await Promise.all([foundationService.classStreams(), subjects ? foundationService.subjects() : { rows: [], connected: true }, teachers ? foundationService.teachers() : { rows: [], connected: true }, terms ? foundationService.terms() : { rows: [], connected: true }]);
        if (live) setS({ loading: false, connected: c.connected, classStreams: c.rows, subjects: su.rows, teachers: te.rows, terms: tr.rows, error: null });
      } catch (e) { if (live) setS((x) => ({ ...x, loading: false, error: e.message })); }
    })();
    return () => { live = false; };
  }, [subjects, teachers, terms]);
  const classLabel = (classId, streamId) => { const r = s.classStreams.find((x) => x.class_id === classId && (x.stream_id || null) === (streamId || null)) || s.classStreams.find((x) => x.class_id === classId); return r ? [r.class_name, streamId ? r.stream_name : null].filter(Boolean).join(' ') : ''; };
  const names = {
    subject: (id) => s.subjects.find((x) => x.subject_id === id)?.subject_name || '', teacher: (id) => s.teachers.find((x) => x.teacher_id === id)?.teacher_name || '',
    class: classLabel, room: () => '',
  };
  return { ...s, classLabel, names };
}
