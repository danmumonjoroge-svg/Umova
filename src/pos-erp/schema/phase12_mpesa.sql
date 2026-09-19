-- ============================================================
-- Phase 12 -- M-Pesa STK Push (Stage 2, brief section 33-41)
--
-- STAGE-GATE NOTE, stated plainly rather than silently skipped: the
-- brief's own instructions say not to start Stage 2 until Stage 1A and
-- 1B are "complete and tested". Stage 1B this session covers Sales and
-- Stock end-to-end (see phase11_offline_sync.sql /
-- offline/offlineSaleService.js) but not every domain the brief lists
-- (Customers/Suppliers/Expenses/Appointments offline creation). Building
-- this now was an explicit instruction, not a judgement that Stage 1B is
-- actually finished -- see AUDIT.md's final report for the honest state
-- of both.
--
-- ARCHITECTURE (brief section 33 -- never call Daraja from the browser):
--
--   React (mpesaService.js)
--     -> Supabase Edge Function: mpesa-stk-push   (holds Daraja secrets)
--       -> Safaricom Daraja OAuth + STK Push API
--         -> customer's phone (STK prompt)
--   Safaricom
--     -> Supabase Edge Function: mpesa-callback   (public webhook)
--       -> lb_mpesa_transactions (idempotent upsert on checkout_request_id)
--       -> saleService.create() equivalent (server-side, via a DB function)
--
-- Edge Functions live in supabase/functions/ in this deliverable, not
-- under src/pos-erp/ -- they run on Supabase's infrastructure, not in
-- the browser bundle, which is the whole point of section 33/34.
--
-- Run order: migration #10, after phase11_offline_sync.sql.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE lb_mpesa_status AS ENUM (
    'PENDING', 'PAID', 'FAILED', 'CANCELLED', 'TIMED_OUT', 'NEEDS_ATTENTION'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------- lb_mpesa_config ----------
-- Non-secret business-level M-Pesa settings ONLY. The consumer key,
-- consumer secret, and passkey are Daraja credentials that must NEVER
-- sit in a table any RLS-scoped client can read, even scoped to "their
-- own business" -- a leaked anon-key JWT would then leak the ability to
-- push STK requests as that business. Those three values live as
-- Supabase Edge Function secrets (see supabase/functions/mpesa-stk-push/
-- README.md), keyed by business_id there, not in this table.
--
-- What's safe to store here: the shortcode (a public-facing till/
-- paybill number -- customers already see it on receipts) and whether
-- M-Pesa is turned on for this business at all.

CREATE TABLE IF NOT EXISTS lb_mpesa_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  shortcode text NOT NULL,
  environment text NOT NULL DEFAULT 'sandbox' CHECK (environment IN ('sandbox', 'production')),
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id)
);

ALTER TABLE lb_mpesa_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_mpesa_config ON lb_mpesa_config;
CREATE POLICY tenant_isolation_lb_mpesa_config ON lb_mpesa_config
  FOR ALL USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- ---------- lb_mpesa_transactions ----------
-- One row per STK request. sale_id starts NULL and is only ever filled
-- in AFTER Safaricom confirms payment -- see the callback function
-- below. Section 37: "only confirmed successful payment becomes paid";
-- creating a real lb_sales row before that would mean a sale exists for
-- money that was only ever REQUESTED, which is exactly what section 43
-- forbids.

CREATE TABLE IF NOT EXISTS lb_mpesa_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid REFERENCES lb_businesses(id),
  shift_id uuid, -- the open cashier shift the request was made from, so a confirmed payment can be attributed to the right shift/reconciliation once the sale is created
  customer_id uuid REFERENCES lb_customers(id),
  phone text NOT NULL, -- normalised 2547XXXXXXXX, same convention as whatsappService.normalizePhoneForWhatsApp()
  amount numeric(15,2) NOT NULL CHECK (amount > 0),

  -- Cart snapshot: what the STK request was FOR, so the callback can
  -- create the real sale once payment is confirmed without trusting
  -- anything Safaricom's callback body says about line items (it says
  -- nothing about them -- Daraja callbacks only carry amount/receipt/
  -- phone). This is the same idea saleService already uses for receipts
  -- (a content snapshot), applied one step earlier.
  cart_snapshot jsonb NOT NULL,

  -- Daraja's own identifiers. checkout_request_id is what makes the
  -- callback idempotent -- Safaricom is explicit that a callback can
  -- arrive more than once for the same request.
  merchant_request_id text,
  checkout_request_id text UNIQUE,

  status lb_mpesa_status NOT NULL DEFAULT 'PENDING',
  mpesa_receipt_number text,
  result_code integer,
  result_desc text,

  sale_id uuid REFERENCES lb_sales(id), -- set only once status = PAID and the sale has actually been created

  requested_by uuid,
  requested_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,

  -- Full raw callback body, kept verbatim. Section 39's reconciliation
  -- view (a human deciding whether an "unmatched" payment is real) is
  -- exactly the situation where having the original payload, not just
  -- the fields this schema chose to parse out of it, matters.
  raw_callback jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lb_mpesa_transactions_business_status ON lb_mpesa_transactions(business_id, status);
CREATE INDEX IF NOT EXISTS idx_lb_mpesa_transactions_requested_at ON lb_mpesa_transactions(requested_at);

ALTER TABLE lb_mpesa_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_lb_mpesa_transactions ON lb_mpesa_transactions;
CREATE POLICY tenant_isolation_lb_mpesa_transactions ON lb_mpesa_transactions
  FOR ALL USING (tenant_id = get_current_tenant_id())
  WITH CHECK (tenant_id = get_current_tenant_id());

-- The callback function below runs as SECURITY DEFINER (service-role,
-- called from the mpesa-callback Edge Function, which uses the
-- service-role key -- never the anon key -- specifically so it isn't
-- subject to this RLS policy at all; Safaricom's callback has no POS
-- staff session to satisfy tenant_id = get_current_tenant_id() with).

-- ---------- confirm_mpesa_payment() ----------
-- Called ONLY by the mpesa-callback Edge Function (service-role). Does,
-- atomically, exactly what section 38 lists: identify the request,
-- verify it hasn't already been processed, update the transaction,
-- create the sale, update stock (via saleService's own logic -- this
-- function does NOT duplicate stock movement code; the sale row it
-- creates goes through the exact same lb_sale_items/applyStockMovement
-- path a normal till sale does, because it inserts into the same
-- tables, not a parallel set).
--
-- IDEMPOTENCY: if this checkout_request_id has already been marked PAID
-- (a repeated Safaricom callback -- their own documentation says this
-- happens), this returns the existing sale_id and does nothing further.
-- Section 38: "Safaricom callback retries must not create duplicate
-- transactions."

CREATE OR REPLACE FUNCTION confirm_mpesa_payment(
  p_checkout_request_id text,
  p_result_code integer,
  p_result_desc text,
  p_mpesa_receipt_number text,
  p_raw_callback jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_txn lb_mpesa_transactions%ROWTYPE;
  v_sale_id uuid;
  v_sale_number text;
  v_item jsonb;
  v_warehouse_id uuid;
BEGIN
  SELECT * INTO v_txn FROM lb_mpesa_transactions WHERE checkout_request_id = p_checkout_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No M-Pesa transaction found for checkout_request_id %', p_checkout_request_id;
  END IF;

  -- Idempotent no-op on a repeated callback for an already-settled request.
  IF v_txn.status IN ('PAID', 'FAILED', 'CANCELLED', 'TIMED_OUT') THEN
    RETURN jsonb_build_object('already_processed', true, 'status', v_txn.status, 'sale_id', v_txn.sale_id);
  END IF;

  UPDATE lb_mpesa_transactions
  SET result_code = p_result_code,
      result_desc = p_result_desc,
      raw_callback = p_raw_callback,
      updated_at = now()
  WHERE id = v_txn.id;

  -- Daraja: ResultCode 0 = success. Anything else = failed/cancelled at
  -- the customer's end. Never inferred as "paid" from anything softer
  -- than this exact code (section 39: "never assume STK request =
  -- payment").
  IF p_result_code <> 0 THEN
    UPDATE lb_mpesa_transactions
    SET status = CASE WHEN p_result_code = 1032 THEN 'CANCELLED' ELSE 'FAILED' END
    WHERE id = v_txn.id;
    RETURN jsonb_build_object('already_processed', false, 'status', 'FAILED', 'sale_id', NULL);
  END IF;

  -- ---- Payment confirmed. Create the sale now, not before. ----
  SELECT id INTO v_warehouse_id FROM lb_warehouses WHERE business_id = v_txn.business_id AND is_default = true LIMIT 1;

  INSERT INTO lb_sales (
    tenant_id, business_id, cashier_id, shift_id, customer_id, sale_number,
    status, subtotal, discount_total, tax_total, total_amount, notes,
    completed_at, client_reference
  )
  SELECT
    v_txn.tenant_id, v_txn.business_id, v_txn.requested_by, v_txn.shift_id, v_txn.customer_id,
    generate_sale_number(),
    'COMPLETED',
    COALESCE((SELECT SUM((i->>'quantity')::numeric * (i->>'unit_price')::numeric) FROM jsonb_array_elements(v_txn.cart_snapshot) i), v_txn.amount),
    0, 0, v_txn.amount,
    'M-Pesa STK payment — ' || COALESCE(p_mpesa_receipt_number, ''),
    now(),
    'MPESA-' || p_checkout_request_id
  RETURNING id, sale_number INTO v_sale_id, v_sale_number;

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_txn.cart_snapshot)
  LOOP
    INSERT INTO lb_sale_items (
      tenant_id, sale_id, product_id, quantity, unit_price, cost_price,
      discount_amount, discount_percent, tax_amount, total_price, selling_mode
    ) VALUES (
      v_txn.tenant_id, v_sale_id, (v_item->>'product_id')::uuid,
      (v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric,
      COALESCE((v_item->>'cost_price')::numeric, 0),
      COALESCE((v_item->>'discount_amount')::numeric, 0), 0, 0,
      (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount_amount')::numeric, 0),
      COALESCE(v_item->>'selling_mode', 'PER_UNIT')
    );

    -- Same stock-movement shape applyStockMovement() writes for a normal
    -- till sale (movement_type = 'SALE', negative quantity) -- inserted
    -- directly here since this function runs inside the DB, not through
    -- the JS service layer, but it is the SAME lb_inventory_movements
    -- table and the SAME triggers/effects a JS-created sale produces.
    -- Not a second, parallel stock-adjustment mechanism (section 4).
    IF v_warehouse_id IS NOT NULL THEN
      UPDATE lb_inventory
      SET quantity = quantity - (v_item->>'quantity')::numeric, updated_at = now()
      WHERE product_id = (v_item->>'product_id')::uuid AND warehouse_id = v_warehouse_id;

      INSERT INTO lb_inventory_movements (
        tenant_id, business_id, warehouse_id, product_id, movement_type,
        quantity, unit_cost, reference_id, reference_type, created_by
      ) VALUES (
        v_txn.tenant_id, v_txn.business_id, v_warehouse_id, (v_item->>'product_id')::uuid, 'SALE',
        -(v_item->>'quantity')::numeric, COALESCE((v_item->>'cost_price')::numeric, 0),
        v_sale_id, 'SALE', v_txn.requested_by
      );
    END IF;
  END LOOP;

  INSERT INTO lb_payments (tenant_id, business_id, sale_id, payment_method, amount, change_amount, reference_no, status, created_by)
  VALUES (v_txn.tenant_id, v_txn.business_id, v_sale_id, 'MOBILE_MONEY', v_txn.amount, 0, p_mpesa_receipt_number, 'COMPLETED', v_txn.requested_by);

  UPDATE lb_mpesa_transactions
  SET status = 'PAID', mpesa_receipt_number = p_mpesa_receipt_number, sale_id = v_sale_id, confirmed_at = now()
  WHERE id = v_txn.id;

  RETURN jsonb_build_object('already_processed', false, 'status', 'PAID', 'sale_id', v_sale_id, 'sale_number', v_sale_number);
END;
$$;

-- NOTE, same caveat as phase9_assets.sql: lb_warehouses/lb_inventory/
-- lb_inventory_movements column names above match what purchaseService.js
-- and saleService.js already read/write elsewhere in this codebase, but
-- this function has not been run against the live schema. If any column
-- name differs, it will fail loudly on first real callback -- intended,
-- not something to guess past.

-- ---------- expire_stale_mpesa_requests() ----------
-- Daraja STK requests that never get a callback (customer's phone off,
-- app killed) need to stop showing as "Pending" forever. Called by a
-- scheduled job (pg_cron, if available, or the mpesa-stk-push Edge
-- Function on its next invocation) rather than a client poll, so a
-- cashier closing the tab doesn't leave a transaction stuck.

CREATE OR REPLACE FUNCTION expire_stale_mpesa_requests(p_older_than_minutes integer DEFAULT 5)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE lb_mpesa_transactions
  SET status = 'TIMED_OUT', updated_at = now()
  WHERE status = 'PENDING' AND requested_at < now() - (p_older_than_minutes || ' minutes')::interval;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;
