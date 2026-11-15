-- ============================================================================
-- ELIMU FINANCE  E007  Accounting integration.
-- The POS has NO general ledger or chart of accounts (see AUDIT: "This schema has NO general ledger"). So this module does NOT
-- invent one. It produces BALANCED JOURNAL POSTINGS into an outbox (elimu_fin_gl_postings) using school-configurable account mappings,
-- ready for whichever GL is introduced later (adapter calls elimu_fin_gl_mark_posted()).
--   * Switched on per school by elimu_fin_settings.gl_enabled (default OFF). Student ledger/invoices work without it.
--   * Every posting must balance (total debit = total credit) or it is refused.
--   * One posting per (event, source): re-running a flow can never double-post (UNIQUE + ON CONFLICT DO NOTHING).
--   * Reversals are separate postings with swapped sides; originals are untouched.
-- Account keys used: STUDENT_RECEIVABLES, FEE_INCOME, DEFERRED_INCOME, DISCOUNT_ALLOWED, SCHOLARSHIP_EXPENSE, BURSARY_RECEIVABLE,
--   BAD_DEBT_EXPENSE, STUDENT_CREDIT_LIABILITY (credit balances are a LIABILITY, never income), CASH_ON_HAND, MPESA_CLEARING, BANK,
--   OTHER_RECEIPTS, OPENING_BALANCE_EQUITY, GENERAL_EXPENSE, EXPENSE:<lb_expense_categories.id>
-- Requires E001-E006. Re-runnable.
-- ============================================================================
CREATE TABLE IF NOT EXISTS elimu_fin_account_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  account_key text NOT NULL CHECK (length(btrim(account_key)) > 0),
  account_code text, account_name text,
  external_account_id uuid,                                    -- future GL account id
  description text,
  updated_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, account_key)
);

CREATE TABLE IF NOT EXISTS elimu_fin_gl_postings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  event text NOT NULL, source_type text NOT NULL, source_id uuid NOT NULL,
  posting_date date NOT NULL,
  total_debit numeric(15,2) NOT NULL, total_credit numeric(15,2) NOT NULL,
  status text NOT NULL CHECK (status IN ('READY','UNMAPPED','POSTED','FAILED')),
  external_ref text, error text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz,
  CONSTRAINT elimu_fin_gl_balanced CHECK (total_debit = total_credit AND total_debit > 0),
  UNIQUE (business_id, event, source_type, source_id)
);
CREATE TABLE IF NOT EXISTS elimu_fin_gl_posting_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, business_id uuid NOT NULL,
  posting_id uuid NOT NULL REFERENCES elimu_fin_gl_postings(id),
  line_no integer NOT NULL,
  account_key text NOT NULL, account_code text, account_name text,
  debit numeric(15,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit numeric(15,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  CONSTRAINT elimu_fin_gl_line_one_side CHECK ((debit > 0) <> (credit > 0)),
  UNIQUE (posting_id, line_no)
);
CREATE INDEX IF NOT EXISTS idx_elimu_fin_gl_status ON elimu_fin_gl_postings (business_id, status, posting_date);

CREATE OR REPLACE FUNCTION _elimu_fin_gl_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Journal postings are never deleted.' USING ERRCODE = '42501'; END IF;
  IF TG_TABLE_NAME = 'elimu_fin_gl_posting_lines' THEN
    IF NEW.debit IS DISTINCT FROM OLD.debit OR NEW.credit IS DISTINCT FROM OLD.credit OR NEW.account_key IS DISTINCT FROM OLD.account_key THEN
      RAISE EXCEPTION 'Journal amounts cannot be edited.' USING ERRCODE = '42501'; END IF;   -- only account_code/name may be resolved later
  ELSE
    IF NEW.total_debit IS DISTINCT FROM OLD.total_debit OR NEW.total_credit IS DISTINCT FROM OLD.total_credit OR NEW.event IS DISTINCT FROM OLD.event OR NEW.source_id IS DISTINCT FROM OLD.source_id THEN
      RAISE EXCEPTION 'Journal amounts cannot be edited.' USING ERRCODE = '42501'; END IF;
    IF OLD.status = 'POSTED' THEN RAISE EXCEPTION 'A posted journal cannot change.' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_fin_gl_guard_h ON elimu_fin_gl_postings;
CREATE TRIGGER trg_elimu_fin_gl_guard_h BEFORE UPDATE OR DELETE ON elimu_fin_gl_postings FOR EACH ROW EXECUTE FUNCTION _elimu_fin_gl_guard();
DROP TRIGGER IF EXISTS trg_elimu_fin_gl_guard_l ON elimu_fin_gl_posting_lines;
CREATE TRIGGER trg_elimu_fin_gl_guard_l BEFORE UPDATE OR DELETE ON elimu_fin_gl_posting_lines FOR EACH ROW EXECUTE FUNCTION _elimu_fin_gl_guard();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['elimu_fin_account_mappings','elimu_fin_gl_postings','elimu_fin_gl_posting_lines'] LOOP PERFORM _elimu_fin_secure(t, 'report'); END LOOP;
END $$;

-- the writer used by every flow (signature fixed by E002's _elimu_fin_gl wrapper)
CREATE OR REPLACE FUNCTION _elimu_fin_gl_post(p_event text, p_source_type text, p_source_id uuid, p_date date, p_lines jsonb, p_business uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE x jsonb; v_d numeric := 0; v_c numeric := 0; v_id uuid; n int := 0; m elimu_fin_account_mappings%ROWTYPE; v_key text; v_unmapped boolean := false; v_clean jsonb := '[]'::jsonb;
BEGIN
  FOR x IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    IF coalesce((x->>'debit')::numeric,0) = 0 AND coalesce((x->>'credit')::numeric,0) = 0 THEN CONTINUE; END IF;
    v_clean := v_clean || x; v_d := v_d + coalesce((x->>'debit')::numeric,0); v_c := v_c + coalesce((x->>'credit')::numeric,0);
  END LOOP;
  IF jsonb_array_length(v_clean) = 0 THEN RETURN; END IF;
  IF v_d <> v_c THEN RAISE EXCEPTION 'Journal % does not balance (debits % vs credits %).', p_event, v_d, v_c; END IF;
  INSERT INTO elimu_fin_gl_postings (tenant_id, business_id, event, source_type, source_id, posting_date, total_debit, total_credit, status, created_by)
  VALUES (get_current_tenant_id(), p_business, p_event, p_source_type, p_source_id, p_date, v_d, v_c, 'READY', _elimu_fin_staff())
  ON CONFLICT (business_id, event, source_type, source_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN; END IF;                         -- already posted: never twice
  FOR x IN SELECT * FROM jsonb_array_elements(v_clean) LOOP
    n := n + 1; v_key := x->>'account_key'; m := NULL;
    SELECT * INTO m FROM elimu_fin_account_mappings WHERE business_id = p_business AND account_key = v_key AND account_code IS NOT NULL;
    IF m.id IS NULL AND x ? 'fallback_key' THEN
      SELECT * INTO m FROM elimu_fin_account_mappings WHERE business_id = p_business AND account_key = x->>'fallback_key' AND account_code IS NOT NULL;
    END IF;
    IF m.id IS NULL THEN v_unmapped := true; END IF;
    INSERT INTO elimu_fin_gl_posting_lines (tenant_id, business_id, posting_id, line_no, account_key, account_code, account_name, debit, credit)
    VALUES (get_current_tenant_id(), p_business, v_id, n, v_key, m.account_code, m.account_name, coalesce((x->>'debit')::numeric,0), coalesce((x->>'credit')::numeric,0));
  END LOOP;
  IF v_unmapped THEN UPDATE elimu_fin_gl_postings SET status = 'UNMAPPED' WHERE id = v_id; END IF;
END $$;

-- after the accountant fills in mappings, resolve what was waiting
CREATE OR REPLACE FUNCTION elimu_fin_gl_resolve_unmapped(p_business uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_fixed int := 0; v_left int;
BEGIN
  PERFORM _elimu_fin_require('reconcile'); PERFORM _elimu_fin_tenant_of(p_business);
  UPDATE elimu_fin_gl_posting_lines l SET account_code = m.account_code, account_name = m.account_name
    FROM elimu_fin_account_mappings m, elimu_fin_gl_postings p
   WHERE p.id = l.posting_id AND p.business_id = p_business AND p.status = 'UNMAPPED' AND l.account_code IS NULL AND m.business_id = p_business AND m.account_key = l.account_key AND m.account_code IS NOT NULL;
  FOR r IN SELECT p.id FROM elimu_fin_gl_postings p WHERE p.business_id = p_business AND p.status = 'UNMAPPED'
            AND NOT EXISTS (SELECT 1 FROM elimu_fin_gl_posting_lines l WHERE l.posting_id = p.id AND l.account_code IS NULL) LOOP
    UPDATE elimu_fin_gl_postings SET status = 'READY' WHERE id = r.id; v_fixed := v_fixed + 1;
  END LOOP;
  SELECT count(*) INTO v_left FROM elimu_fin_gl_postings WHERE business_id = p_business AND status = 'UNMAPPED';
  RETURN jsonb_build_object('ok', true, 'now_ready', v_fixed, 'still_unmapped', v_left);
END $$;

-- adapter hooks for a future GL: it reads READY postings, then reports back
CREATE OR REPLACE FUNCTION elimu_fin_gl_mark_posted(p_posting uuid, p_external_ref text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM _elimu_fin_require('reconcile');
  UPDATE elimu_fin_gl_postings SET status = 'POSTED', external_ref = p_external_ref, posted_at = now() WHERE id = p_posting AND tenant_id = get_current_tenant_id() AND status = 'READY';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only a READY (fully mapped) journal can be marked posted.'; END IF;
  PERFORM _elimu_fin_audit('JOURNAL_POSTED', 'elimu_fin_gl_postings', p_posting, jsonb_build_object('new', jsonb_build_object('external_ref', p_external_ref)));
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION elimu_fin_seed_default_mappings(p_business uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t uuid; k record; v_n int := 0;
BEGIN
  PERFORM _elimu_fin_require('configure'); v_t := _elimu_fin_tenant_of(p_business);
  FOR k IN SELECT * FROM (VALUES
    ('STUDENT_RECEIVABLES','Student fees receivable (control)'),('FEE_INCOME','School fee income'),('DEFERRED_INCOME','Fees received/billed in advance (deferred income)'),
    ('DISCOUNT_ALLOWED','Discounts allowed (contra-income)'),('SCHOLARSHIP_EXPENSE','Scholarships granted'),('BURSARY_RECEIVABLE','Bursaries due from sponsors'),
    ('BAD_DEBT_EXPENSE','Fees written off'),('STUDENT_CREDIT_LIABILITY','Student credit balances (liability - NOT income)'),
    ('CASH_ON_HAND','Cash on hand'),('MPESA_CLEARING','M-Pesa clearing'),('BANK','Bank'),('OTHER_RECEIPTS','Other receipts clearing'),
    ('OPENING_BALANCE_EQUITY','Opening balance equity'),('GENERAL_EXPENSE','General school expenses')) AS d(key, descr) LOOP
    INSERT INTO elimu_fin_account_mappings (tenant_id, business_id, account_key, description, updated_by) VALUES (v_t, p_business, k.key, k.descr, _elimu_fin_staff())
    ON CONFLICT (business_id, account_key) DO NOTHING;
    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'added', v_n);
END $$;

CREATE OR REPLACE FUNCTION elimu_fin_save_mapping(p_business uuid, p_key text, p_code text, p_name text, p_external uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_t uuid; v_old jsonb;
BEGIN
  IF NOT (elimu_fin_can('configure') OR (elimu_fin_can('report') AND elimu_fin_can('reconcile'))) THEN RAISE EXCEPTION 'You do not have permission to do this.' USING ERRCODE = '42501'; END IF;
  v_t := _elimu_fin_tenant_of(p_business);
  SELECT to_jsonb(m) INTO v_old FROM elimu_fin_account_mappings m WHERE business_id = p_business AND account_key = p_key;
  INSERT INTO elimu_fin_account_mappings (tenant_id, business_id, account_key, account_code, account_name, external_account_id, updated_by)
  VALUES (v_t, p_business, p_key, nullif(btrim(p_code),''), p_name, p_external, _elimu_fin_staff())
  ON CONFLICT (business_id, account_key) DO UPDATE SET account_code = EXCLUDED.account_code, account_name = EXCLUDED.account_name, external_account_id = EXCLUDED.external_account_id, updated_by = EXCLUDED.updated_by, updated_at = now();
  PERFORM _elimu_fin_audit('ACCOUNT_MAPPING_CHANGED', 'elimu_fin_account_mappings', NULL, jsonb_build_object('previous', v_old, 'new', jsonb_build_object('key', p_key, 'code', p_code, 'name', p_name)));
  RETURN jsonb_build_object('ok', true);
END $$;

REVOKE ALL ON FUNCTION _elimu_fin_gl_guard(), _elimu_fin_gl_post(text,text,uuid,date,jsonb,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION elimu_fin_gl_resolve_unmapped(uuid), elimu_fin_gl_mark_posted(uuid,text), elimu_fin_seed_default_mappings(uuid), elimu_fin_save_mapping(uuid,text,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION elimu_fin_gl_resolve_unmapped(uuid), elimu_fin_gl_mark_posted(uuid,text), elimu_fin_seed_default_mappings(uuid), elimu_fin_save_mapping(uuid,text,text,text,uuid) TO authenticated;
