-- ============================================================
-- Phase 32 -- Owner control report. NOT DEPLOYED. Needs phases 28, 29 and 30 (phase 31 optional).
--
-- One read-only function, pos_control_report(from, to): what happened in the period that an owner should
-- look at. It READS the records the earlier phases keep; it adds no table and changes no data.
--   Reversals          requested / approved / refused, value, and any the owner approved on their own request
--   Cash and M-Pesa    days counted, signed off, total shortfall and overage, days with sales but no count
--   Staff changes      role, permission and status changes (from the audit trail)
--   Payroll            runs, and any approved by the person who prepared them (only with payroll.access)
--   Audit activity     the number of recorded actions by kind
-- Needs the audit.view permission (owner, manager, accountant by default). Dates are Nairobi calendar days.
-- A section is only as complete as the records behind it: anything done outside these screens (e.g. a
-- direct database edit, or a sale made before phase 29 was in place) is not in it.
-- ============================================================
DO $$ BEGIN
  IF to_regprocedure('public.pos_has_permission(text)') IS NULL OR to_regclass('public.pos_sale_reversals') IS NULL OR to_regclass('public.pos_reconciliations') IS NULL THEN
    RAISE EXCEPTION 'Run phase28, phase29 and phase30 first.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION pos_control_report(p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_t uuid := pos28_tenant_id(); tz constant text := 'Africa/Nairobi';
  rev jsonb; rec jsonb; chg jsonb; act jsonb; pay jsonb := NULL; nores jsonb; v_to date;
BEGIN
  IF NOT pos_has_permission('audit.view') THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='42501'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from OR p_to - p_from > 366 THEN RAISE EXCEPTION 'BAD_DATES: choose a period of up to one year' USING ERRCODE='22023'; END IF;
  v_to := least(p_to, (now() AT TIME ZONE tz)::date);

  SELECT jsonb_build_object(
    'requested', count(*), 'approved', count(*) FILTER (WHERE status='APPROVED'), 'refused', count(*) FILTER (WHERE status='REJECTED'),
    'pending', count(*) FILTER (WHERE status='PENDING'), 'cancelled', count(*) FILTER (WHERE status='CANCELLED'),
    'approved_value', coalesce(sum(sale_total) FILTER (WHERE status='APPROVED'),0),
    'self_approved', count(*) FILTER (WHERE status='APPROVED' AND self_approved),
    'by_person', coalesce((SELECT jsonb_agg(jsonb_build_object('name', n, 'requests', c, 'approved', a) ORDER BY c DESC) FROM (
        SELECT coalesce(s.name,'Unknown') n, count(*) c, count(*) FILTER (WHERE r2.status='APPROVED') a
          FROM pos_sale_reversals r2 LEFT JOIN pos_staff s ON s.id = r2.requested_by
         WHERE r2.pos_tenant_id = v_t AND (r2.requested_at AT TIME ZONE tz)::date BETWEEN p_from AND p_to GROUP BY s.name LIMIT 10) q), '[]'::jsonb))
  INTO rev FROM pos_sale_reversals WHERE pos_tenant_id = v_t AND (requested_at AT TIME ZONE tz)::date BETWEEN p_from AND p_to;

  SELECT jsonb_build_object(
    'days_counted', count(*), 'signed_off', count(*) FILTER (WHERE status='SIGNED_OFF'), 'waiting_sign_off', count(*) FILTER (WHERE status='DRAFT'),
    'self_signed', count(*) FILTER (WHERE self_signed),
    'cash_short', coalesce(-sum(variance_cash) FILTER (WHERE variance_cash < 0),0), 'cash_over', coalesce(sum(variance_cash) FILTER (WHERE variance_cash > 0),0),
    'mpesa_short', coalesce(-sum(variance_mpesa) FILTER (WHERE variance_mpesa < 0),0), 'mpesa_over', coalesce(sum(variance_mpesa) FILTER (WHERE variance_mpesa > 0),0),
    'days_with_difference', count(*) FILTER (WHERE abs(variance_cash) >= 0.5 OR abs(variance_mpesa) >= 0.5))
  INTO rec FROM pos_reconciliations WHERE pos_tenant_id = v_t AND rec_date BETWEEN p_from AND p_to;

  -- days that had completed sales but were never counted (today is not counted: the day is not over)
  SELECT coalesce(jsonb_agg(d ORDER BY d DESC), '[]'::jsonb) INTO nores FROM (
    SELECT DISTINCT ((s.completed_at AT TIME ZONE tz)::date) AS d
      FROM lb_sales s
     WHERE s.tenant_id = v_t AND s.status::text = 'COMPLETED' AND s.completed_at IS NOT NULL
       AND (s.completed_at AT TIME ZONE tz)::date BETWEEN p_from AND LEAST(v_to, (now() AT TIME ZONE tz)::date - 1)
       AND NOT EXISTS (SELECT 1 FROM pos_reconciliations r WHERE r.pos_tenant_id = v_t AND r.rec_date = (s.completed_at AT TIME ZONE tz)::date)
     LIMIT 62) x;

  SELECT jsonb_build_object('role_changes', count(*) FILTER (WHERE action='STAFF_ROLE_CHANGED'), 'permission_changes', count(*) FILTER (WHERE action='STAFF_PERMISSION_CHANGED'),
    'status_changes', count(*) FILTER (WHERE action IN ('STAFF_DISABLED','STAFF_ENABLED')),
    'recent', coalesce((SELECT jsonb_agg(jsonb_build_object('at', a2.created_at, 'action', a2.action, 'by', s.name, 'detail', a2.metadata) ORDER BY a2.created_at DESC) FROM (
        SELECT * FROM pos_audit_log WHERE pos_tenant_id = v_t AND action IN ('STAFF_ROLE_CHANGED','STAFF_PERMISSION_CHANGED','STAFF_DISABLED','STAFF_ENABLED','STAFF_PASSWORD_RESET')
           AND (created_at AT TIME ZONE tz)::date BETWEEN p_from AND p_to ORDER BY created_at DESC LIMIT 15) a2 LEFT JOIN pos_staff s ON s.id = a2.actor_id), '[]'::jsonb))
  INTO chg FROM pos_audit_log WHERE pos_tenant_id = v_t AND (created_at AT TIME ZONE tz)::date BETWEEN p_from AND p_to;

  SELECT coalesce(jsonb_agg(jsonb_build_object('action', action, 'count', c) ORDER BY c DESC), '[]'::jsonb) INTO act FROM (
    SELECT action, count(*) c FROM pos_audit_log WHERE pos_tenant_id = v_t AND (created_at AT TIME ZONE tz)::date BETWEEN p_from AND p_to GROUP BY action ORDER BY count(*) DESC LIMIT 25) y;

  IF pos_has_permission('payroll.access') AND to_regclass('public.pos_payroll_runs') IS NOT NULL THEN
    EXECUTE $q$SELECT jsonb_build_object('runs', count(*), 'approved_or_paid', count(*) FILTER (WHERE status IN ('APPROVED','PAID')), 'cancelled', count(*) FILTER (WHERE status='CANCELLED'),
        'self_approved', count(*) FILTER (WHERE self_approved), 'net_paid', coalesce(sum((totals->>'net')::numeric) FILTER (WHERE status='PAID'),0))
      FROM pos_payroll_runs WHERE pos_tenant_id = $1 AND period_start BETWEEN $2 AND $3$q$ INTO pay USING v_t, p_from, p_to;
  END IF;

  RETURN jsonb_build_object('from', p_from, 'to', p_to, 'reversals', rev, 'reconciliation', rec || jsonb_build_object('days_without_count', nores),
    'staff_changes', chg, 'payroll', pay, 'audit_activity', act);
END $$;
REVOKE ALL ON FUNCTION pos_control_report(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pos_control_report(date,date) TO authenticated;
