-- Phase 54 scenarios. Run on a THROWAWAY database only:
--   psql -f schema/tests/phase54_stubs.sql; psql -f schema/phase31_hr_payroll.sql; psql -f schema/phase54_salon_commission_checkout.sql; psql -f schema/tests/phase54_scenarios.sql
-- The stubs stand in for the tables/functions of earlier phases; read the output against the "expect" lines.
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
SELECT set_config('t.tenant','11111111-1111-1111-1111-111111111111',false), set_config('t.staff','22222222-2222-2222-2222-222222222222',false);
INSERT INTO pos_staff(id,name) VALUES ('22222222-2222-2222-2222-222222222222','Owner');
INSERT INTO lb_businesses(id,tenant_id) VALUES ('33333333-3333-3333-3333-333333333333','11111111-1111-1111-1111-111111111111');
INSERT INTO pos_hr_employees(id,pos_tenant_id,business_id,full_name,basic_salary,start_date) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','Wanjiru Stylist',0,'2026-01-01'),
 ('aaaaaaaa-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','Brian Salaried',50000,'2026-01-01');
INSERT INTO lb_products(id,tenant_id,name) VALUES ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','Braids');
INSERT INTO lb_service_details(tenant_id,product_id,commission_rate) VALUES ('11111111-1111-1111-1111-111111111111','bbbbbbbb-0000-0000-0000-000000000001',20);
INSERT INTO lb_appointments(id,tenant_id) VALUES ('cccccccc-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111');
INSERT INTO lb_sales(id,tenant_id,business_id) VALUES ('dddddddd-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333'),
 ('dddddddd-0000-0000-0000-000000000002','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333');
-- sale 1: booking + provider, 1000 -> 200
INSERT INTO lb_sale_items(tenant_id,sale_id,product_id,total_price,employee_id,appointment_id) VALUES ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',1000,'aaaaaaaa-0000-0000-0000-000000000001','cccccccc-0000-0000-0000-000000000001');
-- sale 2: walk-in, no provider -> no commission
INSERT INTO lb_sale_items(tenant_id,sale_id,product_id,total_price) VALUES ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000002','bbbbbbbb-0000-0000-0000-000000000001',500);
\echo '--- commission rows (expect 1 EARNED 200 ACCRUED), appointment COMPLETED:'
SELECT kind,amount,status FROM pos_commissions;
SELECT status, sale_id IS NOT NULL FROM lb_appointments;
\echo '--- providers:'
SELECT salon_list_providers('33333333-3333-3333-3333-333333333333');
\echo '--- payroll run (expect Wanjiru allowances 200 basic 0, Brian allowances 0):'
SELECT pos_payroll_create_run('33333333-3333-3333-3333-333333333333','2026-11-01','2026-11-30');
SELECT employee_name, basic, allowances, notes FROM pos_payroll_lines ORDER BY employee_name;
SELECT status, run_id IS NOT NULL FROM pos_commissions;
\echo '--- cancel run (expect back to ACCRUED):'
SELECT pos_payroll_cancel((SELECT id FROM pos_payroll_runs),'testing cancel');
SELECT status, run_id IS NOT NULL FROM pos_commissions;
\echo '--- new run, approve, pay (expect PAID):'
SELECT pos_payroll_create_run('33333333-3333-3333-3333-333333333333','2026-11-01','2026-11-30');
UPDATE pos_payroll_runs SET status='APPROVED' WHERE status='DRAFT';
SELECT pos_payroll_mark_paid((SELECT id FROM pos_payroll_runs WHERE status='APPROVED'));
SELECT status FROM pos_commissions;
\echo '--- reverse the PAID sale (expect a -200 REVERSAL ACCRUED):'
UPDATE lb_sales SET status='VOIDED' WHERE id='dddddddd-0000-0000-0000-000000000001';
SELECT kind,amount,status FROM pos_commissions ORDER BY kind;
\echo '--- summary:'
SELECT pos_commission_summary('33333333-3333-3333-3333-333333333333','2026-11-01','2026-11-30');
\echo '--- unpaid commission voided with its sale:'
INSERT INTO lb_sales(id,tenant_id,business_id) VALUES ('dddddddd-0000-0000-0000-000000000003','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333');
INSERT INTO lb_sale_items(tenant_id,sale_id,product_id,total_price,employee_id) VALUES ('11111111-1111-1111-1111-111111111111','dddddddd-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000001',300,'aaaaaaaa-0000-0000-0000-000000000001');
UPDATE lb_sales SET status='VOIDED' WHERE id='dddddddd-0000-0000-0000-000000000003';
SELECT amount,status FROM pos_commissions WHERE sale_id='dddddddd-0000-0000-0000-000000000003';
\echo '--- folio via M-Pesa callback (expect PAID + folio SETTLED):'
INSERT INTO lb_folios(id,tenant_id,business_id) VALUES ('eeeeeeee-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333');
INSERT INTO lb_folio_lines(folio_id,amount) VALUES ('eeeeeeee-0000-0000-0000-000000000001',1500);
INSERT INTO lb_mpesa_transactions(tenant_id,business_id,phone,amount,cart_snapshot,checkout_request_id,requested_by,folio_id) VALUES ('11111111-1111-1111-1111-111111111111','33333333-3333-3333-3333-333333333333','254712345678',1500,NULL,'ws_CO_1','22222222-2222-2222-2222-222222222222','eeeeeeee-0000-0000-0000-000000000001');
SELECT confirm_mpesa_payment('ws_CO_1',0,'ok','SHK7X9ABCD','{}'::jsonb);
\echo '(expect status PAID above; folio SETTLED below)'
SELECT status FROM lb_folios WHERE id='eeeeeeee-0000-0000-0000-000000000001';
