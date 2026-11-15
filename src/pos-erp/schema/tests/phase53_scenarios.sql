\set T '''00000000-0000-0000-0000-0000000000aa'''
\set B '''11111111-1111-1111-1111-111111111111'''
INSERT INTO lb_businesses(id,tenant_id,name) VALUES (:B,:T,'Kamau Properties');
INSERT INTO lb_customers(id,tenant_id,business_id,name) VALUES ('c0000000-0000-0000-0000-000000000001',:T,:B,'John'),('c0000000-0000-0000-0000-000000000002',:T,:B,'Mary');
INSERT INTO lb_units(id,tenant_id,business_id,unit_number,customer_id,rent_amount,status) VALUES
 ('a0000000-0000-0000-0000-000000000004',:T,:B,'A04','c0000000-0000-0000-0000-000000000001',12000,'OCCUPIED'),
 ('a0000000-0000-0000-0000-000000000005',:T,:B,'A05','c0000000-0000-0000-0000-000000000002',9000,'OCCUPIED');
INSERT INTO lb_recurring_charges(tenant_id,business_id,customer_id,unit_id,charge_name,amount,frequency,start_date,taxable) VALUES
 (:T,:B,'c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000004','Rent',11600,'MONTHLY','2026-01-01',false),
 (:T,:B,'c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000004','Service Charge',1160,'MONTHLY','2026-01-01',true),
 (:T,:B,'c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000005','Rent',9000,'MONTHLY','2026-01-01',true);
-- A: tax 16% INCLUSIVE
INSERT INTO lb_pos_settings(tenant_id,business_id,settings) VALUES (:T,:B,'{"tax_rate":16,"tax_inclusive":true}');
\echo == A1 inclusive: John total 12760 (11600 untaxed + 1160 incl), tax_total 160, subtotal 12600; Mary 9000 tax 1241.38
SELECT generate_monthly_rent_invoices(:B,'2026-09-10');
SELECT c.name,total_amount,subtotal_amount,tax_total,tax_rate,tax_inclusive FROM lb_rent_invoice_summary s JOIN lb_customers c ON c.id=s.customer_id ORDER BY c.name;
SELECT r.charge_name,x.amount,x.net_amount,x.tax_amount FROM lb_recurring_charge_invoices x JOIN lb_recurring_charges r ON r.id=x.recurring_charge_id ORDER BY x.created_at;
\echo == A2 receipt: pay 6380 (half of John) -> tax share 80
SELECT issue_rent_invoice(id) FROM lb_rent_invoices;
SELECT record_rent_invoice_payment((SELECT id FROM lb_rent_invoices WHERE customer_id='c0000000-0000-0000-0000-000000000001'),6380,'CASH');
SELECT receipt_number,amount,tax_amount FROM lb_rent_invoice_payments;
\echo == B EXCLUSIVE 16%: change settings, bill Oct. John: Rent 11600 untaxed, Service 1160+185.60=1345.60 => total 12945.60 tax 185.60
UPDATE lb_pos_settings SET settings='{"tax_rate":16,"tax_inclusive":false}';
SELECT generate_monthly_rent_invoices(:B,'2026-10-01');
SELECT c.name,total_amount,subtotal_amount,tax_total,tax_inclusive FROM lb_rent_invoice_summary s JOIN lb_customers c ON c.id=s.customer_id WHERE period='2026-10-01' ORDER BY c.name;
\echo == B2 old Sept invoice unchanged (snapshot): John 12760 tax 160 inclusive
SELECT total_amount,tax_total,tax_inclusive FROM lb_rent_invoice_summary WHERE period='2026-09-01' AND customer_id='c0000000-0000-0000-0000-000000000001';
\echo == B3 customer balance for Mary = 9000 + 10440 = 19440
SELECT name,outstanding_balance FROM lb_customers ORDER BY name;
\echo == C LATE meter charge for John in Sept (Sept invoice already ISSUED): billed as one-off dated 2026-09-20, 500 excl tax -> 580
INSERT INTO lb_recurring_charges(id,tenant_id,business_id,customer_id,unit_id,charge_name,amount,frequency,status) VALUES ('d0000000-0000-0000-0000-000000000001',:T,:B,'c0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000004','Water - 25 units',500,'ONE_OFF','ACTIVE');
SELECT generate_recurring_charge_invoice('d0000000-0000-0000-0000-000000000001','2026-09-20',500) \gset late_
SELECT amount,net_amount,tax_amount FROM lb_recurring_charge_invoices WHERE id=:'late_generate_recurring_charge_invoice';
SELECT 'orphan lines' AS k, count(*) FROM lb_recurring_charge_invoices WHERE rent_invoice_id IS NULL;
\echo == C2 Oct run already made Oct invoices (draft). Run again: the late Sept water line must join Johns Oct DRAFT
SELECT generate_monthly_rent_invoices(:B,'2026-10-01');
SELECT r.charge_name,x.period,x.amount FROM lb_recurring_charge_invoices x JOIN lb_recurring_charges r ON r.id=x.recurring_charge_id WHERE x.rent_invoice_id=(SELECT id FROM lb_rent_invoices WHERE period='2026-10-01' AND customer_id='c0000000-0000-0000-0000-000000000001') ORDER BY 1;
\echo == D rate 0 -> no tax at all
UPDATE lb_pos_settings SET settings='{"tax_rate":0}';
INSERT INTO lb_recurring_charges(id,tenant_id,business_id,customer_id,unit_id,charge_name,amount,frequency,status) VALUES ('d0000000-0000-0000-0000-000000000002',:T,:B,'c0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000005','Garbage',300,'ONE_OFF','ACTIVE');
SELECT generate_recurring_charge_invoice('d0000000-0000-0000-0000-000000000002','2026-10-05') \gset g_
SELECT amount,net_amount,tax_amount,tax_rate FROM lb_recurring_charge_invoices WHERE id=:'g_generate_recurring_charge_invoice';
\echo == E no settings row at all -> no tax
DELETE FROM lb_pos_settings;
SELECT * FROM rental_tax_setting(:B);
