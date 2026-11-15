-- ============================================================================
-- ELIMU FINANCE  E001  Foundation: helpers, permission map, settings, finance-side
--                      student/period bridge, fee items, fee structures, discount rules.
-- Prefix: every object is elimu_fin_* / _elimu_fin_*  (nothing existing is altered).
-- Needs (already in POS): lb_businesses, get_current_tenant_id(), is_pos_session(), is_pos_owner(),
--                         pos_has_permission(text), pos_audit_log (optional), next_doc_number().
-- Re-runnable.  Run order: E001 -> E002 -> ... -> E008.
-- CONVENTION (same as lb_loans / lb_mpesa_c2b_payments): RLS on, tenant SELECT policy, RESTRICTIVE permission policy,
-- NO write grants. Every write goes through a SECURITY DEFINER function that checks permission in the database.
-- ============================================================================

-- ---------- helpers ----------
CREATE OR REPLACE FUNCTION _elimu_fin_today() RETURNS date LANGUAGE sql STABLE
AS $$ SELECT (now() AT TIME ZONE 'Africa/Nairobi')::date $$;

CREATE OR REPLACE FUNCTION _elimu_fin_staff() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT nullif(auth.jwt() ->> 'pos_staff_id','')::uuid $$;

-- (merged install) elimu_fin_can(action) is defined in elimu_000_core.sql as elimu_can('finance.'||action): finance rights now come
-- from Elimu roles (bursar, accountant, cashier, auditor ...), not POS permission keys. See INTEGRATION.md.

CREATE OR REPLACE FUNCTION _elimu_fin_require(p_action text) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT elimu_fin_can(p_action) THEN
    RAISE EXCEPTION 'You do not have permission to do this (%).', p_action USING ERRCODE = '42501';
  END IF;
END $$;

-- The school (= lb_businesses row) must belong to the caller's tenant. Returns the tenant id.
CREATE OR REPLACE FUNCTION _elimu_fin_tenant_of(p_business uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t uuid := get_current_tenant_id(); v_ok boolean;
BEGIN
  IF v_t IS NULL THEN RAISE EXCEPTION 'No school session.' USING ERRCODE = '42501'; END IF;
  SELECT true INTO v_ok FROM lb_businesses WHERE id = p_business AND tenant_id = v_t;
  IF v_ok IS NOT TRUE THEN RAISE EXCEPTION 'That school was not found.' USING ERRCODE = '42501'; END IF;
  RETURN v_t;
END $$;

-- Audit through the EXISTING pos_audit_log. previous/new/reason/approval all ride in metadata.
CREATE OR REPLACE FUNCTION _elimu_fin_audit(p_action text, p_entity_type text, p_entity uuid, p_meta jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF to_regclass('public.pos_audit_log') IS NULL THEN RETURN; END IF;
  INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id, metadata)
  VALUES (get_current_tenant_id(), 'staff', _elimu_fin_staff(), 'ELIMU_FIN_' || upper(p_action), p_entity_type, p_entity,
          coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('at', now()));
END $$;

-- Locks down a table the POS way: tenant read + restrictive permission read, no write grants.
CREATE OR REPLACE FUNCTION _elimu_fin_secure(p_table text, p_read_action text DEFAULT 'view') RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', p_table);
  EXECUTE format('DROP POLICY IF EXISTS tenant_isolation_%s ON %I', p_table, p_table);
  EXECUTE format('CREATE POLICY tenant_isolation_%s ON %I FOR SELECT USING (tenant_id = get_current_tenant_id())', p_table, p_table);
  EXECUTE format('DROP POLICY IF EXISTS finance_permission_%s ON %I', p_table, p_table);
  EXECUTE format('CREATE POLICY finance_permission_%s ON %I AS RESTRICTIVE FOR SELECT USING (elimu_fin_can(%L))', p_table, p_table, p_read_action);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC, anon, authenticated', p_table);
  EXECUTE format('GRANT SELECT ON %I TO authenticated', p_table);
END $$;

-- ---------- settings (one row per school) ----------
CREATE TABLE IF NOT EXISTS elimu_fin_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  currency text NOT NULL DEFAULT 'KES' CHECK (currency ~ '^[A-Z]{3}$'),
  allocation_policy text NOT NULL DEFAULT 'OLDEST_FIRST' CHECK (allocation_policy IN ('OLDEST_FIRST','CURRENT_TERM_FIRST','MANUAL_ONLY')),
  auto_apply_credit boolean NOT NULL DEFAULT true,                 -- new invoices absorb existing credit (unless MANUAL_ONLY)
  bank_requires_confirmation boolean NOT NULL DEFAULT true,        -- bank deposit stays PENDING until an approver confirms
  manual_mpesa_requires_confirmation boolean NOT NULL DEFAULT true,-- a typed M-Pesa code is not money until verified/confirmed
  other_requires_confirmation boolean NOT NULL DEFAULT true,       -- cheque / other
  require_session_for_cash boolean NOT NULL DEFAULT false,         -- cash must fall inside an open cashier session
  invoice_due_days integer NOT NULL DEFAULT 14 CHECK (invoice_due_days BETWEEN 0 AND 365),
  allow_self_approval boolean NOT NULL DEFAULT false,              -- requester may approve own adjustment (owner only)
  accounting_policy text NOT NULL DEFAULT 'ACCRUAL' CHECK (accounting_policy IN ('ACCRUAL','DEFERRED')),
  gl_enabled boolean NOT NULL DEFAULT false,                       -- write balanced journal postings to the outbox
  receipt_title text NOT NULL DEFAULT 'FEE PAYMENT RECEIPT',
  receipt_footer text,
  statement_footer text,
  payment_instructions text,                                       -- e.g. Paybill + account format, shown on invoices/statements
  updated_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id)
);

-- ---------- bridge: academic periods (owned by AI 1 / AI 3; finance keeps the labels it needs) ----------
CREATE TABLE IF NOT EXISTS elimu_fin_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  external_year_id uuid, external_term_id uuid,                      -- ids in AI 1's tables (no FK: table may not exist yet)
  academic_year text NOT NULL CHECK (length(btrim(academic_year)) > 0),
  term text,                                                         -- NULL = a whole-year period (annual billing)
  term_no integer CHECK (term_no IS NULL OR term_no BETWEEN 1 AND 12),
  start_date date NOT NULL, end_date date NOT NULL,
  default_due_date date,
  is_current boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_fin_period_dates CHECK (end_date >= start_date)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_fin_period ON elimu_fin_periods (business_id, academic_year, (coalesce(term, '*')));
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_fin_period_ext ON elimu_fin_periods (business_id, external_term_id) WHERE external_term_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_fin_period_current ON elimu_fin_periods (business_id) WHERE is_current;

-- ---------- bridge: students (owned by AI 1). A finance-side SNAPSHOT of what billing/collection needs. ----------
-- AI 1 keeps this fresh by calling elimu_fin_sync_student(). Financial rows reference (business_id, student_id) and keep
-- their own copies of admission no./class at the time of the transaction, so history survives class changes / leaving.
CREATE TABLE IF NOT EXISTS elimu_fin_students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  student_id uuid NOT NULL,                                          -- AI 1 students.id (authoritative)
  enrollment_id uuid,                                                -- AI 1 current enrollment
  admission_no text NOT NULL CHECK (length(btrim(admission_no)) > 0),
  full_name text NOT NULL CHECK (length(btrim(full_name)) > 0),
  class_id uuid, class_name text, stream_id uuid, stream_name text,
  boarding_status text NOT NULL DEFAULT 'DAY' CHECK (boarding_status IN ('DAY','BOARDING','WEEKLY_BOARDING')),
  student_category text,                                             -- e.g. 'NORMAL','ORPHAN','SPECIAL_NEEDS' - school defined
  sibling_group_id uuid, sibling_rank integer CHECK (sibling_rank IS NULL OR sibling_rank >= 1),  -- 1 = eldest/first enrolled
  is_staff_child boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','LEFT','SUSPENDED','GRADUATED')),
  guardian_id uuid, guardian_name text, guardian_phone text, guardian_email text, guardian_relationship text,
  synced_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, student_id),
  UNIQUE (business_id, admission_no)
);
CREATE INDEX IF NOT EXISTS idx_elimu_fin_students_class ON elimu_fin_students (business_id, class_id, stream_id) WHERE status = 'ACTIVE';

-- ---------- fee items (the catalogue; schools create their own) ----------
CREATE TABLE IF NOT EXISTS elimu_fin_fee_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  description text,
  category text NOT NULL DEFAULT 'OTHER' CHECK (category IN ('TUITION','ADMISSION','ACTIVITY','TRANSPORT','BOARDING','MEALS','EXAMINATION','DEVELOPMENT','MEDICAL','UNIFORM','BOOKS','OTHER')),
  default_amount numeric(15,2) NOT NULL DEFAULT 0 CHECK (default_amount >= 0),
  frequency text NOT NULL DEFAULT 'TERM' CHECK (frequency IN ('ONCE','TERM','ANNUAL','MONTHLY','CUSTOM')),
  applicable_class_ids uuid[],                                       -- NULL = every class
  effective_from date, effective_to date,
  income_account_key text,                                           -- optional override of the FEE_INCOME mapping (see E007)
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_fin_item_dates CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_fin_item_name ON elimu_fin_fee_items (business_id, lower(btrim(name)));

-- ---------- fee structures ----------
CREATE TABLE IF NOT EXISTS elimu_fin_fee_structures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  period_id uuid NOT NULL REFERENCES elimu_fin_periods(id),
  class_id uuid, class_name text,                                    -- NULL = all classes
  stream_id uuid, stream_name text,
  boarding_status text CHECK (boarding_status IS NULL OR boarding_status IN ('DAY','BOARDING','WEEKLY_BOARDING')),
  student_category text,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  effective_from date,
  notes text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_fin_structure_scope ON elimu_fin_fee_structures (business_id, period_id, lower(btrim(name)));
CREATE INDEX IF NOT EXISTS idx_elimu_fin_structures_period ON elimu_fin_fee_structures (business_id, period_id, status);

CREATE TABLE IF NOT EXISTS elimu_fin_fee_structure_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL,
  structure_id uuid NOT NULL REFERENCES elimu_fin_fee_structures(id) ON DELETE CASCADE,
  fee_item_id uuid NOT NULL REFERENCES elimu_fin_fee_items(id),
  amount numeric(15,2) NOT NULL CHECK (amount >= 0),
  due_date date,                                                     -- NULL = period default due date / invoice_due_days
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (structure_id, fee_item_id)
);

-- ---------- automatic discount rules (sibling / staff child ...). Pre-authorised by an administrator. ----------
CREATE TABLE IF NOT EXISTS elimu_fin_discount_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  kind text NOT NULL CHECK (kind IN ('SIBLING','STAFF_CHILD','OTHER')),
  value_type text NOT NULL CHECK (value_type IN ('PERCENT','FIXED')),
  value numeric(15,4) NOT NULL CHECK (value > 0),
  fee_item_id uuid REFERENCES elimu_fin_fee_items(id),               -- NULL = on the whole invoice
  min_sibling_rank integer CHECK (min_sibling_rank IS NULL OR min_sibling_rank >= 2),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT elimu_fin_rule_pct CHECK (value_type <> 'PERCENT' OR value <= 100)
);

-- ---------- lock down ----------
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['elimu_fin_settings','elimu_fin_periods','elimu_fin_students','elimu_fin_fee_items',
    'elimu_fin_fee_structures','elimu_fin_fee_structure_items','elimu_fin_discount_rules'] LOOP
    PERFORM _elimu_fin_secure(t, 'view');
  END LOOP;
END $$;

-- ---------- one audited writer for configuration tables (whitelist; permission 'configure'; old/new in the audit) ----------
-- p_row is a jsonb object using the table's column names. id/tenant_id/business_id/created_by are controlled here.
CREATE OR REPLACE FUNCTION elimu_fin_save_config(p_table text, p_business uuid, p_row jsonb, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_tenant uuid; v_id uuid; v_old jsonb; v_new jsonb; v_cols text; v_sets text; v_action text;
  v_skip text[] := ARRAY['id','tenant_id','business_id','created_at','created_by','updated_at','synced_at'];
BEGIN
  IF p_table NOT IN ('elimu_fin_settings','elimu_fin_periods','elimu_fin_fee_items','elimu_fin_fee_structures',
                     'elimu_fin_fee_structure_items','elimu_fin_discount_rules') THEN
    RAISE EXCEPTION 'Unknown configuration table %.', p_table;
  END IF;
  PERFORM _elimu_fin_require('configure');
  v_tenant := _elimu_fin_tenant_of(p_business);
  v_id := nullif(p_row ->> 'id', '')::uuid;

  IF p_table = 'elimu_fin_settings' THEN
    SELECT to_jsonb(t) INTO v_old FROM elimu_fin_settings t WHERE business_id = p_business;
    v_id := nullif(v_old ->> 'id','')::uuid;
  ELSIF v_id IS NOT NULL THEN
    EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE id = $1 AND tenant_id = $2 AND business_id = $3', p_table)
      INTO v_old USING v_id, v_tenant, p_business;
    IF v_old IS NULL THEN RAISE EXCEPTION 'That record was not found.'; END IF;
  END IF;

  IF v_old IS NULL THEN
    v_id := coalesce(v_id, gen_random_uuid());
    SELECT string_agg(quote_ident(column_name), ',') INTO v_cols FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = p_table AND column_name <> ALL (v_skip) AND p_row ? column_name;
    EXECUTE format(
      'INSERT INTO %1$I (id, tenant_id, business_id%2$s) SELECT $1, $2, $3%2$s FROM jsonb_populate_record(NULL::%1$I, $4)',
      p_table, CASE WHEN v_cols IS NULL THEN '' ELSE ',' || v_cols END)
      USING v_id, v_tenant, p_business, p_row;
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = p_table AND column_name = 'created_by') THEN
      EXECUTE format('UPDATE %I SET created_by = $2 WHERE id = $1', p_table) USING v_id, _elimu_fin_staff();
    END IF;
    v_action := 'CREATED';
  ELSE
    SELECT string_agg(format('%1$I = r.%1$I', column_name), ', ') INTO v_sets FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = p_table AND column_name <> ALL (v_skip) AND p_row ? column_name;
    IF v_sets IS NOT NULL THEN
      EXECUTE format('UPDATE %1$I t SET %2$s, updated_at = now() FROM jsonb_populate_record(NULL::%1$I, $2) r WHERE t.id = $1', p_table, v_sets)
        USING v_id, (v_old || p_row);
    END IF;
    v_action := 'AMENDED';
  END IF;

  EXECUTE format('SELECT to_jsonb(t) FROM %I t WHERE id = $1', p_table) INTO v_new USING v_id;
  PERFORM _elimu_fin_audit(
    CASE WHEN p_table IN ('elimu_fin_fee_items','elimu_fin_fee_structures','elimu_fin_fee_structure_items') THEN 'FEE_STRUCTURE_' || v_action ELSE 'CONFIG_' || v_action END,
    p_table, v_id, jsonb_build_object('previous', v_old, 'new', v_new, 'reason', p_reason));
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'row', v_new);
END $$;

-- ---------- AI 1 bridge writer (student snapshot). configure OR bill permission. ----------
CREATE OR REPLACE FUNCTION elimu_fin_sync_student(p_business uuid, p_student jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid; v_sid uuid := nullif(p_student ->> 'student_id','')::uuid; v_id uuid; v_old jsonb;
BEGIN
  IF NOT (elimu_fin_can('configure') OR elimu_fin_can('bill')) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  v_tenant := _elimu_fin_tenant_of(p_business);
  IF v_sid IS NULL THEN RAISE EXCEPTION 'student_id is required.'; END IF;
  SELECT to_jsonb(s) INTO v_old FROM elimu_fin_students s WHERE business_id = p_business AND student_id = v_sid;
  INSERT INTO elimu_fin_students AS s (tenant_id, business_id, student_id, enrollment_id, admission_no, full_name, class_id, class_name,
      stream_id, stream_name, boarding_status, student_category, sibling_group_id, sibling_rank, is_staff_child, status,
      guardian_id, guardian_name, guardian_phone, guardian_email, guardian_relationship)
  VALUES (v_tenant, p_business, v_sid, nullif(p_student->>'enrollment_id','')::uuid, p_student->>'admission_no', p_student->>'full_name',
      nullif(p_student->>'class_id','')::uuid, p_student->>'class_name', nullif(p_student->>'stream_id','')::uuid, p_student->>'stream_name',
      coalesce(p_student->>'boarding_status','DAY'), p_student->>'student_category', nullif(p_student->>'sibling_group_id','')::uuid,
      nullif(p_student->>'sibling_rank','')::int, coalesce((p_student->>'is_staff_child')::boolean,false), coalesce(p_student->>'status','ACTIVE'),
      nullif(p_student->>'guardian_id','')::uuid, p_student->>'guardian_name', p_student->>'guardian_phone', p_student->>'guardian_email', p_student->>'guardian_relationship')
  ON CONFLICT (business_id, student_id) DO UPDATE SET
      enrollment_id = EXCLUDED.enrollment_id, admission_no = EXCLUDED.admission_no, full_name = EXCLUDED.full_name,
      class_id = EXCLUDED.class_id, class_name = EXCLUDED.class_name, stream_id = EXCLUDED.stream_id, stream_name = EXCLUDED.stream_name,
      boarding_status = EXCLUDED.boarding_status, student_category = EXCLUDED.student_category, sibling_group_id = EXCLUDED.sibling_group_id,
      sibling_rank = EXCLUDED.sibling_rank, is_staff_child = EXCLUDED.is_staff_child, status = EXCLUDED.status,
      guardian_id = EXCLUDED.guardian_id, guardian_name = EXCLUDED.guardian_name, guardian_phone = EXCLUDED.guardian_phone,
      guardian_email = EXCLUDED.guardian_email, guardian_relationship = EXCLUDED.guardian_relationship, synced_at = now()
  RETURNING id INTO v_id;
  -- one fee account per student (E002 defines the table; created lazily by billing too)
  IF to_regclass('public.elimu_fin_accounts') IS NOT NULL THEN
    EXECUTE 'INSERT INTO elimu_fin_accounts (tenant_id, business_id, student_id) VALUES ($1,$2,$3) ON CONFLICT (business_id, student_id) DO NOTHING'
      USING v_tenant, p_business, v_sid;
  END IF;
  IF v_old IS NOT NULL AND (v_old->>'class_id') IS DISTINCT FROM (p_student->>'class_id') THEN
    PERFORM _elimu_fin_audit('STUDENT_CLASS_CHANGED', 'elimu_fin_students', v_id,
      jsonb_build_object('previous', v_old->>'class_name', 'new', p_student->>'class_name'));
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END $$;

REVOKE ALL ON FUNCTION _elimu_fin_today(), _elimu_fin_staff(), _elimu_fin_require(text), _elimu_fin_tenant_of(uuid),
  _elimu_fin_audit(text,text,uuid,jsonb), _elimu_fin_secure(text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION elimu_fin_can(text), elimu_fin_save_config(text,uuid,jsonb,text), elimu_fin_sync_student(uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION elimu_fin_can(text), elimu_fin_save_config(text,uuid,jsonb,text), elimu_fin_sync_student(uuid,jsonb) TO authenticated;
