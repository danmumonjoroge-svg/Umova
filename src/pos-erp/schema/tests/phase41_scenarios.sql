-- Scenarios for phase37 (My Loans) on a SCRATCH database (run by phase37_run.sh). Results land in t_res.
CREATE TABLE t_res (n serial, name text, ok boolean);
CREATE TABLE kv (k text PRIMARY KEY, v text);
GRANT ALL ON t_res, kv TO PUBLIC; GRANT USAGE ON SEQUENCE t_res_n_seq TO PUBLIC;
CREATE FUNCTION chk(p_name text, p_ok boolean) RETURNS void LANGUAGE sql AS $$ INSERT INTO t_res(name, ok) VALUES (p_name, coalesce(p_ok, false)) $$;
CREATE FUNCTION try(p_sql text) RETURNS text LANGUAGE plpgsql AS $$ BEGIN EXECUTE p_sql; RETURN 'OK'; EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE; END $$;
-- who is signed in: tenant, permissions, owner?
CREATE FUNCTION as_user(t text, perms text, owner text) RETURNS void LANGUAGE sql AS $$ SELECT set_config('test.tenant', t, false), set_config('test.perms', perms, false), set_config('test.owner', owner, false) $$;
CREATE FUNCTION pay_of(p_inst uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT p.id FROM lb_loan_payments p JOIN lb_loan_payment_allocations a ON a.payment_id = p.id WHERE a.installment_id = p_inst ORDER BY p.n DESC LIMIT 1 $$;
GRANT EXECUTE ON FUNCTION chk(text, boolean), try(text), as_user(text, text, text), pay_of(uuid) TO PUBLIC;

\set T1 '00000000-0000-0000-0000-0000000000a1'
\set B1 '00000000-0000-0000-0000-0000000000b1'
\set T2 '00000000-0000-0000-0000-0000000000a2'
\set B2 '00000000-0000-0000-0000-0000000000b2'
INSERT INTO lb_businesses VALUES (:'B1', :'T1'), (:'B2', :'T2');


SELECT as_user(:'T1','expenses.record','on');
CREATE FUNCTION kv_set(k text, v text) RETURNS void LANGUAGE sql AS $$ INSERT INTO kv VALUES (k, v) ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v $$;
GRANT EXECUTE ON FUNCTION kv_set(text,text) TO PUBLIC;
CREATE FUNCTION lid(p text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM lb_loans WHERE lender_name = p $$;
CREATE FUNCTION pay(p_ref text, p_lender text, p_amt numeric, p_on date) RETURNS text LANGUAGE sql AS $$ SELECT try(format($q$select loan_record_payment(%L,%L,%s,%L)$q$, p_ref, lid(p_lender), p_amt, p_on)) $$;
CREATE FUNCTION last_pay(p_lender text) RETURNS lb_loan_payments LANGUAGE sql AS $$ SELECT p FROM lb_loan_payments p WHERE loan_id = lid(p_lender) AND status='ACTIVE' ORDER BY n DESC LIMIT 1 $$;
CREATE FUNCTION inst(p_lender text, p_seq int) RETURNS lb_loan_installments LANGUAGE sql AS $$ SELECT i FROM lb_loan_installments i WHERE loan_id = lid(p_lender) AND seq = p_seq $$;
CREATE FUNCTION actual_bal(p_lender text) RETURNS numeric LANGUAGE sql AS $$ SELECT l.principal - coalesce(sum(i.paid_principal),0) FROM lb_loans l JOIN lb_loan_installments i ON i.loan_id=l.id WHERE l.id = lid(p_lender) GROUP BY l.principal $$;
CREATE FUNCTION sched_bal(p_lender text, p_seq int) RETURNS numeric LANGUAGE sql AS $$ SELECT l.principal - coalesce(sum(i.principal_due),0) FROM lb_loans l JOIN lb_loan_installments i ON i.loan_id=l.id AND i.seq <= p_seq WHERE l.id = lid(p_lender) GROUP BY l.principal $$;
GRANT EXECUTE ON FUNCTION lid(text), pay(text,text,numeric,date), last_pay(text), inst(text,int), actual_bal(text), sched_bal(text,int) TO PUBLIC;

-- ===== A. 100,000 at 1% a month, 12 instalments, everything long past due =====
SELECT try($$select loan_create('REF-R41-A',$$ || quote_literal(:'B1') || $$,'RedA','BANK',NULL,100000,'REDUCING',1,'MONTH',12,'MONTHLY','2025-02-01','2025-01-01')$$);
SELECT chk('new reducing loan: no interest charged yet on any instalment', (SELECT bool_and(interest_due = 0 AND accrues AND NOT interest_accrued) FROM lb_loan_installments WHERE loan_id = lid('RedA')));
SELECT chk('the original schedule is kept (scheduled_interest: month 1 = 1000)', (inst('RedA',1)).scheduled_interest = 1000);
SELECT chk('scheduled principal still adds up to 100,000', (SELECT sum(principal_due) FROM lb_loan_installments WHERE loan_id = lid('RedA')) = 100000);

-- the owner's example: lump sum bigger than the instalment
SELECT chk('pay 60,000 in month 1: accepted', pay('REF-R41-A1','RedA',60000,'2025-02-01') = 'OK');
SELECT chk('  interest = 1,000 (1% of the 100,000 balance)', (last_pay('RedA')).interest_paid = 1000);
SELECT chk('  principal = 59,000 (everything else)', (last_pay('RedA')).principal_paid = 59000);
SELECT chk('  actual balance is now 41,000', actual_bal('RedA') = 41000);
SELECT chk('  scheduled interest of FUTURE months was not paid in advance', (SELECT sum(paid_interest) FROM lb_loan_installments WHERE loan_id = lid('RedA') AND seq > 1) = 0);
SELECT chk('  months 2-12 not yet charged interest', (SELECT bool_and(interest_due = 0) FROM lb_loan_installments WHERE loan_id = lid('RedA') AND seq > 1));
SELECT chk('  loan is AHEAD of the schedule (actual balance below scheduled balance after month 1)', actual_bal('RedA') < sched_bal('RedA',1));
SELECT chk('  month 1 is PAID, month 2 is still PENDING', (inst('RedA',1)).status = 'PAID' AND (inst('RedA',2)).status = 'PENDING');
SELECT chk('  only the interest reached My Spending (1,000)', (SELECT sum(amount) FROM lb_expenses WHERE description LIKE '%RedA%') = 1000);

-- month 2: interest is charged on the NEW (lower) balance
SELECT chk('month 2 payment accepted', pay('REF-R41-A2','RedA',8884.88,'2025-03-01') = 'OK');
SELECT chk('  month 2 interest = 1% of 41,000 = 410 (not the scheduled ~913)', (inst('RedA',2)).interest_due = 410 AND (inst('RedA',2)).accrual_opening = 41000);
SELECT chk('  split: interest 410, principal 8,474.88', (last_pay('RedA')).interest_paid = 410 AND (last_pay('RedA')).principal_paid = 8474.88);

-- paying LITTLE and falling into arrears: interest keeps running on the higher balance
SELECT chk('dating: a payment inside an already-charged month is refused (22023)', try(format($$select loan_record_payment('REF-R41-A-OLD',%L,100,'2025-02-01')$$, lid('RedA'))) = '22023');
SELECT chk('small payment of 100 on 1 May 2025 (months 3 and 4 fall due, nothing paid for April)', pay('REF-R41-A3','RedA',100,'2025-05-01') = 'OK');
SELECT chk('  months 3 and 4 both charged on the same unpaid balance 32,525.12 -> 325.25 each',
  (inst('RedA',3)).interest_due = 325.25 AND (inst('RedA',4)).interest_due = 325.25 AND (inst('RedA',3)).accrual_opening = 32525.12 AND (inst('RedA',4)).accrual_opening = 32525.12);
SELECT chk('  the 100 went all to interest, none to principal', (last_pay('RedA')).interest_paid = 100 AND (last_pay('RedA')).principal_paid = 0);
SELECT chk('  the earlier lump sum still keeps the loan AHEAD of the schedule (32,525.12 owed vs ~66,000 scheduled): no arrears yet', actual_bal('RedA') = 32525.12 AND actual_bal('RedA') < sched_bal('RedA',4));
SELECT chk('next payment 1,000 on 1 Jun: all charged interest first (875.75), the rest to principal',
  pay('REF-R41-A4','RedA',1000,'2025-06-01') = 'OK' AND (last_pay('RedA')).interest_paid = 875.75 AND (last_pay('RedA')).principal_paid = 124.25);
SELECT chk('  month 5 interest was charged on the unpaid balance at month 4 (325.25)', (inst('RedA',5)).interest_due = 325.25);
SELECT chk('  payment split always adds up', (SELECT bool_and(interest_paid + fees_paid + principal_paid = amount) FROM lb_loan_payments WHERE loan_id = lid('RedA')));
SELECT chk('  nothing paid beyond what is charged (no instalment over-paid)', (SELECT bool_and(paid_interest <= interest_due AND paid_principal <= principal_due) FROM lb_loan_installments WHERE loan_id = lid('RedA')));

-- undo rules
SELECT chk('undo the latest payment', try(format($$select loan_void_payment(%L)$$, (SELECT id FROM lb_loan_payments WHERE loan_id = lid('RedA') AND status='ACTIVE' ORDER BY n DESC LIMIT 1))) = 'OK');
SELECT chk('  charged interest stays charged, and is owed again', (inst('RedA',5)).interest_due = 325.25 AND (inst('RedA',5)).paid_interest = 0 AND actual_bal('RedA') = 32525.12);
SELECT chk('  undoing an EARLIER payment that later interest was calculated on is refused (22023)',
  try(format($$select loan_void_payment(%L)$$, (SELECT id FROM lb_loan_payments WHERE loan_id = lid('RedA') AND status='ACTIVE' AND paid_on = '2025-03-01'))) = '22023');

-- ===== B. the owner's example exactly: 100,000 at 2% a month; pay 60,000 on the first due date =====
SELECT try($$select loan_create('REF-R41-B',$$ || quote_literal(:'B1') || $$,'RedB','BANK',NULL,100000,'REDUCING',2,'MONTH',12,'MONTHLY','2025-02-01','2025-01-01')$$);
SELECT chk('B: pay 60,000 -> 2,000 interest, 58,000 principal', pay('REF-R41-B1','RedB',60000,'2025-02-01') = 'OK' AND (last_pay('RedB')).interest_paid = 2000 AND (last_pay('RedB')).principal_paid = 58000);
SELECT chk('B: next month interest = 2% of 42,000 = 840', (SELECT pay('REF-R41-B2','RedB',1000,'2025-03-01')) = 'OK' AND (inst('RedB',2)).interest_due = 840);
SELECT chk('B: refused when more than interest + balance is paid (22023)', pay('REF-R41-B3','RedB',100000,'2025-03-02') = '22023');

-- ===== C. pay everything off in month 1 =====
SELECT try($$select loan_create('REF-R41-C',$$ || quote_literal(:'B1') || $$,'RedC','BANK',NULL,100000,'REDUCING',1,'MONTH',6,'MONTHLY','2025-02-01','2025-01-01')$$);
SELECT chk('C: 101,000 clears the whole loan (1,000 interest + 100,000)', pay('REF-R41-C1','RedC',101000,'2025-02-01') = 'OK');
SELECT chk('  loan CLEARED, every instalment PAID, no future interest charged', (SELECT status FROM lb_loans WHERE id = lid('RedC')) = 'CLEARED' AND (SELECT bool_and(status = 'PAID') FROM lb_loan_installments WHERE loan_id = lid('RedC')) AND (SELECT sum(interest_due) FROM lb_loan_installments WHERE loan_id = lid('RedC')) = 1000);
SELECT kv_set('cvoid', try(format($$select loan_void_payment(%L)$$, (SELECT id FROM lb_loan_payments WHERE loan_id = lid('RedC') AND status='ACTIVE'))));
SELECT chk('  undo is accepted', (SELECT v FROM kv WHERE k='cvoid') = 'OK');
SELECT chk('  ...and brings the loan and the closed instalments back', (SELECT status FROM lb_loans WHERE id = lid('RedC')) = 'ACTIVE' AND (SELECT count(*) FROM lb_loan_installments WHERE loan_id = lid('RedC') AND status = 'PAID') = 0);

-- ===== D. fees: unchanged rule, paid with principal in order =====
SELECT try($$select loan_create('REF-R41-D',$$ || quote_literal(:'B1') || $$,'RedD','BANK',NULL,12000,'REDUCING',12,'YEAR',3,'MONTHLY','2025-02-01','2025-01-01',0,100)$$);
SELECT kv_set('dpay', pay('REF-R41-D1','RedD',12000,'2025-02-01'));
SELECT chk('D: 12,000 paid in month 1 on a loan with a 100 monthly fee is accepted', (SELECT v FROM kv WHERE k='dpay') = 'OK');
SELECT chk('D: interest 120 + fees 300 (every month is already due) + principal 11,580', (last_pay('RedD')).interest_paid = 120 AND (last_pay('RedD')).fees_paid = 300 AND (last_pay('RedD')).principal_paid = 11580);
SELECT chk('D: every payment adds up and no table rule broke', (SELECT bool_and(interest_paid + fees_paid + principal_paid = amount) FROM lb_loan_payments WHERE loan_id = lid('RedD')));

-- ===== E. loan_accrue charges months without any payment =====
SELECT try($$select loan_create('REF-R41-E',$$ || quote_literal(:'B1') || $$,'RedE','BANK',NULL,50000,'REDUCING',1,'MONTH',3,'MONTHLY','2025-02-01','2025-01-01')$$);
SELECT as_user(:'T1','','off');
SELECT chk('E: a person without expenses.record gets {skipped:true}, nothing charged', (loan_accrue() ->> 'skipped') = 'true' AND (inst('RedE',1)).interest_due = 0);
SELECT as_user(:'T1','expenses.record','on');
SELECT kv_set('eacc', loan_accrue() ->> 'charged');
SELECT chk('E: loan_accrue charged the 3 past months', (SELECT v FROM kv WHERE k='eacc')::int >= 3);
SELECT chk('E: ...each at 1% of 50,000 = 500', (SELECT bool_and(interest_due = 500) FROM lb_loan_installments WHERE loan_id = lid('RedE')));
SELECT chk('E: running it again charges nothing more', (loan_accrue(:'B1') ->> 'charged')::int = 0);
SELECT chk('E: another business cannot be reached', (SELECT count(*) FROM lb_loans WHERE tenant_id = :'T2') = 0);

-- ===== H. paying little: the balance stays ABOVE the schedule = arrears =====
SELECT try($$select loan_create('REF-R41-H',$$ || quote_literal(:'B1') || $$,'RedH','BANK',NULL,100000,'REDUCING',1,'MONTH',12,'MONTHLY','2025-02-01','2025-01-01')$$);
SELECT chk('H: 3 months, only 1,500 paid: balance 100,000 is above the scheduled balance after month 3', pay('REF-R41-H1','RedH',1500,'2025-04-01') = 'OK' AND actual_bal('RedH') = 100000 - (last_pay('RedH')).principal_paid AND actual_bal('RedH') > sched_bal('RedH',3));
SELECT chk('H: month 4 interest is charged on the HIGH balance, not the scheduled one', pay('REF-R41-H2','RedH',500,'2025-05-01') = 'OK' AND (inst('RedH',4)).accrual_opening = actual_bal('RedH') + (last_pay('RedH')).principal_paid AND (inst('RedH',4)).accrual_opening > sched_bal('RedH',3));

-- ===== F. flat and no-interest loans are untouched =====
SELECT try($$select loan_create('REF-R41-F',$$ || quote_literal(:'B1') || $$,'FlatF','BANK',NULL,12000,'FLAT',12,'YEAR',12,'MONTHLY','2025-02-01','2025-01-01')$$);
SELECT chk('F: flat loan keeps its fixed interest (120 a month) and does not accrue', (SELECT bool_and(interest_due = 120 AND NOT accrues AND interest_accrued) FROM lb_loan_installments WHERE loan_id = lid('FlatF')));
SELECT kv_set('fpay', pay('REF-R41-F1','FlatF',1120,'2025-02-01'));
SELECT chk('F: a payment follows the old rule (interest on every instalment already due first)', (SELECT v FROM kv WHERE k='fpay') = 'OK' AND (last_pay('FlatF')).interest_paid = 1120 AND (last_pay('FlatF')).principal_paid = 0);
SELECT loan_accrue();
SELECT chk('F: loan_accrue leaves it alone', (SELECT bool_and(interest_due = 120) FROM lb_loan_installments WHERE loan_id = lid('FlatF')));

-- ===== G. existing loans are converted by the migration, past instalments keep their interest =====
ALTER TABLE lb_loan_installments DISABLE TRIGGER trg_loan_inst_accrual;
SELECT try($$select loan_create('REF-R41-G',$$ || quote_literal(:'B1') || $$,'OldRed','BANK',NULL,100000,'REDUCING',1,'MONTH',3,'MONTHLY','2025-02-01','2025-01-01')$$);
UPDATE lb_loan_installments SET due_date = _loan_today() + 40 * seq WHERE loan_id = lid('OldRed') AND seq >= 2;
ALTER TABLE lb_loan_installments ENABLE TRIGGER trg_loan_inst_accrual;
SELECT chk('G: before the migration the old loan has fixed interest on every instalment', (SELECT bool_and(interest_due > 0 AND NOT accrues) FROM lb_loan_installments WHERE loan_id = lid('OldRed')));
\i ../phase41_loan_reducing_balance.sql
SELECT chk('G: past-due instalment keeps its interest (charged), future ones switch to accrual (0 until their month)',
  (inst('OldRed',1)).accrues AND (inst('OldRed',1)).interest_accrued AND (inst('OldRed',1)).interest_due > 0
  AND (inst('OldRed',2)).accrues AND NOT (inst('OldRed',2)).interest_accrued AND (inst('OldRed',2)).interest_due = 0 AND (inst('OldRed',2)).scheduled_interest > 0);
SELECT chk('G: the migration can run twice without changing anything more', (SELECT count(*) FROM lb_loan_installments WHERE loan_id = lid('OldRed') AND accrues) = 3);
