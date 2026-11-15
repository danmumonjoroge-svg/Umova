-- Scenarios for phase48 on a SCRATCH database (run by phase48_run.sh). Results land in t_res.
CREATE TABLE t_res (n serial, name text, ok boolean);
GRANT ALL ON t_res TO PUBLIC; GRANT USAGE ON SEQUENCE t_res_n_seq TO PUBLIC;
CREATE FUNCTION chk(p_name text, p_ok boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO t_res(name, ok) VALUES (p_name, coalesce(p_ok, false)) $$;
CREATE FUNCTION try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
GRANT EXECUTE ON FUNCTION chk(text, boolean), try(text) TO PUBLIC;
CREATE FUNCTION as_user(t text, perms text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.tenant', t, false), set_config('test.perms', perms, false) $$;

\set T1 '00000000-0000-0000-0000-0000000000a1'
\set T2 '00000000-0000-0000-0000-0000000000a2'
\set B1 '00000000-0000-0000-0000-0000000000b1'
\set B2 '00000000-0000-0000-0000-0000000000b2'
\set P1 '00000000-0000-0000-0000-0000000000d1'
\set P2 '00000000-0000-0000-0000-0000000000d2'
\set S1 '00000000-0000-0000-0000-0000000000f1'
\set S2 '00000000-0000-0000-0000-0000000000f2'
INSERT INTO lb_businesses VALUES (:'B1', :'T1'), (:'B2', :'T2');
INSERT INTO lb_products VALUES (:'P1', :'T1'), (:'P2', :'T2');
INSERT INTO lb_sales (id, tenant_id, business_id, total_amount) VALUES (:'S1', :'T1', :'B1', 116), (:'S2', :'T2', :'B2', 50);

-- ---- sequences: atomic, gap-free per business and type ----
SELECT chk('sequence: first number is 1', etims_next_invoice_no(:'B1','SALE') = 1);
SELECT chk('sequence: next is 2', etims_next_invoice_no(:'B1','SALE') = 2);
SELECT chk('sequence: credit notes count separately', etims_next_invoice_no(:'B1','CREDIT_NOTE') = 1);
SELECT chk('sequence: another business starts at 1 (no sharing between businesses)', etims_next_invoice_no(:'B2','SALE') = 1);

-- ---- profile: permission, tenant, validation ----
SELECT as_user(:'T1', 'sales.create');
SELECT chk('profile: a cashier cannot save it (42501)', try($$ SELECT pos_etims_save_profile('00000000-0000-0000-0000-0000000000b1','TESTPIN001','sandbox','00','SN1',true) $$) = '42501');
SELECT as_user(:'T1', 'settings.manage');
SELECT chk('profile: another business is refused (42501)', try($$ SELECT pos_etims_save_profile('00000000-0000-0000-0000-0000000000b2','TESTPIN002','sandbox','00','SN1',true) $$) = '42501');
SELECT chk('profile: blank PIN refused', try($$ SELECT pos_etims_save_profile('00000000-0000-0000-0000-0000000000b1','  ','sandbox','00','SN1',true) $$) = '22023');
SELECT chk('profile: PIN with a space refused', try($$ SELECT pos_etims_save_profile('00000000-0000-0000-0000-0000000000b1','AB CD','sandbox','00','SN1',true) $$) = '22023');
SELECT chk('profile: bad environment refused', try($$ SELECT pos_etims_save_profile('00000000-0000-0000-0000-0000000000b1','TESTPIN001','live','00','SN1',true) $$) = '22023');
SELECT pos_etims_save_profile(:'B1','testpin001','sandbox','00','SN1',true);
SELECT chk('profile: saved, upper-cased, waiting for KRA, NOT enabled',
  (SELECT kra_pin = 'TESTPIN001' AND status = 'WAITING_FOR_KRA' AND enabled = false FROM lb_etims_config WHERE business_id = :'B1'));
SELECT chk('profile: audit row written', (SELECT count(*) FROM pos_audit_log WHERE action = 'ETIMS_PROFILE_SAVED') = 1);
-- backend connects it (service role / owner): simulate
UPDATE lb_etims_config SET enabled = true, status = 'ACTIVE', has_comm_key = true WHERE business_id = :'B1';
SELECT pos_etims_save_profile(:'B1','TESTPIN001','sandbox','00','SN2',true);
SELECT chk('profile: editing the device keeps an active connection',
  (SELECT enabled AND status = 'ACTIVE' AND has_comm_key FROM lb_etims_config WHERE business_id = :'B1'));
SELECT pos_etims_save_profile(:'B1','TESTPIN999','sandbox','00','SN2',true);
SELECT chk('profile: changing the PIN switches it off and clears the key flag',
  (SELECT NOT enabled AND status = 'WAITING_FOR_KRA' AND NOT has_comm_key FROM lb_etims_config WHERE business_id = :'B1'));

-- ---- item codes: only codes that exist in KRA's synced list ----
SELECT chk('item codes: refused before any list is synced', try($$ SELECT pos_etims_set_item_codes('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d1','{"tax_code":"X1"}') $$) = '22023');
INSERT INTO lb_etims_code_lists (environment, list_name, code, name) VALUES ('sandbox','tax_type','X1','Test code one'), ('sandbox','unit','U1','Test unit');
SELECT chk('item codes: a synced code is accepted',
  (pos_etims_set_item_codes(:'B1',:'P1','{"tax_code":"X1","unit_code":"U1"}')->>'ok') = 'true');
SELECT chk('item codes: another tenant''s product refused', try($$ SELECT pos_etims_set_item_codes('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d2','{"tax_code":"X1"}') $$) = 'P0002');
SELECT chk('item codes: unknown field refused', try($$ SELECT pos_etims_set_item_codes('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d1','{"rate":"16"}') $$) = '22023');
UPDATE lb_etims_item_map SET registration_status = 'REGISTERED' WHERE product_id = :'P1';
SELECT pos_etims_set_item_codes(:'B1',:'P1','{"unit_code":"U1"}');
SELECT chk('item codes: a partial update keeps other codes, and a change asks for re-registration',
  (SELECT tax_code = 'X1' AND registration_status = 'NOT_REGISTERED' FROM lb_etims_item_map WHERE product_id = :'P1'));
SELECT as_user(:'T1', 'sales.create');
SELECT chk('item codes: a cashier cannot change them (42501)', try($$ SELECT pos_etims_set_item_codes('00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000d1','{"tax_code":"X1"}') $$) = '42501');

-- ---- invoices: duplicate prevention and immutability ----
RESET ALL;
INSERT INTO lb_etims_invoices (tenant_id, business_id, sale_id, doc_type, invoice_no, snapshot, snapshot_hash)
  VALUES (:'T1', :'B1', :'S1', 'SALE', etims_next_invoice_no(:'B1','SALE'), '{"total":116}', 'h1');
SELECT chk('invoice: a second SALE invoice for the same sale is refused (23505)',
  try($$ INSERT INTO lb_etims_invoices (tenant_id, business_id, sale_id, doc_type, invoice_no, snapshot, snapshot_hash) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000f1','SALE', 99, '{}', 'h2') $$) = '23505');
SELECT chk('invoice: the same invoice number twice in a business is refused (23505)',
  try($$ INSERT INTO lb_etims_invoices (tenant_id, business_id, sale_id, doc_type, invoice_no, snapshot, snapshot_hash) SELECT '00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1', gen_random_uuid(),'SALE', invoice_no, '{}', 'h3' FROM lb_etims_invoices LIMIT 1 $$) IN ('23505','23503'));
SELECT chk('invoice: a credit note must name its original (23514)',
  try($$ INSERT INTO lb_etims_invoices (tenant_id, business_id, sale_id, doc_type, invoice_no, snapshot, snapshot_hash) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000f1','CREDIT_NOTE', 1, '{}', 'h4') $$) = '23514');
SELECT chk('invoice: its content cannot change (P0001)', try($$ UPDATE lb_etims_invoices SET snapshot = '{"total":1}' $$) = 'P0001');
SELECT chk('invoice: its number cannot change (P0001)', try($$ UPDATE lb_etims_invoices SET invoice_no = 500 $$) = 'P0001');
SELECT chk('invoice: it cannot be deleted (P0001)', try($$ DELETE FROM lb_etims_invoices $$) = 'P0001');
SELECT chk('invoice: its sale cannot be deleted while a tax document exists (23503)', try($$ DELETE FROM lb_sales WHERE id = '00000000-0000-0000-0000-0000000000f1' $$) = '23503');
SELECT chk('invoice: PENDING -> ACCEPTED directly is refused (P0001)', try($$ UPDATE lb_etims_invoices SET status = 'ACCEPTED' $$) = 'P0001');
UPDATE lb_etims_invoices SET status = 'SENDING';
UPDATE lb_etims_invoices SET status = 'SENT_UNCONFIRMED';
UPDATE lb_etims_invoices SET status = 'PENDING';
SELECT chk('invoice: unconfirmed can go back to pending (retry path)', (SELECT status = 'PENDING' FROM lb_etims_invoices));
UPDATE lb_etims_invoices SET status = 'SENDING';
UPDATE lb_etims_invoices SET status = 'ACCEPTED', accepted_at = now(), kra_data = '{"x":1}';
SELECT chk('invoice: ACCEPTED is final (P0001)', try($$ UPDATE lb_etims_invoices SET status = 'PENDING' $$) = 'P0001');
SELECT chk('invoice: the sale itself is untouched by all of this', (SELECT status = 'COMPLETED' FROM lb_sales WHERE id = :'S1'));
INSERT INTO lb_etims_invoices (tenant_id, business_id, sale_id, doc_type, original_invoice_id, reversal_id, invoice_no, snapshot, snapshot_hash)
  SELECT :'T1', :'B1', :'S1', 'CREDIT_NOTE', id, gen_random_uuid(), etims_next_invoice_no(:'B1','CREDIT_NOTE'), '{}', 'h5' FROM lb_etims_invoices WHERE doc_type = 'SALE';
SELECT chk('invoice: a credit note for the accepted invoice is allowed', (SELECT count(*) FROM lb_etims_invoices WHERE doc_type = 'CREDIT_NOTE') = 1);
SELECT chk('invoice: two credit notes for the SAME reversal are refused (23505)',
  try($$ INSERT INTO lb_etims_invoices (tenant_id, business_id, sale_id, doc_type, original_invoice_id, reversal_id, invoice_no, snapshot, snapshot_hash) SELECT tenant_id, business_id, sale_id, 'CREDIT_NOTE', original_invoice_id, reversal_id, 77, '{}', 'h6' FROM lb_etims_invoices WHERE doc_type = 'CREDIT_NOTE' $$) = '23505');

-- ---- attempts: append-only ----
INSERT INTO lb_etims_attempts (tenant_id, business_id, invoice_id, attempt_no, outcome) SELECT tenant_id, business_id, id, 1, 'ACCEPTED' FROM lb_etims_invoices WHERE doc_type = 'SALE';
SELECT chk('attempts: cannot be edited (P0001)', try($$ UPDATE lb_etims_attempts SET outcome = 'OTHER' $$) = 'P0001');
SELECT chk('attempts: cannot be deleted (P0001)', try($$ DELETE FROM lb_etims_attempts $$) = 'P0001');

-- ---- RLS: tenant isolation and who may read what (run as the 'authenticated' role) ----
INSERT INTO lb_etims_invoices (tenant_id, business_id, sale_id, doc_type, invoice_no, snapshot, snapshot_hash) VALUES (:'T2', :'B2', :'S2', 'SALE', 1, '{"secret":"other tenant"}', 'h9');
INSERT INTO lb_etims_config (tenant_id, business_id, kra_pin) VALUES (:'T2', :'B2', 'OTHERPIN');
GRANT USAGE ON SCHEMA public TO authenticated; GRANT SELECT ON lb_businesses, lb_sales, lb_products TO authenticated;
SET ROLE authenticated;
SELECT as_user(:'T1', 'settings.manage');
SELECT chk('RLS: the owner sees only their own invoices', (SELECT count(*) FROM lb_etims_invoices) = 2 AND (SELECT bool_and(tenant_id = :'T1') FROM lb_etims_invoices));
SELECT chk('RLS: the owner sees only their own config', (SELECT count(*) FROM lb_etims_config) = 1);
SELECT chk('RLS: attempts visible to the owner', (SELECT count(*) FROM lb_etims_attempts) = 1);
SELECT as_user(:'T1', 'sales.create');
SELECT chk('RLS: a cashier cannot read invoice snapshots', (SELECT count(*) FROM lb_etims_invoices) = 0);
SELECT chk('RLS: a cashier cannot read the attempt log', (SELECT count(*) FROM lb_etims_attempts) = 0);
SELECT chk('view: a cashier sees the status of their own sales', (SELECT count(*) FROM lb_sale_etims_status) = 2);
SELECT chk('view: and nothing of another business', (SELECT count(*) FROM lb_sale_etims_status WHERE sale_id = :'S2') = 0);
SELECT chk('view: the snapshot is not exposed', NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'lb_sale_etims_status' AND column_name IN ('snapshot','snapshot_hash')));
SELECT chk('direct write: insert into invoices is refused (42501)', try($$ INSERT INTO lb_etims_invoices (tenant_id, business_id, sale_id, doc_type, invoice_no, snapshot, snapshot_hash) VALUES ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b1', gen_random_uuid(), 'SALE', 5, '{}', 'x') $$) = '42501');
SELECT chk('direct write: update of config is refused (42501)', try($$ UPDATE lb_etims_config SET enabled = true $$) = '42501');
SELECT chk('direct write: the sequence table is not reachable (42501)', try($$ SELECT * FROM lb_etims_sequences $$) = '42501');
SELECT chk('direct write: next-number function is not callable by a till (42501)', try($$ SELECT etims_next_invoice_no('00000000-0000-0000-0000-0000000000b1','SALE') $$) = '42501');
SELECT as_user(:'T1', 'settings.manage');
SELECT chk('status: pin masked, no key, one credit note counted as waiting',
  (pos_etims_my_status(:'B1')->>'pin_masked') = '••••••N999' AND NOT (pos_etims_my_status(:'B1') ? 'comm_key') AND (pos_etims_my_status(:'B1')->>'pending')::int = 1);
SELECT chk('status: another business refused (42501)', try($$ SELECT pos_etims_my_status('00000000-0000-0000-0000-0000000000b2') $$) = '42501');
SELECT chk('code lists are readable', (SELECT count(*) FROM lb_etims_code_lists) = 2);
RESET ROLE;
