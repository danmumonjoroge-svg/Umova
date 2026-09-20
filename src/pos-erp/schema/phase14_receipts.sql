-- ============================================================
-- Phase 14 -- Sale receipts: print / WhatsApp / email (the "remaining
-- part" of the Sale chain the brief always implied but this project
-- never finished building the UI for).
--
-- saleService.create() has always written an lb_receipts row (JS side).
-- confirm_mpesa_payment() (schema/phase12_mpesa.sql), which creates a
-- sale through a DIFFERENT path (a confirmed M-Pesa callback, not the
-- till's own checkout button), never did -- a real gap, found while
-- building the receipt UI, not before. This migration closes it by
-- redefining that one function to also insert the same shape of
-- lb_receipts row saleService.create() writes, so an M-Pesa sale gets a
-- receipt exactly like a cash/card/credit sale does. Everything else
-- about confirm_mpesa_payment() is unchanged -- copy the function from
-- phase12_mpesa.sql and diff if you want to confirm that.
--
-- Run order: migration #12, after phase13_mpesa_client_credentials.sql.
-- ============================================================

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
  v_subtotal numeric;
  v_receipt_number text;
  v_receipt_items jsonb;
BEGIN
  SELECT * INTO v_txn FROM lb_mpesa_transactions WHERE checkout_request_id = p_checkout_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No M-Pesa transaction found for checkout_request_id %', p_checkout_request_id;
  END IF;

  IF v_txn.status IN ('PAID', 'FAILED', 'CANCELLED', 'TIMED_OUT') THEN
    RETURN jsonb_build_object('already_processed', true, 'status', v_txn.status, 'sale_id', v_txn.sale_id);
  END IF;

  UPDATE lb_mpesa_transactions
  SET result_code = p_result_code, result_desc = p_result_desc, raw_callback = p_raw_callback, updated_at = now()
  WHERE id = v_txn.id;

  IF p_result_code <> 0 THEN
    UPDATE lb_mpesa_transactions
    SET status = CASE WHEN p_result_code = 1032 THEN 'CANCELLED' ELSE 'FAILED' END
    WHERE id = v_txn.id;
    RETURN jsonb_build_object('already_processed', false, 'status', 'FAILED', 'sale_id', NULL);
  END IF;

  SELECT id INTO v_warehouse_id FROM lb_warehouses WHERE business_id = v_txn.business_id AND is_default = true LIMIT 1;
  v_subtotal := COALESCE((SELECT SUM((i->>'quantity')::numeric * (i->>'unit_price')::numeric) FROM jsonb_array_elements(v_txn.cart_snapshot) i), v_txn.amount);

  INSERT INTO lb_sales (
    tenant_id, business_id, cashier_id, shift_id, customer_id, sale_number,
    status, subtotal, discount_total, tax_total, total_amount, notes,
    completed_at, client_reference
  )
  SELECT
    v_txn.tenant_id, v_txn.business_id, v_txn.requested_by, v_txn.shift_id, v_txn.customer_id,
    generate_sale_number(), 'COMPLETED', v_subtotal, 0, 0, v_txn.amount,
    'M-Pesa STK payment — ' || COALESCE(p_mpesa_receipt_number, ''),
    now(), 'MPESA-' || p_checkout_request_id
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

  -- ---- Phase 14: the receipt row (new) ----
  -- Same content-snapshot shape saleService.create() writes on the
  -- normal till path, built here from the SAME cart_snapshot that
  -- created the sale items above, so an M-Pesa receipt looks and reads
  -- identically to a cash/card/credit one -- receiptService.js on the
  -- client doesn't need to know or care which path produced it.
  --
  -- Product NAMES: cart_snapshot carries `name` when the client sent it
  -- (POSPage.jsx's handleMpesaCheckout does, as of this same session's
  -- change). Older or other callers that omit it just get a receipt
  -- line with a null name -- not a crash, same fallback
  -- receiptService.buildReceiptHtml()/buildReceiptText() already handle
  -- on the JS side ("item.name || 'Item'").
  SELECT jsonb_agg(jsonb_build_object(
    'product_id', v_item->>'product_id',
    'name', v_item->>'name',
    'quantity', (v_item->>'quantity')::numeric,
    'unit_price', (v_item->>'unit_price')::numeric,
    'total_price', (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric - COALESCE((v_item->>'discount_amount')::numeric, 0)
  ))
  INTO v_receipt_items
  FROM jsonb_array_elements(v_txn.cart_snapshot) v_item;

  v_receipt_number := 'RCPT-' || to_char(now(), 'YYYYMMDD') || '-' || substr(v_sale_id::text, 1, 8);

  INSERT INTO lb_receipts (tenant_id, business_id, sale_id, receipt_number, receipt_type, receipt_data)
  VALUES (
    v_txn.tenant_id, v_txn.business_id, v_sale_id, v_receipt_number, 'THERMAL',
    jsonb_build_object(
      'sale_number', v_sale_number,
      'items', COALESCE(v_receipt_items, '[]'::jsonb),
      'payments', jsonb_build_array(jsonb_build_object('payment_method', 'MOBILE_MONEY', 'amount', v_txn.amount)),
      'subtotal', v_subtotal, 'discount_total', 0, 'tax_total', 0, 'total_amount', v_txn.amount,
      'completed_at', now()
    )
  );

  UPDATE lb_mpesa_transactions
  SET status = 'PAID', mpesa_receipt_number = p_mpesa_receipt_number, sale_id = v_sale_id, confirmed_at = now()
  WHERE id = v_txn.id;

  RETURN jsonb_build_object('already_processed', false, 'status', 'PAID', 'sale_id', v_sale_id, 'sale_number', v_sale_number);
END;
$$;

-- NOTE, same caveat as phase12_mpesa.sql's own: this generates
-- receipt_number as 'RCPT-<date>-<8 chars of sale id>' rather than
-- calling saleService.js's generateReceiptNumber() (a JS function this
-- SQL function can't call) or a shared SQL sequence -- there is no
-- confirmed shared numbering scheme between the two paths in this
-- codebase. If your live lb_receipts.receipt_number has a uniqueness
-- constraint with a different expected format, adjust this line before
-- running. It IS guaranteed unique (sale_id is a uuid), just not
-- necessarily in the same numbering series as till-created receipts.
