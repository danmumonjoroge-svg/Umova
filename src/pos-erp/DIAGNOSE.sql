-- DIAGNOSE.sql -- finds out WHY a successful M-Pesa prompt is not turned into a sale.
-- Safe: it ALWAYS ends with an error, which rolls everything back. Nothing is saved, no sale, no stock change.
-- Run it in the Supabase SQL editor. The error message it shows is the answer: send it to me.
-- It picks your newest prompt that never received a result (e.g. the 08:23 "No reply" one) and replays a
-- successful Safaricom confirmation for it with a fake code (DIAGTEST01).
DO $$
DECLARE
  r record;
  res jsonb;
  m text; st text; ctx text; det text;
BEGIN
  SELECT * INTO r FROM lb_mpesa_transactions
   WHERE rent_invoice_id IS NULL AND result_code IS NULL AND status IN ('PENDING', 'NEEDS_ATTENTION')
   ORDER BY requested_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'DIAG: no unanswered prompt found to test with. Send one prompt, let it time out, run this again.'; END IF;

  BEGIN
    res := confirm_mpesa_payment(
      r.checkout_request_id, 0, 'diag', 'DIAGTEST01',
      jsonb_build_object('Body', jsonb_build_object('stkCallback', jsonb_build_object(
        'ResultCode', 0,
        'CallbackMetadata', jsonb_build_object('Item', jsonb_build_array(
          jsonb_build_object('Name', 'Amount', 'Value', r.amount),
          jsonb_build_object('Name', 'MpesaReceiptNumber', 'Value', 'DIAGTEST01')))))));
    RAISE EXCEPTION 'DIAG: confirm_mpesa_payment WORKED for request % (rolled back). Result: %', r.id, res;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS ctx = PG_EXCEPTION_CONTEXT, det = PG_EXCEPTION_DETAIL;
    m := SQLERRM; st := SQLSTATE;
    RAISE EXCEPTION 'DIAG RESULT -> message: % | sqlstate: % | detail: % | where: %', m, st, coalesce(det, '-'), ctx;
  END;
END $$;
