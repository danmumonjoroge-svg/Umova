-- phase48_etims_foundation.sql   -- NOT YET RUN on any database. Run on STAGING first. Re-runnable.
--
-- KRA eTIMS integration, PHASE 2: the foundation. No KRA calls, no triggers on sales, no change to checkout.
-- Everything here is dormant until a business has a row in lb_etims_config with enabled = true, which only the
-- (Phase 3) backend functions can set. Design: ETIMS_PHASE1_AUDIT.md (sections D and E).
--
-- WHAT THIS ADDS (nothing existing is changed or removed, except ONE nullable column on lb_customers)
--   1. lb_etims_config         one row per business: PIN, environment, branch, device, connection status
--   2. lb_etims_item_map       per product: KRA codes (opaque text, copied from KRA's own lists; NEVER invented here)
--   3. lb_etims_code_lists     KRA code lists cache (global, read-only for tenants)
--   4. lb_etims_sequences      invoice counters (one atomic function hands out numbers)
--   5. lb_etims_invoices       one row per KRA document (sale / credit note), status machine, immutable snapshot
--   6. lb_etims_attempts       append-only trace of every call to KRA
--   7. lb_customers.kra_pin    optional buyer PIN (nullable)
--   8. lb_sale_etims_status    read-only view: eTIMS status per sale, for badges. lb_sales.status is NEVER touched.
--   9. pos_etims_save_profile / pos_etims_set_item_codes / pos_etims_my_status   owner-facing RPCs (settings.manage)
--
-- NOT HERE (later phases): the communication-key secrets table (waits on the Vault decision), the trigger that queues
-- invoices from lb_receipts, credit-note triggers, the submit worker, any Edge Function.
--
-- PREREQUISITES: phase28 helpers (is_pos_session, pos_has_permission, pos_require) and get_current_tenant_id().
-- ROLLBACK (loses only eTIMS data):
--   DROP VIEW lb_sale_etims_status;  DROP FUNCTION pos_etims_my_status(uuid), pos_etims_set_item_codes(uuid,uuid,jsonb),
--     pos_etims_save_profile(uuid,text,text,text,text,boolean), etims_next_invoice_no(uuid,text,text);
--   DROP TABLE lb_etims_attempts, lb_etims_invoices, lb_etims_sequences, lb_etims_item_map, lb_etims_code_lists, lb_etims_config;
--   ALTER TABLE lb_customers DROP COLUMN kra_pin;

DO $$ BEGIN
  IF to_regprocedure('pos_require(text[])') IS NULL OR to_regprocedure('is_pos_session()') IS NULL
     OR to_regprocedure('pos_has_permission(text)') IS NULL OR to_regprocedure('get_current_tenant_id()') IS NULL THEN
    RAISE EXCEPTION 'phase48 needs the phase28 permission helpers and get_current_tenant_id() first.';
  END IF;
END $$;

-- ---------- 1. per-business configuration ----------
CREATE TABLE IF NOT EXISTS lb_etims_config (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  business_id      uuid NOT NULL REFERENCES lb_businesses(id),
  kra_pin          text,
  environment      text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox','production')),
  branch_id        text,                      -- KRA branch office id, as KRA issued it (format per spec; not validated here)
  device_serial    text,
  vat_registered   boolean NOT NULL DEFAULT false,
  prices_include_tax boolean NOT NULL DEFAULT true,   -- owner confirms at setup; default matches Settings' existing default
  enabled          boolean NOT NULL DEFAULT false,    -- master switch. Set ONLY by the backend (service role), never by a till session
  status           text NOT NULL DEFAULT 'NOT_CONFIGURED'
                   CHECK (status IN ('NOT_CONFIGURED','WAITING_FOR_KRA','READY_TO_CONNECT','ACTIVE','NEEDS_ATTENTION','SUSPENDED')),
  go_live_at       timestamptz,               -- sales completed before this are never queued
  last_init_at     timestamptz,
  last_success_at  timestamptz,
  last_error       text,                      -- sanitised, short; never a key or header
  has_comm_key     boolean NOT NULL DEFAULT false,   -- flag only, the key itself lives elsewhere (Phase 3)
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id)
);

-- ---------- 2. per-product KRA codes ----------
CREATE TABLE IF NOT EXISTS lb_etims_item_map (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  business_id         uuid NOT NULL REFERENCES lb_businesses(id),
  product_id          uuid NOT NULL REFERENCES lb_products(id),
  tax_code            text,          -- all four codes are copied from KRA's lists (lb_etims_code_lists); this file defines none
  item_class_code     text,
  unit_code           text,
  packaging_code      text,
  origin_country_code text,
  kra_item_code       text,
  registration_status text NOT NULL DEFAULT 'NOT_REGISTERED'
                      CHECK (registration_status IN ('NOT_REGISTERED','PENDING','REGISTERED','REJECTED')),
  registration_error  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id)
);
CREATE INDEX IF NOT EXISTS idx_lb_etims_item_map_business ON lb_etims_item_map (business_id);

-- ---------- 3. KRA code lists (global cache, same for every tenant) ----------
CREATE TABLE IF NOT EXISTS lb_etims_code_lists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  list_name   text NOT NULL,
  code        text NOT NULL,
  name        text,
  extra       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- whatever else KRA returns for that code (e.g. a percentage, if it does)
  synced_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, list_name, code)
);

-- ---------- 4. invoice counters ----------
-- scope lets a later phase number per branch/device if the spec requires it; 'DEFAULT' until then.
CREATE TABLE IF NOT EXISTS lb_etims_sequences (
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  scope       text NOT NULL DEFAULT 'DEFAULT',
  doc_type    text NOT NULL CHECK (doc_type IN ('SALE','CREDIT_NOTE')),
  last_no     bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (business_id, scope, doc_type)
);

CREATE OR REPLACE FUNCTION etims_next_invoice_no(p_business uuid, p_doc_type text, p_scope text DEFAULT 'DEFAULT') RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v bigint;
BEGIN
  -- one atomic statement: concurrent callers serialise on the row, so two sales can never get the same number
  INSERT INTO lb_etims_sequences (business_id, scope, doc_type, last_no) VALUES (p_business, p_scope, p_doc_type, 1)
  ON CONFLICT (business_id, scope, doc_type) DO UPDATE SET last_no = lb_etims_sequences.last_no + 1
  RETURNING last_no INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION etims_next_invoice_no(uuid,text,text) FROM PUBLIC, anon, authenticated;   -- backend / trigger code only

-- ---------- 5. the invoices (one row per KRA document) ----------
CREATE TABLE IF NOT EXISTS lb_etims_invoices (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid NOT NULL,
  business_id         uuid NOT NULL REFERENCES lb_businesses(id),
  sale_id             uuid NOT NULL REFERENCES lb_sales(id) ON DELETE RESTRICT,   -- a tax document must outlive any attempt to delete its sale
  doc_type            text NOT NULL CHECK (doc_type IN ('SALE','CREDIT_NOTE')),
  original_invoice_id uuid REFERENCES lb_etims_invoices(id),
  reversal_id         uuid,                                                      -- pos_sale_reversals.id for a credit note
  invoice_no          bigint NOT NULL,                                           -- allocated ONCE at creation; retries reuse it
  status              text NOT NULL DEFAULT 'PENDING'
                      CHECK (status IN ('PENDING','SENDING','SENT_UNCONFIRMED','ACCEPTED','REJECTED','CANCELLED_BEFORE_SEND')),
  attempt_count       integer NOT NULL DEFAULT 0,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  lease_until         timestamptz,
  lease_by            text,
  snapshot            jsonb NOT NULL,        -- exactly what is sent; immutable once created
  snapshot_hash       text NOT NULL,
  response_summary    jsonb,                 -- sanitised: result code + message, never headers or keys
  kra_data            jsonb,                 -- fields KRA returns for the customer copy (shape fixed after the spec is read)
  last_error_code     text,
  last_error_message  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  submitted_at        timestamptz,
  accepted_at         timestamptz,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK ((doc_type = 'CREDIT_NOTE') = (original_invoice_id IS NOT NULL))
);
-- duplicate prevention at the database level
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_etims_one_sale_invoice   ON lb_etims_invoices (sale_id) WHERE doc_type = 'SALE';
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_etims_one_credit_per_rev ON lb_etims_invoices (reversal_id) WHERE doc_type = 'CREDIT_NOTE' AND reversal_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_lb_etims_invoice_no         ON lb_etims_invoices (business_id, doc_type, invoice_no);
CREATE INDEX IF NOT EXISTS idx_lb_etims_invoices_due    ON lb_etims_invoices (next_attempt_at) WHERE status IN ('PENDING','SENT_UNCONFIRMED');
CREATE INDEX IF NOT EXISTS idx_lb_etims_invoices_tenant ON lb_etims_invoices (tenant_id, status, created_at DESC);

-- What may never change, and which status moves are legal.
CREATE OR REPLACE FUNCTION etims_invoice_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'ETIMS_IMMUTABLE: tax documents cannot be deleted' USING ERRCODE = 'P0001'; END IF;
  IF (NEW.snapshot, NEW.snapshot_hash, NEW.invoice_no, NEW.sale_id, NEW.doc_type, NEW.business_id, NEW.tenant_id, NEW.original_invoice_id)
     IS DISTINCT FROM (OLD.snapshot, OLD.snapshot_hash, OLD.invoice_no, OLD.sale_id, OLD.doc_type, OLD.business_id, OLD.tenant_id, OLD.original_invoice_id) THEN
    RAISE EXCEPTION 'ETIMS_IMMUTABLE: the invoice content and number cannot change after it is created' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status IN ('ACCEPTED','CANCELLED_BEFORE_SEND') THEN
      RAISE EXCEPTION 'ETIMS_FINAL: an % invoice cannot change status', OLD.status USING ERRCODE = 'P0001';
    END IF;
    IF NOT ((OLD.status, NEW.status) IN (
        ('PENDING','SENDING'), ('PENDING','CANCELLED_BEFORE_SEND'),
        ('SENDING','PENDING'), ('SENDING','ACCEPTED'), ('SENDING','REJECTED'), ('SENDING','SENT_UNCONFIRMED'),
        ('SENT_UNCONFIRMED','ACCEPTED'), ('SENT_UNCONFIRMED','REJECTED'), ('SENT_UNCONFIRMED','PENDING'), ('SENT_UNCONFIRMED','SENDING'),
        ('REJECTED','PENDING'))) THEN
      RAISE EXCEPTION 'ETIMS_BAD_TRANSITION: % -> % is not allowed', OLD.status, NEW.status USING ERRCODE = 'P0001';
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_etims_invoice_guard ON lb_etims_invoices;
CREATE TRIGGER trg_etims_invoice_guard BEFORE UPDATE OR DELETE ON lb_etims_invoices FOR EACH ROW EXECUTE FUNCTION etims_invoice_guard();

-- ---------- 6. attempts (append-only) ----------
CREATE TABLE IF NOT EXISTS lb_etims_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  invoice_id  uuid NOT NULL REFERENCES lb_etims_invoices(id),
  attempt_no  integer NOT NULL,
  outcome     text NOT NULL CHECK (outcome IN ('ACCEPTED','REJECTED','NETWORK_ERROR','KRA_UNAVAILABLE','NO_REPLY','AUTH_ERROR','OTHER')),
  http_status integer,
  result_code text,
  duration_ms integer,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lb_etims_attempts_invoice ON lb_etims_attempts (invoice_id, attempt_no);
CREATE OR REPLACE FUNCTION etims_attempts_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'ETIMS_APPEND_ONLY: the attempt log cannot be changed' USING ERRCODE = 'P0001'; END $$;
DROP TRIGGER IF EXISTS trg_etims_attempts_append_only ON lb_etims_attempts;
CREATE TRIGGER trg_etims_attempts_append_only BEFORE UPDATE OR DELETE ON lb_etims_attempts FOR EACH ROW EXECUTE FUNCTION etims_attempts_append_only();

-- ---------- 7. buyer PIN ----------
ALTER TABLE lb_customers ADD COLUMN IF NOT EXISTS kra_pin text;

-- ---------- RLS ----------
ALTER TABLE lb_etims_config     ENABLE ROW LEVEL SECURITY;
ALTER TABLE lb_etims_item_map   ENABLE ROW LEVEL SECURITY;
ALTER TABLE lb_etims_code_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE lb_etims_sequences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE lb_etims_invoices   ENABLE ROW LEVEL SECURITY;
ALTER TABLE lb_etims_attempts   ENABLE ROW LEVEL SECURITY;

-- all writes go through RPCs or the backend (service role bypasses RLS); nobody signed in can write directly
REVOKE ALL ON lb_etims_config, lb_etims_item_map, lb_etims_code_lists, lb_etims_sequences, lb_etims_invoices, lb_etims_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON lb_etims_config, lb_etims_item_map, lb_etims_code_lists, lb_etims_invoices, lb_etims_attempts TO authenticated;
-- lb_etims_sequences: no grant, no policy = backend only

DROP POLICY IF EXISTS etims_config_read ON lb_etims_config;
CREATE POLICY etims_config_read ON lb_etims_config FOR SELECT USING (tenant_id = get_current_tenant_id());
DROP POLICY IF EXISTS etims_item_map_read ON lb_etims_item_map;
CREATE POLICY etims_item_map_read ON lb_etims_item_map FOR SELECT USING (tenant_id = get_current_tenant_id());
DROP POLICY IF EXISTS etims_codes_read ON lb_etims_code_lists;
CREATE POLICY etims_codes_read ON lb_etims_code_lists FOR SELECT USING (true);
-- snapshots hold buyer PINs and amounts: owner/manager/accountant only. The cashier sees status through the view below.
DROP POLICY IF EXISTS etims_invoices_read ON lb_etims_invoices;
CREATE POLICY etims_invoices_read ON lb_etims_invoices FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND (NOT is_pos_session() OR pos_has_permission('settings.manage') OR pos_has_permission('finance.view')));
DROP POLICY IF EXISTS etims_attempts_read ON lb_etims_attempts;
CREATE POLICY etims_attempts_read ON lb_etims_attempts FOR SELECT
  USING (tenant_id = get_current_tenant_id() AND (NOT is_pos_session() OR pos_has_permission('settings.manage')));

-- ---------- 8. status view (what a cashier may see: no snapshot, no PIN, no key) ----------
-- Deliberately NOT security_invoker: it reads lb_etims_invoices as its owner and filters to the caller's business itself.
CREATE OR REPLACE VIEW lb_sale_etims_status AS
  SELECT i.sale_id, i.business_id, i.doc_type, i.invoice_no, i.status, i.attempt_count, i.accepted_at, i.created_at,
         CASE WHEN i.status = 'ACCEPTED' THEN i.kra_data END AS kra_data
  FROM lb_etims_invoices i
  WHERE i.tenant_id = get_current_tenant_id();
REVOKE ALL ON lb_sale_etims_status FROM PUBLIC, anon;
GRANT SELECT ON lb_sale_etims_status TO authenticated;

-- ---------- 9. owner-facing RPCs ----------
CREATE OR REPLACE FUNCTION pos_etims_save_profile(
  p_business_id uuid, p_kra_pin text, p_environment text, p_branch_id text, p_device_serial text, p_vat_registered boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); v_pin text := upper(btrim(coalesce(p_kra_pin,''))); v_row lb_etims_config;
BEGIN
  PERFORM pos_require('settings.manage');
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No business in this session.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'This business is not yours.' USING ERRCODE = '42501';
  END IF;
  -- Only the shape we can be sure of is checked. KRA's exact PIN format is verified against the spec in Phase 3.
  IF v_pin = '' OR v_pin ~ '\s' THEN RAISE EXCEPTION 'PIN_INVALID: enter the business KRA PIN with no spaces' USING ERRCODE = '22023'; END IF;
  IF p_environment NOT IN ('sandbox','production') THEN RAISE EXCEPTION 'ENVIRONMENT_INVALID' USING ERRCODE = '22023'; END IF;

  INSERT INTO lb_etims_config (tenant_id, business_id, kra_pin, environment, branch_id, device_serial, vat_registered, status)
  VALUES (v_tenant, p_business_id, v_pin, p_environment, nullif(btrim(p_branch_id),''), nullif(btrim(p_device_serial),''), coalesce(p_vat_registered,false), 'WAITING_FOR_KRA')
  ON CONFLICT (business_id) DO UPDATE SET
    -- changing the PIN or environment after a connection invalidates it: the backend must connect again
    status = CASE WHEN lb_etims_config.kra_pin IS DISTINCT FROM EXCLUDED.kra_pin OR lb_etims_config.environment IS DISTINCT FROM EXCLUDED.environment
                  THEN 'WAITING_FOR_KRA' ELSE lb_etims_config.status END,
    enabled = CASE WHEN lb_etims_config.kra_pin IS DISTINCT FROM EXCLUDED.kra_pin OR lb_etims_config.environment IS DISTINCT FROM EXCLUDED.environment
                   THEN false ELSE lb_etims_config.enabled END,
    has_comm_key = CASE WHEN lb_etims_config.kra_pin IS DISTINCT FROM EXCLUDED.kra_pin OR lb_etims_config.environment IS DISTINCT FROM EXCLUDED.environment
                        THEN false ELSE lb_etims_config.has_comm_key END,
    kra_pin = EXCLUDED.kra_pin, environment = EXCLUDED.environment, branch_id = EXCLUDED.branch_id,
    device_serial = EXCLUDED.device_serial, vat_registered = EXCLUDED.vat_registered, updated_at = now()
  RETURNING * INTO v_row;

  BEGIN
    INSERT INTO pos_audit_log (pos_tenant_id, actor_type, actor_id, action, entity_type, entity_id)
    VALUES (v_tenant, 'staff', nullif(auth.jwt() ->> 'pos_staff_id','')::uuid, 'ETIMS_PROFILE_SAVED', 'lb_etims_config', v_row.id);
  EXCEPTION WHEN OTHERS THEN NULL;   -- an audit gap must not undo a saved profile (same rule as saleService)
  END;
  RETURN jsonb_build_object('ok', true, 'status', v_row.status, 'environment', v_row.environment, 'enabled', v_row.enabled);
END $$;
REVOKE ALL ON FUNCTION pos_etims_save_profile(uuid,text,text,text,text,boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pos_etims_save_profile(uuid,text,text,text,text,boolean) TO authenticated;

-- Per-product KRA codes. Any value is accepted as text, but only if it exists in the synced KRA list for this business's environment
-- (once a list has been synced). Before the first sync the lists are empty and the call is refused for a non-empty code.
CREATE OR REPLACE FUNCTION pos_etims_set_item_codes(p_business_id uuid, p_product_id uuid, p_codes jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); v_env text; k text; v text; v_list text; v_row lb_etims_item_map;
        v_map jsonb := '{"tax_code":"tax_type","item_class_code":"item_class","unit_code":"unit","packaging_code":"packaging","origin_country_code":"country"}';
BEGIN
  PERFORM pos_require('products.manage', 'settings.manage');
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'No business in this session.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'This business is not yours.' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM lb_products WHERE id = p_product_id AND tenant_id = v_tenant) THEN RAISE EXCEPTION 'ITEM_NOT_FOUND' USING ERRCODE = 'P0002'; END IF;
  SELECT environment INTO v_env FROM lb_etims_config WHERE business_id = p_business_id;
  IF v_env IS NULL THEN RAISE EXCEPTION 'ETIMS_NOT_SET_UP: set up tax invoices first' USING ERRCODE = 'P0001'; END IF;

  FOR k, v IN SELECT key, value #>> '{}' FROM jsonb_each(p_codes) LOOP
    IF NOT (v_map ? k) THEN RAISE EXCEPTION 'UNKNOWN_FIELD: %', k USING ERRCODE = '22023'; END IF;
    v_list := v_map ->> k;
    -- list names above are OUR labels for where a code is cached; the sync function (Phase 3) stores each KRA list under them
    IF coalesce(btrim(v),'') <> '' AND NOT EXISTS (SELECT 1 FROM lb_etims_code_lists WHERE environment = v_env AND list_name = v_list AND code = v) THEN
      RAISE EXCEPTION 'CODE_NOT_IN_KRA_LIST: % is not in the % list from KRA', v, v_list USING ERRCODE = '22023';
    END IF;
  END LOOP;

  INSERT INTO lb_etims_item_map (tenant_id, business_id, product_id, tax_code, item_class_code, unit_code, packaging_code, origin_country_code)
  VALUES (v_tenant, p_business_id, p_product_id, nullif(btrim(p_codes->>'tax_code'),''), nullif(btrim(p_codes->>'item_class_code'),''),
          nullif(btrim(p_codes->>'unit_code'),''), nullif(btrim(p_codes->>'packaging_code'),''), nullif(btrim(p_codes->>'origin_country_code'),''))
  ON CONFLICT (product_id) DO UPDATE SET
    tax_code = CASE WHEN p_codes ? 'tax_code' THEN nullif(btrim(p_codes->>'tax_code'),'') ELSE lb_etims_item_map.tax_code END,
    item_class_code = CASE WHEN p_codes ? 'item_class_code' THEN nullif(btrim(p_codes->>'item_class_code'),'') ELSE lb_etims_item_map.item_class_code END,
    unit_code = CASE WHEN p_codes ? 'unit_code' THEN nullif(btrim(p_codes->>'unit_code'),'') ELSE lb_etims_item_map.unit_code END,
    packaging_code = CASE WHEN p_codes ? 'packaging_code' THEN nullif(btrim(p_codes->>'packaging_code'),'') ELSE lb_etims_item_map.packaging_code END,
    origin_country_code = CASE WHEN p_codes ? 'origin_country_code' THEN nullif(btrim(p_codes->>'origin_country_code'),'') ELSE lb_etims_item_map.origin_country_code END,
    -- any change to the codes means KRA must be told again
    registration_status = 'NOT_REGISTERED', registration_error = NULL, updated_at = now()
  RETURNING * INTO v_row;
  RETURN jsonb_build_object('ok', true, 'id', v_row.id, 'registration_status', v_row.registration_status);
END $$;
REVOKE ALL ON FUNCTION pos_etims_set_item_codes(uuid,uuid,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pos_etims_set_item_codes(uuid,uuid,jsonb) TO authenticated;

-- What the setup card and the receipt badge need, with nothing sensitive (PIN masked, no key, no snapshot).
CREATE OR REPLACE FUNCTION pos_etims_my_status(p_business_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tenant uuid := get_current_tenant_id(); c lb_etims_config; v_pending int; v_attention int;
BEGIN
  IF v_tenant IS NULL OR NOT EXISTS (SELECT 1 FROM lb_businesses WHERE id = p_business_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'This business is not yours.' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO c FROM lb_etims_config WHERE business_id = p_business_id;
  IF c.id IS NULL THEN RETURN jsonb_build_object('configured', false, 'status', 'NOT_CONFIGURED', 'enabled', false); END IF;
  SELECT count(*) FILTER (WHERE status IN ('PENDING','SENDING','SENT_UNCONFIRMED')),
         count(*) FILTER (WHERE status = 'REJECTED')
    INTO v_pending, v_attention FROM lb_etims_invoices WHERE business_id = p_business_id;
  RETURN jsonb_build_object('configured', true, 'status', c.status, 'enabled', c.enabled, 'environment', c.environment,
    'pin_masked', CASE WHEN length(c.kra_pin) > 4 THEN repeat('•', length(c.kra_pin) - 4) || right(c.kra_pin, 4) ELSE '••••' END,
    'vat_registered', c.vat_registered, 'prices_include_tax', c.prices_include_tax, 'has_comm_key', c.has_comm_key,
    'last_success_at', c.last_success_at, 'last_error', c.last_error, 'pending', v_pending, 'needs_attention', v_attention);
END $$;
REVOKE ALL ON FUNCTION pos_etims_my_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION pos_etims_my_status(uuid) TO authenticated;
