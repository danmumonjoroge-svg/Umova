-- Elimu Phase 8: READ-ONLY foreign-key inventory and a confirmed attendance orphan check.
-- Run against a STAGING clone first. This file contains SELECT statements only.
-- It does not add constraints, delete rows, or change data.

-- 1) Existing FK constraints touching Elimu tables, including their delete/update rules.
SELECT
  con.conname AS constraint_name,
  src_ns.nspname AS source_schema,
  src.relname AS source_table,
  pg_get_constraintdef(con.oid, true) AS definition,
  con.convalidated AS validated
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
JOIN pg_namespace src_ns ON src_ns.oid = src.relnamespace
WHERE con.contype = 'f'
  AND (src.relname LIKE 'elimu_%' OR con.confrelid::regclass::text LIKE '%elimu_%')
ORDER BY src.relname, con.conname;

-- 2) Elimu *_id columns with their nullability and whether they are currently FK-covered.
-- This is an inventory, not proof that a same-named target table exists.
SELECT
  c.table_schema,
  c.table_name,
  c.column_name,
  c.is_nullable,
  c.data_type,
  EXISTS (
    SELECT 1
    FROM information_schema.key_column_usage k
    JOIN information_schema.table_constraints tc
      ON tc.constraint_name = k.constraint_name
     AND tc.constraint_schema = k.constraint_schema
     AND tc.table_name = k.table_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND k.table_schema = c.table_schema
      AND k.table_name = c.table_name
      AND k.column_name = c.column_name
  ) AS has_foreign_key
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name LIKE 'elimu_%'
  AND c.column_name LIKE '%\_id' ESCAPE '\'
ORDER BY c.table_name, c.ordinal_position;

-- 3) Confirmed relationship from the Attendance architecture:
--    attendance_records.session_id -> attendance_sessions.id, scoped by tenant.
--    Any returned group is an orphan candidate that must be investigated before hardening.
SELECT
  r.tenant_id,
  r.session_id,
  COUNT(*) AS orphan_record_count
FROM public.elimu_attendance_records r
LEFT JOIN public.elimu_attendance_sessions s
  ON s.id = r.session_id
 AND s.tenant_id = r.tenant_id
WHERE s.id IS NULL
GROUP BY r.tenant_id, r.session_id
ORDER BY orphan_record_count DESC;

-- 4) Candidate relationship inventory for manual review.
-- Views such as elimu_v_roster are not valid FK targets. Do not add FKs to views.
-- Confirm physical parent table, tenant key, lifecycle/history semantics, and delete policy
-- from the actual migration source before drafting any ALTER TABLE statement.
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name LIKE 'elimu_%'
  AND column_name IN (
    'tenant_id', 'business_id', 'student_id', 'enrollment_id', 'guardian_id',
    'class_id', 'stream_id', 'academic_year_id', 'term_id', 'assessment_id',
    'session_id', 'staff_id', 'teacher_id', 'invoice_id', 'payment_id'
  )
ORDER BY table_name, ordinal_position;
