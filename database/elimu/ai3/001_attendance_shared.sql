-- ============================================================
-- ELIMU 001 (merged install) -- attendance/timetable shared bits.
-- Roles, elimu_can, elimu_require, elimu_tenant/business, elimu_audit (6-arg), elimu_my_access and the helpers now live in
-- ../elimu_000_core.sql and academic/15_setup_functions.sql. AI 3's own elimu_teacher_allocations table is DROPPED from the
-- install (decision D4): "who teaches what" is AI 2's elimu_class_teachers + elimu_subject_allocations, one source of truth.
-- Run AFTER AI 2's 10_core.sql. Re-runnable.
-- ============================================================

-- Is the CALLER allocated to this class/stream (class teacher), or to this subject in it (subject teacher)?
CREATE OR REPLACE FUNCTION elimu_is_allocated(p_class uuid, p_stream uuid DEFAULT NULL, p_subject uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM elimu_class_teachers c
     WHERE c.tenant_id = get_current_tenant_id() AND c.teacher_staff_id = elimu_staff_id() AND c.status = 'ACTIVE'
       AND c.class_id = p_class AND (c.stream_id IS NULL OR p_stream IS NULL OR c.stream_id = p_stream))
  OR EXISTS (
    SELECT 1 FROM elimu_subject_allocations a
     WHERE a.tenant_id = get_current_tenant_id() AND a.teacher_staff_id = elimu_staff_id() AND a.status = 'ACTIVE'
       AND a.class_id = p_class AND p_subject IS NOT NULL AND a.subject_id = p_subject
       AND (a.stream_id IS NULL OR p_stream IS NULL OR a.stream_id = p_stream))
$$;
GRANT EXECUTE ON FUNCTION elimu_is_allocated(uuid, uuid, uuid) TO authenticated;
