-- ============================================================
-- Phase 31 -- Staff records (HR) and payroll. NOT DEPLOYED. Needs phase28.
--
-- HR: employee records, daily attendance, leave requests. Optional: nothing else depends on it.
-- Payroll: monthly runs for the employees on file. Statutory deductions come from a RATES TABLE
-- kept per business, with a start date, a source note and a confirmation. A run cannot be APPROVED
-- until the owner has confirmed every rate in force for that month. The defaults seeded below were
-- read from public summaries and an NSSF notice in October 2026; they are a STARTING POINT, not
-- legal or tax advice. Check them against KRA, NSSF and SHA before confirming, and again whenever
-- the law changes (add a new row with a new start date; never overwrite history).
--
-- Not done: part-month pro-rating, overtime, loans/advances, automatic unpaid-leave deductions,
-- bank/M-Pesa pay-out files, P9 / P10 returns, employer-side filing. Payslips are produced; money
-- is NOT moved by the system.
-- ============================================================
DO $$ BEGIN
  IF to_regprocedure('public.pos28_tenant_id()') IS NULL OR to_regprocedure('public.pos_has_permission(text)') IS NULL THEN RAISE EXCEPTION 'Run phase28_staff_permissions.sql first.'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS pos_hr_employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_tenant_id uuid NOT NULL, business_id uuid NOT NULL,
  staff_id uuid,                                   -- the login this person uses, if any
  employee_no text, full_name text NOT NULL, phone text, job_title text,
  employment_type text NOT NULL DEFAULT 'PERMANENT' CHECK (employment_type IN ('PERMANENT','CONTRACT','CASUAL','INTERN')),
  start_date date, end_date date,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LEFT')),
  basic_salary numeric(15,2) NOT NULL DEFAULT 0 CHECK (basic_salary >= 0),   -- per month; visible only with payroll.access
  tax_pin text, nssf_no text, sha_no text, national_id text,                 -- visible only with employees.manage
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_hr_emp_no ON pos_hr_employees(business_id, employee_no) WHERE employee_no IS NOT NULL;
CREATE TABLE IF NOT EXISTS pos_hr_attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_tenant_id uuid NOT NULL, employee_id uuid NOT NULL REFERENCES pos_hr_employees(id) ON DELETE CASCADE,
  work_date date NOT NULL, status text NOT NULL CHECK (status IN ('PRESENT','ABSENT','LATE','LEAVE','OFF')),
  note text, recorded_by uuid, recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, work_date)
);
CREATE TABLE IF NOT EXISTS pos_hr_leave (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_tenant_id uuid NOT NULL, employee_id uuid NOT NULL REFERENCES pos_hr_employees(id) ON DELETE CASCADE,
  leave_type text NOT NULL CHECK (leave_type IN ('ANNUAL','SICK','MATERNITY','PATERNITY','UNPAID','OTHER')),
  from_date date NOT NULL, to_date date NOT NULL, days integer NOT NULL, reason text,
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED','APPROVED','REJECTED','CANCELLED')),
  requested_by uuid, decided_by uuid, decided_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date)
);
CREATE TABLE IF NOT EXISTS pos_payroll_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_tenant_id uuid NOT NULL,
  code text NOT NULL CHECK (code IN ('PAYE_BANDS','PERSONAL_RELIEF','NSSF','SHIF','HOUSING_LEVY')),
  effective_from date NOT NULL, params jsonb NOT NULL, source text,
  confirmed_by uuid, confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pos_tenant_id, code, effective_from)
);
CREATE TABLE IF NOT EXISTS pos_payroll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pos_tenant_id uuid NOT NULL, business_id uuid NOT NULL,
  period_start date NOT NULL, period_end date NOT NULL CHECK (period_end >= period_start),
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','PAID','CANCELLED')),
  rates_snapshot jsonb, totals jsonb, notes text,
  prepared_by uuid, prepared_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid, approved_at timestamptz, self_approved boolean NOT NULL DEFAULT false,
  paid_by uuid, paid_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payroll_run_period ON pos_payroll_runs(business_id, period_start) WHERE status <> 'CANCELLED';
CREATE TABLE IF NOT EXISTS pos_payroll_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES pos_payroll_runs(id) ON DELETE CASCADE, pos_tenant_id uuid NOT NULL,
  employee_id uuid NOT NULL, employee_name text NOT NULL, job_title text, tax_pin text, nssf_no text, sha_no text,
  basic numeric(15,2) NOT NULL, allowances numeric(15,2) NOT NULL DEFAULT 0, other_deductions numeric(15,2) NOT NULL DEFAULT 0,
  gross numeric(15,2) NOT NULL, nssf numeric(15,2) NOT NULL, shif numeric(15,2) NOT NULL, housing numeric(15,2) NOT NULL,
  taxable numeric(15,2) NOT NULL, paye_before_relief numeric(15,2) NOT NULL, relief numeric(15,2) NOT NULL, paye numeric(15,2) NOT NULL,
  net numeric(15,2) NOT NULL, employer_nssf numeric(15,2) NOT NULL, employer_housing numeric(15,2) NOT NULL, notes text,
  UNIQUE (run_id, employee_id)
);
ALTER TABLE pos_hr_employees ENABLE ROW LEVEL SECURITY; ALTER TABLE pos_hr_attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_hr_leave ENABLE ROW LEVEL SECURITY; ALTER TABLE pos_payroll_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE pos_payroll_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE pos_payroll_lines ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pos_hr_employees, pos_hr_attendance, pos_hr_leave, pos_payroll_rates, pos_payroll_runs, pos_payroll_lines FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION pos__audit_x(p_action text, p_type text, p_id uuid, p_meta jsonb) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (pos28_tenant_id(), 'staff', pos28_staff_id(), p_action, p_type, p_id, p_meta) $$;
REVOKE ALL ON FUNCTION pos__audit_x(text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION pos__need(p text) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN IF NOT pos_has_permission(p) THEN RAISE EXCEPTION 'NOT_ALLOWED' USING ERRCODE='42501'; END IF; END $$;
REVOKE ALL ON FUNCTION pos__need(text) FROM PUBLIC, anon, authenticated;

-- ---------- default statutory rates (UNCONFIRMED starting point) ----------
CREATE OR REPLACE FUNCTION _payroll_seed_rates(p_tenant uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO pos_payroll_rates(pos_tenant_id, code, effective_from, params, source) VALUES
   (p_tenant,'PAYE_BANDS','2026-01-01','{"bands":[{"upto":24000,"rate":0.10},{"upto":32333,"rate":0.25},{"upto":500000,"rate":0.30},{"upto":800000,"rate":0.325},{"upto":null,"rate":0.35}],"deduct_before_tax":["NSSF","SHIF","HOUSING"]}',
    'Public summaries (countrytaxcalc.com, faidihr.com), Oct 2026. NOT confirmed on kra.go.ke. Sources disagree on whether SHIF and the housing levy reduce taxable pay: check "deduct_before_tax".'),
   (p_tenant,'PERSONAL_RELIEF','2026-01-01','{"monthly":2400}','Public summaries, Oct 2026. NOT confirmed on kra.go.ke.'),
   (p_tenant,'NSSF','2026-02-01','{"rate":0.06,"lower_limit":9000,"upper_limit":108000}','NSSF Year 4 notice to employers (gaa.go.ke) and PwC tax alert, effective 1 Feb 2026. Employee 6% and employer 6%, up to KES 108,000. Confirm with NSSF.'),
   (p_tenant,'SHIF','2026-01-01','{"rate":0.0275,"minimum":0}','Public summaries, Oct 2026 (one flags the rate as provisional). Minimum contribution not confirmed. NOT confirmed with SHA.'),
   (p_tenant,'HOUSING_LEVY','2026-01-01','{"employee_rate":0.015,"employer_rate":0.015}','Public summaries, Oct 2026. NOT confirmed on kra.go.ke.')
  ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION _payroll_seed_rates(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION _payroll_rate(p_tenant uuid, p_code text, p_on date) RETURNS pos_payroll_rates
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r pos_payroll_rates;
BEGIN
  SELECT * INTO r FROM pos_payroll_rates WHERE pos_tenant_id = p_tenant AND code = p_code AND effective_from <= p_on ORDER BY effective_from DESC LIMIT 1;
  IF r.id IS NULL THEN RAISE EXCEPTION 'RATES_MISSING: no % rate is set for %', p_code, p_on USING ERRCODE='P0001'; END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION _payroll_rate(uuid,text,date) FROM PUBLIC, anon, authenticated;

-- one employee, one month. Rounding: each statutory amount to 2 decimals (half up); PAYE rounded after relief.
CREATE OR REPLACE FUNCTION _payroll_calc(p_tenant uuid, p_on date, p_basic numeric, p_allow numeric, p_other numeric) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  rb pos_payroll_rates; rr pos_payroll_rates; rn pos_payroll_rates; rs pos_payroll_rates; rh pos_payroll_rates;
  gross numeric; lel numeric; uel numeric; nssf numeric; nssf_er numeric; shif numeric; housing numeric; housing_er numeric;
  ded numeric := 0; taxable numeric; tax numeric := 0; lower numeric := 0; b jsonb; upto numeric; seg numeric; relief numeric; paye numeric; ded_set jsonb;
BEGIN
  rb := _payroll_rate(p_tenant,'PAYE_BANDS',p_on); rr := _payroll_rate(p_tenant,'PERSONAL_RELIEF',p_on);
  rn := _payroll_rate(p_tenant,'NSSF',p_on); rs := _payroll_rate(p_tenant,'SHIF',p_on); rh := _payroll_rate(p_tenant,'HOUSING_LEVY',p_on);
  gross := round(p_basic + p_allow, 2);
  lel := (rn.params->>'lower_limit')::numeric; uel := (rn.params->>'upper_limit')::numeric;
  nssf := round(least(gross, lel) * (rn.params->>'rate')::numeric + greatest(least(gross, uel) - lel, 0) * (rn.params->>'rate')::numeric, 2);
  nssf_er := nssf;                                           -- employer matches the employee amount
  shif := round(greatest(gross * (rs.params->>'rate')::numeric, coalesce((rs.params->>'minimum')::numeric, 0)), 2);
  housing := round(gross * (rh.params->>'employee_rate')::numeric, 2);
  housing_er := round(gross * (rh.params->>'employer_rate')::numeric, 2);
  ded_set := coalesce(rb.params->'deduct_before_tax', '[]'::jsonb);
  IF ded_set ? 'NSSF' THEN ded := ded + nssf; END IF;
  IF ded_set ? 'SHIF' THEN ded := ded + shif; END IF;
  IF ded_set ? 'HOUSING' THEN ded := ded + housing; END IF;
  taxable := greatest(gross - ded, 0);
  FOR b IN SELECT * FROM jsonb_array_elements(rb.params->'bands') LOOP
    upto := CASE WHEN b->'upto' = 'null'::jsonb THEN NULL ELSE (b->>'upto')::numeric END;
    seg := CASE WHEN upto IS NULL THEN greatest(taxable - lower, 0) ELSE greatest(least(taxable, upto) - lower, 0) END;
    tax := tax + seg * (b->>'rate')::numeric;
    EXIT WHEN upto IS NULL OR taxable <= upto;
    lower := upto;
  END LOOP;
  tax := round(tax, 2);
  relief := least((rr.params->>'monthly')::numeric, tax);
  paye := round(tax - relief, 2);
  RETURN jsonb_build_object('gross', gross, 'nssf', nssf, 'shif', shif, 'housing', housing, 'taxable', round(taxable,2),
    'paye_before_relief', tax, 'relief', relief, 'paye', paye,
    'net', round(gross - nssf - shif - housing - paye - p_other, 2), 'employer_nssf', nssf_er, 'employer_housing', housing_er,
    'confirmed', (rb.confirmed_at IS NOT NULL AND rr.confirmed_at IS NOT NULL AND rn.confirmed_at IS NOT NULL AND rs.confirmed_at IS NOT NULL AND rh.confirmed_at IS NOT NULL),
    'rates', jsonb_build_object('PAYE_BANDS', jsonb_build_object('from', rb.effective_from, 'params', rb.params), 'PERSONAL_RELIEF', jsonb_build_object('from', rr.effective_from, 'params', rr.params),
      'NSSF', jsonb_build_object('from', rn.effective_from, 'params', rn.params), 'SHIF', jsonb_build_object('from', rs.effective_from, 'params', rs.params), 'HOUSING_LEVY', jsonb_build_object('from', rh.effective_from, 'params', rh.params)));
END $$;
REVOKE ALL ON FUNCTION _payroll_calc(uuid,date,numeric,numeric,numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION pos__biz_ok2(p_business uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business AND tenant_id = pos28_tenant_id()) $$;
REVOKE ALL ON FUNCTION pos__biz_ok2(uuid) FROM PUBLIC, anon, authenticated;

-- ============================ HR ============================
CREATE OR REPLACE FUNCTION pos_hr_list_employees(p_business uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_sal boolean := pos_has_permission('payroll.access');
BEGIN
  PERFORM pos__need('employees.manage');
  IF NOT pos__biz_ok2(p_business) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.status, x.full_name) FROM (
    SELECT e.id, e.employee_no, e.full_name, e.phone, e.job_title, e.employment_type, e.start_date, e.end_date, e.status, e.staff_id,
           e.tax_pin, e.nssf_no, e.sha_no, e.national_id, CASE WHEN v_sal THEN e.basic_salary END AS basic_salary
      FROM pos_hr_employees e WHERE e.business_id = p_business AND e.pos_tenant_id = pos28_tenant_id()) x), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION pos_hr_save_employee(p_business uuid, p_id uuid, p_data jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := pos28_tenant_id(); v_id uuid := p_id; v_sal numeric; v_can_sal boolean := pos_has_permission('payroll.access');
BEGIN
  PERFORM pos__need('employees.manage');
  IF NOT pos__biz_ok2(p_business) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF length(btrim(coalesce(p_data->>'full_name',''))) < 2 THEN RAISE EXCEPTION 'NAME_REQUIRED: enter the employee''s name' USING ERRCODE='22023'; END IF;
  IF p_data ? 'basic_salary' AND v_can_sal THEN v_sal := (p_data->>'basic_salary')::numeric; IF v_sal < 0 THEN RAISE EXCEPTION 'BAD_AMOUNT' USING ERRCODE='22023'; END IF; END IF;
  IF p_data->>'staff_id' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM pos_staff WHERE id = (p_data->>'staff_id')::uuid AND pos_tenant_id = v_t) THEN RAISE EXCEPTION 'NOT_FOUND: that login is not in this business' USING ERRCODE='P0002'; END IF;
  IF v_id IS NULL THEN
    INSERT INTO pos_hr_employees (pos_tenant_id, business_id, staff_id, employee_no, full_name, phone, job_title, employment_type, start_date, end_date, status, basic_salary, tax_pin, nssf_no, sha_no, national_id, created_by)
    VALUES (v_t, p_business, nullif(p_data->>'staff_id','')::uuid, nullif(btrim(p_data->>'employee_no'),''), btrim(p_data->>'full_name'), nullif(btrim(p_data->>'phone'),''), nullif(btrim(p_data->>'job_title'),''),
            coalesce(nullif(p_data->>'employment_type',''),'PERMANENT'), nullif(p_data->>'start_date','')::date, nullif(p_data->>'end_date','')::date, coalesce(nullif(p_data->>'status',''),'ACTIVE'),
            coalesce(v_sal,0), nullif(btrim(p_data->>'tax_pin'),''), nullif(btrim(p_data->>'nssf_no'),''), nullif(btrim(p_data->>'sha_no'),''), nullif(btrim(p_data->>'national_id'),''), pos28_staff_id())
    RETURNING id INTO v_id;
    PERFORM pos__audit_x('HR_EMPLOYEE_ADDED','pos_hr_employees',v_id,jsonb_build_object('name', p_data->>'full_name'));
  ELSE
    UPDATE pos_hr_employees SET staff_id = nullif(p_data->>'staff_id','')::uuid, employee_no = nullif(btrim(p_data->>'employee_no'),''), full_name = btrim(p_data->>'full_name'),
      phone = nullif(btrim(p_data->>'phone'),''), job_title = nullif(btrim(p_data->>'job_title'),''), employment_type = coalesce(nullif(p_data->>'employment_type',''), employment_type),
      start_date = nullif(p_data->>'start_date','')::date, end_date = nullif(p_data->>'end_date','')::date, status = coalesce(nullif(p_data->>'status',''), status),
      basic_salary = coalesce(v_sal, basic_salary), tax_pin = nullif(btrim(p_data->>'tax_pin'),''), nssf_no = nullif(btrim(p_data->>'nssf_no'),''),
      sha_no = nullif(btrim(p_data->>'sha_no'),''), national_id = nullif(btrim(p_data->>'national_id'),''), updated_at = now()
     WHERE id = v_id AND pos_tenant_id = v_t AND business_id = p_business;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
    PERFORM pos__audit_x('HR_EMPLOYEE_CHANGED','pos_hr_employees',v_id,jsonb_build_object('name', p_data->>'full_name', 'salary_changed', v_sal IS NOT NULL));
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION pos_hr_set_attendance(p_employee uuid, p_date date, p_status text, p_note text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM pos__need('employees.manage');
  IF p_date > (now() AT TIME ZONE 'Africa/Nairobi')::date THEN RAISE EXCEPTION 'FUTURE_DATE' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pos_hr_employees WHERE id = p_employee AND pos_tenant_id = pos28_tenant_id()) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  INSERT INTO pos_hr_attendance(pos_tenant_id, employee_id, work_date, status, note, recorded_by)
  VALUES (pos28_tenant_id(), p_employee, p_date, p_status, nullif(btrim(coalesce(p_note,'')),''), pos28_staff_id())
  ON CONFLICT (employee_id, work_date) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, recorded_by = EXCLUDED.recorded_by, recorded_at = now();
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION pos_hr_attendance_month(p_business uuid, p_month date) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM pos__need('employees.manage');
  IF NOT pos__biz_ok2(p_business) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('employee_id', a.employee_id, 'work_date', a.work_date, 'status', a.status, 'note', a.note))
    FROM pos_hr_attendance a JOIN pos_hr_employees e ON e.id = a.employee_id
   WHERE e.business_id = p_business AND e.pos_tenant_id = pos28_tenant_id()
     AND a.work_date >= date_trunc('month', p_month)::date AND a.work_date < (date_trunc('month', p_month) + interval '1 month')::date), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION pos_hr_leave_request(p_employee uuid, p_type text, p_from date, p_to date, p_reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_id uuid;
BEGIN
  PERFORM pos__need('employees.manage');
  IF NOT EXISTS (SELECT 1 FROM pos_hr_employees WHERE id = p_employee AND pos_tenant_id = pos28_tenant_id()) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_to < p_from THEN RAISE EXCEPTION 'BAD_DATES: the end date is before the start date' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM pos_hr_leave WHERE employee_id = p_employee AND status IN ('REQUESTED','APPROVED') AND from_date <= p_to AND to_date >= p_from) THEN
    RAISE EXCEPTION 'OVERLAP: this person already has leave on those dates' USING ERRCODE='P0001'; END IF;
  INSERT INTO pos_hr_leave(pos_tenant_id, employee_id, leave_type, from_date, to_date, days, reason, requested_by)
  VALUES (pos28_tenant_id(), p_employee, p_type, p_from, p_to, (p_to - p_from) + 1, nullif(btrim(coalesce(p_reason,'')),''), pos28_staff_id()) RETURNING id INTO v_id;
  PERFORM pos__audit_x('HR_LEAVE_REQUESTED','pos_hr_leave',v_id,jsonb_build_object('from',p_from,'to',p_to,'type',p_type));
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

CREATE OR REPLACE FUNCTION pos_hr_leave_decide(p_id uuid, p_approve boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE q record; d date; own boolean;
BEGIN
  PERFORM pos__need('employees.manage');
  SELECT l.*, e.staff_id AS emp_staff INTO q FROM pos_hr_leave l JOIN pos_hr_employees e ON e.id = l.employee_id WHERE l.id = p_id AND l.pos_tenant_id = pos28_tenant_id() FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF q.status <> 'REQUESTED' THEN RAISE EXCEPTION 'ALREADY_DECIDED' USING ERRCODE='P0001'; END IF;
  own := q.emp_staff IS NOT NULL AND q.emp_staff = pos28_staff_id();
  IF own THEN RAISE EXCEPTION 'NOT_ALLOWED: you cannot decide your own leave' USING ERRCODE='42501'; END IF;
  UPDATE pos_hr_leave SET status = CASE WHEN p_approve THEN 'APPROVED' ELSE 'REJECTED' END, decided_by = pos28_staff_id(), decided_at = now() WHERE id = q.id;
  IF p_approve THEN
    FOR d IN SELECT generate_series(q.from_date, q.to_date, interval '1 day')::date LOOP
      INSERT INTO pos_hr_attendance(pos_tenant_id, employee_id, work_date, status, note, recorded_by) VALUES (q.pos_tenant_id, q.employee_id, d, 'LEAVE', q.leave_type, pos28_staff_id())
      ON CONFLICT (employee_id, work_date) DO UPDATE SET status = 'LEAVE', note = EXCLUDED.note, recorded_by = EXCLUDED.recorded_by, recorded_at = now();
    END LOOP;
  END IF;
  PERFORM pos__audit_x(CASE WHEN p_approve THEN 'HR_LEAVE_APPROVED' ELSE 'HR_LEAVE_REJECTED' END,'pos_hr_leave',q.id,jsonb_build_object('days', q.days));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION pos_hr_leave_list(p_business uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM pos__need('employees.manage');
  IF NOT pos__biz_ok2(p_business) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'employee_id', l.employee_id, 'employee_name', e.full_name, 'leave_type', l.leave_type,
      'from_date', l.from_date, 'to_date', l.to_date, 'days', l.days, 'reason', l.reason, 'status', l.status) ORDER BY l.from_date DESC)
    FROM pos_hr_leave l JOIN pos_hr_employees e ON e.id = l.employee_id WHERE e.business_id = p_business AND l.pos_tenant_id = pos28_tenant_id()), '[]'::jsonb);
END $$;

-- ============================ PAYROLL ============================
CREATE OR REPLACE FUNCTION pos_payroll_rates_list() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM pos__need('payroll.access');
  PERFORM _payroll_seed_rates(pos28_tenant_id());
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('code', r.code, 'effective_from', r.effective_from, 'params', r.params, 'source', r.source,
      'confirmed_at', r.confirmed_at, 'confirmed_by_name', s.name) ORDER BY r.code, r.effective_from DESC)
    FROM pos_payroll_rates r LEFT JOIN pos_staff s ON s.id = r.confirmed_by WHERE r.pos_tenant_id = pos28_tenant_id()), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION pos_payroll_rate_set(p_code text, p_effective_from date, p_params jsonb, p_source text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := pos28_tenant_id();
BEGIN
  PERFORM pos__need('payroll.access');
  IF p_code NOT IN ('PAYE_BANDS','PERSONAL_RELIEF','NSSF','SHIF','HOUSING_LEVY') THEN RAISE EXCEPTION 'BAD_CODE' USING ERRCODE='22023'; END IF;
  IF p_code = 'PAYE_BANDS' AND (jsonb_typeof(p_params->'bands') <> 'array' OR jsonb_array_length(p_params->'bands') < 1) THEN RAISE EXCEPTION 'BAD_PARAMS: PAYE needs a list of bands' USING ERRCODE='22023'; END IF;
  IF p_code = 'PERSONAL_RELIEF' AND (p_params->>'monthly') IS NULL THEN RAISE EXCEPTION 'BAD_PARAMS: monthly amount needed' USING ERRCODE='22023'; END IF;
  IF p_code = 'NSSF' AND ((p_params->>'rate') IS NULL OR (p_params->>'lower_limit') IS NULL OR (p_params->>'upper_limit') IS NULL) THEN RAISE EXCEPTION 'BAD_PARAMS: NSSF needs rate, lower_limit, upper_limit' USING ERRCODE='22023'; END IF;
  IF p_code = 'SHIF' AND (p_params->>'rate') IS NULL THEN RAISE EXCEPTION 'BAD_PARAMS: SHIF needs a rate' USING ERRCODE='22023'; END IF;
  IF p_code = 'HOUSING_LEVY' AND ((p_params->>'employee_rate') IS NULL OR (p_params->>'employer_rate') IS NULL) THEN RAISE EXCEPTION 'BAD_PARAMS: levy needs employee_rate and employer_rate' USING ERRCODE='22023'; END IF;
  IF length(btrim(coalesce(p_source,''))) < 5 THEN RAISE EXCEPTION 'SOURCE_REQUIRED: say where this figure comes from (e.g. the KRA notice and its date)' USING ERRCODE='22023'; END IF;
  IF EXISTS (SELECT 1 FROM pos_payroll_runs WHERE pos_tenant_id = v_t AND status IN ('APPROVED','PAID') AND period_end >= p_effective_from) THEN
    NULL; -- history is kept in each run's own snapshot; changing rates never rewrites an approved run
  END IF;
  INSERT INTO pos_payroll_rates(pos_tenant_id, code, effective_from, params, source) VALUES (v_t, p_code, p_effective_from, p_params, btrim(p_source))
  ON CONFLICT (pos_tenant_id, code, effective_from) DO UPDATE SET params = EXCLUDED.params, source = EXCLUDED.source, confirmed_by = NULL, confirmed_at = NULL;
  PERFORM pos__audit_x('PAYROLL_RATE_SET','pos_payroll_rates',NULL,jsonb_build_object('code',p_code,'from',p_effective_from,'params',p_params));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION pos_payroll_rate_confirm(p_code text, p_effective_from date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM pos__need('payroll.access');
  UPDATE pos_payroll_rates SET confirmed_by = pos28_staff_id(), confirmed_at = now() WHERE pos_tenant_id = pos28_tenant_id() AND code = p_code AND effective_from = p_effective_from;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  PERFORM pos__audit_x('PAYROLL_RATE_CONFIRMED','pos_payroll_rates',NULL,jsonb_build_object('code',p_code,'from',p_effective_from));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION _payroll_retotal(p_run uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  UPDATE pos_payroll_runs r SET totals = (SELECT jsonb_build_object('employees', count(*), 'gross', coalesce(sum(gross),0), 'nssf', coalesce(sum(nssf),0), 'shif', coalesce(sum(shif),0),
      'housing', coalesce(sum(housing),0), 'paye', coalesce(sum(paye),0), 'other_deductions', coalesce(sum(other_deductions),0), 'net', coalesce(sum(net),0),
      'employer_nssf', coalesce(sum(employer_nssf),0), 'employer_housing', coalesce(sum(employer_housing),0),
      'employer_cost', coalesce(sum(gross + employer_nssf + employer_housing),0)) FROM pos_payroll_lines WHERE run_id = r.id) WHERE r.id = p_run $$;
REVOKE ALL ON FUNCTION _payroll_retotal(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION pos_payroll_create_run(p_business uuid, p_period_start date, p_period_end date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_t uuid := pos28_tenant_id(); v_run uuid; e record; c jsonb; v_n int := 0; snap jsonb;
BEGIN
  PERFORM pos__need('payroll.access');
  IF NOT pos__biz_ok2(p_business) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF p_period_end < p_period_start OR p_period_end - p_period_start > 31 THEN RAISE EXCEPTION 'BAD_DATES: a run covers one month' USING ERRCODE='22023'; END IF;
  IF p_period_end > (now() AT TIME ZONE 'Africa/Nairobi')::date + 31 THEN RAISE EXCEPTION 'BAD_DATES: too far in the future' USING ERRCODE='22023'; END IF;
  PERFORM _payroll_seed_rates(v_t);
  BEGIN
    INSERT INTO pos_payroll_runs(pos_tenant_id, business_id, period_start, period_end, prepared_by) VALUES (v_t, p_business, p_period_start, p_period_end, pos28_staff_id()) RETURNING id INTO v_run;
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'ALREADY_EXISTS: there is already a payroll run for that month' USING ERRCODE='P0001'; END;
  FOR e IN SELECT * FROM pos_hr_employees WHERE pos_tenant_id = v_t AND business_id = p_business AND status = 'ACTIVE' AND basic_salary > 0
             AND (start_date IS NULL OR start_date <= p_period_end) AND (end_date IS NULL OR end_date >= p_period_start) ORDER BY full_name LOOP
    c := _payroll_calc(v_t, p_period_end, e.basic_salary, 0, 0);
    INSERT INTO pos_payroll_lines(run_id, pos_tenant_id, employee_id, employee_name, job_title, tax_pin, nssf_no, sha_no, basic, allowances, other_deductions, gross, nssf, shif, housing, taxable, paye_before_relief, relief, paye, net, employer_nssf, employer_housing)
    VALUES (v_run, v_t, e.id, e.full_name, e.job_title, e.tax_pin, e.nssf_no, e.sha_no, e.basic_salary, 0, 0, (c->>'gross')::numeric, (c->>'nssf')::numeric, (c->>'shif')::numeric, (c->>'housing')::numeric,
            (c->>'taxable')::numeric, (c->>'paye_before_relief')::numeric, (c->>'relief')::numeric, (c->>'paye')::numeric, (c->>'net')::numeric, (c->>'employer_nssf')::numeric, (c->>'employer_housing')::numeric);
    snap := c->'rates'; v_n := v_n + 1;
  END LOOP;
  IF v_n = 0 THEN RAISE EXCEPTION 'NO_EMPLOYEES: no active employee with a salary is on file for that month' USING ERRCODE='P0001'; END IF;
  UPDATE pos_payroll_runs SET rates_snapshot = snap WHERE id = v_run;
  PERFORM _payroll_retotal(v_run);
  PERFORM pos__audit_x('PAYROLL_RUN_CREATED','pos_payroll_runs',v_run,jsonb_build_object('start',p_period_start,'end',p_period_end,'employees',v_n));
  RETURN jsonb_build_object('ok', true, 'id', v_run, 'employees', v_n);
END $$;

CREATE OR REPLACE FUNCTION pos_payroll_edit_line(p_line uuid, p_allowances numeric, p_other_deductions numeric, p_notes text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE l record; r record; c jsonb;
BEGIN
  PERFORM pos__need('payroll.access');
  IF coalesce(p_allowances,0) < 0 OR coalesce(p_other_deductions,0) < 0 THEN RAISE EXCEPTION 'BAD_AMOUNT' USING ERRCODE='22023'; END IF;
  SELECT * INTO l FROM pos_payroll_lines WHERE id = p_line AND pos_tenant_id = pos28_tenant_id() FOR UPDATE;
  IF l.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  SELECT * INTO r FROM pos_payroll_runs WHERE id = l.run_id FOR UPDATE;
  IF r.status <> 'DRAFT' THEN RAISE EXCEPTION 'LOCKED: only a draft run can be changed' USING ERRCODE='P0001'; END IF;
  c := _payroll_calc(l.pos_tenant_id, r.period_end, l.basic, coalesce(p_allowances,0), coalesce(p_other_deductions,0));
  IF (c->>'net')::numeric < 0 THEN RAISE EXCEPTION 'NEGATIVE_NET: the deductions are more than the pay' USING ERRCODE='22023'; END IF;
  UPDATE pos_payroll_lines SET allowances = coalesce(p_allowances,0), other_deductions = coalesce(p_other_deductions,0), gross = (c->>'gross')::numeric, nssf = (c->>'nssf')::numeric, shif = (c->>'shif')::numeric,
    housing = (c->>'housing')::numeric, taxable = (c->>'taxable')::numeric, paye_before_relief = (c->>'paye_before_relief')::numeric, relief = (c->>'relief')::numeric, paye = (c->>'paye')::numeric,
    net = (c->>'net')::numeric, employer_nssf = (c->>'employer_nssf')::numeric, employer_housing = (c->>'employer_housing')::numeric, notes = nullif(btrim(coalesce(p_notes,'')),'') WHERE id = l.id;
  PERFORM _payroll_retotal(l.run_id);
  PERFORM pos__audit_x('PAYROLL_LINE_EDITED','pos_payroll_lines',l.id,jsonb_build_object('allowances',p_allowances,'other_deductions',p_other_deductions));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION pos_payroll_approve(p_run uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; v_self boolean; v_role text; code text;
BEGIN
  PERFORM pos__need('payroll.access');
  SELECT * INTO r FROM pos_payroll_runs WHERE id = p_run AND pos_tenant_id = pos28_tenant_id() FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF r.status <> 'DRAFT' THEN RAISE EXCEPTION 'ALREADY_DECIDED: this run is %', lower(r.status) USING ERRCODE='P0001'; END IF;
  FOREACH code IN ARRAY ARRAY['PAYE_BANDS','PERSONAL_RELIEF','NSSF','SHIF','HOUSING_LEVY'] LOOP
    IF (_payroll_rate(r.pos_tenant_id, code, r.period_end)).confirmed_at IS NULL THEN
      RAISE EXCEPTION 'RATES_NOT_CONFIRMED: confirm the % rate first (check it against the official source)', code USING ERRCODE='P0001'; END IF;
  END LOOP;
  v_self := r.prepared_by = pos28_staff_id();
  SELECT role::text INTO v_role FROM pos_staff WHERE id = pos28_staff_id();
  IF v_self AND v_role <> 'owner' THEN RAISE EXCEPTION 'SECOND_PERSON: someone else (or the owner) must approve a run you prepared' USING ERRCODE='42501'; END IF;
  UPDATE pos_payroll_runs SET status='APPROVED', approved_by=pos28_staff_id(), approved_at=now(), self_approved=v_self WHERE id = r.id;
  PERFORM pos__audit_x('PAYROLL_RUN_APPROVED','pos_payroll_runs',r.id,jsonb_build_object('self_approved',v_self,'totals',r.totals));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION pos_payroll_mark_paid(p_run uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  PERFORM pos__need('payroll.access');
  SELECT * INTO r FROM pos_payroll_runs WHERE id = p_run AND pos_tenant_id = pos28_tenant_id() FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF r.status <> 'APPROVED' THEN RAISE EXCEPTION 'NOT_APPROVED: approve the run before marking it paid' USING ERRCODE='P0001'; END IF;
  UPDATE pos_payroll_runs SET status='PAID', paid_by=pos28_staff_id(), paid_at=now() WHERE id = r.id;
  PERFORM pos__audit_x('PAYROLL_RUN_PAID','pos_payroll_runs',r.id,jsonb_build_object('net',r.totals->'net'));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION pos_payroll_cancel(p_run uuid, p_reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  PERFORM pos__need('payroll.access');
  IF length(btrim(coalesce(p_reason,''))) < 5 THEN RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM pos_payroll_runs WHERE id = p_run AND pos_tenant_id = pos28_tenant_id() FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  IF r.status NOT IN ('DRAFT','APPROVED') THEN RAISE EXCEPTION 'LOCKED: a % run cannot be cancelled', lower(r.status) USING ERRCODE='P0001'; END IF;
  UPDATE pos_payroll_runs SET status='CANCELLED', notes = btrim(p_reason) WHERE id = r.id;
  PERFORM pos__audit_x('PAYROLL_RUN_CANCELLED','pos_payroll_runs',r.id,jsonb_build_object('reason',p_reason));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION pos_payroll_list_runs(p_business uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM pos__need('payroll.access');
  IF NOT pos__biz_ok2(p_business) THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'period_start', r.period_start, 'period_end', r.period_end, 'status', r.status, 'totals', r.totals,
      'self_approved', r.self_approved, 'prepared_by_name', p.name, 'approved_by_name', a.name, 'approved_at', r.approved_at, 'paid_at', r.paid_at) ORDER BY r.period_start DESC)
    FROM pos_payroll_runs r LEFT JOIN pos_staff p ON p.id = r.prepared_by LEFT JOIN pos_staff a ON a.id = r.approved_by
   WHERE r.business_id = p_business AND r.pos_tenant_id = pos28_tenant_id()), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION pos_payroll_get_run(p_run uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record;
BEGIN
  PERFORM pos__need('payroll.access');
  SELECT * INTO r FROM pos_payroll_runs WHERE id = p_run AND pos_tenant_id = pos28_tenant_id();
  IF r.id IS NULL THEN RAISE EXCEPTION 'NOT_FOUND' USING ERRCODE='P0002'; END IF;
  RETURN jsonb_build_object('run', to_jsonb(r), 'lines', coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.employee_name) FROM pos_payroll_lines l WHERE l.run_id = r.id), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION pos_hr_list_employees(uuid), pos_hr_save_employee(uuid,uuid,jsonb), pos_hr_set_attendance(uuid,date,text,text), pos_hr_attendance_month(uuid,date),
  pos_hr_leave_request(uuid,text,date,date,text), pos_hr_leave_decide(uuid,boolean), pos_hr_leave_list(uuid), pos_payroll_rates_list(), pos_payroll_rate_set(text,date,jsonb,text),
  pos_payroll_rate_confirm(text,date), pos_payroll_create_run(uuid,date,date), pos_payroll_edit_line(uuid,numeric,numeric,text), pos_payroll_approve(uuid), pos_payroll_mark_paid(uuid),
  pos_payroll_cancel(uuid,text), pos_payroll_list_runs(uuid), pos_payroll_get_run(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pos_hr_list_employees(uuid), pos_hr_save_employee(uuid,uuid,jsonb), pos_hr_set_attendance(uuid,date,text,text), pos_hr_attendance_month(uuid,date),
  pos_hr_leave_request(uuid,text,date,date,text), pos_hr_leave_decide(uuid,boolean), pos_hr_leave_list(uuid), pos_payroll_rates_list(), pos_payroll_rate_set(text,date,jsonb,text),
  pos_payroll_rate_confirm(text,date), pos_payroll_create_run(uuid,date,date), pos_payroll_edit_line(uuid,numeric,numeric,text), pos_payroll_approve(uuid), pos_payroll_mark_paid(uuid),
  pos_payroll_cancel(uuid,text), pos_payroll_list_runs(uuid), pos_payroll_get_run(uuid) TO authenticated;
