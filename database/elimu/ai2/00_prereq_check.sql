-- ============================================================
-- ELIMU Academic — 00 PREREQUISITE CHECK  (READ-ONLY, safe to run anywhere)
--
-- Lists which EXISTING POS objects the academic module needs and whether
-- they are present. Run it before 10_core.sql. It changes nothing.
-- Any row with ok = false must be fixed first (run the named POS phase).
-- ============================================================
WITH needs(kind, name, from_phase) AS (VALUES
  ('function', 'get_current_tenant_id',   'phase1 / auth hook'),
  ('function', 'is_pos_session',          'phase27'),
  ('function', 'is_pos_owner',            'phase27'),
  ('function', 'pos_has_permission',      'phase28'),
  ('table',    'pos_tenants',             'base'),
  ('table',    'pos_staff',               'base'),
  ('table',    'pos_audit_log',           'base'),
  ('table',    'lb_businesses',           'phase1'),
  ('table',    'lb_communication_log',    'phase7 + phase50'),
  ('table',    'lb_communication_templates', 'phase7 + phase50'),
  ('view',     'elimu_ref_enrollments',   'ELIMU FOUNDATION (or dev stub: dev/05_dev_foundation_stub.sql)'),
  ('view',     'elimu_ref_students',      'ELIMU FOUNDATION (or dev stub)'),
  ('view',     'elimu_ref_classes',       'ELIMU FOUNDATION (or dev stub)'),
  ('view',     'elimu_ref_streams',       'ELIMU FOUNDATION (or dev stub)'),
  ('view',     'elimu_ref_academic_years','ELIMU FOUNDATION (or dev stub)'),
  ('view',     'elimu_ref_terms',         'ELIMU FOUNDATION (or dev stub)'),
  ('view',     'elimu_ref_guardians',     'ELIMU FOUNDATION (or dev stub)'),
  ('view',     'elimu_ref_student_guardians', 'ELIMU FOUNDATION (or dev stub)')
)
SELECT n.kind, n.name, n.from_phase,
       CASE n.kind
         WHEN 'function' THEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace WHERE s.nspname = 'public' AND p.proname = n.name)
         WHEN 'table'    THEN to_regclass('public.' || n.name) IS NOT NULL
         WHEN 'view'     THEN to_regclass('public.' || n.name) IS NOT NULL
       END AS ok
  FROM needs n
 ORDER BY ok, n.kind, n.name;
