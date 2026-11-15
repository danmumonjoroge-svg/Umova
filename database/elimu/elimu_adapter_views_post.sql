-- ELIMU ADAPTER VIEWS (part 2) -- run after AI 2's 10_core.sql (needs elimu_subjects). Re-runnable.
CREATE OR REPLACE VIEW elimu_v_subjects WITH (security_invoker = true) AS
  SELECT tenant_id, id AS subject_id, name AS subject_name, code AS subject_code FROM elimu_subjects WHERE is_active;

-- D4: teachers are the POS staff table (no core change).
-- NOT security_invoker on purpose: it must not depend on the POS's own RLS/grants on pos_staff (which this repo cannot see); it is filtered
-- to the caller's own tenant, and exposes only id/name/phone/email.
CREATE OR REPLACE VIEW elimu_v_teachers AS
  SELECT pos_tenant_id AS tenant_id, id AS teacher_id, name AS teacher_name, phone, email
    FROM pos_staff WHERE status = 'active' AND pos_tenant_id = get_current_tenant_id();

GRANT SELECT ON elimu_v_subjects, elimu_v_teachers TO authenticated;
