-- phase39_mpesa_manual_and_prompt.sql   -- NOT YET RUN on any database. Test on STAGING first.
--
-- WHY (M-Pesa audit, one till, two ways to pay):
--   1. DUPLICATE CODES. Nothing in the database stopped one M-Pesa code being used on two sales; the check lived only in
--      the till (read, then write), so two tills could both pass it. A unique index now makes the DATABASE the authority.
--      One index on lb_payments covers manual codes AND prompted payments, because a confirmed prompt also writes an
--      lb_payments row carrying the real M-Pesa receipt code.
--   2. LATE CONFIRMATION. confirm_mpesa_payment() treated TIMED_OUT as final, so a buyer who approved AFTER the till
--      gave up had paid but no sale was ever recorded. A late success on a request nobody has settled is now processed.
--   3. SAFER CONFIRMATION. A success callback is no longer trusted blindly: the callback's Amount must match the amount
--      that was requested, it must carry a receipt code, and that code must not already be on another payment. Anything
--      else is parked as NEEDS_ATTENTION for a human (money is never dropped, never guessed).
--   4. RECEIPT ROW. phase17 re-created confirm_mpesa_payment() from the phase12 body and so dropped the lb_receipts row
--      phase14 had added: an M-Pesa-prompt sale had no receipt. Restored here.
--   5. WHO MAY CONFIGURE / PROMPT. Daraja settings (shortcode, on/off) were writable by any signed-in staff member who could
--      see the business. They now need settings.manage, like every other business setting (phase28 pattern). Sending a
--      prompt needs sales.create or payments.record.
--
-- NO schema is rewritten or deleted and no financial row is changed. Manual vs provider-confirmed is NOT a new column: a
-- payment is provider-confirmed exactly when a PAID row in lb_mpesa_transactions carries the same receipt code (that is how
-- the M-Pesa page already separates "Recorded by cashier" from prompted payments). A typed code is never marked confirmed.
--
-- RUN ORDER: after phase28_permissions.sql, phase30 and phase34. Re-runnable.
-- BEFORE RUNNING: schema/diagnostics/phase39_precheck.sql shows any code already used twice. They do NOT block the migration:
-- the duplicate rule then applies to payments recorded from now on (section 1). Never delete or rewrite those rows.
--
-- ROLLBACK (all additive except the function body):
--   DROP INDEX IF EXISTS uq_lb_payments_mpesa_ref;  DROP INDEX IF EXISTS uq_lb_mpesa_txn_receipt;
--   DROP TRIGGER IF EXISTS trg_pos_perm_lb_mpesa_config_ins ON lb_mpesa_config;  (and _upd, _del; and
--   trg_pos_perm_lb_mpesa_transactions_ins ON lb_mpesa_transactions)
--   Then re-run the confirm_mpesa_payment() definition from phase17_invoices_maintenance.sql and phase34's ALTER/REVOKE/GRANT.

-- ---------- 1. duplicate-code guard ----------
-- Old rows are never touched. If the database ALREADY holds the same code twice (see diagnostics/phase39_precheck.sql), a
-- full unique index is impossible, so the index is created for rows written FROM NOW ON only (cutoff = this moment) and a
-- NOTICE says what was left alone. Nothing is deleted or rewritten; the old duplicates stay visible for the owner to review.
-- With no existing duplicates the index covers every row. To tighten it later: fix the old rows by hand, DROP the index, re-run.
-- tenant-scoped on purpose: a unique index across tenants would let one business learn that another used a code.
DO $$
DECLARE v_cut text := ''; v_cut2 text := ''; v_pay integer; v_txn integer; v_now text := quote_literal(now()::text);
BEGIN
  SELECT count(*) INTO v_pay FROM (
    SELECT 1 FROM lb_payments
     WHERE payment_method = 'MOBILE_MONEY' AND reference_no IS NOT NULL AND btrim(reference_no) <> ''
     GROUP BY tenant_id, upper(regexp_replace(reference_no, '[^A-Za-z0-9]', '', 'g')) HAVING count(*) > 1) d;
  SELECT count(*) INTO v_txn FROM (
    SELECT 1 FROM lb_mpesa_transactions WHERE mpesa_receipt_number IS NOT NULL
     GROUP BY tenant_id, upper(mpesa_receipt_number) HAVING count(*) > 1) d;
  IF v_pay > 0 THEN
    v_cut := ' AND created_at >= ' || v_now || '::timestamptz';
    RAISE NOTICE 'phase39: % M-Pesa code(s) already appear more than once in lb_payments. They are left as they are; the duplicate rule applies to payments recorded from now on. Run diagnostics/phase39_precheck.sql to see them.', v_pay;
  END IF;
  IF v_txn > 0 THEN
    v_cut2 := ' AND created_at >= ' || v_now || '::timestamptz';
    RAISE NOTICE 'phase39: % receipt code(s) already repeat in lb_mpesa_transactions. Left as they are; the rule applies from now on.', v_txn;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_lb_payments_mpesa_ref') THEN
    EXECUTE 'CREATE UNIQUE INDEX uq_lb_payments_mpesa_ref ON lb_payments (tenant_id, (upper(regexp_replace(reference_no, ''[^A-Za-z0-9]'', '''', ''g''))))'
         || ' WHERE payment_method = ''MOBILE_MONEY'' AND reference_no IS NOT NULL AND btrim(reference_no) <> '''''
         || v_cut;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'uq_lb_mpesa_txn_receipt') THEN
    EXECUTE 'CREATE UNIQUE INDEX uq_lb_mpesa_txn_receipt ON lb_mpesa_transactions (tenant_id, (upper(mpesa_receipt_number)))'
         || ' WHERE mpesa_receipt_number IS NOT NULL' || v_cut2;
  END IF;
END $$;

-- ---------- 2. confirm_mpesa_payment(): same signature, same caller (the mpesa-callback Edge Function) ----------
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
  v_inv_result jsonb;
  v_subtotal numeric;
  v_receipt_number text;
  v_receipt_items jsonb;
  v_code text;
  v_cb_amount numeric;
  v_reopen boolean;
  v_dup_sale uuid;
BEGIN
  SELECT * INTO v_txn FROM lb_mpesa_transactions WHERE checkout_request_id = p_checkout_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No M-Pesa transaction found for checkout_request_id %', p_checkout_request_id;
  END IF;

  -- A request the till gave up on (TIMED_OUT, or set aside by hand before any callback) has NOT been settled: the buyer may
  -- still have approved. Only those can still change. PAID / FAILED / CANCELLED, and a NEEDS_ATTENTION that already holds
  -- a callback result, are final: a repeated callback is an idempotent no-op (Safaricom does send duplicates).
  v_reopen := v_txn.status = 'TIMED_OUT' OR (v_txn.status = 'NEEDS_ATTENTION' AND v_txn.result_code IS NULL);
  IF v_txn.status IN ('PAID', 'FAILED', 'CANCELLED') OR (v_txn.status IN ('TIMED_OUT', 'NEEDS_ATTENTION') AND NOT v_reopen) THEN
    RETURN jsonb_build_object('already_processed', true, 'status', v_txn.status, 'sale_id', v_txn.sale_id);
  END IF;

  UPDATE lb_mpesa_transactions
  SET result_code = p_result_code,
      result_desc = p_result_desc,
      raw_callback = p_raw_callback,
      updated_at = now()
  WHERE id = v_txn.id;

  -- Daraja: ResultCode 0 = success. Anything else = failed/cancelled at the customer's end.
  IF p_result_code <> 0 THEN
    UPDATE lb_mpesa_transactions
    SET status = (CASE WHEN p_result_code = 1032 THEN 'CANCELLED' ELSE 'FAILED' END)::lb_mpesa_status
    WHERE id = v_txn.id;
    RETURN jsonb_build_object('already_processed', false, 'status', 'FAILED', 'sale_id', NULL);
  END IF;

  -- ---- Success callback: verify before trusting ----
  v_code := upper(regexp_replace(coalesce(p_mpesa_receipt_number, ''), '[^A-Za-z0-9]', '', 'g'));
  SELECT (i->>'Value')::numeric INTO v_cb_amount
    FROM jsonb_array_elements(coalesce(p_raw_callback #> '{Body,stkCallback,CallbackMetadata,Item}', '[]'::jsonb)) i
   WHERE i->>'Name' = 'Amount' LIMIT 1;

  IF v_code = '' THEN
    -- Confirmed, but no receipt code: never invent one.
    UPDATE lb_mpesa_transactions SET status = 'NEEDS_ATTENTION', confirmed_at = now(),
           result_desc = coalesce(result_desc, '') || ' | Confirmed by Safaricom but no M-Pesa code was supplied: check the Daraja statement before recording it.'
     WHERE id = v_txn.id;
    RETURN jsonb_build_object('already_processed', false, 'status', 'NEEDS_ATTENTION', 'sale_id', NULL);
  END IF;

  IF v_cb_amount IS NOT NULL AND abs(v_cb_amount - v_txn.amount) > 0.5 THEN
    UPDATE lb_mpesa_transactions SET status = 'NEEDS_ATTENTION', mpesa_receipt_number = NULL, confirmed_at = now(),
           result_desc = coalesce(result_desc, '') || ' | Safaricom confirmed KES ' || v_cb_amount || ' (code ' || v_code || ') but KES ' || v_txn.amount || ' was requested. Not applied.'
     WHERE id = v_txn.id;
    RETURN jsonb_build_object('already_processed', false, 'status', 'NEEDS_ATTENTION', 'sale_id', NULL);
  END IF;

  -- The same code already recorded (a cashier typed it, or another request carries it): applying it again would count one
  -- payment twice. Parked for a human, with the sale it is already on.
  SELECT p.sale_id INTO v_dup_sale FROM lb_payments p
   WHERE p.tenant_id = v_txn.tenant_id AND p.payment_method = 'MOBILE_MONEY'
     AND upper(regexp_replace(coalesce(p.reference_no, ''), '[^A-Za-z0-9]', '', 'g')) = v_code LIMIT 1;
  IF FOUND OR EXISTS (SELECT 1 FROM lb_mpesa_transactions t WHERE t.tenant_id = v_txn.tenant_id AND t.id <> v_txn.id AND upper(t.mpesa_receipt_number) = v_code) THEN
    UPDATE lb_mpesa_transactions SET status = 'NEEDS_ATTENTION', mpesa_receipt_number = NULL, confirmed_at = now(),
           result_desc = coalesce(result_desc, '') || ' | M-Pesa code ' || v_code || ' is already recorded' || coalesce(' on sale ' || v_dup_sale::text, '') || '. Not applied a second time.'
     WHERE id = v_txn.id;
    RETURN jsonb_build_object('already_processed', false, 'status', 'NEEDS_ATTENTION', 'sale_id', NULL);
  END IF;

  -- ---- Rent invoice payment (phase17): apply to the invoice, not a sale ----
  IF v_txn.rent_invoice_id IS NOT NULL THEN
    BEGIN
      v_inv_result := record_rent_invoice_payment(
        v_txn.rent_invoice_id, v_txn.amount, 'MOBILE_MONEY', v_code,
        'M-Pesa STK payment', v_txn.requested_by, 'MPESA_PROMPT', v_txn.id);
    EXCEPTION WHEN OTHERS THEN
      UPDATE lb_mpesa_transactions
      SET status = 'NEEDS_ATTENTION', mpesa_receipt_number = v_code, confirmed_at = now(),
          result_desc = COALESCE(result_desc, '') || ' | Received but not applied: ' || SQLERRM
      WHERE id = v_txn.id;
      RETURN jsonb_build_object('already_processed', false, 'status', 'NEEDS_ATTENTION', 'sale_id', NULL);
    END;
    UPDATE lb_mpesa_transactions
    SET status = 'PAID', mpesa_receipt_number = v_code, confirmed_at = now()
    WHERE id = v_txn.id;
    RETURN jsonb_build_object('already_processed', false, 'status', 'PAID', 'sale_id', NULL, 'rent_invoice_id', v_txn.rent_invoice_id);
  END IF;

  -- ---- Payment confirmed. Create the sale now, not before. ----
  SELECT id INTO v_warehouse_id FROM lb_warehouses WHERE business_id = v_txn.business_id AND is_default = true LIMIT 1;
  v_subtotal := COALESCE((SELECT SUM((i->>'quantity')::numeric * (i->>'unit_price')::numeric) FROM jsonb_array_elements(v_txn.cart_snapshot) i), v_txn.amount);

  INSERT INTO lb_sales (
    tenant_id, business_id, cashier_id, shift_id, customer_id, sale_number,
    status, subtotal, discount_total, tax_total, total_amount, notes,
    completed_at, client_reference
  ) VALUES (
    v_txn.tenant_id, v_txn.business_id, v_txn.requested_by, v_txn.shift_id, v_txn.customer_id,
    generate_sale_number(), 'COMPLETED', v_subtotal, 0, 0, v_txn.amount,
    'M-Pesa STK payment — ' || v_code, now(), 'MPESA-' || p_checkout_request_id
  ) RETURNING id, sale_number INTO v_sale_id, v_sale_number;

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
  VALUES (v_txn.tenant_id, v_txn.business_id, v_sale_id, 'MOBILE_MONEY', v_txn.amount, 0, v_code, 'COMPLETED', v_txn.requested_by);

  -- Receipt row (phase14 content snapshot, restored: phase17 had dropped it)
  SELECT jsonb_agg(jsonb_build_object(
    'product_id', i->>'product_id', 'name', i->>'name',
    'quantity', (i->>'quantity')::numeric, 'unit_price', (i->>'unit_price')::numeric,
    'total_price', (i->>'quantity')::numeric * (i->>'unit_price')::numeric - COALESCE((i->>'discount_amount')::numeric, 0)))
  INTO v_receipt_items FROM jsonb_array_elements(v_txn.cart_snapshot) i;

  v_receipt_number := 'RCPT-' || to_char(now(), 'YYYYMMDD') || '-' || substr(v_sale_id::text, 1, 8);
  INSERT INTO lb_receipts (tenant_id, business_id, sale_id, receipt_number, receipt_type, receipt_data)
  VALUES (
    v_txn.tenant_id, v_txn.business_id, v_sale_id, v_receipt_number, 'THERMAL',
    jsonb_build_object(
      'sale_number', v_sale_number, 'items', COALESCE(v_receipt_items, '[]'::jsonb),
      'payments', jsonb_build_array(jsonb_build_object('payment_method', 'MOBILE_MONEY', 'amount', v_txn.amount, 'reference_no', v_code)),
      'subtotal', v_subtotal, 'discount_total', 0, 'tax_total', 0, 'total_amount', v_txn.amount, 'completed_at', now()));

  UPDATE lb_mpesa_transactions
  SET status = 'PAID', mpesa_receipt_number = v_code, sale_id = v_sale_id, confirmed_at = now()
  WHERE id = v_txn.id;

  RETURN jsonb_build_object('already_processed', false, 'status', 'PAID', 'sale_id', v_sale_id, 'sale_number', v_sale_number);
END;
$$;

-- phase34 lockdown, re-applied (CREATE OR REPLACE keeps grants, but the pinned search_path must be set again)
ALTER FUNCTION confirm_mpesa_payment(text, integer, text, text, jsonb) SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION confirm_mpesa_payment(text, integer, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION confirm_mpesa_payment(text, integer, text, text, jsonb) TO service_role;

-- ---------- 3. who may configure Daraja / send a prompt (phase28 trigger pattern; skipped where phase28 is absent) ----------
DO $$
BEGIN
  IF to_regprocedure('pos_enforce_permission()') IS NULL THEN
    RAISE NOTICE 'phase39: phase28 permission helpers not found, trigger step skipped';
    RETURN;
  END IF;
  EXECUTE 'DROP TRIGGER IF EXISTS trg_pos_perm_lb_mpesa_config_ins ON lb_mpesa_config';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_pos_perm_lb_mpesa_config_upd ON lb_mpesa_config';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_pos_perm_lb_mpesa_config_del ON lb_mpesa_config';
  EXECUTE 'CREATE TRIGGER trg_pos_perm_lb_mpesa_config_ins BEFORE INSERT ON lb_mpesa_config FOR EACH ROW EXECUTE FUNCTION pos_enforce_permission(''settings.manage'')';
  EXECUTE 'CREATE TRIGGER trg_pos_perm_lb_mpesa_config_upd BEFORE UPDATE ON lb_mpesa_config FOR EACH ROW EXECUTE FUNCTION pos_enforce_permission(''settings.manage'')';
  EXECUTE 'CREATE TRIGGER trg_pos_perm_lb_mpesa_config_del BEFORE DELETE ON lb_mpesa_config FOR EACH ROW EXECUTE FUNCTION pos_enforce_permission(''settings.manage'')';
  EXECUTE 'DROP TRIGGER IF EXISTS trg_pos_perm_lb_mpesa_transactions_ins ON lb_mpesa_transactions';
  EXECUTE 'CREATE TRIGGER trg_pos_perm_lb_mpesa_transactions_ins BEFORE INSERT ON lb_mpesa_transactions FOR EACH ROW EXECUTE FUNCTION pos_enforce_permission(''sales.create'', ''payments.record'')';
END $$;
