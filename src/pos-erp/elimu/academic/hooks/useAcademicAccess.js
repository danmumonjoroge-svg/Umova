// elimu/academic/hooks/useAcademicAccess.js — what the signed-in person may do. UI hints only: the database enforces every rule.
import { useCallback, useMemo } from 'react';
import { useLoad } from '../../../components/network/networkKit';
import { academicService } from '../services/academicService';

export function useAcademicAccess() {
  const { data, loading, error, reload } = useLoad(() => academicService.access(), []);
  const can = useCallback((action) => !!data?.can?.[action], [data]);
  return useMemo(() => ({ access: data, loading, error, reload, can, hasAnyRole: !!data?.ok && (data.is_owner || (data.roles || []).length > 0),
    isOwner: !!data?.is_owner, isTeacher: !!data?.is_teacher, isClassTeacher: !!data?.is_class_teacher }), [data, loading, error, reload, can]);
}
