// elimu/academic/hooks/useScope.js — year / term / class / stream (/ subject) selection shared by the academic screens.
// Reads the foundation only through the adapter views (academicService.refs). Defaults to the current year and term.
import { useEffect, useMemo, useState } from 'react';
import { useLoad } from '../../../components/network/networkKit';
import { academicService } from '../services/academicService';

export function useScope(initial = {}) {
  const { data: refs, loading, error, reload } = useLoad(() => academicService.refs(), []);
  const [scope, setScopeState] = useState({ yearId: '', termId: '', classId: '', streamId: '', subjectId: '', ...initial });
  useEffect(() => {
    if (!refs) return;
    setScopeState((s) => {
      const year = s.yearId || (refs.years.find((y) => y.is_current) || refs.years[0])?.id || '';
      const term = s.termId || (refs.terms.find((t) => t.academic_year_id === year && t.is_current) || refs.terms.find((t) => t.academic_year_id === year))?.id || '';
      return { ...s, yearId: year, termId: term };
    });
  }, [refs]);
  const setScope = (patch) => setScopeState((s) => {
    const n = { ...s, ...patch };
    if ('yearId' in patch && refs) n.termId = (refs.terms.find((t) => t.academic_year_id === n.yearId && t.is_current) || refs.terms.find((t) => t.academic_year_id === n.yearId))?.id || '';
    if ('classId' in patch) n.streamId = '';
    return n;
  });
  const termsForYear = useMemo(() => (refs?.terms || []).filter((t) => t.academic_year_id === scope.yearId), [refs, scope.yearId]);
  const streamsForClass = useMemo(() => (refs?.streams || []).filter((x) => x.class_id === scope.classId), [refs, scope.classId]);
  const nameOf = (list, id) => (refs?.[list] || []).find((x) => x.id === id)?.name || '';
  return { refs, loading, error, reload, scope, setScope, termsForYear, streamsForClass, nameOf };
}
