\set ON_ERROR_STOP off
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
REVOKE ALL ON FUNCTION comm_claim_jobs(integer), comm_install_schedule(text,text) FROM authenticated;  -- (the blanket test grant above would undo the migration's revoke)
CREATE TABLE t_res(n serial, name text, ok boolean);
CREATE OR REPLACE FUNCTION chk(p_name text, p_ok boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO t_res(name, ok) VALUES (p_name, coalesce(p_ok,false)) $$;
-- run a statement as a signed-in POS user, return 'OK' or the SQLSTATE
CREATE OR REPLACE FUNCTION try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
GRANT EXECUTE ON FUNCTION try(text), chk(text, boolean) TO authenticated;
GRANT ALL ON t_res TO authenticated; GRANT ALL ON SEQUENCE t_res_n_seq TO authenticated;

-- ---- two tenants, each with a business, an owner, a cashier (cashier: sales/payments/operations) and an accountant-less viewer
INSERT INTO pos_tenants(id) VALUES ('00000000-0000-0000-0000-0000000000a1'),('00000000-0000-0000-0000-0000000000b1');
INSERT INTO lb_businesses(id, tenant_id, name, time_zone) VALUES
 ('10000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','Kamau Hardware','Africa/Nairobi'),
 ('10000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b1','Zawadi Salon','Africa/Nairobi');
INSERT INTO pos_staff(id, pos_tenant_id, role, role_template) VALUES
 ('20000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a1','owner',null),
 ('20000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a1','cashier','cashier'),
 ('20000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a1','cashier','hr_officer'),
 ('20000000-0000-0000-0000-0000000000b1','00000000-0000-0000-0000-0000000000b1','owner',null);
CREATE OR REPLACE FUNCTION as_staff(p_staff text, p_tenant text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('pos_staff_id', p_staff, 'pos_tenant_id', p_tenant)::text, false);
  SET ROLE authenticated;
END $$;
GRANT EXECUTE ON FUNCTION as_staff(text,text) TO PUBLIC;
CREATE OR REPLACE FUNCTION as_service() RETURNS void LANGUAGE plpgsql AS $$ BEGIN RESET ROLE; PERFORM set_config('request.jwt.claims','',false); END $$;

\set TA '00000000-0000-0000-0000-0000000000a1'
\set TB '00000000-0000-0000-0000-0000000000b1'
\set OWNA '20000000-0000-0000-0000-0000000000a1'
\set CASH '20000000-0000-0000-0000-0000000000a2'
\set HR   '20000000-0000-0000-0000-0000000000a3'
\set OWNB '20000000-0000-0000-0000-0000000000b1'
\set BA '10000000-0000-0000-0000-0000000000a1'
\set BB '10000000-0000-0000-0000-0000000000b1'

INSERT INTO lb_customers(id, tenant_id, business_id, name, phone, outstanding_balance) VALUES
 ('30000000-0000-0000-0000-000000000001', :'TA', :'BA', 'Wanjiru', '0712345678', 8500),
 ('30000000-0000-0000-0000-000000000002', :'TA', :'BA', 'Paid Up', '0712000000', 0),
 ('30000000-0000-0000-0000-000000000003', :'TB', :'BB', 'Zawadi Client', '0700000001', 1000);
INSERT INTO lb_suppliers(id, tenant_id, business_id, name) VALUES ('40000000-0000-0000-0000-000000000001', :'TA', :'BA', 'Bidco');

-- ================= receivable snapshot (due dates derived from the ledger) =================
-- Wanjiru: credit 5,000 (1 Oct), credit 6,000 (20 Oct), payment 2,500 (25 Oct) => balance 8,500
INSERT INTO lb_customer_credit_transactions(tenant_id, customer_id, transaction_type, reference_type, amount, balance_after, created_at) VALUES
 (:'TA','30000000-0000-0000-0000-000000000001','SALE','sale',5000,5000,'2026-10-01 10:00+03'),
 (:'TA','30000000-0000-0000-0000-000000000001','SALE','sale',6000,11000,'2026-10-20 10:00+03'),
 (:'TA','30000000-0000-0000-0000-000000000001','PAYMENT','payment',2500,8500,'2026-10-25 10:00+03');
-- no terms anywhere -> no due date (never invented)
SELECT chk('no payment terms -> due_date is NULL, not guessed', (SELECT bool_and(due_date IS NULL) AND count(*) > 0 FROM comm_receivable_snapshot(:'TA')));
SELECT chk('only customers who owe appear', (SELECT count(DISTINCT customer_id) FROM comm_receivable_snapshot(:'TA')) = 1);
-- with 14 days terms: FIFO => the 2,500 payment cleared the OLDEST debt first: 5,000 -> 2,500 still open (due 15 Oct), 6,000 open (due 3 Nov)
SELECT chk('FIFO: open parts are 2,500 (oldest, partly paid) and 6,000',
  (SELECT array_agg(open_amount ORDER BY event_at) FROM comm_receivable_snapshot(:'TA','Africa/Nairobi',14)) = ARRAY[2500::numeric, 6000]);
SELECT chk('open parts add up to the outstanding balance', (SELECT sum(open_amount) FROM comm_receivable_snapshot(:'TA','Africa/Nairobi',14)) = 8500);
SELECT chk('due date = event date + terms (15 Oct and 3 Nov)', (SELECT array_agg(due_date::text ORDER BY event_at) FROM comm_receivable_snapshot(:'TA','Africa/Nairobi',14)) = ARRAY['2026-10-15','2026-11-03']);
-- customer terms beat the business default
UPDATE lb_customers SET credit_terms_days = 30 WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT chk('customer terms override the business default', (SELECT min(due_date)::text FROM comm_receivable_snapshot(:'TA','Africa/Nairobi',14)) = '2026-10-31');
-- explicit due date for one ledger row wins over terms
INSERT INTO lb_receivable_dues(tenant_id, customer_id, reference_id, due_date) SELECT :'TA', id, (SELECT id FROM lb_customer_credit_transactions WHERE balance_after = 11000), '2026-11-09' FROM lb_customers WHERE id='30000000-0000-0000-0000-000000000001';
SELECT chk('explicit lb_receivable_dues date wins', (SELECT max(due_date)::text FROM comm_receivable_snapshot(:'TA','Africa/Nairobi',14)) = '2026-11-09');
-- paying everything off leaves nothing to chase
UPDATE lb_customers SET outstanding_balance = 0 WHERE id = '30000000-0000-0000-0000-000000000001';
SELECT chk('cleared debt returns no open items (no reminders for paid customers)', (SELECT count(*) FROM comm_receivable_snapshot(:'TA','Africa/Nairobi',14)) = 0);
UPDATE lb_customers SET outstanding_balance = 8500 WHERE id = '30000000-0000-0000-0000-000000000001';
-- tenant isolation through the function as a POS session
SELECT as_staff(:'OWNB', :'TB');
SELECT chk('another tenant cannot read this tenant''s receivables', (SELECT count(*) FROM comm_receivable_snapshot(:'TA','Africa/Nairobi',14)) = 0);
SELECT as_service();

-- ================= appointments remember their dates =================
INSERT INTO lb_appointments(id, tenant_id, customer_id, appointment_date, appointment_time) VALUES ('50000000-0000-0000-0000-000000000001', :'TA', '30000000-0000-0000-0000-000000000001', '2026-11-08', '10:30');
SELECT chk('new appointment records its original slot', (SELECT original_appointment_date::text = '2026-11-08' AND rescheduled_at IS NULL FROM lb_appointments WHERE id='50000000-0000-0000-0000-000000000001'));
UPDATE lb_appointments SET appointment_date='2026-11-10', appointment_time='14:00' WHERE id='50000000-0000-0000-0000-000000000001';
UPDATE lb_appointments SET appointment_date='2026-11-12', appointment_time='09:00' WHERE id='50000000-0000-0000-0000-000000000001';
SELECT chk('reschedule keeps the ORIGINAL date, the previous slot and counts moves',
  (SELECT original_appointment_date::text='2026-11-08' AND rescheduled_from_date::text='2026-11-10' AND rescheduled_from_time::text='14:00:00' AND reschedule_count=2 AND rescheduled_at IS NOT NULL FROM lb_appointments WHERE id='50000000-0000-0000-0000-000000000001'));
UPDATE lb_appointments SET status='CANCELLED' WHERE id='50000000-0000-0000-0000-000000000001';
SELECT chk('cancelling stamps cancelled_at', (SELECT cancelled_at IS NOT NULL FROM lb_appointments WHERE id='50000000-0000-0000-0000-000000000001'));
UPDATE lb_appointments SET status='SCHEDULED' WHERE id='50000000-0000-0000-0000-000000000001';
SELECT chk('re-opening clears cancelled_at', (SELECT cancelled_at IS NULL FROM lb_appointments WHERE id='50000000-0000-0000-0000-000000000001'));

-- ================= purchase orders keep the original delivery date =================
INSERT INTO lb_purchase_orders(id, tenant_id, supplier_id, po_number, status, expected_date) VALUES ('60000000-0000-0000-0000-000000000001', :'TA', '40000000-0000-0000-0000-000000000001', 'PO-1', 'APPROVED', '2026-11-03');
UPDATE lb_purchase_orders SET revised_delivery_date='2026-11-09' WHERE id='60000000-0000-0000-0000-000000000001';
SELECT chk('revising delivery keeps expected_date (original) and counts revisions', (SELECT expected_date::text='2026-11-03' AND revised_delivery_date::text='2026-11-09' AND delivery_revision_count=1 AND delivery_revised_at IS NOT NULL FROM lb_purchase_orders WHERE id='60000000-0000-0000-0000-000000000001'));

-- ================= outbox integrity & permissions =================
SELECT as_staff(:'CASH', :'TA');
SELECT chk('cashier (operations.use) can prepare a customer message',
  try(format($q$INSERT INTO lb_communication_log(tenant_id, business_id, customer_id, channel, message_type, purpose, recipient, rendered_message) VALUES (%L,%L,'30000000-0000-0000-0000-000000000001','WHATSAPP','OTHER','PAYMENT_OVERDUE','254712345678','Hello') $q$, :'TA', :'BA')) = 'OK');
SELECT chk('cashier cannot message a supplier without purchase/payment permission... (cashier has payments.record, so allowed)',
  try(format($q$INSERT INTO lb_communication_log(tenant_id, business_id, supplier_id, channel, message_type, recipient, rendered_message) VALUES (%L,%L,'40000000-0000-0000-0000-000000000001','WHATSAPP','OTHER','254733','Hi') $q$, :'TA', :'BA')) = 'OK');
SELECT as_staff(:'HR', :'TA');
SELECT chk('staff without any messaging permission (HR officer) cannot create a message',
  try(format($q$INSERT INTO lb_communication_log(tenant_id, business_id, customer_id, channel, message_type, recipient, rendered_message) VALUES (%L,%L,'30000000-0000-0000-0000-000000000001','SMS','OTHER','+254712345678','Hi') $q$, :'TA', :'BA')) = '42501');
SELECT as_staff(:'CASH', :'TA');
SELECT chk('a user session cannot start a message as DELIVERED',
  try(format($q$INSERT INTO lb_communication_log(tenant_id, customer_id, channel, message_type, rendered_message, status) VALUES (%L,'30000000-0000-0000-0000-000000000001','SMS','OTHER','x','DELIVERED') $q$, :'TA')) <> 'OK');
SELECT chk('a user session cannot forge a provider reference',
  try(format($q$INSERT INTO lb_communication_log(tenant_id, customer_id, channel, message_type, rendered_message, provider, provider_message_id) VALUES (%L,'30000000-0000-0000-0000-000000000001','SMS','OTHER','x','AFRICASTALKING','abc') $q$, :'TA')) = '42501');
-- the first (WhatsApp) row: opened -> sent by user, never delivered
CREATE TEMP TABLE m AS SELECT id FROM lb_communication_log WHERE purpose = 'PAYMENT_OVERDUE';
SELECT chk('a user can mark a prepared message OPENED', try(format('UPDATE lb_communication_log SET status=%L, opened_at=now() WHERE id=%L', 'OPENED', (SELECT id FROM m))) = 'OK');
SELECT chk('opening WhatsApp records OPENED (not SENT) and keeps the row', (SELECT status::text = 'OPENED' AND sent_at IS NULL FROM lb_communication_log WHERE id=(SELECT id FROM m)));
SELECT chk('owner may attest SENT on a manual (WhatsApp) message', try(format('UPDATE lb_communication_log SET status=%L, sent_at=now() WHERE id=%L', 'SENT', (SELECT id FROM m))) = 'OK');
SELECT chk('user cannot mark a message DELIVERED', try(format('UPDATE lb_communication_log SET status=%L WHERE id=%L', 'DELIVERED', (SELECT id FROM m))) = '42501');
SELECT chk('user cannot mark a message READ', try(format('UPDATE lb_communication_log SET status=%L WHERE id=%L', 'READ', (SELECT id FROM m))) = '42501');
SELECT chk('user cannot mark a message SUBMITTED', try(format('UPDATE lb_communication_log SET status=%L WHERE id=%L', 'SUBMITTED', (SELECT id FROM m))) = '42501');
SELECT chk('a sent message text cannot be rewritten afterwards', try(format('UPDATE lb_communication_log SET rendered_message=%L WHERE id=%L', 'changed', (SELECT id FROM m))) = '42501');
SELECT chk('the original generated text cannot be changed', try(format('UPDATE lb_communication_log SET generated_message=%L WHERE id=%L', 'changed', (SELECT id FROM m))) = '42501');
SELECT chk('status history records each step', (SELECT jsonb_array_length(status_history) = 3 FROM lb_communication_log WHERE id=(SELECT id FROM m)));
SELECT chk('outbox rows cannot be deleted by a POS session', try(format('DELETE FROM lb_communication_log WHERE id=%L', (SELECT id FROM m))) IN ('42501') OR (SELECT count(*) FROM lb_communication_log WHERE id=(SELECT id FROM m)) = 1);
SELECT chk('...and the row is still there', (SELECT count(*) FROM lb_communication_log WHERE id=(SELECT id FROM m)) = 1);
-- edit-before-send is recorded as an edit
INSERT INTO lb_communication_log(tenant_id, customer_id, channel, message_type, rendered_message, generated_message) VALUES (:'TA','30000000-0000-0000-0000-000000000001','SMS','OTHER','Edited text','Original text');
SELECT chk('final vs generated text: was_edited is set and both are kept', (SELECT was_edited AND generated_message='Original text' AND rendered_message='Edited text' FROM lb_communication_log WHERE rendered_message='Edited text'));
-- server can confirm delivery from provider receipts
SELECT as_service();
UPDATE lb_communication_log SET provider='AFRICASTALKING', provider_message_id='ATXid_1', status='SUBMITTED', submitted_at=now() WHERE rendered_message='Edited text';
UPDATE lb_communication_log SET status='DELIVERED', delivered_at=now() WHERE provider_message_id='ATXid_1';
SELECT chk('service role can record provider delivery', (SELECT status::text='DELIVERED' FROM lb_communication_log WHERE provider_message_id='ATXid_1'));
SELECT as_staff(:'CASH', :'TA');
SELECT chk('user cannot SENT-attest a provider message', try(format('UPDATE lb_communication_log SET status=%L WHERE provider_message_id=%L', 'SENT', 'ATXid_1')) <> 'OK');
SELECT chk('a delivered message cannot be changed by a user', try(format('UPDATE lb_communication_log SET status=%L WHERE provider_message_id=%L', 'FAILED', 'ATXid_1')) <> 'OK');

-- ================= tenant isolation =================
SELECT as_staff(:'OWNB', :'TB');
SELECT chk('tenant B sees none of tenant A''s messages', (SELECT count(*) FROM lb_communication_log) = 0);
SELECT chk('tenant B cannot insert into tenant A', try(format($q$INSERT INTO lb_communication_log(tenant_id, customer_id, channel, message_type, rendered_message) VALUES (%L,NULL,'SMS','OTHER','x') $q$, :'TA')) <> 'OK');
SELECT chk('tenant B cannot read A''s preferences/jobs', (SELECT count(*) FROM lb_comm_preferences) = 0 AND (SELECT count(*) FROM lb_comm_jobs) = 0);
SELECT as_service();

-- ================= templates: only settings.manage may save wording =================
SELECT as_staff(:'CASH', :'TA');
SELECT chk('anyone may still get untouched default rows seeded (old Messages screen)',
  try(format($q$INSERT INTO lb_communication_templates(tenant_id, business_id, message_type, channel, body) VALUES (%L,%L,'WELCOME','SMS','Welcome {{customer_name}}') $q$, :'TA', :'BA')) = 'OK');
SELECT chk('a cashier cannot edit a permanent template', try(format('UPDATE lb_communication_templates SET body=%L WHERE business_id=%L', 'hacked', :'BA')) = '42501');
SELECT chk('a cashier cannot save a customised template',
  try(format($q$INSERT INTO lb_communication_templates(tenant_id, business_id, message_type, channel, purpose, is_customised, body) VALUES (%L,%L,'OTHER','SMS','CUSTOMER_WELCOME',true,'x') $q$, :'TA', :'BA')) = '42501');
SELECT chk('a cashier cannot change automation settings',
  try(format($q$INSERT INTO lb_comm_preferences(tenant_id, business_id, settings) VALUES (%L,%L,'{"automations":{"PAYMENT_REMINDER":{"mode":"AUTO"}}}') $q$, :'TA', :'BA')) = '42501');
SELECT as_staff(:'OWNA', :'TA');
SELECT chk('the owner can save a customised template', try(format($q$INSERT INTO lb_communication_templates(tenant_id, business_id, message_type, channel, purpose, is_customised, body) VALUES (%L,%L,'OTHER','SMS','PAYMENT_OVERDUE',true,'Pay now') $q$, :'TA', :'BA')) = 'OK');
SELECT chk('a customised purpose does not collide with an old seed of the same message type',
  try(format($q$INSERT INTO lb_communication_templates(tenant_id, business_id, message_type, channel, body) VALUES (%L,%L,'PAYMENT_OVERDUE','SMS','old seed') $q$, :'TA', :'BA')) = 'OK');
SELECT chk('...but one template per business + purpose + channel',
  try(format($q$INSERT INTO lb_communication_templates(tenant_id, business_id, message_type, channel, purpose, is_customised, body) VALUES (%L,%L,'OTHER','SMS','PAYMENT_OVERDUE',true,'dup') $q$, :'TA', :'BA')) = '23505');
SELECT chk('the owner can save preferences (one row per business)', try(format($q$INSERT INTO lb_comm_preferences(tenant_id, business_id, settings) VALUES (%L,%L,'{"greeting":"Habari"}') $q$, :'TA', :'BA')) = 'OK');
SELECT chk('...a second preferences row for the same business is refused', try(format($q$INSERT INTO lb_comm_preferences(tenant_id, business_id, settings) VALUES (%L,%L,'{}') $q$, :'TA', :'BA')) = '23505');
SELECT as_service();

-- ================= jobs: dedupe, and what people may change =================
INSERT INTO lb_comm_jobs(tenant_id, business_id, automation, purpose, channel, mode, recipient_kind, customer_id, dedupe_key, status)
 VALUES (:'TA', :'BA', 'PAYMENT_REMINDER','PAYMENT_OVERDUE','WHATSAPP','DRAFT','CUSTOMER','30000000-0000-0000-0000-000000000001','PAYREM:LATE:c1:2026-11-06:0','READY');
SELECT chk('the same dedupe_key cannot create a second job (no duplicate reminders)',
  try(format($q$INSERT INTO lb_comm_jobs(tenant_id, automation, purpose, channel, mode, recipient_kind, dedupe_key) VALUES (%L,'PAYMENT_REMINDER','PAYMENT_OVERDUE','WHATSAPP','DRAFT','CUSTOMER','PAYREM:LATE:c1:2026-11-06:0') $q$, :'TA')) = '23505');
SELECT chk('...but the same key in another tenant is independent',
  try(format($q$INSERT INTO lb_comm_jobs(tenant_id, automation, purpose, channel, mode, recipient_kind, dedupe_key) VALUES (%L,'PAYMENT_REMINDER','PAYMENT_OVERDUE','WHATSAPP','DRAFT','CUSTOMER','PAYREM:LATE:c1:2026-11-06:0') $q$, :'TB')) = 'OK');
SELECT as_staff(:'CASH', :'TA');
SELECT chk('a user cannot create jobs', try(format($q$INSERT INTO lb_comm_jobs(tenant_id, automation, purpose, channel, mode, recipient_kind, dedupe_key) VALUES (%L,'X','Y','SMS','AUTO','CUSTOMER','k') $q$, :'TA')) <> 'OK');
SELECT chk('a user can dismiss a READY job', try(format($q$UPDATE lb_comm_jobs SET status='CANCELLED' WHERE dedupe_key='PAYREM:LATE:c1:2026-11-06:0' AND tenant_id=%L $q$, :'TA')) = 'OK');
SELECT chk('a user cannot re-arm it as AUTO or change what it is about', try(format($q$UPDATE lb_comm_jobs SET mode='AUTO', status='READY' WHERE dedupe_key='PAYREM:LATE:c1:2026-11-06:0' AND tenant_id=%L $q$, :'TA')) = '42501');
SELECT chk('a user cannot delete jobs', try(format($q$DELETE FROM lb_comm_jobs WHERE tenant_id=%L $q$, :'TA')) <> 'OK' OR (SELECT count(*) FROM lb_comm_jobs) >= 1);
SELECT chk('...jobs are still there', (SELECT count(*) FROM lb_comm_jobs) >= 1);
SELECT as_service();

-- ================= notification read state is per person =================
SELECT as_staff(:'OWNA', :'TA');
INSERT INTO lb_notification_reads(tenant_id, staff_id, notif_key) VALUES (:'TA', :'OWNA', 'overdue:c1');
SELECT chk('a person can mark a notification read', (SELECT count(*) FROM lb_notification_reads) = 1);
SELECT chk('they cannot mark it read on someone else''s behalf', try(format($q$INSERT INTO lb_notification_reads(tenant_id, staff_id, notif_key) VALUES (%L,%L,'x') $q$, :'TA', :'CASH')) <> 'OK');
SELECT as_staff(:'CASH', :'TA');
SELECT chk('another person''s read marks are invisible', (SELECT count(*) FROM lb_notification_reads) = 0);
SELECT as_service();

-- ================= financial tables untouched =================
SELECT chk('no trigger was added to any financial table',
  (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid WHERE NOT t.tgisinternal AND c.relname IN ('lb_customers','lb_customer_credit_transactions','lb_sales','lb_customer_payments','lb_supplier_payments') AND t.tgname LIKE '%comm%') = 0);

-- ================= scheduler claim =================
INSERT INTO lb_comm_jobs(tenant_id, automation, purpose, channel, mode, recipient_kind, dedupe_key, status, run_at) VALUES
 (:'TA','A','P','SMS','AUTO','CUSTOMER','claim-1','PENDING', now() - interval '1 minute'),
 (:'TA','A','P','SMS','AUTO','CUSTOMER','claim-future','PENDING', now() + interval '1 hour'),
 (:'TA','A','P','SMS','AUTO','CUSTOMER','claim-retry-later','PENDING', now() - interval '1 hour');
UPDATE lb_comm_jobs SET next_attempt_at = now() + interval '10 minutes' WHERE dedupe_key='claim-retry-later';
INSERT INTO lb_comm_jobs(tenant_id, automation, purpose, channel, mode, recipient_kind, dedupe_key, status, claimed_at) VALUES (:'TA','A','P','SMS','AUTO','CUSTOMER','stuck','PROCESSING', now() - interval '30 minutes');
CREATE TEMP TABLE c1 AS SELECT dedupe_key FROM comm_claim_jobs(10) WHERE dedupe_key LIKE 'claim-%';
SELECT chk('claim returns only due jobs (not future, not waiting for a retry time)', (SELECT array_agg(dedupe_key) FROM c1) = ARRAY['claim-1']);
SELECT chk('claimed job is PROCESSING with attempts=1', (SELECT status='PROCESSING' AND attempts=1 FROM lb_comm_jobs WHERE dedupe_key='claim-1'));
CREATE TEMP TABLE c2 AS SELECT dedupe_key FROM comm_claim_jobs(10);
SELECT chk('a second dispatcher run cannot claim the same job again (no double send)', (SELECT count(*) FROM c2) = 0);
SELECT chk('a run that died mid-send is parked as FAILED, never blindly retried', (SELECT status='FAILED' AND last_error LIKE '%unknown%' FROM lb_comm_jobs WHERE dedupe_key='stuck'));
SELECT as_staff(:'OWNA', :'TA');
SELECT chk('users cannot call the claim function', try('SELECT * FROM comm_claim_jobs(1)') <> 'OK');
SELECT as_service();
