-- ============================================================================
-- ELIMU FINANCE  E008  Reporting functions. Read-only, permission-gated, PAGINATED (never the whole history at once).
-- Money figures are numeric(15,2). "outstanding" = amount owed on open invoices; "credit" = free money held for the student.
-- Requires E001-E007. Re-runnable.
-- ============================================================================
CREATE OR REPLACE FUNCTION _elimu_fin_lim(p int, p_max int DEFAULT 200) RETURNS int LANGUAGE sql IMMUTABLE AS $$ SELECT least(greatest(coalesce(p, 50), 1), p_max) $$;

-- ---------- one student's account in one object ----------
CREATE OR REPLACE FUNCTION elimu_fin_student_account(p_business uuid, p_student uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a elimu_fin_accounts%ROWTYPE; s elimu_fin_students%ROWTYPE; v jsonb; v_out numeric; v_arrears numeric; v_credit numeric; v_next jsonb;
BEGIN
  PERFORM _elimu_fin_require('view'); PERFORM _elimu_fin_tenant_of(p_business);
  SELECT * INTO s FROM elimu_fin_students WHERE business_id = p_business AND student_id = p_student;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Student not found.'; END IF;
  SELECT * INTO a FROM elimu_fin_accounts WHERE business_id = p_business AND student_id = p_student;
  SELECT jsonb_object_agg(entry_type, total) INTO v FROM (SELECT entry_type, sum(amount) AS total FROM elimu_fin_ledger WHERE business_id = p_business AND student_id = p_student GROUP BY entry_type) q;
  SELECT coalesce(sum(outstanding),0), coalesce(sum(outstanding) FILTER (WHERE due_date < _elimu_fin_today()),0) INTO v_out, v_arrears
    FROM elimu_fin_invoices WHERE business_id = p_business AND student_id = p_student AND status IN ('ISSUED','PARTIALLY_PAID');
  v_credit := coalesce((SELECT sum(_elimu_fin_source_free('PAYMENT', id)) FROM elimu_fin_payments WHERE business_id = p_business AND student_id = p_student AND status = 'CONFIRMED'), 0)
            + coalesce((SELECT sum(_elimu_fin_source_free('ADJUSTMENT', id)) FROM elimu_fin_adjustments WHERE business_id = p_business AND student_id = p_student AND status = 'APPLIED'), 0);
  SELECT jsonb_build_object('plan_id', pl.id, 'seq', q.seq, 'due_date', q.due_date, 'remaining', q.remaining) INTO v_next
    FROM elimu_fin_payment_plans pl CROSS JOIN LATERAL (SELECT * FROM elimu_fin_plan_status(pl.id) x WHERE x.status <> 'PAID' ORDER BY x.seq LIMIT 1) q
   WHERE pl.business_id = p_business AND pl.student_id = p_student AND pl.status = 'ACTIVE' ORDER BY q.due_date LIMIT 1;
  RETURN jsonb_build_object(
    'student', jsonb_build_object('student_id', s.student_id, 'admission_no', s.admission_no, 'name', s.full_name, 'class_name', s.class_name, 'stream_name', s.stream_name,
      'guardian_name', s.guardian_name, 'guardian_phone', s.guardian_phone, 'guardian_email', s.guardian_email, 'status', s.status),
    'opening_balance', coalesce((v->>'OPENING_BALANCE')::numeric,0), 'opening_credit', -coalesce((v->>'OPENING_CREDIT')::numeric,0),
    'charges', coalesce((v->>'CHARGE')::numeric,0), 'payments', -coalesce((v->>'PAYMENT')::numeric,0),
    'discounts', -coalesce((v->>'DISCOUNT')::numeric,0), 'scholarships', -coalesce((v->>'SCHOLARSHIP')::numeric,0), 'bursaries', -coalesce((v->>'BURSARY')::numeric,0),
    'credit_notes', -coalesce((v->>'CREDIT_NOTE')::numeric,0), 'write_offs', -coalesce((v->>'WRITE_OFF')::numeric,0),
    'refunds', coalesce((v->>'REFUND')::numeric,0), 'reversals', coalesce((v->>'REVERSAL')::numeric,0),
    'current_balance', coalesce(a.balance,0),                  -- >0 owed, <0 credit
    'billed', coalesce((SELECT sum(total) FROM elimu_fin_invoices WHERE business_id = p_business AND student_id = p_student AND status <> 'CANCELLED'),0),
    'outstanding', v_out, 'arrears', v_arrears, 'credit_available', v_credit,
    'balance_check', jsonb_build_object('ledger_vs_cache', coalesce(elimu_fin_verify_account(p_business, p_student),0), 'outstanding_minus_credit_minus_balance', v_out - v_credit - coalesce(a.balance,0)),
    'next_installment', v_next);
END $$;

-- ---------- statement (chronological, paged) ----------
CREATE OR REPLACE FUNCTION elimu_fin_statement(p_business uuid, p_student uuid, p_from date DEFAULT NULL, p_to date DEFAULT NULL, p_limit int DEFAULT 100, p_offset int DEFAULT 0)
RETURNS TABLE (seq bigint, entry_date date, entry_type text, description text, debit numeric, credit numeric, balance numeric, invoice_no text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM _elimu_fin_require('view'); PERFORM _elimu_fin_tenant_of(p_business);
  RETURN QUERY
    SELECT l.seq, l.entry_date, l.entry_type, l.description, greatest(l.amount,0), greatest(-l.amount,0), l.balance_after, i.invoice_no
      FROM elimu_fin_ledger l LEFT JOIN elimu_fin_invoices i ON i.id = l.invoice_id
     WHERE l.business_id = p_business AND l.student_id = p_student AND (p_from IS NULL OR l.entry_date >= p_from) AND (p_to IS NULL OR l.entry_date <= p_to)
     ORDER BY l.seq OFFSET greatest(coalesce(p_offset,0),0) LIMIT _elimu_fin_lim(p_limit, 500);
END $$;

-- ---------- debtors ----------
CREATE OR REPLACE FUNCTION elimu_fin_debtors(p_business uuid, p_period uuid DEFAULT NULL, p_class uuid DEFAULT NULL, p_stream uuid DEFAULT NULL,
  p_min_outstanding numeric DEFAULT 0.01, p_min_days_overdue int DEFAULT NULL, p_as_of date DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE (student_id uuid, admission_no text, student_name text, class_name text, stream_name text, guardian_name text, guardian_phone text, guardian_email text,
  total_billed numeric, total_paid numeric, outstanding numeric, days_overdue int, last_payment_date date, next_installment_due date, open_invoices int, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_asof date := coalesce(p_as_of, _elimu_fin_today());
BEGIN
  IF NOT (elimu_fin_can('report') OR elimu_fin_can('bill')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  PERFORM _elimu_fin_tenant_of(p_business);
  RETURN QUERY
  WITH inv AS (
    SELECT i.student_id, sum(i.total) AS billed, sum(i.settled) AS paid, sum(i.outstanding) AS owed, count(*) FILTER (WHERE i.outstanding > 0)::int AS open_n,
           max(GREATEST(v_asof - i.due_date, 0)) FILTER (WHERE i.outstanding > 0) AS overdue
      FROM elimu_fin_invoices i WHERE i.business_id = p_business AND i.status <> 'CANCELLED' AND (p_period IS NULL OR i.period_id = p_period) GROUP BY i.student_id),
  nxt AS (
    SELECT pl.student_id, min(q.due_date) AS d FROM elimu_fin_payment_plans pl CROSS JOIN LATERAL elimu_fin_plan_status(pl.id, v_asof) q
     WHERE pl.business_id = p_business AND pl.status = 'ACTIVE' AND q.status <> 'PAID' GROUP BY pl.student_id),
  lp AS (SELECT p.student_id, max(p.payment_date) AS d FROM elimu_fin_payments p WHERE p.business_id = p_business AND p.status = 'CONFIRMED' GROUP BY p.student_id),
  base AS (
    SELECT s.student_id, s.admission_no, s.full_name, s.class_name, s.stream_name, s.guardian_name, s.guardian_phone, s.guardian_email,
           inv.billed, inv.paid, inv.owed, inv.overdue::int AS dov, lp.d AS lastp, nxt.d AS nextd, inv.open_n
      FROM elimu_fin_students s JOIN inv ON inv.student_id = s.student_id LEFT JOIN nxt ON nxt.student_id = s.student_id LEFT JOIN lp ON lp.student_id = s.student_id
     WHERE s.business_id = p_business AND inv.owed >= coalesce(p_min_outstanding, 0.01)
       AND (p_class IS NULL OR s.class_id = p_class) AND (p_stream IS NULL OR s.stream_id = p_stream)
       AND (p_min_days_overdue IS NULL OR coalesce(inv.overdue,0) >= p_min_days_overdue))
  SELECT b.student_id, b.admission_no, b.full_name, b.class_name, b.stream_name, b.guardian_name, b.guardian_phone, b.guardian_email,
         b.billed, b.paid, b.owed, b.dov, b.lastp, b.nextd, b.open_n, count(*) OVER ()
    FROM base b ORDER BY b.owed DESC, b.admission_no OFFSET greatest(coalesce(p_offset,0),0) LIMIT _elimu_fin_lim(p_limit);
END $$;

-- ---------- aging ----------
CREATE OR REPLACE FUNCTION elimu_fin_aging(p_business uuid, p_as_of date DEFAULT NULL, p_class uuid DEFAULT NULL, p_period uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_asof date := coalesce(p_as_of, _elimu_fin_today()); v jsonb;
BEGIN
  IF NOT (elimu_fin_can('report') OR elimu_fin_can('bill')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  PERFORM _elimu_fin_tenant_of(p_business);
  SELECT jsonb_build_object(
    'as_of', v_asof,
    'not_yet_due', jsonb_build_object('amount', coalesce(sum(i.outstanding) FILTER (WHERE d <= 0),0), 'students', count(DISTINCT i.student_id) FILTER (WHERE d <= 0)),
    'days_1_30',   jsonb_build_object('amount', coalesce(sum(i.outstanding) FILTER (WHERE d BETWEEN 1 AND 30),0), 'students', count(DISTINCT i.student_id) FILTER (WHERE d BETWEEN 1 AND 30)),
    'days_31_60',  jsonb_build_object('amount', coalesce(sum(i.outstanding) FILTER (WHERE d BETWEEN 31 AND 60),0), 'students', count(DISTINCT i.student_id) FILTER (WHERE d BETWEEN 31 AND 60)),
    'days_61_90',  jsonb_build_object('amount', coalesce(sum(i.outstanding) FILTER (WHERE d BETWEEN 61 AND 90),0), 'students', count(DISTINCT i.student_id) FILTER (WHERE d BETWEEN 61 AND 90)),
    'over_90',     jsonb_build_object('amount', coalesce(sum(i.outstanding) FILTER (WHERE d > 90),0), 'students', count(DISTINCT i.student_id) FILTER (WHERE d > 90)),
    'total',       jsonb_build_object('amount', coalesce(sum(i.outstanding),0), 'students', count(DISTINCT i.student_id)))
  INTO v
  FROM (SELECT i.*, (v_asof - i.due_date) AS d FROM elimu_fin_invoices i JOIN elimu_fin_students s ON s.business_id = i.business_id AND s.student_id = i.student_id
         WHERE i.business_id = p_business AND i.status IN ('ISSUED','PARTIALLY_PAID') AND i.outstanding > 0
           AND (p_class IS NULL OR s.class_id = p_class) AND (p_period IS NULL OR i.period_id = p_period)) i;
  RETURN v;
END $$;

-- ---------- collections (confirmed money only) ----------
CREATE OR REPLACE FUNCTION elimu_fin_collections(p_business uuid, p_from date, p_to date, p_group text DEFAULT 'DAY')
RETURNS TABLE (bucket text, payments bigint, collected numeric, reversed numeric, net numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE g text := upper(coalesce(p_group,'DAY'));
BEGIN
  IF NOT (elimu_fin_can('report') OR elimu_fin_can('approve')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  PERFORM _elimu_fin_tenant_of(p_business);
  IF g NOT IN ('DAY','WEEK','MONTH','YEAR','METHOD','CASHIER') THEN RAISE EXCEPTION 'Group by DAY, WEEK, MONTH, YEAR, METHOD or CASHIER.'; END IF;
  RETURN QUERY
    SELECT q.b, count(*) FILTER (WHERE q.status = 'CONFIRMED'), coalesce(sum(q.amount) FILTER (WHERE q.status = 'CONFIRMED'),0),
           coalesce(sum(q.amount) FILTER (WHERE q.status = 'REVERSED'),0), coalesce(sum(q.amount) FILTER (WHERE q.status = 'CONFIRMED'),0)
      FROM (SELECT p.amount, p.status, CASE g WHEN 'DAY' THEN to_char(p.payment_date,'YYYY-MM-DD') WHEN 'WEEK' THEN to_char(date_trunc('week', p.payment_date),'YYYY-MM-DD')
              WHEN 'MONTH' THEN to_char(p.payment_date,'YYYY-MM') WHEN 'YEAR' THEN to_char(p.payment_date,'YYYY') WHEN 'METHOD' THEN p.method
              ELSE coalesce((SELECT st.name FROM pos_staff st WHERE st.id = coalesce(p.cashier_id, p.created_by)), 'Unknown') END AS b
              FROM elimu_fin_payments p WHERE p.business_id = p_business AND p.payment_date BETWEEN p_from AND p_to AND p.status IN ('CONFIRMED','REVERSED')) q
     GROUP BY q.b ORDER BY q.b;
END $$;

-- term / annual collections: what the confirmed money was ALLOCATED to, by billing period (+ unallocated credit)
CREATE OR REPLACE FUNCTION elimu_fin_collections_by_period(p_business uuid) RETURNS TABLE (academic_year text, term text, allocated numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (elimu_fin_can('report')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  PERFORM _elimu_fin_tenant_of(p_business);
  RETURN QUERY SELECT coalesce(i.academic_year,'(none)'), i.term, sum(a.amount) FROM elimu_fin_allocations a JOIN elimu_fin_invoices i ON i.id = a.invoice_id
   WHERE a.business_id = p_business AND a.released_at IS NULL AND a.source_type = 'PAYMENT' GROUP BY 1, 2 ORDER BY 1, 2 NULLS FIRST;
END $$;

-- ---------- fees summary for a period ----------
CREATE OR REPLACE FUNCTION elimu_fin_fee_summary(p_business uuid, p_period uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb;
BEGIN
  IF NOT elimu_fin_can('report') THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  PERFORM _elimu_fin_tenant_of(p_business);
  SELECT jsonb_build_object(
    'gross_charges', coalesce(sum(charges),0), 'invoice_discounts', coalesce(sum(discounts),0), 'total_billed', coalesce(sum(total),0),
    'settled', coalesce(sum(settled),0), 'outstanding', coalesce(sum(outstanding),0), 'invoices', count(*),
    'adjustments', (SELECT coalesce(jsonb_object_agg(kind, tot),'{}'::jsonb) FROM (SELECT a.kind, sum(a.amount) AS tot FROM elimu_fin_adjustments a
        WHERE a.business_id = p_business AND a.status = 'APPLIED' AND (p_period IS NULL OR a.period_id = p_period) GROUP BY a.kind) k))
  INTO v FROM elimu_fin_invoices WHERE business_id = p_business AND status <> 'CANCELLED' AND (p_period IS NULL OR period_id = p_period);
  RETURN v;
END $$;

-- ---------- fee structure report ----------
CREATE OR REPLACE FUNCTION elimu_fin_structure_report(p_business uuid, p_period uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM _elimu_fin_require('view'); PERFORM _elimu_fin_tenant_of(p_business);
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('structure_id', f.id, 'name', f.name, 'status', f.status, 'class', f.class_name, 'stream', f.stream_name, 'boarding', f.boarding_status,
      'category', f.student_category, 'academic_year', p.academic_year, 'term', p.term,
      'total', (SELECT coalesce(sum(si.amount),0) FROM elimu_fin_fee_structure_items si WHERE si.structure_id = f.id),
      'items', (SELECT coalesce(jsonb_agg(jsonb_build_object('item', i.name, 'amount', si.amount, 'frequency', i.frequency) ORDER BY si.sort_order, i.name),'[]'::jsonb)
                  FROM elimu_fin_fee_structure_items si JOIN elimu_fin_fee_items i ON i.id = si.fee_item_id WHERE si.structure_id = f.id)) ORDER BY p.start_date, f.name)
    FROM elimu_fin_fee_structures f JOIN elimu_fin_periods p ON p.id = f.period_id WHERE f.business_id = p_business AND (p_period IS NULL OR f.period_id = p_period)), '[]'::jsonb);
END $$;

-- ---------- student lists ----------
-- kind: OUTSTANDING | PAID_UP | CREDIT | WITH_PLAN
CREATE OR REPLACE FUNCTION elimu_fin_student_list(p_business uuid, p_kind text, p_class uuid DEFAULT NULL, p_limit int DEFAULT 50, p_offset int DEFAULT 0)
RETURNS TABLE (student_id uuid, admission_no text, student_name text, class_name text, balance numeric, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE k text := upper(p_kind);
BEGIN
  IF NOT (elimu_fin_can('report') OR elimu_fin_can('bill')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  PERFORM _elimu_fin_tenant_of(p_business);
  IF k NOT IN ('OUTSTANDING','PAID_UP','CREDIT','WITH_PLAN') THEN RAISE EXCEPTION 'Unknown list.'; END IF;
  RETURN QUERY
    SELECT s.student_id, s.admission_no, s.full_name, s.class_name, a.balance, count(*) OVER ()
      FROM elimu_fin_students s JOIN elimu_fin_accounts a ON a.business_id = s.business_id AND a.student_id = s.student_id
     WHERE s.business_id = p_business AND (p_class IS NULL OR s.class_id = p_class)
       AND CASE k WHEN 'OUTSTANDING' THEN a.balance > 0 WHEN 'CREDIT' THEN a.balance < 0
                  WHEN 'PAID_UP' THEN a.balance <= 0 AND EXISTS (SELECT 1 FROM elimu_fin_invoices i WHERE i.business_id = s.business_id AND i.student_id = s.student_id AND i.status <> 'CANCELLED')
                  ELSE EXISTS (SELECT 1 FROM elimu_fin_payment_plans pl WHERE pl.business_id = s.business_id AND pl.student_id = s.student_id AND pl.status = 'ACTIVE') END
     ORDER BY s.admission_no OFFSET greatest(coalesce(p_offset,0),0) LIMIT _elimu_fin_lim(p_limit);
END $$;

-- ---------- income & expenditure ----------
CREATE OR REPLACE FUNCTION elimu_fin_income_expenditure(p_business uuid, p_from date, p_to date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_coll numeric; v_ref numeric; v_exp numeric; v_cat jsonb;
BEGIN
  IF NOT elimu_fin_can('report') THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  PERFORM _elimu_fin_tenant_of(p_business);
  SELECT coalesce(sum(amount),0) INTO v_coll FROM elimu_fin_payments WHERE business_id = p_business AND status = 'CONFIRMED' AND payment_date BETWEEN p_from AND p_to;
  SELECT coalesce(sum(amount),0) INTO v_ref FROM elimu_fin_corrections WHERE business_id = p_business AND kind = 'REFUND' AND status = 'COMPLETED' AND decided_at::date BETWEEN p_from AND p_to;
  SELECT coalesce(sum(e.amount),0) INTO v_exp FROM lb_expenses e JOIN elimu_fin_expense_meta m ON m.expense_id = e.id
   WHERE e.business_id = p_business AND e.status::text = 'PAID' AND e.expense_date BETWEEN p_from AND p_to;
  SELECT coalesce(jsonb_agg(jsonb_build_object('category', c.name, 'amount', t.amt) ORDER BY t.amt DESC),'[]'::jsonb) INTO v_cat
    FROM (SELECT e.category_id, sum(e.amount) AS amt FROM lb_expenses e JOIN elimu_fin_expense_meta m ON m.expense_id = e.id
           WHERE e.business_id = p_business AND e.status::text = 'PAID' AND e.expense_date BETWEEN p_from AND p_to GROUP BY e.category_id) t LEFT JOIN lb_expense_categories c ON c.id = t.category_id;
  RETURN jsonb_build_object('fees_collected', v_coll, 'refunds_paid', v_ref, 'net_fees_received', v_coll - v_ref, 'expenditure', v_exp, 'surplus_deficit', v_coll - v_ref - v_exp, 'expenditure_by_category', v_cat,
    'basis', 'Cash basis: confirmed fee receipts less refunds, against PAID school expenses. Credit balances held for students are included in receipts until used.');
END $$;

-- ---------- repeated overdue accounts ----------
CREATE OR REPLACE FUNCTION elimu_fin_repeat_overdue(p_business uuid, p_min_terms int DEFAULT 2, p_limit int DEFAULT 50)
RETURNS TABLE (student_id uuid, admission_no text, student_name text, overdue_invoices bigint, outstanding numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (elimu_fin_can('report') OR elimu_fin_can('bill')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  PERFORM _elimu_fin_tenant_of(p_business);
  RETURN QUERY SELECT i.student_id, max(i.admission_no), max(i.student_name), count(*), sum(i.outstanding) FROM elimu_fin_invoices i
   WHERE i.business_id = p_business AND i.status IN ('ISSUED','PARTIALLY_PAID') AND i.due_date < _elimu_fin_today() AND i.outstanding > 0
   GROUP BY i.student_id HAVING count(*) >= greatest(p_min_terms,2) ORDER BY sum(i.outstanding) DESC LIMIT _elimu_fin_lim(p_limit);
END $$;

-- ---------- pending items an approver needs to see ----------
CREATE OR REPLACE FUNCTION elimu_fin_approval_queue(p_business uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM _elimu_fin_require('approve'); PERFORM _elimu_fin_tenant_of(p_business);
  RETURN jsonb_build_object(
    'payments',    (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'student', student_name, 'admission_no', admission_no, 'amount', amount, 'method', method, 'ref', transaction_ref, 'date', payment_date, 'recorded_by', created_by) ORDER BY created_at),'[]'::jsonb) FROM elimu_fin_payments WHERE business_id = p_business AND status = 'PENDING'),
    'adjustments', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'student', student_name, 'kind', kind, 'amount', amount, 'reason', reason, 'requested_by', requested_by) ORDER BY requested_at),'[]'::jsonb) FROM elimu_fin_adjustments WHERE business_id = p_business AND status = 'PENDING_APPROVAL'),
    'corrections', (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'student', student_name, 'kind', kind, 'amount', amount, 'reason', reason, 'requested_by', requested_by) ORDER BY requested_at),'[]'::jsonb) FROM elimu_fin_corrections WHERE business_id = p_business AND status = 'PENDING_APPROVAL'),
    'plans',       (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'student', student_name, 'total', total_amount, 'reason', reason, 'requested_by', requested_by) ORDER BY requested_at),'[]'::jsonb) FROM elimu_fin_payment_plans WHERE business_id = p_business AND status = 'PENDING_APPROVAL'),
    'sessions',    (SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'cashier_id', cashier_id, 'variance', variance, 'closed_at', closed_at) ORDER BY closed_at),'[]'::jsonb) FROM elimu_fin_cashier_sessions WHERE business_id = p_business AND status = 'CLOSED'));
END $$;

REVOKE ALL ON FUNCTION _elimu_fin_lim(int,int) FROM PUBLIC, anon, authenticated;
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'elimu_fin_student_account(uuid,uuid)','elimu_fin_statement(uuid,uuid,date,date,int,int)','elimu_fin_debtors(uuid,uuid,uuid,uuid,numeric,int,date,int,int)',
    'elimu_fin_aging(uuid,date,uuid,uuid)','elimu_fin_collections(uuid,date,date,text)','elimu_fin_collections_by_period(uuid)','elimu_fin_fee_summary(uuid,uuid)',
    'elimu_fin_structure_report(uuid,uuid)','elimu_fin_student_list(uuid,text,uuid,int,int)','elimu_fin_income_expenditure(uuid,date,date)',
    'elimu_fin_repeat_overdue(uuid,int,int)','elimu_fin_approval_queue(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;
