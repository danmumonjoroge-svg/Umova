set T '''00000000-0000-0000-0000-0000000000aa'''
\set ON_ERROR_STOP off
\pset pager off
-- ===== setup =====
INSERT INTO lb_businesses(id,tenant_id,name) VALUES ('11111111-1111-1111-1111-111111111111',:T,'Kamau Properties');
INSERT INTO lb_customers(id,tenant_id,business_id,name,phone) VALUES
 ('c0000000-0000-0000-0000-000000000001',:T,'11111111-1111-1111-1111-111111111111','John Kamau','0712345678'),
 ('c0000000-0000-0000-0000-000000000002',:T,'11111111-1111-1111-1111-111111111111','Mary W','0722000000'),
 ('c0000000-0000-0000-0000-000000000003',:T,'11111111-1111-1111-1111-111111111111','Peter O','0733000000');
INSERT INTO lb_units(id,tenant_id,business_id,unit_number,customer_id,rent_amount,status) VALUES
 ('a0000000-0000-0000-0000-000000000004',:T,'11111111-1111-1111-1111-111111111111','A04','c0000000-0000-0000-0000-000000000001',12000,'OCCUPIED'),
 ('a0000000-0000-0000-0000-000000000005',:T,'11111111-1111-1111-1111-111111111111','A05','c0000000-0000-0000-0000-000000000002',9000,'OCCUPIED'),
 ('a0000000-0000-0000-0000-000000000006',:T,'11111111-1111-1111-1111-111111111111','A06','c0000000-0000-0000-0000-000000000003',8000,'OCCUPIED'),
 ('a0000000-0000-0000-0000-000000000007',:T,'11111111-1111-1111-1111-111111111111','A07',NULL,7000,'VACANT');
INSERT INTO lb_recurring_charges(tenant_id,business_id,customer_id,unit_id,charge_name,amount,frequency,start_date) VALUES
 (:T,'11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000004','Monthly Rent',12000,'MONTHLY','2026-01-01'),
 (:T,'11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000004','Water',600,'MONTHLY','2026-01-01'),
 (:T,'11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000004','Garbage',200,'MONTHLY','2026-01-01'),
 (:T,'11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000004','Service Charge',500,'MONTHLY','2026-01-01'),
 (:T,'11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000005','Monthly Rent',9000,'MONTHLY','2026-01-01');
-- (Peter, A06 has NO charges)
\echo '== T1 generate twice: expect created 2 / existing 0 / skipped 1, then created 0 / existing 2 =='
SELECT generate_monthly_rent_invoices('11111111-1111-1111-1111-111111111111','2026-09-15');
SELECT generate_monthly_rent_invoices('11111111-1111-1111-1111-111111111111','2026-09-15');
\echo '== T2 John total 13300, DRAFT, 4 lines =='
SELECT invoice_number,total_amount,paid_amount,balance_due,display_status FROM lb_rent_invoice_summary ORDER BY invoice_number;
\echo '== T3 cannot pay a draft; issue then pay =='
SELECT record_rent_invoice_payment((SELECT id FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000001'),1000,'CASH');
SELECT issue_rent_invoice(id) FROM lb_rent_invoices;
\echo '== T4 partial 5000 -> PARTIALLY_PAID, balance 8300 =='
SELECT record_rent_invoice_payment((SELECT id FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000001'),5000,'CASH');
SELECT total_amount,paid_amount,balance_due,display_status FROM lb_rent_invoice_summary WHERE customer_id='c0000000-0000-0000-0000-000000000001';
\echo '== T5 overpayment 9000 > 8300 must ERROR =='
SELECT record_rent_invoice_payment((SELECT id FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000001'),9000,'CASH');
\echo '== T6 manual M-Pesa 3000 code SGL7K2X9AB ok, same code again must ERROR =='
SELECT record_rent_invoice_payment((SELECT id FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000001'),3000,'MOBILE_MONEY','SGL7K2X9AB',NULL,NULL,'MPESA_MANUAL');
SELECT record_rent_invoice_payment((SELECT id FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000001'),100,'MOBILE_MONEY','SGL7K2X9AB',NULL,NULL,'MPESA_MANUAL');
\echo '== T7 pay the rest 5300 -> PAID, balance 0; pay again must ERROR; cancel with payments must ERROR =='
SELECT record_rent_invoice_payment((SELECT id FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000001'),5300,'CASH');
SELECT total_amount,paid_amount,balance_due,display_status FROM lb_rent_invoice_summary WHERE customer_id='c0000000-0000-0000-0000-000000000001';
SELECT record_rent_invoice_payment((SELECT id FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000001'),10,'CASH');
SELECT cancel_rent_invoice((SELECT id FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000001'));
\echo '== T8 tenant ledger: John owes 0, 3 payment rows (5000+3000+5300); Mary owes 9000 =='
SELECT c.name,c.outstanding_balance FROM lb_customers c ORDER BY name;
SELECT count(*),sum(amount) FROM lb_rent_invoice_payments;
\echo '== T9 duplicate live invoice same tenant/unit/month must ERROR (unique index) =='
INSERT INTO lb_rent_invoices(tenant_id,business_id,customer_id,unit_id,invoice_number,period,due_date) VALUES (:T,'11111111-1111-1111-1111-111111111111','c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000005','INV-X','2026-09-01','2026-09-05');
\echo '== T10 M-Pesa STK for Mary: confirm success twice (idempotent), then a failure on a 2nd txn =='
INSERT INTO lb_mpesa_transactions(tenant_id,business_id,customer_id,phone,amount,merchant_request_id,checkout_request_id,rent_invoice_id)
 SELECT :T,business_id,customer_id,'254722000000',4000,'m1','ws_CO_1',id FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000002';
\echo 'second pending prompt for same invoice must ERROR:'
INSERT INTO lb_mpesa_transactions(tenant_id,business_id,customer_id,phone,amount,merchant_request_id,checkout_request_id,rent_invoice_id)
 SELECT :T,business_id,customer_id,'254722000000',4000,'m2','ws_CO_2',id FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000002';
SELECT confirm_mpesa_payment('ws_CO_1',0,'The service request is processed successfully.','TIK9ABC123','{}'::jsonb);
SELECT confirm_mpesa_payment('ws_CO_1',0,'The service request is processed successfully.','TIK9ABC123','{}'::jsonb);
SELECT total_amount,paid_amount,balance_due,display_status FROM lb_rent_invoice_summary WHERE customer_id='c0000000-0000-0000-0000-000000000002';
SELECT source,reference_no,amount FROM lb_rent_invoice_payments WHERE source='MPESA_PROMPT';
SELECT status,mpesa_receipt_number FROM lb_mpesa_transactions WHERE checkout_request_id='ws_CO_1';
\echo '== T11 failed + cancelled results never touch the invoice =='
INSERT INTO lb_mpesa_transactions(tenant_id,business_id,customer_id,phone,amount,merchant_request_id,checkout_request_id,rent_invoice_id)
 SELECT :T,business_id,customer_id,'254722000000',1000,'m3','ws_CO_3',id FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000002';
SELECT confirm_mpesa_payment('ws_CO_3',1032,'Request cancelled by user',NULL,'{}'::jsonb);
SELECT status,result_code FROM lb_mpesa_transactions WHERE checkout_request_id='ws_CO_3';
SELECT paid_amount,balance_due FROM lb_rent_invoice_summary WHERE customer_id='c0000000-0000-0000-0000-000000000002';
\echo '== T12 STK success that cannot be applied (invoice already fully paid) -> NEEDS_ATTENTION, money not lost =='
INSERT INTO lb_mpesa_transactions(tenant_id,business_id,customer_id,phone,amount,merchant_request_id,checkout_request_id,rent_invoice_id)
 SELECT :T,business_id,customer_id,'254722000000',5000,'m4','ws_CO_4',id FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000002';
SELECT confirm_mpesa_payment('ws_CO_4',0,'ok','TIK9ZZZ999','{}'::jsonb);
SELECT status,left(result_desc,90) FROM lb_mpesa_transactions WHERE checkout_request_id='ws_CO_4';
\echo '== T13 Maintenance: create/assign/start/complete 800+400 -> expense 1200 =='
INSERT INTO lb_maintenance_requests(tenant_id,business_id,reference_no,unit_id,customer_id,description,category,priority) VALUES (:T,'11111111-1111-1111-1111-111111111111',next_doc_number('11111111-1111-1111-1111-111111111111','MNT'),'a0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000001','Leaking tap','PLUMBING','HIGH');
SELECT set_maintenance_status((SELECT id FROM lb_maintenance_requests),'ASSIGNED');
SELECT set_maintenance_status((SELECT id FROM lb_maintenance_requests),'ASSIGNED','Joseph the plumber');
SELECT set_maintenance_status((SELECT id FROM lb_maintenance_requests),'IN_PROGRESS');
SELECT set_maintenance_status((SELECT id FROM lb_maintenance_requests),'COMPLETED');
SELECT complete_maintenance_request((SELECT id FROM lb_maintenance_requests),800,400,0,'CASH','2026-09-30','done','BUSINESS');
SELECT reference_no,status,total_cost,expense_id IS NOT NULL AS has_expense FROM lb_maintenance_requests;
SELECT amount,status,description FROM lb_expenses;
\echo 'complete again must ERROR:'
SELECT complete_maintenance_request((SELECT id FROM lb_maintenance_requests),1,1,1,'CASH');
\echo '== T14 Charge Tenant option: still an expense AND a one-off tenant charge =='
INSERT INTO lb_maintenance_requests(tenant_id,business_id,reference_no,unit_id,customer_id,description,category) VALUES (:T,'11111111-1111-1111-1111-111111111111',next_doc_number('11111111-1111-1111-1111-111111111111','MNT'),'a0000000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000001','Broken window by tenant','CARPENTRY');
SELECT complete_maintenance_request((SELECT id FROM lb_maintenance_requests WHERE reference_no LIKE '%0002'),1500,500,0,'CASH','2026-09-30',NULL,'TENANT');
SELECT count(*) AS expenses, sum(amount) FROM lb_expenses;
SELECT charge_name,amount,status FROM lb_recurring_charges WHERE charge_name LIKE 'Repair%';
SELECT amount,status FROM lb_recurring_charge_invoices WHERE rent_invoice_id IS NULL AND amount=2000;
\echo '== T15 Next month generation does not touch September =='
SELECT generate_monthly_rent_invoices('11111111-1111-1111-1111-111111111111','2026-10-01');
SELECT invoice_number,period,total_amount FROM lb_rent_invoice_summary ORDER BY period,invoice_number;
\echo '== T12b STK success for MORE than the balance -> NEEDS_ATTENTION with reason, invoice untouched =='
INSERT INTO lb_mpesa_transactions(tenant_id,business_id,customer_id,phone,amount,merchant_request_id,checkout_request_id,rent_invoice_id)
 SELECT :T,business_id,customer_id,'254722000000',7000,'m9','ws_CO_9',id FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000002' AND period='2026-10-01';
SELECT issue_rent_invoice(id) FROM lb_rent_invoices WHERE period='2026-10-01';
SELECT confirm_mpesa_payment('ws_CO_9',0,'ok','TIK9OVER77','{}'::jsonb);
SELECT status,left(result_desc,95) FROM lb_mpesa_transactions WHERE checkout_request_id='ws_CO_9';
SELECT paid_amount,balance_due FROM lb_rent_invoice_summary WHERE customer_id='c0000000-0000-0000-0000-000000000002' AND period='2026-10-01';
\echo '== T16 cancel a DRAFT/ISSUED unpaid invoice, then generate again -> new invoice, lines re-attached, no duplicate charge =='
SELECT cancel_rent_invoice(id) FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000001' AND period='2026-10-01';
SELECT generate_monthly_rent_invoices('11111111-1111-1111-1111-111111111111','2026-10-01');
SELECT invoice_number,display_status,total_amount FROM lb_rent_invoice_summary WHERE customer_id='c0000000-0000-0000-0000-000000000001' AND period='2026-10-01' ORDER BY invoice_number;
SELECT count(*) AS john_oct_charge_lines FROM lb_recurring_charge_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000001' AND period='2026-10-01';
\echo '== T17 invoice numbers are gap-free per run (no numbers burned on Peter) =='
SELECT string_agg(invoice_number, ', ' ORDER BY invoice_number) FROM lb_rent_invoices;
INSERT INTO lb_mpesa_transactions(tenant_id,business_id,customer_id,phone,amount,merchant_request_id,checkout_request_id,rent_invoice_id)
 SELECT :T,business_id,customer_id,'254722000000',5000,'m10','ws_CO_10',id FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000002' AND period='2026-10-01';
SELECT confirm_mpesa_payment('ws_CO_10',0,'ok','TIK9OVER88','{}'::jsonb);
SELECT status,left(result_desc,100),mpesa_receipt_number FROM lb_mpesa_transactions WHERE checkout_request_id='ws_CO_10';
SELECT paid_amount,balance_due FROM lb_rent_invoice_summary WHERE customer_id='c0000000-0000-0000-0000-000000000002' AND period='2026-10-01';
SELECT count(*) AS rent_payment_rows_for_that_receipt FROM lb_rent_invoice_payments WHERE reference_no='TIK9OVER88';
