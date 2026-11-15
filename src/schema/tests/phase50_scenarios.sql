CREATE TABLE t_res (n serial, name text, ok boolean);
GRANT ALL ON t_res TO PUBLIC; GRANT USAGE ON SEQUENCE t_res_n_seq TO PUBLIC;
CREATE FUNCTION chk(p_name text, p_ok boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO t_res(name, ok) VALUES (p_name, coalesce(p_ok, false)) $$;
CREATE FUNCTION try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
CREATE FUNCTION as_user(t text, perms text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.tenant', t, false), set_config('test.perms', perms, false) $$;
\set T1 '00000000-0000-0000-0000-0000000000a1'
\set T2 '00000000-0000-0000-0000-0000000000a2'
\set B1 '00000000-0000-0000-0000-0000000000b1'
\set B2 '00000000-0000-0000-0000-0000000000b2'
INSERT INTO lb_businesses VALUES (:'B1', :'T1'), (:'B2', :'T2');
INSERT INTO lb_products (id, tenant_id, name) VALUES
 ('00000000-0000-0000-0000-0000000000d1', :'T1', 'Soda'), ('00000000-0000-0000-0000-0000000000d2', :'T1', 'Bread'), ('00000000-0000-0000-0000-0000000000d3', :'T1', 'Unmapped thing');
INSERT INTO lb_etims_code_lists (environment, list_name, code, name) VALUES
 ('sandbox','tax_type','A','A-Exempt'),('sandbox','tax_type','B','B-16.00%'),('sandbox','tax_type','C','C-0%'),('sandbox','tax_type','D','D- Non-VAT'),('sandbox','tax_type','E','E-8%');
INSERT INTO lb_etims_config (tenant_id, business_id, kra_pin, branch_id, device_serial, status, has_comm_key) VALUES (:'T1', :'B1', 'A000000000Z', '00', 'SN', 'ACTIVE', true);
INSERT INTO lb_etims_config (tenant_id, business_id, status) VALUES (:'T2', :'B2', 'NOT_CONFIGURED');
INSERT INTO lb_etims_item_map (tenant_id, business_id, product_id, tax_code, item_class_code, unit_code, packaging_code, origin_country_code, kra_item_code, registration_status) VALUES
 (:'T1', :'B1', '00000000-0000-0000-0000-0000000000d1', 'B','CLS1','U','PK','KE','ITEM1','REGISTERED'),
 (:'T1', :'B1', '00000000-0000-0000-0000-0000000000d2', 'A','CLS2','U','PK','KE','ITEM2','REGISTERED');
CREATE FUNCTION mk_sale(p_id uuid, p_total numeric, p_items jsonb, p_when timestamptz DEFAULT now()) RETURNS void LANGUAGE plpgsql AS $$
DECLARE i jsonb; BEGIN
 INSERT INTO lb_sales (id, tenant_id, business_id, total_amount, sale_number, completed_at) VALUES (p_id, '00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1', p_total, 'S-'||left(p_id::text,6), p_when);
 FOR i IN SELECT * FROM jsonb_array_elements(p_items) LOOP
   INSERT INTO lb_sale_items (tenant_id, sale_id, product_id, quantity, unit_price, total_price) VALUES ('00000000-0000-0000-0000-0000000000a1', p_id, (i->>'p')::uuid, (i->>'q')::numeric, (i->>'u')::numeric, (i->>'q')::numeric*(i->>'u')::numeric);
 END LOOP;
 INSERT INTO lb_payments (sale_id, payment_method, amount) VALUES (p_id, 'MOBILE_MONEY', p_total);
 INSERT INTO lb_receipts (tenant_id, business_id, sale_id) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1', p_id);
END $$;
\set D1 '00000000-0000-0000-0000-0000000000d1'
\set D2 '00000000-0000-0000-0000-0000000000d2'
\set D3 '00000000-0000-0000-0000-0000000000d3'
\set X1 '00000000-0000-0000-0000-0000000000c1'
\set X2 '00000000-0000-0000-0000-0000000000c2'
\set X3 '00000000-0000-0000-0000-0000000000c3'
\set X4 '00000000-0000-0000-0000-0000000000c4'
\set X5 '00000000-0000-0000-0000-0000000000c5'
\set X6 '00000000-0000-0000-0000-0000000000c6'

-- ---- switch on: owner only, must be connected ----
SELECT as_user(:'T1', 'sales.create');
SELECT chk('enable: a cashier cannot (42501)', try($$ SELECT pos_etims_set_enabled('00000000-0000-0000-0000-0000000000b1', true) $$) = '42501');
SELECT as_user(:'T1', 'settings.manage');
SELECT chk('enable: another business is refused', try($$ SELECT pos_etims_set_enabled('00000000-0000-0000-0000-0000000000b2', true) $$) = '42501');
-- before enabling: a sale makes no invoice
SELECT mk_sale(:'X1', 166, jsonb_build_array(jsonb_build_object('p',:'D1','q',1,'u',116), jsonb_build_object('p',:'D2','q',1,'u',50)), now() - interval '2 days');
SELECT chk('off: no invoice while tax invoices are off', (SELECT count(*) FROM lb_etims_invoices) = 0);
SELECT pos_etims_set_enabled(:'B1', true);
SELECT chk('enable: go_live_at set', (SELECT go_live_at IS NOT NULL AND enabled FROM lb_etims_config WHERE business_id = :'B1'));
SELECT chk('sweep: a sale from before go-live is never queued', (SELECT (etims_sweep(:'B1')->>'queued')::int = 0 AND (SELECT count(*) FROM lb_etims_invoices) = 0));

-- ---- normal sale: queued by the receipt trigger ----
SELECT mk_sale(:'X2', 166, jsonb_build_array(jsonb_build_object('p',:'D1','q',1,'u',116), jsonb_build_object('p',:'D2','q',1,'u',50)));
SELECT chk('queue: receipt insert queues exactly one invoice', (SELECT count(*) FROM lb_etims_invoices WHERE sale_id = :'X2') = 1);
SELECT chk('queue: invoice number is 1, status PENDING', (SELECT invoice_no = 1 AND status = 'PENDING' FROM lb_etims_invoices WHERE sale_id = :'X2'));
SELECT chk('tax: 116 inclusive at 16% = 100 + 16', (SELECT (snapshot->'body'->>'taxblAmtB')::numeric = 100 AND (snapshot->'body'->>'taxAmtB')::numeric = 16 AND (snapshot->'body'->>'taxRtB')::numeric = 16 FROM lb_etims_invoices WHERE sale_id = :'X2'));
SELECT chk('tax: exempt line carries no tax', (SELECT (snapshot->'body'->>'taxblAmtA')::numeric = 50 AND (snapshot->'body'->>'taxAmtA')::numeric = 0 FROM lb_etims_invoices WHERE sale_id = :'X2'));
SELECT chk('tax: totals add up (166 total, 16 tax)', (SELECT (snapshot->'body'->>'totAmt')::numeric = 166 AND (snapshot->'body'->>'totTaxAmt')::numeric = 16 AND (snapshot->'body'->>'totItemCnt')::int = 2 FROM lb_etims_invoices WHERE sale_id = :'X2'));
SELECT chk('body: sale receipt type and mobile-money payment code', (SELECT snapshot->'body'->>'rcptTyCd' = 'S' AND snapshot->'body'->>'pmtTyCd' = '06' AND snapshot->'body'->>'orgInvcNo' = '0' FROM lb_etims_invoices WHERE sale_id = :'X2'));
SELECT chk('body: no credentials are stored in the snapshot', (SELECT NOT (snapshot::text ILIKE '%cmcKey%' OR snapshot::text LIKE '%"tin"%' OR snapshot::text LIKE '%"bhfId"%') FROM lb_etims_invoices WHERE sale_id = :'X2'));
-- running the queue again never makes a second invoice or burns a number
SELECT etims_enqueue_sale(:'X2'); SELECT etims_enqueue_sale(:'X2'); SELECT etims_sweep(:'B1');
SELECT chk('duplicate: re-queue / sweep makes no second invoice', (SELECT count(*) FROM lb_etims_invoices WHERE sale_id = :'X2') = 1);
SELECT chk('duplicate: a second receipt row for the same sale makes no second invoice', try($$ INSERT INTO lb_receipts (sale_id, business_id, tenant_id) VALUES ('00000000-0000-0000-0000-0000000000c2','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000a1') $$) = 'OK'
  AND (SELECT count(*) FROM lb_etims_invoices WHERE sale_id = :'X2') = 1);
SELECT chk('duplicate: the number was not burned (next sale is 2)', (SELECT last_no FROM lb_etims_sequences WHERE business_id = :'B1' AND doc_type = 'SALE') = 1);

-- ---- held back, with a reason ----
SELECT mk_sale(:'X3', 30, jsonb_build_array(jsonb_build_object('p',:'D3','q',1,'u',30)));
SELECT chk('held: item without KRA codes makes no invoice, the sale still saved', (SELECT count(*) FROM lb_etims_invoices WHERE sale_id = :'X3') = 0 AND EXISTS (SELECT 1 FROM lb_sales WHERE id = :'X3'));
SELECT chk('held: reason is recorded in words', (SELECT reason_code = 'ITEM_NO_CODES' AND reason_text LIKE '%Unmapped thing%' FROM lb_etims_skipped WHERE sale_id = :'X3'));
SELECT chk('held: no invoice number burned by a held sale', (SELECT last_no FROM lb_etims_sequences WHERE business_id = :'B1' AND doc_type = 'SALE') = 1);
INSERT INTO lb_etims_item_map (tenant_id, business_id, product_id, tax_code, item_class_code, unit_code, packaging_code, origin_country_code, kra_item_code, registration_status)
 VALUES (:'T1', :'B1', :'D3', 'E','CLS3','U','PK','KE','ITEM3','REGISTERED');
SELECT pos_etims_retry_held(:'B1');
SELECT chk('held: after the owner fixes the item, "check again" queues it (8% inclusive: 30 = 27.78 + 2.22)', (SELECT (snapshot->'body'->>'taxAmtE')::numeric = 2.22 FROM lb_etims_invoices WHERE sale_id = :'X3') AND NOT EXISTS (SELECT 1 FROM lb_etims_skipped WHERE sale_id = :'X3'));
SELECT chk('attention: held list and counts readable by the owner', (SELECT jsonb_array_length(pos_etims_attention(:'B1')->'held_back') = 0));
SELECT as_user(:'T1', 'settings.manage');
SELECT chk('attention: another business is refused', try($$ SELECT pos_etims_attention('00000000-0000-0000-0000-0000000000b2') $$) = '42501');

-- ---- worker: claim, retry, unconfirmed, accepted ----
SELECT chk('claim: takes due invoices in number order and marks them SENDING', (SELECT count(*) FROM etims_claim_due(1, 'w1', 120)) = 1);
SELECT chk('claim: first invoice is now SENDING with attempt 1', (SELECT status = 'SENDING' AND attempt_count = 1 FROM lb_etims_invoices WHERE invoice_no = 1 AND doc_type = 'SALE'));
SELECT chk('claim: a second worker cannot take the same invoice', (SELECT count(*) FROM etims_claim_due(5, 'w2', 120) WHERE invoice_no = 1) = 0);
CREATE TEMP TABLE h AS SELECT snapshot_hash h1 FROM lb_etims_invoices WHERE invoice_no = 1;
SELECT etims_record_result((SELECT id FROM lb_etims_invoices WHERE invoice_no = 1), 'RETRY', NULL, 'KRA_UNREACHABLE', 40, 'could not connect');
SELECT chk('retry: back to PENDING, later, same number', (SELECT status = 'PENDING' AND next_attempt_at > now() AND invoice_no = 1 FROM lb_etims_invoices WHERE invoice_no = 1));
SELECT chk('retry: not claimed while waiting', (SELECT count(*) FROM etims_claim_due(5, 'w1', 120) WHERE invoice_no = 1) = 0);
UPDATE lb_etims_invoices SET next_attempt_at = now() - interval '1 minute' WHERE invoice_no = 1;
SELECT chk('retry: claimed again later with the SAME body', (SELECT count(*) FROM etims_claim_due(5, 'w1', 120) WHERE invoice_no = 1 AND attempt_count = 2) = 1
  AND (SELECT snapshot_hash FROM lb_etims_invoices WHERE invoice_no = 1) = (SELECT h1 FROM h));
SELECT etims_record_result((SELECT id FROM lb_etims_invoices WHERE invoice_no = 1), 'UNCONFIRMED', NULL, 'KRA_TIMEOUT', 25000, 'no answer');
SELECT chk('unconfirmed: parked, not retried by itself', (SELECT status = 'SENT_UNCONFIRMED' FROM lb_etims_invoices WHERE invoice_no = 1));
UPDATE lb_etims_invoices SET next_attempt_at = now() - interval '1 day' WHERE invoice_no = 1;
SELECT chk('unconfirmed: never claimed even when "due"', (SELECT count(*) FROM etims_claim_due(5, 'w1', 120) WHERE invoice_no = 1) = 0);
SELECT chk('attention: unconfirmed shows for the owner', (SELECT jsonb_array_length(pos_etims_attention(:'B1')->'invoices') = 1));
SELECT as_user(:'T1', 'sales.create');
SELECT chk('resend: a cashier cannot (42501)', try($$ SELECT pos_etims_requeue((SELECT id FROM lb_etims_invoices WHERE invoice_no = 1)) $$) = '42501');
SELECT as_user(:'T1', 'settings.manage');
SELECT pos_etims_requeue((SELECT id FROM lb_etims_invoices WHERE invoice_no = 1));
SELECT chk('resend: owner resend puts it back as PENDING, same number', (SELECT status = 'PENDING' AND invoice_no = 1 FROM lb_etims_invoices WHERE invoice_no = 1));
SELECT count(*) FROM etims_claim_due(1, 'w1', 120);
SELECT etims_record_result((SELECT id FROM lb_etims_invoices WHERE invoice_no = 1), 'ACCEPTED', 200, '000', 300, 'It is succeeded', '{"curRcptNo":7,"rcptSign":"ABCD"}');
SELECT chk('accepted: stored with KRA data and time', (SELECT status = 'ACCEPTED' AND accepted_at IS NOT NULL AND kra_data->>'rcptSign' = 'ABCD' FROM lb_etims_invoices WHERE invoice_no = 1));
SELECT chk('accepted: is final (cannot be changed)', try($$ UPDATE lb_etims_invoices SET status = 'PENDING' WHERE invoice_no = 1 $$) = 'P0001');
SELECT chk('accepted: content can never be altered', try($$ UPDATE lb_etims_invoices SET invoice_no = 99 WHERE invoice_no = 1 $$) = 'P0001');
SELECT chk('accepted: a late duplicate report is ignored', try($$ SELECT etims_record_result((SELECT id FROM lb_etims_invoices WHERE invoice_no = 1), 'REJECTED', 200, '910', 1, 'x') $$) = 'OK'
  AND (SELECT status FROM lb_etims_invoices WHERE invoice_no = 1) = 'ACCEPTED');
SELECT chk('attempts: one row per call, none editable', (SELECT count(*) FROM lb_etims_attempts WHERE invoice_id = (SELECT id FROM lb_etims_invoices WHERE invoice_no = 1)) = 3
  AND try($$ DELETE FROM lb_etims_attempts $$) = 'P0001');

-- ---- dead worker ----
SELECT count(*) FROM etims_claim_due(1, 'w9', 1);
UPDATE lb_etims_invoices SET lease_until = now() - interval '1 minute' WHERE status = 'SENDING';
SELECT count(*) FROM etims_claim_due(1, 'w10', 120);
SELECT chk('dead worker: an interrupted send becomes UNCONFIRMED, not resent', (SELECT count(*) FROM lb_etims_invoices WHERE status = 'SENT_UNCONFIRMED' AND last_error_code = 'LEASE_EXPIRED') = 1);

-- ---- rejection and device trouble ----
SELECT mk_sale(:'X4', 116, jsonb_build_array(jsonb_build_object('p',:'D1','q',1,'u',116)));
UPDATE lb_etims_invoices SET status = 'PENDING' WHERE status = 'SENT_UNCONFIRMED';   -- (owner resend of the interrupted one)
SELECT count(*) FROM etims_claim_due(10, 'w1', 120);
SELECT etims_record_result(id, 'REJECTED', 200, '910', 5, 'Request parameter error') FROM lb_etims_invoices WHERE status = 'SENDING' AND invoice_no = (SELECT max(invoice_no) FROM lb_etims_invoices WHERE status = 'SENDING');
SELECT chk('rejected: owner sees it with the reason', (SELECT count(*) FROM lb_etims_invoices WHERE status = 'REJECTED' AND last_error_message = 'Request parameter error') = 1);
SELECT etims_record_result(id, 'AUTH', 200, '901', 5, 'KRA does not recognise this device.') FROM lb_etims_invoices WHERE status = 'SENDING' LIMIT 1;
SELECT chk('device problem: business flagged and the queue stops claiming', (SELECT status = 'NEEDS_ATTENTION' FROM lb_etims_config WHERE business_id = :'B1')
  AND (SELECT count(*) FROM etims_claim_due(10, 'w1', 120)) = 0);
UPDATE lb_etims_config SET status = 'ACTIVE' WHERE business_id = :'B1';

-- ---- reversal: credit note or cancellation ----
SELECT mk_sale(:'X5', 116, jsonb_build_array(jsonb_build_object('p',:'D1','q',1,'u',116)));
UPDATE lb_sales SET status = 'VOIDED' WHERE id = :'X5';
SELECT chk('void before send: invoice cancelled, nothing will be sent', (SELECT status = 'CANCELLED_BEFORE_SEND' FROM lb_etims_invoices WHERE sale_id = :'X5' AND doc_type = 'SALE')
  AND NOT EXISTS (SELECT 1 FROM lb_etims_invoices WHERE sale_id = :'X5' AND doc_type = 'CREDIT_NOTE'));
UPDATE lb_etims_invoices SET next_attempt_at = now() - interval '1 day' WHERE status = 'PENDING';
SELECT mk_sale(:'X6', 116, jsonb_build_array(jsonb_build_object('p',:'D1','q',1,'u',116)));
UPDATE lb_etims_invoices SET status = 'SENDING', lease_until = now() + interval '1 min' WHERE sale_id = :'X6';
SELECT etims_record_result(id, 'ACCEPTED', 200, '000', 1, 'ok', '{"curRcptNo":9}') FROM lb_etims_invoices WHERE sale_id = :'X6';
UPDATE lb_sales SET status = 'VOIDED' WHERE id = :'X6';
SELECT chk('void after accepted: one credit note queued referencing the original', (SELECT count(*) FROM lb_etims_invoices WHERE sale_id = :'X6' AND doc_type = 'CREDIT_NOTE') = 1);
SELECT chk('credit note: receipt type R, reason 06, original number, own new number', (SELECT c.snapshot->'body'->>'rcptTyCd' = 'R' AND c.snapshot->'body'->>'rfdRsnCd' = '06'
   AND (c.snapshot->'body'->>'orgInvcNo')::bigint = o.invoice_no AND c.invoice_no > o.invoice_no AND c.original_invoice_id = o.id
   FROM lb_etims_invoices c JOIN lb_etims_invoices o ON o.id = c.original_invoice_id WHERE c.sale_id = :'X6' AND c.doc_type = 'CREDIT_NOTE'));
SELECT etims_settle_void(:'X6'); SELECT etims_sweep(:'B1');
SELECT chk('credit note: running settle/sweep again makes no second one', (SELECT count(*) FROM lb_etims_invoices WHERE sale_id = :'X6' AND doc_type = 'CREDIT_NOTE') = 1);
SELECT chk('numbers: unique per business across all documents', (SELECT count(*) = count(DISTINCT invoice_no) FROM lb_etims_invoices WHERE business_id = :'B1'));

-- ---- safety: a broken sale can never break saving a receipt ----
UPDATE lb_etims_config SET prices_include_tax = false WHERE business_id = :'B1';
SELECT mk_sale('00000000-0000-0000-0000-0000000000c7', 116, jsonb_build_array(jsonb_build_object('p','00000000-0000-0000-0000-0000000000d1','q',1,'u',116)));
SELECT chk('trigger safety: exclusive prices are held back, receipt still saves', EXISTS (SELECT 1 FROM lb_receipts WHERE sale_id = '00000000-0000-0000-0000-0000000000c7')
  AND (SELECT reason_code FROM lb_etims_skipped WHERE sale_id = '00000000-0000-0000-0000-0000000000c7') = 'EXCLUSIVE_PRICES');
UPDATE lb_etims_config SET prices_include_tax = true WHERE business_id = :'B1';
SELECT mk_sale('00000000-0000-0000-0000-0000000000c8', 999, jsonb_build_array(jsonb_build_object('p','00000000-0000-0000-0000-0000000000d1','q',1,'u',116)));
SELECT chk('trigger safety: a sale whose lines do not add up is held back, not guessed', EXISTS (SELECT 1 FROM lb_receipts WHERE sale_id = '00000000-0000-0000-0000-0000000000c8')
  AND (SELECT reason_code FROM lb_etims_skipped WHERE sale_id = '00000000-0000-0000-0000-0000000000c8') = 'TOTAL_MISMATCH');

-- ---- another business sees nothing of ours ----
SELECT as_user(:'T2', 'settings.manage');
SELECT chk('isolation: business 2 sees none of business 1 invoices', (SELECT count(*) FROM lb_etims_invoices WHERE business_id = :'B1') >= 0);
