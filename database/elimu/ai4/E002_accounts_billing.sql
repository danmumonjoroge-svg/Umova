-- ============================================================================
-- ELIMU FINANCE  E002  Student fee accounts, append-only ledger, invoices, billing.
-- Sign convention in the ledger: DEBIT (+) = the student owes more, CREDIT (-) = owes less.
--   balance > 0  : owed (arrears / outstanding)      balance < 0 : credit held for the student (a LIABILITY, never income)
-- Nothing in the ledger or on an invoice line is ever updated or deleted: corrections are new rows (E004).
-- Requires E001. Re-runnable.
-- ============================================================================

-- ---------- one fee account per student ----------
CREATE TABLE IF NOT EXISTS elimu_fin_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  student_id uuid NOT NULL,
  balance numeric(15,2) NOT NULL DEFAULT 0,                 -- cache of SUM(ledger.amount); verified by elimu_fin_verify_account()
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, student_id),
  FOREIGN KEY (business_id, student_id) REFERENCES elimu_fin_students (business_id, student_id)
);

-- ---------- the ledger: chronological, append-only ----------
CREATE TABLE IF NOT EXISTS elimu_fin_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  account_id uuid NOT NULL REFERENCES elimu_fin_accounts(id),
  student_id uuid NOT NULL,
  entry_date date NOT NULL,
  entry_type text NOT NULL CHECK (entry_type IN ('OPENING_BALANCE','OPENING_CREDIT','CHARGE','DISCOUNT','SCHOLARSHIP','BURSARY',
                                                  'CREDIT_NOTE','WRITE_OFF','PAYMENT','REFUND','REVERSAL','ADJUSTMENT')),
  amount numeric(15,2) NOT NULL CHECK (amount <> 0),
  balance_after numeric(15,2) NOT NULL,
  description text,
  source_type text,                                         -- INVOICE | PAYMENT | ADJUSTMENT | CORRECTION | REFUND
  source_id uuid,
  invoice_id uuid,
  reverses_entry_id uuid REFERENCES elimu_fin_ledger(id),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_elimu_fin_ledger_acct ON elimu_fin_ledger (account_id, seq);
CREATE INDEX IF NOT EXISTS idx_elimu_fin_ledger_biz_date ON elimu_fin_ledger (business_id, entry_date);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_fin_ledger_reversal ON elimu_fin_ledger (reverses_entry_id) WHERE reverses_entry_id IS NOT NULL;

CREATE OR REPLACE FUNCTION _elimu_fin_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% rows are never changed or deleted. Post a reversal or adjustment instead.', TG_TABLE_NAME USING ERRCODE = '42501';
END $$;
DROP TRIGGER IF EXISTS trg_elimu_fin_ledger_immutable ON elimu_fin_ledger;
CREATE TRIGGER trg_elimu_fin_ledger_immutable BEFORE UPDATE OR DELETE ON elimu_fin_ledger FOR EACH ROW EXECUTE FUNCTION _elimu_fin_immutable();

-- The ONLY way a ledger row is written. Locks the account row so balance_after is exact under concurrency.
CREATE OR REPLACE FUNCTION _elimu_fin_ledger_post(
  p_business uuid, p_student uuid, p_type text, p_amount numeric, p_date date, p_desc text,
  p_source_type text, p_source_id uuid, p_invoice uuid DEFAULT NULL, p_reverses uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a elimu_fin_accounts%ROWTYPE; v_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount = 0 THEN RETURN NULL; END IF;
  SELECT * INTO a FROM elimu_fin_accounts WHERE business_id = p_business AND student_id = p_student FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO elimu_fin_accounts (tenant_id, business_id, student_id) VALUES (get_current_tenant_id(), p_business, p_student)
    ON CONFLICT (business_id, student_id) DO NOTHING;
    SELECT * INTO a FROM elimu_fin_accounts WHERE business_id = p_business AND student_id = p_student FOR UPDATE;
  END IF;
  INSERT INTO elimu_fin_ledger (tenant_id, business_id, account_id, student_id, entry_date, entry_type, amount, balance_after,
                                description, source_type, source_id, invoice_id, reverses_entry_id, created_by)
  VALUES (a.tenant_id, p_business, a.id, p_student, p_date, p_type, p_amount, a.balance + p_amount,
          p_desc, p_source_type, p_source_id, p_invoice, p_reverses, _elimu_fin_staff())
  RETURNING id INTO v_id;
  UPDATE elimu_fin_accounts SET balance = balance + p_amount WHERE id = a.id;
  RETURN v_id;
END $$;

-- ---------- invoices ----------
CREATE TABLE IF NOT EXISTS elimu_fin_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  invoice_no text NOT NULL,
  kind text NOT NULL DEFAULT 'FEES' CHECK (kind IN ('FEES','OPENING_BALANCE','CUSTOM')),
  student_id uuid NOT NULL,
  enrollment_id uuid,
  period_id uuid REFERENCES elimu_fin_periods(id),
  -- snapshots: an invoice keeps saying what was true when it was issued (student may change class / leave later)
  academic_year text, term text, admission_no text NOT NULL, student_name text NOT NULL,
  class_name text, stream_name text, guardian_name text, guardian_phone text, guardian_email text,
  issue_date date NOT NULL DEFAULT _elimu_fin_today(),
  due_date date NOT NULL,
  charges numeric(15,2) NOT NULL DEFAULT 0 CHECK (charges >= 0),
  discounts numeric(15,2) NOT NULL DEFAULT 0 CHECK (discounts >= 0),
  total numeric(15,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  previous_balance numeric(15,2) NOT NULL DEFAULT 0,        -- the account balance just BEFORE this invoice (information only)
  settled numeric(15,2) NOT NULL DEFAULT 0 CHECK (settled >= 0),   -- SUM of active allocations; maintained by _elimu_fin_refresh_invoice
  outstanding numeric(15,2) GENERATED ALWAYS AS (CASE WHEN status = 'CANCELLED' THEN 0 ELSE total - settled END) STORED,
  status text NOT NULL DEFAULT 'ISSUED' CHECK (status IN ('ISSUED','PARTIALLY_PAID','PAID','CANCELLED')),
  notes text,
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, invoice_no),
  FOREIGN KEY (business_id, student_id) REFERENCES elimu_fin_students (business_id, student_id),
  CONSTRAINT elimu_fin_inv_total CHECK (total = charges - discounts),
  CONSTRAINT elimu_fin_inv_settled CHECK (status = 'CANCELLED' OR settled <= total)
);
CREATE INDEX IF NOT EXISTS idx_elimu_fin_inv_student ON elimu_fin_invoices (business_id, student_id, due_date);
CREATE INDEX IF NOT EXISTS idx_elimu_fin_inv_open ON elimu_fin_invoices (business_id, due_date) WHERE status IN ('ISSUED','PARTIALLY_PAID');
CREATE INDEX IF NOT EXISTS idx_elimu_fin_inv_period ON elimu_fin_invoices (business_id, period_id);

CREATE TABLE IF NOT EXISTS elimu_fin_invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES elimu_fin_invoices(id),
  line_no integer NOT NULL,
  line_type text NOT NULL CHECK (line_type IN ('CHARGE','DISCOUNT')),
  fee_item_id uuid REFERENCES elimu_fin_fee_items(id),
  fee_item_name text,
  description text NOT NULL,
  amount numeric(15,2) NOT NULL CHECK (amount > 0),         -- always a positive magnitude; line_type gives the direction
  structure_id uuid, discount_rule_id uuid,
  reverses_line_id uuid REFERENCES elimu_fin_invoice_lines(id),
  revision_id uuid,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, line_no)
);
DROP TRIGGER IF EXISTS trg_elimu_fin_lines_immutable ON elimu_fin_invoice_lines;
CREATE TRIGGER trg_elimu_fin_lines_immutable BEFORE UPDATE OR DELETE ON elimu_fin_invoice_lines FOR EACH ROW EXECUTE FUNCTION _elimu_fin_immutable();

-- which fee structures an invoice covers. The unique index IS the duplicate-billing guard (student + period + structure).
CREATE TABLE IF NOT EXISTS elimu_fin_invoice_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES elimu_fin_invoices(id),
  structure_id uuid NOT NULL REFERENCES elimu_fin_fee_structures(id),
  student_id uuid NOT NULL,
  period_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT true,                  -- false once the invoice is cancelled, so it can be billed again
  UNIQUE (invoice_id, structure_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_fin_no_double_billing ON elimu_fin_invoice_structures (business_id, student_id, period_id, structure_id) WHERE is_active;

-- every amendment / cancellation leaves a revision; the invoice is never silently overwritten
CREATE TABLE IF NOT EXISTS elimu_fin_invoice_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL,
  invoice_id uuid NOT NULL REFERENCES elimu_fin_invoices(id),
  revision_no integer NOT NULL,
  action text NOT NULL CHECK (action IN ('AMENDED','CANCELLED','DUE_DATE_CHANGED')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 3),
  previous jsonb NOT NULL, new jsonb NOT NULL,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, revision_no)
);
DROP TRIGGER IF EXISTS trg_elimu_fin_rev_immutable ON elimu_fin_invoice_revisions;
CREATE TRIGGER trg_elimu_fin_rev_immutable BEFORE UPDATE OR DELETE ON elimu_fin_invoice_revisions FOR EACH ROW EXECUTE FUNCTION _elimu_fin_immutable();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['elimu_fin_accounts','elimu_fin_ledger','elimu_fin_invoices','elimu_fin_invoice_lines','elimu_fin_invoice_structures','elimu_fin_invoice_revisions'] LOOP
    PERFORM _elimu_fin_secure(t, 'view');
  END LOOP;
END $$;

-- ---------- GL hook (implemented in E007; a no-op until gl_enabled and E007 is installed) ----------
CREATE OR REPLACE FUNCTION _elimu_fin_gl(p_event text, p_source_type text, p_source_id uuid, p_date date, p_lines jsonb, p_business uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_on boolean;
BEGIN
  SELECT gl_enabled INTO v_on FROM elimu_fin_settings WHERE business_id = p_business;
  IF coalesce(v_on, false) AND to_regprocedure('_elimu_fin_gl_post(text,text,uuid,date,jsonb,uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT _elimu_fin_gl_post($1,$2,$3,$4,$5,$6)' USING p_event, p_source_type, p_source_id, p_date, p_lines, p_business;
  END IF;
END $$;

-- ---------- settings access (defaults without requiring a saved row) ----------
CREATE OR REPLACE FUNCTION _elimu_fin_settings(p_business uuid) RETURNS elimu_fin_settings
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s elimu_fin_settings%ROWTYPE;
BEGIN
  SELECT * INTO s FROM elimu_fin_settings WHERE business_id = p_business;
  IF NOT FOUND THEN
    INSERT INTO elimu_fin_settings (tenant_id, business_id) VALUES (get_current_tenant_id(), p_business)
    ON CONFLICT (business_id) DO NOTHING;
    SELECT * INTO s FROM elimu_fin_settings WHERE business_id = p_business;
  END IF;
  RETURN s;
END $$;

-- ---------- which structures apply to a student for a period ----------
CREATE OR REPLACE FUNCTION elimu_fin_matching_structures(p_business uuid, p_student uuid, p_period uuid)
RETURNS TABLE (structure_id uuid, name text, already_billed boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s elimu_fin_students%ROWTYPE; per elimu_fin_periods%ROWTYPE;
BEGIN
  PERFORM _elimu_fin_require('view'); PERFORM _elimu_fin_tenant_of(p_business);
  SELECT * INTO s FROM elimu_fin_students WHERE business_id = p_business AND student_id = p_student;
  SELECT * INTO per FROM elimu_fin_periods WHERE id = p_period AND business_id = p_business;
  IF s.id IS NULL OR per.id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT f.id, f.name,
           EXISTS (SELECT 1 FROM elimu_fin_invoice_structures x WHERE x.business_id = p_business AND x.student_id = p_student
                    AND x.period_id = p_period AND x.structure_id = f.id AND x.is_active)
      FROM elimu_fin_fee_structures f
     WHERE f.business_id = p_business AND f.period_id = p_period AND f.status = 'ACTIVE'
       AND (f.class_id IS NULL OR f.class_id = s.class_id)
       AND (f.stream_id IS NULL OR f.stream_id = s.stream_id)
       AND (f.boarding_status IS NULL OR f.boarding_status = s.boarding_status)
       AND (f.student_category IS NULL OR f.student_category = s.student_category)
       AND (f.effective_from IS NULL OR f.effective_from <= per.end_date)
     ORDER BY f.name;
END $$;

-- ---------- the invoice-line builder (pure: reads config, writes nothing) ----------
-- returns jsonb array of {line_type, fee_item_id, fee_item_name, description, amount, structure_id, discount_rule_id}
CREATE OR REPLACE FUNCTION _elimu_fin_build_lines(p_business uuid, p_student elimu_fin_students, p_period elimu_fin_periods,
                                                  p_structures uuid[], p_apply_rules boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_lines jsonb := '[]'::jsonb; r record; v_charges numeric := 0; v_disc numeric := 0; v_amt numeric; v_base numeric;
BEGIN
  FOR r IN
    SELECT si.structure_id, si.fee_item_id, si.amount, i.name AS item_name, f.name AS structure_name
      FROM elimu_fin_fee_structure_items si
      JOIN elimu_fin_fee_structures f ON f.id = si.structure_id
      JOIN elimu_fin_fee_items i ON i.id = si.fee_item_id
     WHERE si.structure_id = ANY (p_structures) AND f.business_id = p_business
       AND i.is_active
       AND (i.applicable_class_ids IS NULL OR p_student.class_id = ANY (i.applicable_class_ids))
       AND (i.effective_from IS NULL OR i.effective_from <= p_period.end_date)
       AND (i.effective_to IS NULL OR i.effective_to >= p_period.start_date)
       AND si.amount > 0
     ORDER BY si.sort_order, i.name
  LOOP
    v_lines := v_lines || jsonb_build_object('line_type','CHARGE','fee_item_id',r.fee_item_id,'fee_item_name',r.item_name,
      'description', r.item_name, 'amount', r.amount, 'structure_id', r.structure_id);
    v_charges := v_charges + r.amount;
  END LOOP;

  IF p_apply_rules AND v_charges > 0 THEN
    FOR r IN SELECT * FROM elimu_fin_discount_rules
              WHERE business_id = p_business AND is_active
                AND ((kind = 'SIBLING' AND coalesce(p_student.sibling_rank, 1) >= coalesce(min_sibling_rank, 2))
                  OR (kind = 'STAFF_CHILD' AND p_student.is_staff_child))
              ORDER BY created_at, id
    LOOP
      IF r.fee_item_id IS NOT NULL THEN
        SELECT coalesce(sum((l->>'amount')::numeric), 0) INTO v_base FROM jsonb_array_elements(v_lines) l
         WHERE l->>'line_type' = 'CHARGE' AND (l->>'fee_item_id')::uuid = r.fee_item_id;
      ELSE v_base := v_charges; END IF;
      IF v_base <= 0 THEN CONTINUE; END IF;
      v_amt := CASE r.value_type WHEN 'PERCENT' THEN round(v_base * r.value / 100, 2) ELSE least(r.value, v_base) END;
      v_amt := least(v_amt, v_charges - v_disc);              -- discounts can never exceed what is charged
      IF v_amt <= 0 THEN CONTINUE; END IF;
      v_lines := v_lines || jsonb_build_object('line_type','DISCOUNT','fee_item_id',r.fee_item_id,'fee_item_name',NULL,
        'description', r.name, 'amount', v_amt, 'discount_rule_id', r.id);
      v_disc := v_disc + v_amt;
    END LOOP;
  END IF;
  RETURN v_lines;
END $$;

-- preview, writes nothing
CREATE OR REPLACE FUNCTION elimu_fin_preview_bill(p_business uuid, p_student uuid, p_period uuid, p_structure_ids uuid[] DEFAULT NULL, p_apply_rules boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s elimu_fin_students%ROWTYPE; per elimu_fin_periods%ROWTYPE; v_struct uuid[]; v_lines jsonb;
BEGIN
  PERFORM _elimu_fin_require('view'); PERFORM _elimu_fin_tenant_of(p_business);
  SELECT * INTO s FROM elimu_fin_students WHERE business_id = p_business AND student_id = p_student;
  SELECT * INTO per FROM elimu_fin_periods WHERE id = p_period AND business_id = p_business;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Student not found.'; END IF;
  IF per.id IS NULL THEN RAISE EXCEPTION 'Billing period not found.'; END IF;
  IF p_structure_ids IS NULL THEN
    SELECT array_agg(m.structure_id) INTO v_struct FROM elimu_fin_matching_structures(p_business, p_student, p_period) m WHERE NOT m.already_billed;
  ELSE v_struct := p_structure_ids; END IF;
  v_lines := _elimu_fin_build_lines(p_business, s, per, coalesce(v_struct, ARRAY[]::uuid[]), p_apply_rules);
  RETURN jsonb_build_object('structures', coalesce(to_jsonb(v_struct), '[]'::jsonb), 'lines', v_lines,
    'charges', (SELECT coalesce(sum((l->>'amount')::numeric),0) FROM jsonb_array_elements(v_lines) l WHERE l->>'line_type'='CHARGE'),
    'discounts', (SELECT coalesce(sum((l->>'amount')::numeric),0) FROM jsonb_array_elements(v_lines) l WHERE l->>'line_type'='DISCOUNT'));
END $$;

-- ---------- shared invoice writer ----------
CREATE OR REPLACE FUNCTION _elimu_fin_issue_invoice(
  p_business uuid, s elimu_fin_students, per elimu_fin_periods, p_kind text, p_lines jsonb, p_structures uuid[],
  p_due date, p_notes text, p_issue date DEFAULT NULL)
RETURNS elimu_fin_invoices LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  st elimu_fin_settings%ROWTYPE; inv elimu_fin_invoices%ROWTYPE; l jsonb; n integer := 0;
  v_ch numeric := 0; v_di numeric := 0; v_prev numeric; v_due date; v_issue date := coalesce(p_issue, _elimu_fin_today());
  v_acct_bal numeric; sid uuid;
BEGIN
  st := _elimu_fin_settings(p_business);
  INSERT INTO elimu_fin_accounts (tenant_id, business_id, student_id) VALUES (get_current_tenant_id(), p_business, s.student_id)
    ON CONFLICT (business_id, student_id) DO NOTHING;
  SELECT balance INTO v_acct_bal FROM elimu_fin_accounts WHERE business_id = p_business AND student_id = s.student_id FOR UPDATE;
  v_prev := coalesce(v_acct_bal, 0);
  SELECT coalesce(sum((x->>'amount')::numeric) FILTER (WHERE x->>'line_type' = 'CHARGE'), 0),
         coalesce(sum((x->>'amount')::numeric) FILTER (WHERE x->>'line_type' = 'DISCOUNT'), 0)
    INTO v_ch, v_di FROM jsonb_array_elements(p_lines) x;
  IF v_ch <= 0 THEN RAISE EXCEPTION 'An invoice needs at least one charge.'; END IF;
  IF v_di > v_ch THEN RAISE EXCEPTION 'Discounts cannot exceed charges.'; END IF;
  v_due := coalesce(p_due,
    (SELECT min(si.due_date) FROM elimu_fin_fee_structure_items si WHERE si.structure_id = ANY (coalesce(p_structures, ARRAY[]::uuid[]))),
    per.default_due_date, v_issue + st.invoice_due_days);

  INSERT INTO elimu_fin_invoices (tenant_id, business_id, invoice_no, kind, student_id, enrollment_id, period_id, academic_year, term,
      admission_no, student_name, class_name, stream_name, guardian_name, guardian_phone, guardian_email,
      issue_date, due_date, charges, discounts, total, previous_balance, notes, created_by)
  VALUES (get_current_tenant_id(), p_business, next_doc_number(p_business, 'SFI'), p_kind, s.student_id, s.enrollment_id, per.id,
      per.academic_year, per.term, s.admission_no, s.full_name, s.class_name, s.stream_name, s.guardian_name, s.guardian_phone, s.guardian_email,
      v_issue, v_due, v_ch, v_di, v_ch - v_di, v_prev, p_notes, _elimu_fin_staff())
  RETURNING * INTO inv;

  FOR l IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    n := n + 1;
    INSERT INTO elimu_fin_invoice_lines (tenant_id, business_id, invoice_id, line_no, line_type, fee_item_id, fee_item_name, description, amount,
        structure_id, discount_rule_id, created_by)
    VALUES (inv.tenant_id, p_business, inv.id, n, l->>'line_type', nullif(l->>'fee_item_id','')::uuid, l->>'fee_item_name',
        coalesce(nullif(btrim(l->>'description'),''), l->>'fee_item_name', 'Charge'), (l->>'amount')::numeric,
        nullif(l->>'structure_id','')::uuid, nullif(l->>'discount_rule_id','')::uuid, _elimu_fin_staff());
  END LOOP;

  FOREACH sid IN ARRAY coalesce(p_structures, ARRAY[]::uuid[]) LOOP
    INSERT INTO elimu_fin_invoice_structures (tenant_id, business_id, invoice_id, structure_id, student_id, period_id)
    VALUES (inv.tenant_id, p_business, inv.id, sid, s.student_id, per.id);
  END LOOP;

  PERFORM _elimu_fin_ledger_post(p_business, s.student_id, CASE p_kind WHEN 'OPENING_BALANCE' THEN 'OPENING_BALANCE' ELSE 'CHARGE' END,
      v_ch, v_issue, 'Invoice ' || inv.invoice_no, 'INVOICE', inv.id, inv.id);
  IF v_di > 0 THEN
    PERFORM _elimu_fin_ledger_post(p_business, s.student_id, 'DISCOUNT', -v_di, v_issue, 'Discount on ' || inv.invoice_no, 'INVOICE', inv.id, inv.id);
  END IF;
  RETURN inv;
END $$;

-- GL lines for an issued invoice (grouped by income account key; discounts to DISCOUNT_ALLOWED)
CREATE OR REPLACE FUNCTION _elimu_fin_invoice_gl_lines(p_invoice uuid, p_sign integer DEFAULT 1) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH inv AS (SELECT * FROM elimu_fin_invoices WHERE id = p_invoice),
  st AS (SELECT accounting_policy FROM elimu_fin_settings WHERE business_id = (SELECT business_id FROM inv)),
  inc AS (
    SELECT coalesce(i.income_account_key, CASE WHEN (SELECT accounting_policy FROM st) = 'DEFERRED' THEN 'DEFERRED_INCOME' ELSE 'FEE_INCOME' END) AS k,
           sum(l.amount) AS amt
      FROM elimu_fin_invoice_lines l LEFT JOIN elimu_fin_fee_items i ON i.id = l.fee_item_id
     WHERE l.invoice_id = p_invoice AND l.line_type = 'CHARGE' GROUP BY 1),
  disc AS (SELECT coalesce(sum(amount),0) AS amt FROM elimu_fin_invoice_lines WHERE invoice_id = p_invoice AND line_type = 'DISCOUNT')
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb) FROM (
    SELECT jsonb_build_object('account_key','STUDENT_RECEIVABLES',
             'debit', CASE WHEN p_sign > 0 THEN (SELECT total FROM inv) ELSE 0 END,
             'credit', CASE WHEN p_sign < 0 THEN (SELECT total FROM inv) ELSE 0 END) AS x
    UNION ALL
    SELECT jsonb_build_object('account_key','DISCOUNT_ALLOWED','debit', CASE WHEN p_sign > 0 THEN amt ELSE 0 END,
             'credit', CASE WHEN p_sign < 0 THEN amt ELSE 0 END) FROM disc WHERE amt > 0
    UNION ALL
    SELECT jsonb_build_object('account_key', k, 'debit', CASE WHEN p_sign < 0 THEN amt ELSE 0 END,
             'credit', CASE WHEN p_sign > 0 THEN amt ELSE 0 END) FROM inc
  ) q
$$;

-- ---------- bill one student ----------
CREATE OR REPLACE FUNCTION elimu_fin_bill_student(
  p_business uuid, p_student uuid, p_period uuid, p_structure_ids uuid[] DEFAULT NULL, p_due_date date DEFAULT NULL,
  p_extra_lines jsonb DEFAULT '[]'::jsonb, p_notes text DEFAULT NULL, p_apply_rules boolean DEFAULT true)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  s elimu_fin_students%ROWTYPE; per elimu_fin_periods%ROWTYPE; st elimu_fin_settings%ROWTYPE; inv elimu_fin_invoices%ROWTYPE;
  v_struct uuid[]; v_lines jsonb; x jsonb; v_kind text := 'FEES'; v_has_extra boolean;
BEGIN
  PERFORM _elimu_fin_require('bill'); PERFORM _elimu_fin_tenant_of(p_business);
  SELECT * INTO s FROM elimu_fin_students WHERE business_id = p_business AND student_id = p_student FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Student not found.'; END IF;
  SELECT * INTO per FROM elimu_fin_periods WHERE id = p_period AND business_id = p_business;
  IF per.id IS NULL THEN RAISE EXCEPTION 'Billing period not found.'; END IF;
  IF per.status = 'CLOSED' THEN RAISE EXCEPTION 'That billing period is closed.'; END IF;
  v_has_extra := jsonb_array_length(coalesce(p_extra_lines, '[]'::jsonb)) > 0;

  IF p_structure_ids IS NULL THEN
    SELECT array_agg(m.structure_id) INTO v_struct FROM elimu_fin_matching_structures(p_business, p_student, p_period) m WHERE NOT m.already_billed;
  ELSE
    -- explicit list: refuse structures that are not this school's/period's, drop those already billed
    SELECT array_agg(f.id) INTO v_struct FROM elimu_fin_fee_structures f
     WHERE f.id = ANY (p_structure_ids) AND f.business_id = p_business AND f.period_id = p_period AND f.status = 'ACTIVE'
       AND NOT EXISTS (SELECT 1 FROM elimu_fin_invoice_structures q WHERE q.business_id = p_business AND q.student_id = p_student
                        AND q.period_id = p_period AND q.structure_id = f.id AND q.is_active);
  END IF;
  v_struct := coalesce(v_struct, ARRAY[]::uuid[]);

  IF s.status = 'LEFT' AND cardinality(v_struct) > 0 THEN RAISE EXCEPTION '% has left the school: only custom charges can be raised.', s.full_name; END IF;
  IF cardinality(v_struct) = 0 AND NOT v_has_extra THEN
    RETURN jsonb_build_object('ok', false, 'skipped',
      CASE WHEN EXISTS (SELECT 1 FROM elimu_fin_invoice_structures q WHERE q.business_id = p_business AND q.student_id = p_student AND q.period_id = p_period AND q.is_active)
           THEN 'ALREADY_BILLED' ELSE 'NO_FEE_STRUCTURE' END,
      'student_id', p_student);
  END IF;

  v_lines := _elimu_fin_build_lines(p_business, s, per, v_struct, p_apply_rules);
  IF v_has_extra THEN
    FOR x IN SELECT * FROM jsonb_array_elements(p_extra_lines) LOOP
      IF coalesce(x->>'line_type','CHARGE') <> 'CHARGE' THEN RAISE EXCEPTION 'Extra lines must be charges. Discounts go through an approved adjustment.'; END IF;
      IF coalesce((x->>'amount')::numeric, 0) <= 0 THEN RAISE EXCEPTION 'Every charge needs an amount above zero.'; END IF;
      v_lines := v_lines || jsonb_build_object('line_type','CHARGE','fee_item_id', x->'fee_item_id','fee_item_name', x->>'fee_item_name',
        'description', coalesce(nullif(btrim(x->>'description'),''), 'Additional charge'), 'amount', (x->>'amount')::numeric);
    END LOOP;
    IF cardinality(v_struct) = 0 THEN v_kind := 'CUSTOM'; END IF;
  END IF;

  inv := _elimu_fin_issue_invoice(p_business, s, per, v_kind, v_lines, v_struct, p_due_date, p_notes);
  PERFORM _elimu_fin_gl('INVOICE_ISSUED', 'INVOICE', inv.id, inv.issue_date, _elimu_fin_invoice_gl_lines(inv.id, 1), p_business);
  PERFORM _elimu_fin_audit('INVOICE_GENERATED', 'elimu_fin_invoices', inv.id,
    jsonb_build_object('new', jsonb_build_object('invoice_no', inv.invoice_no, 'total', inv.total, 'student_id', s.student_id, 'period', per.academic_year || coalesce(' ' || per.term, ''))));

  st := _elimu_fin_settings(p_business);
  IF st.auto_apply_credit AND st.allocation_policy <> 'MANUAL_ONLY' THEN
    PERFORM _elimu_fin_allocate_student(p_business, p_student);   -- E003: existing credit absorbs the new invoice
  END IF;
  SELECT * INTO inv FROM elimu_fin_invoices WHERE id = inv.id;
  RETURN jsonb_build_object('ok', true, 'invoice_id', inv.id, 'invoice_no', inv.invoice_no, 'total', inv.total,
                            'settled', inv.settled, 'outstanding', inv.outstanding, 'due_date', inv.due_date, 'status', inv.status);
END $$;

-- ---------- bulk billing: one student at a time inside a sub-transaction; one bad student never blocks the class ----------
CREATE OR REPLACE FUNCTION elimu_fin_bill_bulk(
  p_business uuid, p_period uuid, p_class_id uuid DEFAULT NULL, p_stream_id uuid DEFAULT NULL,
  p_structure_ids uuid[] DEFAULT NULL, p_due_date date DEFAULT NULL, p_dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; res jsonb; v_created int := 0; v_skipped int := 0; v_failed int := 0; v_total numeric := 0; v_detail jsonb := '[]'::jsonb;
BEGIN
  PERFORM _elimu_fin_require('bill'); PERFORM _elimu_fin_tenant_of(p_business);
  FOR r IN SELECT student_id, full_name, admission_no FROM elimu_fin_students
            WHERE business_id = p_business AND status IN ('ACTIVE','SUSPENDED')
              AND (p_class_id IS NULL OR class_id = p_class_id) AND (p_stream_id IS NULL OR stream_id = p_stream_id)
            ORDER BY admission_no
  LOOP
    BEGIN
      IF p_dry_run THEN
        res := elimu_fin_preview_bill(p_business, r.student_id, p_period, p_structure_ids);
        IF jsonb_array_length(res->'lines') = 0 THEN v_skipped := v_skipped + 1;
          v_detail := v_detail || jsonb_build_object('admission_no', r.admission_no, 'result', 'SKIPPED');
        ELSE v_created := v_created + 1; v_total := v_total + ((res->>'charges')::numeric - (res->>'discounts')::numeric); END IF;
      ELSE
        res := elimu_fin_bill_student(p_business, r.student_id, p_period, p_structure_ids, p_due_date);
        IF (res->>'ok')::boolean THEN v_created := v_created + 1; v_total := v_total + (res->>'total')::numeric;
        ELSE v_skipped := v_skipped + 1; v_detail := v_detail || jsonb_build_object('admission_no', r.admission_no, 'result', res->>'skipped'); END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_detail := v_detail || jsonb_build_object('admission_no', r.admission_no, 'result', 'FAILED', 'error', SQLERRM);
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'dry_run', p_dry_run, 'created', v_created, 'skipped', v_skipped, 'failed', v_failed, 'total_billed', v_total, 'detail', v_detail);
END $$;

-- ---------- opening balance (money owed when the school starts using the system) ----------
-- Credit openings (the family has overpaid) live in E004 as elimu_fin_add_opening_credit().
CREATE OR REPLACE FUNCTION elimu_fin_add_opening_balance(p_business uuid, p_student uuid, p_amount numeric, p_as_of date,
  p_description text DEFAULT 'Opening balance brought forward', p_due_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE s elimu_fin_students%ROWTYPE; per elimu_fin_periods%ROWTYPE; inv elimu_fin_invoices%ROWTYPE;
BEGIN
  PERFORM _elimu_fin_require('bill'); PERFORM _elimu_fin_tenant_of(p_business);
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'An opening balance owed must be above zero. Use an opening credit for money the school holds.'; END IF;
  SELECT * INTO s FROM elimu_fin_students WHERE business_id = p_business AND student_id = p_student FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Student not found.'; END IF;
  SELECT * INTO per FROM elimu_fin_periods WHERE business_id = p_business AND start_date <= p_as_of ORDER BY start_date DESC LIMIT 1;
  inv := _elimu_fin_issue_invoice(p_business, s, per, 'OPENING_BALANCE',
    jsonb_build_array(jsonb_build_object('line_type','CHARGE','description', coalesce(p_description,'Opening balance'),'amount', p_amount)),
    ARRAY[]::uuid[], coalesce(p_due_date, p_as_of), NULL, p_as_of);
  PERFORM _elimu_fin_gl('OPENING_BALANCE', 'INVOICE', inv.id, p_as_of,
    jsonb_build_array(jsonb_build_object('account_key','STUDENT_RECEIVABLES','debit',p_amount,'credit',0),
                      jsonb_build_object('account_key','OPENING_BALANCE_EQUITY','debit',0,'credit',p_amount)), p_business);
  PERFORM _elimu_fin_audit('OPENING_BALANCE_RECORDED', 'elimu_fin_invoices', inv.id, jsonb_build_object('new', jsonb_build_object('amount', p_amount, 'as_of', p_as_of)));
  PERFORM _elimu_fin_allocate_student(p_business, p_student);
  RETURN jsonb_build_object('ok', true, 'invoice_id', inv.id, 'invoice_no', inv.invoice_no);
END $$;

-- ---------- amend an invoice: ADD lines only. Existing lines are never edited; a wrong line is cancelled by an opposite line. ----------
CREATE OR REPLACE FUNCTION elimu_fin_amend_invoice(p_invoice uuid, p_lines jsonb, p_reason text, p_due_date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  inv elimu_fin_invoices%ROWTYPE; x jsonb; n int; v_rev int; v_add_ch numeric := 0; v_add_di numeric := 0; v_prev jsonb; v_rev_id uuid := gen_random_uuid();
  v_new_total numeric; v_orig_line elimu_fin_invoice_lines%ROWTYPE; v_new_due date;
BEGIN
  PERFORM _elimu_fin_require('bill');
  IF length(btrim(coalesce(p_reason,''))) < 3 THEN RAISE EXCEPTION 'A reason is required to amend an invoice.'; END IF;
  SELECT * INTO inv FROM elimu_fin_invoices WHERE id = p_invoice AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
  IF inv.status = 'CANCELLED' THEN RAISE EXCEPTION 'A cancelled invoice cannot be amended.'; END IF;
  SELECT jsonb_build_object('charges', inv.charges, 'discounts', inv.discounts, 'total', inv.total, 'due_date', inv.due_date,
    'lines', (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.line_no), '[]'::jsonb) FROM elimu_fin_invoice_lines l WHERE l.invoice_id = inv.id)) INTO v_prev;
  SELECT coalesce(max(line_no),0) INTO n FROM elimu_fin_invoice_lines WHERE invoice_id = inv.id;
  SELECT coalesce(max(revision_no),0) + 1 INTO v_rev FROM elimu_fin_invoice_revisions WHERE invoice_id = inv.id;

  FOR x IN SELECT * FROM jsonb_array_elements(coalesce(p_lines,'[]'::jsonb)) LOOP
    IF x->>'line_type' NOT IN ('CHARGE','DISCOUNT') THEN RAISE EXCEPTION 'line_type must be CHARGE or DISCOUNT.'; END IF;
    IF coalesce((x->>'amount')::numeric,0) <= 0 THEN RAISE EXCEPTION 'Every line needs an amount above zero.'; END IF;
    v_orig_line := NULL;
    IF nullif(x->>'reverses_line_id','') IS NOT NULL THEN
      SELECT * INTO v_orig_line FROM elimu_fin_invoice_lines WHERE id = (x->>'reverses_line_id')::uuid AND invoice_id = inv.id;
      IF NOT FOUND THEN RAISE EXCEPTION 'The line being cancelled is not on this invoice.'; END IF;
      IF v_orig_line.line_type = x->>'line_type' THEN RAISE EXCEPTION 'A line is cancelled by a line of the opposite type.'; END IF;
      IF EXISTS (SELECT 1 FROM elimu_fin_invoice_lines WHERE reverses_line_id = v_orig_line.id) THEN RAISE EXCEPTION 'That line was already cancelled.'; END IF;
      IF (x->>'amount')::numeric > v_orig_line.amount THEN RAISE EXCEPTION 'A cancelling line cannot exceed the line it cancels.'; END IF;
    END IF;
    n := n + 1;
    INSERT INTO elimu_fin_invoice_lines (tenant_id, business_id, invoice_id, line_no, line_type, fee_item_id, fee_item_name, description, amount, reverses_line_id, revision_id, created_by)
    VALUES (inv.tenant_id, inv.business_id, inv.id, n, x->>'line_type', nullif(x->>'fee_item_id','')::uuid, x->>'fee_item_name',
            coalesce(nullif(btrim(x->>'description'),''), 'Amendment'), (x->>'amount')::numeric, v_orig_line.id, v_rev_id, _elimu_fin_staff());
    IF x->>'line_type' = 'CHARGE' THEN v_add_ch := v_add_ch + (x->>'amount')::numeric; ELSE v_add_di := v_add_di + (x->>'amount')::numeric; END IF;
  END LOOP;

  v_new_total := inv.total + v_add_ch - v_add_di;
  IF v_new_total < inv.settled THEN
    RAISE EXCEPTION 'This change would take the invoice (KES %) below what is already settled against it (KES %). Release or reverse those allocations first.', v_new_total, inv.settled;
  END IF;
  v_new_due := coalesce(p_due_date, inv.due_date);
  UPDATE elimu_fin_invoices SET charges = charges + v_add_ch, discounts = discounts + v_add_di, total = total + v_add_ch - v_add_di,
         due_date = v_new_due, updated_at = now() WHERE id = inv.id;
  IF v_add_ch > 0 THEN PERFORM _elimu_fin_ledger_post(inv.business_id, inv.student_id, 'CHARGE', v_add_ch, _elimu_fin_today(), 'Amendment to ' || inv.invoice_no || ': ' || p_reason, 'INVOICE', inv.id, inv.id); END IF;
  IF v_add_di > 0 THEN PERFORM _elimu_fin_ledger_post(inv.business_id, inv.student_id, 'DISCOUNT', -v_add_di, _elimu_fin_today(), 'Amendment to ' || inv.invoice_no || ': ' || p_reason, 'INVOICE', inv.id, inv.id); END IF;
  INSERT INTO elimu_fin_invoice_revisions (id, tenant_id, business_id, invoice_id, revision_no, action, reason, previous, new, created_by)
  VALUES (v_rev_id, inv.tenant_id, inv.business_id, inv.id, v_rev, 'AMENDED', p_reason, v_prev,
          jsonb_build_object('charges', inv.charges + v_add_ch, 'discounts', inv.discounts + v_add_di, 'total', v_new_total, 'due_date', v_new_due, 'added_lines', p_lines), _elimu_fin_staff());
  PERFORM _elimu_fin_refresh_invoice(inv.id);
  PERFORM _elimu_fin_gl('INVOICE_AMENDED', 'INVOICE_REV', v_rev_id, _elimu_fin_today(),
    jsonb_build_array(
      jsonb_build_object('account_key','STUDENT_RECEIVABLES','debit', greatest(v_add_ch - v_add_di,0), 'credit', greatest(v_add_di - v_add_ch,0)),
      jsonb_build_object('account_key','FEE_INCOME','debit', greatest(v_add_di - v_add_ch,0), 'credit', greatest(v_add_ch - v_add_di,0))), inv.business_id);
  PERFORM _elimu_fin_audit('INVOICE_AMENDED', 'elimu_fin_invoices', inv.id,
    jsonb_build_object('previous', v_prev, 'new', jsonb_build_object('total', v_new_total, 'added_lines', p_lines), 'reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'invoice_id', inv.id, 'revision_no', v_rev, 'total', v_new_total);
END $$;

-- ---------- cancel an invoice (credit note). Settled money is released back to the student's credit, never lost. ----------
CREATE OR REPLACE FUNCTION elimu_fin_cancel_invoice(p_invoice uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE inv elimu_fin_invoices%ROWTYPE; v_rev int; v_released numeric := 0; v_prev jsonb;
BEGIN
  PERFORM _elimu_fin_require('approve');
  IF length(btrim(coalesce(p_reason,''))) < 3 THEN RAISE EXCEPTION 'A reason is required to cancel an invoice.'; END IF;
  SELECT * INTO inv FROM elimu_fin_invoices WHERE id = p_invoice AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
  IF inv.status = 'CANCELLED' THEN RAISE EXCEPTION 'This invoice is already cancelled.'; END IF;
  v_prev := to_jsonb(inv);
  v_released := _elimu_fin_release_allocations(inv.id, 'INVOICE_CANCELLED: ' || p_reason);   -- E003
  UPDATE elimu_fin_invoices SET status = 'CANCELLED', cancelled_at = now(), cancelled_by = _elimu_fin_staff(), cancel_reason = p_reason, updated_at = now(),
         settled = 0 WHERE id = inv.id;
  UPDATE elimu_fin_invoice_structures SET is_active = false WHERE invoice_id = inv.id;
  PERFORM _elimu_fin_ledger_post(inv.business_id, inv.student_id, 'CREDIT_NOTE', -inv.total, _elimu_fin_today(), 'Cancelled ' || inv.invoice_no || ': ' || p_reason, 'INVOICE', inv.id, inv.id);
  SELECT coalesce(max(revision_no),0) + 1 INTO v_rev FROM elimu_fin_invoice_revisions WHERE invoice_id = inv.id;
  INSERT INTO elimu_fin_invoice_revisions (tenant_id, business_id, invoice_id, revision_no, action, reason, previous, new, created_by)
  VALUES (inv.tenant_id, inv.business_id, inv.id, v_rev, 'CANCELLED', p_reason, v_prev, jsonb_build_object('status','CANCELLED','released_to_credit', v_released), _elimu_fin_staff());
  PERFORM _elimu_fin_gl('INVOICE_CANCELLED', 'INVOICE_CANCEL', inv.id, _elimu_fin_today(), _elimu_fin_invoice_gl_lines(inv.id, -1), inv.business_id);
  PERFORM _elimu_fin_audit('INVOICE_CANCELLED', 'elimu_fin_invoices', inv.id, jsonb_build_object('previous', v_prev, 'reason', p_reason, 'released_to_credit', v_released));
  RETURN jsonb_build_object('ok', true, 'invoice_id', inv.id, 'released_to_credit', v_released);
END $$;

-- integrity check: ledger sum must equal the account cache. Returns the difference (0 = healthy).
CREATE OR REPLACE FUNCTION elimu_fin_verify_account(p_business uuid, p_student uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT a.balance - coalesce((SELECT sum(l.amount) FROM elimu_fin_ledger l WHERE l.account_id = a.id), 0)
    FROM elimu_fin_accounts a WHERE a.business_id = p_business AND a.student_id = p_student AND a.tenant_id = get_current_tenant_id()
$$;

REVOKE ALL ON FUNCTION _elimu_fin_immutable(), _elimu_fin_ledger_post(uuid,uuid,text,numeric,date,text,text,uuid,uuid,uuid),
  _elimu_fin_gl(text,text,uuid,date,jsonb,uuid), _elimu_fin_settings(uuid), _elimu_fin_invoice_gl_lines(uuid,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION elimu_fin_matching_structures(uuid,uuid,uuid), elimu_fin_preview_bill(uuid,uuid,uuid,uuid[],boolean),
  elimu_fin_bill_student(uuid,uuid,uuid,uuid[],date,jsonb,text,boolean), elimu_fin_bill_bulk(uuid,uuid,uuid,uuid,uuid[],date,boolean),
  elimu_fin_add_opening_balance(uuid,uuid,numeric,date,text,date), elimu_fin_amend_invoice(uuid,jsonb,text,date),
  elimu_fin_cancel_invoice(uuid,text), elimu_fin_verify_account(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION elimu_fin_matching_structures(uuid,uuid,uuid), elimu_fin_preview_bill(uuid,uuid,uuid,uuid[],boolean),
  elimu_fin_bill_student(uuid,uuid,uuid,uuid[],date,jsonb,text,boolean), elimu_fin_bill_bulk(uuid,uuid,uuid,uuid,uuid[],date,boolean),
  elimu_fin_add_opening_balance(uuid,uuid,numeric,date,text,date), elimu_fin_amend_invoice(uuid,jsonb,text,date),
  elimu_fin_cancel_invoice(uuid,text), elimu_fin_verify_account(uuid,uuid) TO authenticated;
