-- ============================================================================
-- ELIMU FINANCE  E003  Payments, allocation, M-Pesa duplicate protection, confirmation, receipts.
--
-- A payment row can exist as PENDING without being money: it touches NO ledger, NO invoice, NO receipt until CONFIRMED.
--   CASH   : confirmed on entry (the cashier is holding it)              [unless a cashier session is required and not open]
--   MPESA  : confirmed on entry ONLY when proven (the code is found in the POS Paybill inbox with a matching amount);
--            a typed code that cannot be proven stays PENDING until an approver confirms it (setting-controlled).
--   BANK / CHEQUE / OTHER : PENDING until an approver confirms (setting-controlled).
-- Allocation = a separate append-only table. A payment can never be allocated beyond its amount; an invoice never beyond its total.
-- Reuses: lb_mpesa_c2b_payments (Paybill inbox, written only via the documented contract), lb_payments / lb_mpesa_transactions
-- (read-only duplicate checks), next_doc_number() for receipt numbers.  NO Daraja code lives here.
-- Requires E001, E002. Re-runnable.
-- ============================================================================

-- ---------- credit sources other than payments (E004 adds the table; allocation refers to it by type) ----------
CREATE TABLE IF NOT EXISTS elimu_fin_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES lb_businesses(id),
  student_id uuid NOT NULL,
  receipt_no text,                                           -- issued only at confirmation
  client_reference text,                                     -- idempotency key (double tap / offline replay)
  method text NOT NULL CHECK (method IN ('CASH','MPESA','BANK','CHEQUE','OTHER')),
  method_detail text CHECK (method_detail IN ('MANUAL_CODE','C2B_INBOX','STK','TRANSFER','DEPOSIT','CHEQUE','OTHER')),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  payment_date date NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','CONFIRMED','FAILED','REVERSED')),
  confirmation_basis text CHECK (confirmation_basis IN ('CASH_RECEIVED','C2B_MATCH','STK_CALLBACK','MANUAL_ATTESTATION','BANK_STATEMENT')),
  confirmed_by uuid, confirmed_at timestamptz,
  transaction_ref text,                                      -- as typed / received
  ref_norm text,                                             -- upper-case letters+digits only (duplicate detection)
  bank_account text, deposit_slip_ref text,
  payer_name text, payer_phone text, notes text,
  cashier_id uuid, session_id uuid,
  c2b_id uuid, mpesa_txn_id uuid,
  allocated numeric(15,2) NOT NULL DEFAULT 0 CHECK (allocated >= 0),   -- cache of active allocations
  refunded numeric(15,2) NOT NULL DEFAULT 0 CHECK (refunded >= 0),     -- credit paid back out of this payment (E004 refunds)
  reconciliation_id uuid, reconciled_at timestamptz,
  failure_reason text,
  -- snapshots for the receipt (survive class changes / leaving)
  admission_no text NOT NULL, student_name text NOT NULL, class_name text, guardian_name text, guardian_email text,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (business_id, student_id) REFERENCES elimu_fin_students (business_id, student_id),
  CONSTRAINT elimu_fin_pay_alloc_cap CHECK (allocated + refunded <= amount),
  CONSTRAINT elimu_fin_pay_confirmed_has_basis CHECK (status NOT IN ('CONFIRMED') OR (confirmation_basis IS NOT NULL AND confirmed_at IS NOT NULL AND receipt_no IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_fin_pay_receipt ON elimu_fin_payments (business_id, receipt_no) WHERE receipt_no IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_fin_pay_client_ref ON elimu_fin_payments (business_id, client_reference) WHERE client_reference IS NOT NULL;
-- the same bank/M-Pesa/cheque reference can never be live twice. C2B-linked rows are exempt only because one inbox payment may legitimately be
-- split across siblings; that case is capped by the inbox's own amount_used in _elimu_fin_consume_c2b().
CREATE UNIQUE INDEX IF NOT EXISTS uq_elimu_fin_pay_ref_live ON elimu_fin_payments (business_id, method, ref_norm)
  WHERE ref_norm IS NOT NULL AND c2b_id IS NULL AND status IN ('PENDING','CONFIRMED');
CREATE INDEX IF NOT EXISTS idx_elimu_fin_pay_student ON elimu_fin_payments (business_id, student_id, payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_elimu_fin_pay_date ON elimu_fin_payments (business_id, payment_date, status);
CREATE INDEX IF NOT EXISTS idx_elimu_fin_pay_pending ON elimu_fin_payments (business_id, created_at) WHERE status = 'PENDING';

-- core money columns are frozen once written (status/allocated/reconciliation change only through our functions)
CREATE OR REPLACE FUNCTION _elimu_fin_pay_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Payments are never deleted. Reverse the payment instead.' USING ERRCODE = '42501'; END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.student_id IS DISTINCT FROM OLD.student_id OR NEW.method IS DISTINCT FROM OLD.method
     OR NEW.business_id IS DISTINCT FROM OLD.business_id OR NEW.payment_date IS DISTINCT FROM OLD.payment_date THEN
    RAISE EXCEPTION 'A payment''s amount, student, method and date cannot be edited. Reverse it and record a new one.' USING ERRCODE = '42501';
  END IF;
  IF OLD.status = 'REVERSED' THEN RAISE EXCEPTION 'A reversed payment cannot change.' USING ERRCODE = '42501'; END IF;
  IF OLD.status = 'CONFIRMED' AND NEW.status NOT IN ('CONFIRMED','REVERSED') THEN RAISE EXCEPTION 'A confirmed payment can only be reversed.' USING ERRCODE = '42501'; END IF;
  IF OLD.status = 'FAILED' AND NEW.status <> 'FAILED' THEN RAISE EXCEPTION 'A failed payment cannot be revived. Record a new one.' USING ERRCODE = '42501'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_fin_pay_guard ON elimu_fin_payments;
CREATE TRIGGER trg_elimu_fin_pay_guard BEFORE UPDATE OR DELETE ON elimu_fin_payments FOR EACH ROW EXECUTE FUNCTION _elimu_fin_pay_guard();

-- ---------- allocations: append-only; released (not deleted) when undone ----------
CREATE TABLE IF NOT EXISTS elimu_fin_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  business_id uuid NOT NULL,
  student_id uuid NOT NULL,
  source_type text NOT NULL CHECK (source_type IN ('PAYMENT','ADJUSTMENT')),
  source_id uuid NOT NULL,                                   -- elimu_fin_payments.id or elimu_fin_adjustments.id
  invoice_id uuid NOT NULL REFERENCES elimu_fin_invoices(id),
  amount numeric(15,2) NOT NULL CHECK (amount > 0),
  mode text NOT NULL CHECK (mode IN ('AUTO','MANUAL','CREDIT_APPLIED')),
  policy text,
  allocated_by uuid, allocated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz, released_by uuid, release_reason text
);
CREATE INDEX IF NOT EXISTS idx_elimu_fin_alloc_source ON elimu_fin_allocations (source_type, source_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_elimu_fin_alloc_invoice ON elimu_fin_allocations (invoice_id) WHERE released_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_elimu_fin_alloc_student ON elimu_fin_allocations (business_id, student_id);

CREATE OR REPLACE FUNCTION _elimu_fin_alloc_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Allocations are never deleted; they are released with a reason.' USING ERRCODE = '42501'; END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW.invoice_id IS DISTINCT FROM OLD.invoice_id OR NEW.source_id IS DISTINCT FROM OLD.source_id
     OR NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.student_id IS DISTINCT FROM OLD.student_id THEN
    RAISE EXCEPTION 'An allocation cannot be edited. Release it and allocate again.' USING ERRCODE = '42501';
  END IF;
  IF OLD.released_at IS NOT NULL THEN RAISE EXCEPTION 'A released allocation cannot change.' USING ERRCODE = '42501'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_elimu_fin_alloc_guard ON elimu_fin_allocations;
CREATE TRIGGER trg_elimu_fin_alloc_guard BEFORE UPDATE OR DELETE ON elimu_fin_allocations FOR EACH ROW EXECUTE FUNCTION _elimu_fin_alloc_guard();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['elimu_fin_payments','elimu_fin_allocations'] LOOP PERFORM _elimu_fin_secure(t, 'view'); END LOOP;
END $$;

-- ---------- invoice cache refresh ----------
CREATE OR REPLACE FUNCTION _elimu_fin_refresh_invoice(p_invoice uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_set numeric; inv elimu_fin_invoices%ROWTYPE;
BEGIN
  SELECT * INTO inv FROM elimu_fin_invoices WHERE id = p_invoice;
  IF NOT FOUND OR inv.status = 'CANCELLED' THEN RETURN; END IF;
  SELECT coalesce(sum(amount),0) INTO v_set FROM elimu_fin_allocations WHERE invoice_id = p_invoice AND released_at IS NULL;
  UPDATE elimu_fin_invoices SET settled = v_set, updated_at = now(),
         status = CASE WHEN v_set >= total AND total > 0 THEN 'PAID' WHEN v_set > 0 THEN 'PARTIALLY_PAID' ELSE 'ISSUED' END
   WHERE id = p_invoice;
END $$;

-- unallocated amount of a credit source (payment confirmed amount, or adjustment amount) minus its active allocations
CREATE OR REPLACE FUNCTION _elimu_fin_source_free(p_type text, p_id uuid) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_amt numeric; v_used numeric;
BEGIN
  IF p_type = 'PAYMENT' THEN SELECT CASE WHEN status = 'CONFIRMED' THEN amount - refunded ELSE 0 END INTO v_amt FROM elimu_fin_payments WHERE id = p_id;
  ELSE EXECUTE 'SELECT CASE WHEN status = ''APPLIED'' THEN amount ELSE 0 END FROM elimu_fin_adjustments WHERE id = $1' INTO v_amt USING p_id; END IF;
  SELECT coalesce(sum(amount),0) INTO v_used FROM elimu_fin_allocations WHERE source_type = p_type AND source_id = p_id AND released_at IS NULL;
  RETURN coalesce(v_amt,0) - v_used;
END $$;

-- ---------- the ONE allocation primitive ----------
-- Locks the source and the invoice, checks both caps, writes the allocation, refreshes caches, posts the GL move.
CREATE OR REPLACE FUNCTION _elimu_fin_allocate_one(p_type text, p_source uuid, p_invoice uuid, p_amount numeric, p_mode text, p_policy text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE inv elimu_fin_invoices%ROWTYPE; v_free numeric; v_id uuid; v_student uuid; v_biz uuid; v_tenant uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'Allocation amount must be above zero.'; END IF;
  IF p_type = 'PAYMENT' THEN
    SELECT student_id, business_id, tenant_id INTO v_student, v_biz, v_tenant FROM elimu_fin_payments WHERE id = p_source FOR UPDATE;
  ELSE
    EXECUTE 'SELECT student_id, business_id, tenant_id FROM elimu_fin_adjustments WHERE id = $1 FOR UPDATE' INTO v_student, v_biz, v_tenant USING p_source;
  END IF;
  IF v_student IS NULL THEN RAISE EXCEPTION 'Payment or adjustment not found.'; END IF;
  SELECT * INTO inv FROM elimu_fin_invoices WHERE id = p_invoice FOR UPDATE;
  IF NOT FOUND OR inv.business_id <> v_biz OR inv.student_id <> v_student THEN RAISE EXCEPTION 'That invoice does not belong to the same student.'; END IF;
  IF inv.status = 'CANCELLED' THEN RAISE EXCEPTION 'That invoice is cancelled.'; END IF;
  v_free := _elimu_fin_source_free(p_type, p_source);
  IF p_amount > v_free THEN RAISE EXCEPTION 'Only KES % of this is still unallocated (tried KES %). The same money cannot be allocated twice.', v_free, p_amount; END IF;
  IF p_amount > inv.outstanding THEN RAISE EXCEPTION 'Invoice % only has KES % outstanding (tried KES %).', inv.invoice_no, inv.outstanding, p_amount; END IF;
  INSERT INTO elimu_fin_allocations (tenant_id, business_id, student_id, source_type, source_id, invoice_id, amount, mode, policy, allocated_by)
  VALUES (v_tenant, v_biz, v_student, p_type, p_source, p_invoice, p_amount, p_mode, p_policy, _elimu_fin_staff()) RETURNING id INTO v_id;
  IF p_type = 'PAYMENT' THEN UPDATE elimu_fin_payments SET allocated = allocated + p_amount WHERE id = p_source; END IF;
  PERFORM _elimu_fin_refresh_invoice(p_invoice);
  -- GL: the credit held as a liability moves to settle the receivable
  PERFORM _elimu_fin_gl('ALLOCATION', 'ALLOCATION', v_id, _elimu_fin_today(),
    jsonb_build_array(jsonb_build_object('account_key','STUDENT_CREDIT_LIABILITY','debit',p_amount,'credit',0),
                      jsonb_build_object('account_key','STUDENT_RECEIVABLES','debit',0,'credit',p_amount)), v_biz);
  PERFORM _elimu_fin_audit('PAYMENT_ALLOCATED', 'elimu_fin_allocations', v_id,
    jsonb_build_object('new', jsonb_build_object('source_type', p_type, 'source_id', p_source, 'invoice', inv.invoice_no, 'amount', p_amount, 'mode', p_mode)));
  RETURN v_id;
END $$;

-- release (undo) every active allocation on an invoice: money returns to the student's credit (no ledger change needed:
-- allocation is matching, the ledger balance is unaffected).  Returns the amount released.
CREATE OR REPLACE FUNCTION _elimu_fin_release_allocations(p_invoice uuid, p_reason text) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a elimu_fin_allocations%ROWTYPE; v_total numeric := 0;
BEGIN
  FOR a IN SELECT * FROM elimu_fin_allocations WHERE invoice_id = p_invoice AND released_at IS NULL ORDER BY allocated_at FOR UPDATE LOOP
    v_total := v_total + _elimu_fin_release_one(a.id, p_reason);
  END LOOP;
  RETURN v_total;
END $$;

CREATE OR REPLACE FUNCTION _elimu_fin_release_one(p_alloc uuid, p_reason text) RETURNS numeric
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE a elimu_fin_allocations%ROWTYPE;
BEGIN
  SELECT * INTO a FROM elimu_fin_allocations WHERE id = p_alloc AND released_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  UPDATE elimu_fin_allocations SET released_at = now(), released_by = _elimu_fin_staff(), release_reason = p_reason WHERE id = a.id;
  IF a.source_type = 'PAYMENT' THEN UPDATE elimu_fin_payments SET allocated = allocated - a.amount WHERE id = a.source_id; END IF;
  PERFORM _elimu_fin_refresh_invoice(a.invoice_id);
  PERFORM _elimu_fin_gl('ALLOCATION_RELEASED', 'ALLOCATION_REL', a.id, _elimu_fin_today(),
    jsonb_build_array(jsonb_build_object('account_key','STUDENT_RECEIVABLES','debit',a.amount,'credit',0),
                      jsonb_build_object('account_key','STUDENT_CREDIT_LIABILITY','debit',0,'credit',a.amount)), a.business_id);
  PERFORM _elimu_fin_audit('ALLOCATION_RELEASED', 'elimu_fin_allocations', a.id, jsonb_build_object('previous', jsonb_build_object('amount', a.amount, 'invoice_id', a.invoice_id), 'reason', p_reason));
  RETURN a.amount;
END $$;

-- ---------- automatic allocation of every free credit source against open invoices, per the school's policy ----------
CREATE OR REPLACE FUNCTION _elimu_fin_allocate_student(p_business uuid, p_student uuid, p_only_source uuid DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  st elimu_fin_settings%ROWTYPE; src record; inv record; v_free numeric; v_take numeric; v_done numeric := 0; v_cur uuid;
BEGIN
  st := _elimu_fin_settings(p_business);
  IF st.allocation_policy = 'MANUAL_ONLY' THEN RETURN 0; END IF;
  SELECT id INTO v_cur FROM elimu_fin_periods WHERE business_id = p_business AND is_current LIMIT 1;
  FOR src IN
    SELECT 'PAYMENT'::text AS stype, p.id, p.confirmed_at AS at FROM elimu_fin_payments p
     WHERE p.business_id = p_business AND p.student_id = p_student AND p.status = 'CONFIRMED' AND (p_only_source IS NULL OR p.id = p_only_source)
    UNION ALL
    SELECT 'ADJUSTMENT', a.id, a.applied_at FROM elimu_fin_adjustments a
     WHERE a.business_id = p_business AND a.student_id = p_student AND a.status = 'APPLIED' AND (p_only_source IS NULL OR a.id = p_only_source)
    ORDER BY 3, 2
  LOOP
    v_free := _elimu_fin_source_free(src.stype, src.id);
    IF v_free <= 0 THEN CONTINUE; END IF;
    FOR inv IN
      SELECT i.id, i.outstanding FROM elimu_fin_invoices i
       WHERE i.business_id = p_business AND i.student_id = p_student AND i.status IN ('ISSUED','PARTIALLY_PAID') AND i.outstanding > 0
         AND (src.stype <> 'ADJUSTMENT' OR coalesce((SELECT a.target_invoice_id FROM elimu_fin_adjustments a WHERE a.id = src.id), i.id) = i.id)
       ORDER BY CASE WHEN st.allocation_policy = 'CURRENT_TERM_FIRST' AND i.period_id = v_cur THEN 0 ELSE 1 END, i.due_date, i.created_at, i.id
    LOOP
      EXIT WHEN v_free <= 0;
      v_take := least(v_free, inv.outstanding);
      IF v_take > 0 THEN
        PERFORM _elimu_fin_allocate_one(src.stype, src.id, inv.id, v_take, 'AUTO', st.allocation_policy);
        v_free := v_free - v_take; v_done := v_done + v_take;
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_done;
END $$;

-- ---------- manual allocation (authorised staff) ----------
CREATE OR REPLACE FUNCTION elimu_fin_allocate(p_source_type text, p_source uuid, p_invoice uuid, p_amount numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid; v_biz uuid;
BEGIN
  PERFORM _elimu_fin_require('approve');
  SELECT business_id INTO v_biz FROM elimu_fin_invoices WHERE id = p_invoice AND tenant_id = get_current_tenant_id();
  IF v_biz IS NULL THEN RAISE EXCEPTION 'Invoice not found.'; END IF;
  IF upper(p_source_type) NOT IN ('PAYMENT','ADJUSTMENT') THEN RAISE EXCEPTION 'Unknown source type.'; END IF;
  v_id := _elimu_fin_allocate_one(upper(p_source_type), p_source, p_invoice, p_amount, 'MANUAL', NULL);
  RETURN jsonb_build_object('ok', true, 'allocation_id', v_id);
END $$;

CREATE OR REPLACE FUNCTION elimu_fin_release_allocation(p_alloc uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_amt numeric;
BEGIN
  PERFORM _elimu_fin_require('approve');
  IF length(btrim(coalesce(p_reason,''))) < 3 THEN RAISE EXCEPTION 'A reason is required.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM elimu_fin_allocations WHERE id = p_alloc AND tenant_id = get_current_tenant_id()) THEN RAISE EXCEPTION 'Allocation not found.'; END IF;
  v_amt := _elimu_fin_release_one(p_alloc, p_reason);
  RETURN jsonb_build_object('ok', true, 'released', v_amt);
END $$;

-- ---------- M-Pesa: normalise + duplicate checks across the POS and Elimu ----------
CREATE OR REPLACE FUNCTION _elimu_fin_norm_ref(p text) RETURNS text LANGUAGE sql IMMUTABLE
AS $$ SELECT nullif(upper(regexp_replace(coalesce(p,''), '[^A-Za-z0-9]', '', 'g')), '') $$;

-- Safaricom M-Pesa codes are 10 characters, letters+digits (e.g. QGH7K2L9MN). We reject obviously malformed codes
-- rather than guess: a typo'd code would otherwise defeat duplicate detection.
CREATE OR REPLACE FUNCTION _elimu_fin_valid_mpesa_code(p text) RETURNS boolean LANGUAGE sql IMMUTABLE
AS $$ SELECT p ~ '^[A-Z0-9]{10}$' AND p ~ '[A-Z]' AND p ~ '[0-9]' $$;

CREATE OR REPLACE FUNCTION _elimu_fin_mpesa_seen_in_pos(p_tenant uuid, p_code text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF to_regclass('public.lb_payments') IS NOT NULL AND EXISTS (
       SELECT 1 FROM lb_payments p WHERE p.tenant_id = p_tenant AND upper(regexp_replace(coalesce(p.reference_no,''), '[^A-Za-z0-9]', '', 'g')) = p_code) THEN
    RETURN 'a POS sale or payment'; END IF;
  IF to_regclass('public.lb_mpesa_transactions') IS NOT NULL AND EXISTS (
       SELECT 1 FROM lb_mpesa_transactions t WHERE t.tenant_id = p_tenant AND upper(coalesce(t.mpesa_receipt_number,'')) = p_code) THEN
    RETURN 'an M-Pesa prompt transaction'; END IF;
  RETURN NULL;
END $$;

-- consume part of a Paybill-inbox payment (the documented write contract on the POS table; mirrors pos_apply_mpesa_c2b)
CREATE OR REPLACE FUNCTION _elimu_fin_consume_c2b(p_c2b uuid, p_amount numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE c lb_mpesa_c2b_payments%ROWTYPE; v_left numeric;
BEGIN
  SELECT * INTO c FROM lb_mpesa_c2b_payments WHERE id = p_c2b AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That Paybill payment was not found.'; END IF;
  IF c.status NOT IN ('NEW','PARTLY_USED') THEN RAISE EXCEPTION 'M-Pesa payment % is already %: it cannot be used again.', c.trans_id, lower(replace(c.status,'_',' ')); END IF;
  v_left := c.amount - c.amount_used;
  IF p_amount > v_left THEN RAISE EXCEPTION 'You can use at most KES % of M-Pesa payment %.', v_left, c.trans_id; END IF;
  PERFORM set_config('pos.c2b_apply', 'on', true);       -- the POS "manual use" trigger must not mark our own write
  UPDATE lb_mpesa_c2b_payments SET amount_used = amount_used + p_amount,
         status = CASE WHEN amount_used + p_amount >= amount THEN 'USED' ELSE 'PARTLY_USED' END, updated_at = now() WHERE id = c.id;
END $$;

CREATE OR REPLACE FUNCTION _elimu_fin_return_c2b(p_c2b uuid, p_amount numeric) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM set_config('pos.c2b_apply', 'on', true);
  UPDATE lb_mpesa_c2b_payments SET amount_used = greatest(amount_used - p_amount, 0),
         status = CASE WHEN greatest(amount_used - p_amount,0) = 0 THEN 'NEW' ELSE 'PARTLY_USED' END, updated_at = now()
   WHERE id = p_c2b AND tenant_id = get_current_tenant_id() AND status <> 'IGNORED';
END $$;

-- suggestions from the Paybill inbox: account number typed by the payer is matched to an admission number
CREATE OR REPLACE FUNCTION elimu_fin_c2b_inbox(p_business uuid, p_limit int DEFAULT 50)
RETURNS TABLE (c2b_id uuid, trans_id text, amount numeric, left_amount numeric, trans_time timestamptz, payer_name text, bill_ref_number text,
               suggested_student_id uuid, suggested_admission_no text, suggested_name text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM _elimu_fin_require('collect'); PERFORM _elimu_fin_tenant_of(p_business);
  RETURN QUERY
    SELECT c.id, c.trans_id, c.amount, c.amount - c.amount_used, c.trans_time, c.payer_name, c.bill_ref_number,
           s.student_id, s.admission_no, s.full_name
      FROM lb_mpesa_c2b_payments c
      LEFT JOIN elimu_fin_students s ON s.business_id = p_business
           AND upper(regexp_replace(s.admission_no, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(coalesce(c.bill_ref_number,''), '[^A-Za-z0-9]', '', 'g'))
     WHERE c.tenant_id = get_current_tenant_id() AND c.business_id = p_business AND c.status IN ('NEW','PARTLY_USED')
     ORDER BY c.trans_time DESC LIMIT least(greatest(p_limit,1), 200);
END $$;

-- ---------- the payment recorder (every channel goes through here) ----------
CREATE OR REPLACE FUNCTION elimu_fin_record_payment(
  p_business uuid, p_student uuid, p_method text, p_amount numeric, p_payment_date date DEFAULT NULL,
  p_transaction_ref text DEFAULT NULL, p_bank_account text DEFAULT NULL, p_deposit_slip_ref text DEFAULT NULL,
  p_payer_name text DEFAULT NULL, p_payer_phone text DEFAULT NULL, p_notes text DEFAULT NULL,
  p_client_reference text DEFAULT NULL, p_c2b_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  st elimu_fin_settings%ROWTYPE; s elimu_fin_students%ROWTYPE; pay elimu_fin_payments%ROWTYPE; v_ref text; v_method text := upper(p_method);
  v_detail text; v_status text := 'PENDING'; v_basis text; v_seen text; c lb_mpesa_c2b_payments%ROWTYPE; v_session uuid;
  v_date date := coalesce(p_payment_date, _elimu_fin_today()); v_existing elimu_fin_payments%ROWTYPE; v_can_confirm boolean;
BEGIN
  PERFORM _elimu_fin_require('collect'); PERFORM _elimu_fin_tenant_of(p_business);
  IF p_amount IS NULL OR p_amount <= 0 THEN RAISE EXCEPTION 'The amount must be above zero.'; END IF;
  IF p_amount <> round(p_amount, 2) THEN RAISE EXCEPTION 'The amount can have at most two decimal places.'; END IF;
  IF v_method NOT IN ('CASH','MPESA','BANK','CHEQUE','OTHER') THEN RAISE EXCEPTION 'Unknown payment method.'; END IF;
  IF v_date > _elimu_fin_today() THEN RAISE EXCEPTION 'A payment cannot be dated in the future.'; END IF;

  -- idempotency: same client_reference returns the first result, never a second payment
  IF p_client_reference IS NOT NULL THEN
    SELECT * INTO v_existing FROM elimu_fin_payments WHERE business_id = p_business AND client_reference = p_client_reference;
    IF FOUND THEN RETURN jsonb_build_object('ok', true, 'duplicate_submission', true, 'payment_id', v_existing.id, 'status', v_existing.status, 'receipt_no', v_existing.receipt_no); END IF;
  END IF;

  st := _elimu_fin_settings(p_business);
  SELECT * INTO s FROM elimu_fin_students WHERE business_id = p_business AND student_id = p_student FOR SHARE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'Student not found.'; END IF;
  v_ref := _elimu_fin_norm_ref(p_transaction_ref);
  v_can_confirm := elimu_fin_can('approve');

  IF v_method = 'CASH' THEN
    v_status := 'CONFIRMED'; v_basis := 'CASH_RECEIVED'; v_detail := NULL;
    SELECT id INTO v_session FROM elimu_fin_cashier_sessions WHERE business_id = p_business AND cashier_id = _elimu_fin_staff() AND status = 'OPEN' LIMIT 1;
    IF st.require_session_for_cash AND v_session IS NULL THEN RAISE EXCEPTION 'Open your cashier session before taking cash.'; END IF;
  ELSIF v_method = 'MPESA' THEN
    IF v_ref IS NULL THEN RAISE EXCEPTION 'Enter the M-Pesa transaction code.'; END IF;
    IF NOT _elimu_fin_valid_mpesa_code(v_ref) THEN RAISE EXCEPTION 'That does not look like an M-Pesa code (10 letters and digits, for example QGH7K2L9MN). Check it and try again.'; END IF;
    v_seen := _elimu_fin_mpesa_seen_in_pos(s.tenant_id, v_ref);
    IF v_seen IS NOT NULL THEN RAISE EXCEPTION 'M-Pesa code % is already recorded on %. A code can only be used once.', v_ref, v_seen; END IF;
    SELECT * INTO c FROM lb_mpesa_c2b_payments WHERE tenant_id = s.tenant_id AND business_id = p_business AND trans_id = v_ref FOR UPDATE;
    IF FOUND THEN
      -- the code is in the Paybill inbox: SAFARICOM told us about it, so it can be proven
      IF p_c2b_id IS NOT NULL AND p_c2b_id <> c.id THEN RAISE EXCEPTION 'That code belongs to a different Paybill payment.'; END IF;
      IF c.status NOT IN ('NEW','PARTLY_USED') THEN RAISE EXCEPTION 'M-Pesa code % is already %.', v_ref, lower(replace(c.status,'_',' ')); END IF;
      IF p_amount > c.amount - c.amount_used THEN RAISE EXCEPTION 'Safaricom reports KES % for code % (KES % still unused). The amount you entered is higher.', c.amount, v_ref, c.amount - c.amount_used; END IF;
      v_detail := 'C2B_INBOX'; v_status := 'CONFIRMED'; v_basis := 'C2B_MATCH';
      PERFORM _elimu_fin_consume_c2b(c.id, p_amount);
      p_c2b_id := c.id;
    ELSIF p_c2b_id IS NOT NULL THEN
      RAISE EXCEPTION 'That Paybill payment does not carry this code.';
    ELSE
      v_detail := 'MANUAL_CODE';
      IF EXISTS (SELECT 1 FROM elimu_fin_payments WHERE business_id = p_business AND method = 'MPESA' AND ref_norm = v_ref AND status IN ('PENDING','CONFIRMED')) THEN
        RAISE EXCEPTION 'M-Pesa code % has already been recorded here.', v_ref;
      END IF;
      IF NOT st.manual_mpesa_requires_confirmation AND v_can_confirm THEN v_status := 'CONFIRMED'; v_basis := 'MANUAL_ATTESTATION'; END IF;
    END IF;
  ELSE
    IF v_ref IS NULL AND v_method IN ('BANK','CHEQUE') THEN RAISE EXCEPTION 'Enter the bank / cheque reference.'; END IF;
    v_detail := CASE v_method WHEN 'BANK' THEN CASE WHEN p_deposit_slip_ref IS NOT NULL THEN 'DEPOSIT' ELSE 'TRANSFER' END WHEN 'CHEQUE' THEN 'CHEQUE' ELSE 'OTHER' END;
    IF (v_method = 'BANK' AND NOT st.bank_requires_confirmation OR v_method IN ('CHEQUE','OTHER') AND NOT st.other_requires_confirmation) AND v_can_confirm THEN
      v_status := 'CONFIRMED'; v_basis := 'BANK_STATEMENT';
    END IF;
  END IF;

  INSERT INTO elimu_fin_payments (tenant_id, business_id, student_id, client_reference, method, method_detail, amount, payment_date, status, confirmation_basis,
      confirmed_by, confirmed_at, receipt_no, transaction_ref, ref_norm, bank_account, deposit_slip_ref, payer_name, payer_phone, notes,
      cashier_id, session_id, c2b_id, admission_no, student_name, class_name, guardian_name, guardian_email, created_by)
  VALUES (s.tenant_id, p_business, p_student, p_client_reference, v_method, v_detail, p_amount, v_date, v_status, v_basis,
      CASE WHEN v_status = 'CONFIRMED' THEN _elimu_fin_staff() END, CASE WHEN v_status = 'CONFIRMED' THEN now() END,
      CASE WHEN v_status = 'CONFIRMED' THEN next_doc_number(p_business, 'SFR') END,
      p_transaction_ref, v_ref, p_bank_account, p_deposit_slip_ref, p_payer_name, p_payer_phone, p_notes,
      _elimu_fin_staff(), v_session, p_c2b_id, s.admission_no, s.full_name, s.class_name, s.guardian_name, s.guardian_email, _elimu_fin_staff())
  RETURNING * INTO pay;

  PERFORM _elimu_fin_audit('PAYMENT_RECEIVED', 'elimu_fin_payments', pay.id,
    jsonb_build_object('new', jsonb_build_object('amount', pay.amount, 'method', pay.method, 'status', pay.status, 'student_id', pay.student_id, 'ref', pay.ref_norm)));
  IF v_status = 'CONFIRMED' THEN PERFORM _elimu_fin_on_confirmed(pay.id); END IF;
  SELECT * INTO pay FROM elimu_fin_payments WHERE id = pay.id;
  RETURN jsonb_build_object('ok', true, 'payment_id', pay.id, 'status', pay.status, 'receipt_no', pay.receipt_no,
                            'allocated', pay.allocated, 'unallocated', CASE WHEN pay.status = 'CONFIRMED' THEN pay.amount - pay.allocated ELSE 0 END,
                            'needs_confirmation', pay.status = 'PENDING');
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'This payment (or its reference) has already been recorded.' USING ERRCODE = '23505';
END $$;

-- everything that happens when a payment becomes CONFIRMED: ledger, GL, audit, allocation
CREATE OR REPLACE FUNCTION _elimu_fin_on_confirmed(p_payment uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pay elimu_fin_payments%ROWTYPE; v_cash_key text;
BEGIN
  SELECT * INTO pay FROM elimu_fin_payments WHERE id = p_payment FOR UPDATE;
  IF pay.status <> 'CONFIRMED' THEN RETURN; END IF;
  -- idempotent: the ledger row for this payment exists once
  IF EXISTS (SELECT 1 FROM elimu_fin_ledger WHERE source_type = 'PAYMENT' AND source_id = pay.id AND entry_type = 'PAYMENT') THEN RETURN; END IF;
  PERFORM _elimu_fin_ledger_post(pay.business_id, pay.student_id, 'PAYMENT', -pay.amount, pay.payment_date,
    pay.method || ' payment ' || pay.receipt_no || coalesce(' ref ' || pay.transaction_ref, ''), 'PAYMENT', pay.id);
  v_cash_key := CASE pay.method WHEN 'CASH' THEN 'CASH_ON_HAND' WHEN 'MPESA' THEN 'MPESA_CLEARING' WHEN 'BANK' THEN 'BANK' ELSE 'OTHER_RECEIPTS' END;
  PERFORM _elimu_fin_gl('PAYMENT_CONFIRMED', 'PAYMENT', pay.id, pay.payment_date,
    jsonb_build_array(jsonb_build_object('account_key', v_cash_key, 'debit', pay.amount, 'credit', 0),
                      jsonb_build_object('account_key', 'STUDENT_CREDIT_LIABILITY', 'debit', 0, 'credit', pay.amount)), pay.business_id);
  PERFORM _elimu_fin_audit('RECEIPT_GENERATED', 'elimu_fin_payments', pay.id, jsonb_build_object('new', jsonb_build_object('receipt_no', pay.receipt_no, 'basis', pay.confirmation_basis)));
  PERFORM _elimu_fin_allocate_student(pay.business_id, pay.student_id, pay.id);
END $$;

-- ---------- approver confirms a PENDING payment ----------
CREATE OR REPLACE FUNCTION elimu_fin_confirm_payment(p_payment uuid, p_basis text DEFAULT 'MANUAL_ATTESTATION', p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pay elimu_fin_payments%ROWTYPE;
BEGIN
  PERFORM _elimu_fin_require('approve');
  IF p_basis NOT IN ('MANUAL_ATTESTATION','BANK_STATEMENT') THEN RAISE EXCEPTION 'A person can confirm only against the bank statement or by attestation.'; END IF;
  SELECT * INTO pay FROM elimu_fin_payments WHERE id = p_payment AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  IF pay.status = 'CONFIRMED' THEN RETURN jsonb_build_object('ok', true, 'already_confirmed', true, 'receipt_no', pay.receipt_no); END IF;
  IF pay.status <> 'PENDING' THEN RAISE EXCEPTION 'Only a pending payment can be confirmed (this one is %).', lower(pay.status); END IF;
  IF pay.created_by IS NOT DISTINCT FROM _elimu_fin_staff() AND is_pos_session() AND NOT is_pos_owner() AND pay.method <> 'CASH' THEN
    RAISE EXCEPTION 'A different person must confirm a payment you recorded.' USING ERRCODE = '42501';
  END IF;
  IF pay.method = 'MPESA' AND pay.method_detail = 'MANUAL_CODE' THEN
    IF _elimu_fin_mpesa_seen_in_pos(pay.tenant_id, pay.ref_norm) IS NOT NULL THEN RAISE EXCEPTION 'That M-Pesa code now appears in the POS: it cannot be confirmed here too.'; END IF;
  END IF;
  UPDATE elimu_fin_payments SET status = 'CONFIRMED', confirmation_basis = p_basis, confirmed_by = _elimu_fin_staff(), confirmed_at = now(),
         receipt_no = next_doc_number(pay.business_id, 'SFR'), notes = coalesce(notes || E'\n', '') || coalesce('Confirmed: ' || p_note, 'Confirmed by approver') WHERE id = pay.id;
  PERFORM _elimu_fin_audit('PAYMENT_CONFIRMED', 'elimu_fin_payments', pay.id, jsonb_build_object('previous', 'PENDING', 'new', 'CONFIRMED', 'approval', p_basis, 'reason', p_note));
  PERFORM _elimu_fin_on_confirmed(pay.id);
  SELECT * INTO pay FROM elimu_fin_payments WHERE id = pay.id;
  RETURN jsonb_build_object('ok', true, 'receipt_no', pay.receipt_no, 'allocated', pay.allocated);
END $$;

CREATE OR REPLACE FUNCTION elimu_fin_fail_payment(p_payment uuid, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pay elimu_fin_payments%ROWTYPE;
BEGIN
  PERFORM _elimu_fin_require('approve');
  IF length(btrim(coalesce(p_reason,''))) < 3 THEN RAISE EXCEPTION 'A reason is required.'; END IF;
  SELECT * INTO pay FROM elimu_fin_payments WHERE id = p_payment AND tenant_id = get_current_tenant_id() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  IF pay.status <> 'PENDING' THEN RAISE EXCEPTION 'Only a pending payment can be marked failed; a confirmed one must be reversed.'; END IF;
  UPDATE elimu_fin_payments SET status = 'FAILED', failure_reason = p_reason WHERE id = pay.id;
  IF pay.c2b_id IS NOT NULL THEN PERFORM _elimu_fin_return_c2b(pay.c2b_id, pay.amount); END IF;
  PERFORM _elimu_fin_audit('PAYMENT_FAILED', 'elimu_fin_payments', pay.id, jsonb_build_object('previous','PENDING','new','FAILED','reason',p_reason));
  RETURN jsonb_build_object('ok', true);
END $$;

-- ---------- service-role only: a VERIFIED Daraja STK result confirms a pending fee payment (used by the optional POS patch) ----------
CREATE OR REPLACE FUNCTION elimu_fin_confirm_stk_payment(p_payment uuid, p_mpesa_code text, p_amount numeric, p_mpesa_txn uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pay elimu_fin_payments%ROWTYPE; v_code text := _elimu_fin_norm_ref(p_mpesa_code); v_seen text;
BEGIN
  IF is_pos_session() THEN RAISE EXCEPTION 'Only the payment provider callback can confirm an STK payment.' USING ERRCODE = '42501'; END IF;
  SELECT * INTO pay FROM elimu_fin_payments WHERE id = p_payment FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  IF pay.status = 'CONFIRMED' THEN RETURN jsonb_build_object('ok', true, 'already_confirmed', true); END IF;
  IF pay.status <> 'PENDING' OR pay.method <> 'MPESA' THEN RAISE EXCEPTION 'Not a pending M-Pesa payment.'; END IF;
  -- a provider callback has no tenant in its JWT: scope THIS transaction to the payment's own school so every helper below
  -- (ledger, journal, audit, settings) sees the right tenant. Transaction-local; is_pos_session() stays false.
  PERFORM set_config('request.jwt.claims', jsonb_build_object('pos_tenant_id', pay.tenant_id)::text, true);
  IF v_code IS NULL OR NOT _elimu_fin_valid_mpesa_code(v_code) THEN RAISE EXCEPTION 'The provider did not supply a valid M-Pesa code.'; END IF;
  IF abs(p_amount - pay.amount) > 0.004 THEN RAISE EXCEPTION 'Provider amount (%) does not match the payment (%).', p_amount, pay.amount; END IF;
  v_seen := _elimu_fin_mpesa_seen_in_pos(pay.tenant_id, v_code);
  IF v_seen IS NOT NULL AND NOT EXISTS (SELECT 1 FROM lb_mpesa_transactions t WHERE t.id = p_mpesa_txn AND upper(coalesce(t.mpesa_receipt_number,'')) = v_code) THEN
    RAISE EXCEPTION 'M-Pesa code % is already recorded on %.', v_code, v_seen; END IF;
  UPDATE elimu_fin_payments SET status = 'CONFIRMED', confirmation_basis = 'STK_CALLBACK', confirmed_at = now(), method_detail = 'STK',
         transaction_ref = p_mpesa_code, ref_norm = v_code, mpesa_txn_id = p_mpesa_txn, receipt_no = next_doc_number(pay.business_id, 'SFR') WHERE id = pay.id;
  PERFORM _elimu_fin_audit('PAYMENT_CONFIRMED', 'elimu_fin_payments', pay.id, jsonb_build_object('previous','PENDING','new','CONFIRMED','approval','STK_CALLBACK'));
  PERFORM _elimu_fin_on_confirmed(pay.id);
  RETURN jsonb_build_object('ok', true);
END $$;

-- ---------- receipt data (rendered by the POS print/PDF stack; nothing is stored twice) ----------
CREATE OR REPLACE FUNCTION elimu_fin_receipt_data(p_payment uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE pay elimu_fin_payments%ROWTYPE; b lb_businesses%ROWTYPE; st elimu_fin_settings%ROWTYPE; v_bal numeric; v_items jsonb; v_cashier text;
BEGIN
  PERFORM _elimu_fin_require('view');
  SELECT * INTO pay FROM elimu_fin_payments WHERE id = p_payment AND tenant_id = get_current_tenant_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;
  IF pay.status NOT IN ('CONFIRMED','REVERSED') THEN RAISE EXCEPTION 'No receipt exists for a % payment.', lower(pay.status); END IF;
  SELECT * INTO b FROM lb_businesses WHERE id = pay.business_id;
  SELECT * INTO st FROM elimu_fin_settings WHERE business_id = pay.business_id;
  SELECT balance INTO v_bal FROM elimu_fin_accounts WHERE business_id = pay.business_id AND student_id = pay.student_id;
  SELECT name INTO v_cashier FROM pos_staff WHERE id = coalesce(pay.confirmed_by, pay.cashier_id);
  SELECT coalesce(jsonb_agg(jsonb_build_object('invoice_no', i.invoice_no, 'academic_year', i.academic_year, 'term', i.term, 'amount', a.amount,
           'invoice_outstanding_after', i.outstanding, 'lines', (SELECT coalesce(jsonb_agg(l.description ORDER BY l.line_no),'[]'::jsonb) FROM elimu_fin_invoice_lines l WHERE l.invoice_id = i.id AND l.line_type = 'CHARGE'))
           ORDER BY i.due_date), '[]'::jsonb)
    INTO v_items FROM elimu_fin_allocations a JOIN elimu_fin_invoices i ON i.id = a.invoice_id
   WHERE a.source_type = 'PAYMENT' AND a.source_id = pay.id AND a.released_at IS NULL;
  RETURN jsonb_build_object(
    'school', jsonb_build_object('name', b.name, 'phone', b.phone, 'email', b.email, 'address', b.address, 'logo_url', b.logo_url, 'currency', coalesce(st.currency,'KES')),
    'title', coalesce(st.receipt_title, 'FEE PAYMENT RECEIPT'), 'footer', coalesce(st.receipt_footer, b.receipt_footer),
    'receipt_no', pay.receipt_no, 'payment_id', pay.id, 'status', pay.status, 'reversed', pay.status = 'REVERSED',
    'student', jsonb_build_object('name', pay.student_name, 'admission_no', pay.admission_no, 'class_name', pay.class_name),
    'method', pay.method, 'method_detail', pay.method_detail, 'transaction_ref', pay.transaction_ref, 'bank_account', pay.bank_account, 'deposit_slip_ref', pay.deposit_slip_ref,
    'amount', pay.amount, 'payment_date', pay.payment_date, 'confirmed_at', pay.confirmed_at, 'confirmation_basis', pay.confirmation_basis,
    'received_by', v_cashier, 'payer_name', pay.payer_name,
    'paid_for', v_items, 'unallocated', pay.amount - pay.allocated,
    'balance_after', coalesce(v_bal, 0),                      -- >0 still owed, <0 credit held
    'balance_note', 'Balance is the student''s account balance now; it may have moved since the payment if other entries were posted.');
END $$;

REVOKE ALL ON FUNCTION _elimu_fin_pay_guard(), _elimu_fin_alloc_guard(), _elimu_fin_refresh_invoice(uuid), _elimu_fin_source_free(text,uuid),
  _elimu_fin_allocate_one(text,uuid,uuid,numeric,text,text), _elimu_fin_release_allocations(uuid,text), _elimu_fin_release_one(uuid,text),
  _elimu_fin_allocate_student(uuid,uuid,uuid), _elimu_fin_norm_ref(text), _elimu_fin_valid_mpesa_code(text), _elimu_fin_mpesa_seen_in_pos(uuid,text),
  _elimu_fin_consume_c2b(uuid,numeric), _elimu_fin_return_c2b(uuid,numeric), _elimu_fin_on_confirmed(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION elimu_fin_allocate(text,uuid,uuid,numeric), elimu_fin_release_allocation(uuid,text), elimu_fin_c2b_inbox(uuid,int),
  elimu_fin_record_payment(uuid,uuid,text,numeric,date,text,text,text,text,text,text,text,uuid), elimu_fin_confirm_payment(uuid,text,text),
  elimu_fin_fail_payment(uuid,text), elimu_fin_receipt_data(uuid), elimu_fin_confirm_stk_payment(uuid,text,numeric,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION elimu_fin_allocate(text,uuid,uuid,numeric), elimu_fin_release_allocation(uuid,text), elimu_fin_c2b_inbox(uuid,int),
  elimu_fin_record_payment(uuid,uuid,text,numeric,date,text,text,text,text,text,text,text,uuid), elimu_fin_confirm_payment(uuid,text,text),
  elimu_fin_fail_payment(uuid,text), elimu_fin_receipt_data(uuid) TO authenticated;
-- the STK confirm function is for the provider callback only (service_role), like confirm_mpesa_payment
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
  EXECUTE 'GRANT EXECUTE ON FUNCTION elimu_fin_confirm_stk_payment(uuid,text,numeric,uuid) TO service_role'; END IF; END $$;
