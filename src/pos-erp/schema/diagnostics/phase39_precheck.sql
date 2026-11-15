-- phase39_precheck.sql -- READ ONLY. Run on staging/production BEFORE phase39_mpesa_manual_and_prompt.sql.
-- Every query below must return ZERO rows. Rows = an M-Pesa code already used more than once; the unique index cannot be
-- created until a human has decided what each one is. Never delete or edit financial rows to make this pass.

-- 1. M-Pesa codes on more than one payment (compared the way the index compares: letters/digits only, upper case)
SELECT tenant_id,
       upper(regexp_replace(reference_no, '[^A-Za-z0-9]', '', 'g')) AS code,
       count(*) AS payments, array_agg(id) AS payment_ids, array_agg(sale_id) AS sale_ids
  FROM lb_payments
 WHERE payment_method = 'MOBILE_MONEY' AND reference_no IS NOT NULL AND btrim(reference_no) <> ''
 GROUP BY 1, 2 HAVING count(*) > 1;

-- 2. The same M-Pesa receipt on more than one prompted request
SELECT tenant_id, upper(mpesa_receipt_number) AS code, count(*) AS requests, array_agg(id) AS txn_ids
  FROM lb_mpesa_transactions WHERE mpesa_receipt_number IS NOT NULL
 GROUP BY 1, 2 HAVING count(*) > 1;

-- 3. (information) the demo account records two sales with the reference "DEMO-MPESA"; those rows show up in query 1 on any
--    demo tenant created before this change. Re-create the demo, or give each its own reference by hand.

-- 4. (information) manual M-Pesa payments with NO code at all. They are not blocked by the index (blank codes are exempt)
--    but the daily reconciliation already warns about them.
SELECT count(*) AS mpesa_payments_without_code FROM lb_payments
 WHERE payment_method = 'MOBILE_MONEY' AND coalesce(btrim(reference_no), '') = '';
