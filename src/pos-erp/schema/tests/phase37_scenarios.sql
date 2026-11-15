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

-- ============ 1. the schedule calculator (pure) ============
SELECT chk('FLAT 120000 @12%/yr x12: principal adds to exactly 120000', (SELECT sum(principal_due) FROM loan_preview_schedule(120000,'FLAT',12,'YEAR',12,'MONTHLY','2026-01-31')) = 120000);
SELECT chk('FLAT 120000 @12%/yr x12: total interest 14400, 1200 each', (SELECT sum(interest_due) = 14400 AND min(interest_due) = 1200 AND max(interest_due) = 1200 FROM loan_preview_schedule(120000,'FLAT',12,'YEAR',12,'MONTHLY','2026-01-31')));
SELECT chk('month-end dates: 31 Jan, 28 Feb, 31 Mar (each counted from the first date)', (SELECT array_agg(due_date ORDER BY seq) FROM loan_preview_schedule(1000,'NONE',0,'YEAR',3,'MONTHLY','2026-01-31')) = ARRAY['2026-01-31','2026-02-28','2026-03-31']::date[]);
SELECT chk('weekly dates are 7 days apart', (SELECT array_agg(due_date ORDER BY seq) FROM loan_preview_schedule(1000,'NONE',0,'YEAR',3,'WEEKLY','2026-03-02')) = ARRAY['2026-03-02','2026-03-09','2026-03-16']::date[]);
SELECT chk('NONE 10000 / 3: 3333.33, 3333.33, 3333.34 and no interest', (SELECT array_agg(principal_due ORDER BY seq) = ARRAY[3333.33,3333.33,3333.34] AND sum(interest_due) = 0 FROM loan_preview_schedule(10000,'NONE',0,'YEAR',3,'MONTHLY','2026-01-01')));
SELECT chk('1% per MONTH flat on 12000 x6 = 12%/yr -> interest 720', (SELECT sum(interest_due) FROM loan_preview_schedule(12000,'FLAT',1,'MONTH',6,'MONTHLY','2026-01-01')) = 720);
SELECT chk('REDUCING 100000 @14%/yr x12: principal adds to exactly 100000', (SELECT sum(principal_due) FROM loan_preview_schedule(100000,'REDUCING',14,'YEAR',12,'MONTHLY','2026-01-01')) = 100000);
SELECT chk('REDUCING: first month interest = 100000 x 14%/12 = 1166.67', (SELECT interest_due FROM loan_preview_schedule(100000,'REDUCING',14,'YEAR',12,'MONTHLY','2026-01-01') WHERE seq = 1) = 1166.67);
SELECT chk('REDUCING: instalments are level to within a few cents (last absorbs rounding)', (SELECT max(principal_due+interest_due) - min(principal_due+interest_due) < 0.5 FROM loan_preview_schedule(100000,'REDUCING',14,'YEAR',12,'MONTHLY','2026-01-01')));
SELECT chk('REDUCING: interest falls every month', (SELECT bool_and(i2 < i1) FROM (SELECT interest_due i2, lag(interest_due) OVER (ORDER BY seq) i1 FROM loan_preview_schedule(100000,'REDUCING',14,'YEAR',12,'MONTHLY','2026-01-01')) x WHERE i1 IS NOT NULL));
SELECT chk('REDUCING total interest is less than FLAT at the same headline rate', (SELECT sum(interest_due) FROM loan_preview_schedule(100000,'REDUCING',14,'YEAR',12,'MONTHLY','2026-01-01')) < (SELECT sum(interest_due) FROM loan_preview_schedule(100000,'FLAT',14,'YEAR',12,'MONTHLY','2026-01-01')));
SELECT chk('REDUCING 1 instalment: all principal, one month interest', (SELECT principal_due = 5000 AND interest_due = 50 FROM loan_preview_schedule(5000,'REDUCING',12,'YEAR',1,'MONTHLY','2026-01-01')));
SELECT chk('monthly fee is carried on every row', (SELECT bool_and(fees_due = 150) AND count(*) = 4 FROM loan_preview_schedule(4000,'NONE',0,'YEAR',4,'MONTHLY','2026-01-01',150)));
SELECT chk('zero amount refused (22023)', try($$select * from loan_preview_schedule(0,'NONE',0,'YEAR',3,'MONTHLY','2026-01-01')$$) = '22023');
SELECT chk('interest method with no rate refused (22023)', try($$select * from loan_preview_schedule(1000,'FLAT',0,'YEAR',3,'MONTHLY','2026-01-01')$$) = '22023');
SELECT chk('0 instalments refused (22023)', try($$select * from loan_preview_schedule(1000,'NONE',0,'YEAR',0,'MONTHLY','2026-01-01')$$) = '22023');
SELECT chk('unknown method refused (22023)', try($$select * from loan_preview_schedule(1000,'COMPOUND',5,'YEAR',3,'MONTHLY','2026-01-01')$$) = '22023');

-- ============ 2. adding a loan: owner only, safe to retry ============
SELECT as_user(:'T1','expenses.record','off');
SELECT chk('a non-owner cannot add a loan (42501)', try(format($$select loan_create('REF-NOTOWNER-1',%L,'Equity Bank','BANK',NULL,120000,'FLAT',12,'YEAR',12,'MONTHLY',_loan_today()+10,_loan_today())$$, :'B1')) = '42501');
SELECT chk('...and nothing was saved', (SELECT count(*) FROM lb_loans) = 0);
SELECT as_user(:'T1','','on');   -- owner (the owner always has every permission in real life; here the loan itself needs none)
SELECT chk('owner adds a loan', try(format($$select loan_create('REF-LOAN-0001',%L,'Equity Bank','BANK','EQ-123',120000,'FLAT',12,'YEAR',12,'MONTHLY',_loan_today()+10,_loan_today())$$, :'B1')) = 'OK');
SELECT chk('12 instalments made, all pending', (SELECT count(*) = 12 AND bool_and(status = 'PENDING') FROM lb_loan_installments));
SELECT chk('instalment principal adds to the loan amount', (SELECT sum(principal_due) FROM lb_loan_installments) = 120000);
SELECT chk('adding a loan posts NO expense', (SELECT count(*) FROM lb_expenses) = 0);
SELECT chk('same reference + same request again: no second loan (retry safe)', try(format($$select loan_create('REF-LOAN-0001',%L,'Equity Bank','BANK','EQ-123',120000,'FLAT',12,'YEAR',12,'MONTHLY',_loan_today()+10,_loan_today())$$, :'B1')) = 'OK' AND (SELECT count(*) FROM lb_loans) = 1);
SELECT chk('same reference with a different request refused (P0409)', try(format($$select loan_create('REF-LOAN-0001',%L,'Equity Bank','BANK','EQ-123',999999,'FLAT',12,'YEAR',12,'MONTHLY',_loan_today()+10,_loan_today())$$, :'B1')) = 'P0409');
SELECT chk('someone else''s business refused (42501)', try(format($$select loan_create('REF-LOAN-0002',%L,'X','BANK',NULL,1000,'NONE',0,'YEAR',2,'MONTHLY',_loan_today()+10,_loan_today())$$, :'B2')) = '42501');
SELECT chk('processing fee on an old (not-received-in-app) loan refused (22023)', try(format($$select loan_create('REF-LOAN-0003',%L,'X','BANK',NULL,1000,'NONE',0,'YEAR',4,'MONTHLY',_loan_today()+10,_loan_today(),500,0,false,'BANK',0,false)$$, :'B1')) = '22023');
SELECT chk('"already paid" must be fewer than all instalments (22023)', try(format($$select loan_create('REF-LOAN-0004',%L,'X','BANK',NULL,1000,'NONE',0,'YEAR',4,'MONTHLY',_loan_today()+10,_loan_today(),0,0,false,'BANK',4,true)$$, :'B1')) = '22023');
INSERT INTO kv SELECT 'loan1', id::text FROM lb_loans WHERE reference_no = 'EQ-123';
INSERT INTO kv SELECT 'inst1', id::text FROM lb_loan_installments WHERE seq = 1 AND loan_id = (SELECT v::uuid FROM kv WHERE k = 'loan1');
INSERT INTO kv SELECT 'inst2', id::text FROM lb_loan_installments WHERE seq = 2 AND loan_id = (SELECT v::uuid FROM kv WHERE k = 'loan1');

-- ============ 3. reading is locked to your own business; writing only through the functions ============
SET ROLE authenticated;
SELECT as_user(:'T2','','on');
SELECT chk('another business sees none of these loans (RLS)', (SELECT count(*) FROM lb_loans) = 0 AND (SELECT count(*) FROM lb_loan_installments) = 0);
SELECT as_user(:'T1','','on');
SELECT chk('your own business sees its loan', (SELECT count(*) FROM lb_loans) = 1);
SELECT chk('writing straight into lb_loans is refused', try(format($$insert into lb_loans (tenant_id,business_id,lender_name,lender_type,principal,interest_method,term_count,frequency,first_due_date,disbursed_on) values (%L,%L,'x','BANK',1,'NONE',1,'MONTHLY',now(),now())$$, :'T1', :'B1')) = '42501');
SELECT chk('editing an instalment straight in the table is refused', try($$update lb_loan_installments set principal_due = 1$$) = '42501');
RESET ROLE;

-- ============ 4. marking an instalment paid: only interest + fees reach My Spending ============
SELECT as_user(:'T1','','off');
SELECT chk('without expenses.record, mark paid is refused (42501)', try(format($$select loan_mark_paid(%L)$$, (SELECT v FROM kv WHERE k='inst1'))) = '42501');
SELECT as_user(:'T1','expenses.record','off');
SELECT chk('a payment date in the future is refused (22023)', try(format($$select loan_mark_paid(%L, _loan_today()+3)$$, (SELECT v FROM kv WHERE k='inst1'))) = '22023');
SELECT as_user(:'T2','expenses.record','off');
SELECT chk('someone else''s instalment cannot be touched (42501)', try(format($$select loan_mark_paid(%L)$$, (SELECT v FROM kv WHERE k='inst1'))) = '42501');
SELECT as_user(:'T1','expenses.record','off');
SELECT chk('mark instalment 1 paid', try(format($$select loan_mark_paid(%L)$$, (SELECT v FROM kv WHERE k='inst1'))) = 'OK');
SELECT chk('exactly one expense posted, for the INTEREST only (1200, not the 11200 instalment)', (SELECT count(*) = 1 AND sum(amount) = 1200 FROM lb_expenses));
SELECT chk('it is in the "Loan Interest & Charges" category', (SELECT c.name = 'Loan Interest & Charges' FROM lb_expenses e JOIN lb_expense_categories c ON c.id = e.category_id));
SELECT chk('paid early: the expense is dated today, never in the future', (SELECT expense_date = _loan_today() AND status = 'PAID' FROM lb_expenses));
SELECT chk('the instalment is PAID and linked to that expense', (SELECT i.status = 'PAID' AND NOT i.auto_posted AND a.expense_id = e.id FROM lb_loan_installments i JOIN lb_loan_payment_allocations a ON a.installment_id = i.id JOIN lb_expenses e ON e.id = a.expense_id WHERE i.id = (SELECT v::uuid FROM kv WHERE k='inst1')));
SELECT chk('paying it again changes nothing (already = true, still 1 expense)', (SELECT loan_mark_paid((SELECT v::uuid FROM kv WHERE k='inst1')) ->> 'already') = 'true' AND (SELECT count(*) FROM lb_expenses) = 1);
SELECT chk('the loan is still ACTIVE', (SELECT status = 'ACTIVE' FROM lb_loans));

-- ============ 5. owner corrections ============
SELECT as_user(:'T1','expenses.record','off');
SELECT chk('a non-owner cannot undo (42501)', try(format($$select loan_void_payment(%L)$$, pay_of((SELECT v FROM kv WHERE k='inst1')::uuid))) = '42501');
SELECT chk('a non-owner cannot edit an instalment (42501)', try(format($$select loan_update_installment(%L,_loan_today()+40,1000,100,0)$$, (SELECT v FROM kv WHERE k='inst2'))) = '42501');
SELECT chk('a non-owner cannot switch on auto-pay (42501)', try(format($$select loan_set_auto_pay(%L,true)$$, (SELECT v FROM kv WHERE k='loan1'))) = '42501');
SELECT chk('a non-owner cannot close a loan (42501)', try(format($$select loan_close(%L,'SETTLED')$$, (SELECT v FROM kv WHERE k='loan1'))) = '42501');
SELECT as_user(:'T1','expenses.record','on');
SELECT chk('owner edits instalment 2 to match the lender statement', try(format($$select loan_update_installment(%L,_loan_today()+41,10000,1500,50)$$, (SELECT v FROM kv WHERE k='inst2'))) = 'OK');
SELECT chk('...it is flagged edited with the new figures', (SELECT edited AND principal_due = 10000 AND interest_due = 1500 AND fees_due = 50 FROM lb_loan_installments WHERE id = (SELECT v::uuid FROM kv WHERE k='inst2')));
SELECT chk('a PAID instalment cannot be edited (22023)', try(format($$select loan_update_installment(%L,_loan_today(),1,1,0)$$, (SELECT v FROM kv WHERE k='inst1'))) = '22023');
SELECT chk('negative amounts refused (22023)', try(format($$select loan_update_installment(%L,_loan_today()+41,-5,100,0)$$, (SELECT v FROM kv WHERE k='inst2'))) = '22023');
SELECT chk('owner undoes instalment 1', try(format($$select loan_void_payment(%L)$$, pay_of((SELECT v FROM kv WHERE k='inst1')::uuid))) = 'OK');
SELECT chk('the expense is now REJECTED (every report counts PAID only)', (SELECT status = 'REJECTED' AND description LIKE '%(undone)' FROM lb_expenses));
SELECT chk('the instalment is back to PENDING and marked manual-only', (SELECT status = 'PENDING' AND manual_only AND expense_id IS NULL FROM lb_loan_installments WHERE id = (SELECT v::uuid FROM kv WHERE k='inst1')));
SELECT chk('PAID expenses total is now 0', (SELECT coalesce(sum(amount),0) FROM lb_expenses WHERE status = 'PAID') = 0);
SELECT chk('undoing twice is harmless', (SELECT loan_void_payment(pay_of((SELECT v::uuid FROM kv WHERE k='inst1'))) ->> 'already') = 'true');
SELECT chk('mark paid again after an undo works', try(format($$select loan_mark_paid(%L)$$, (SELECT v FROM kv WHERE k='inst1'))) = 'OK');
SELECT chk('...and posts a fresh expense (the undone one stays REJECTED)', (SELECT count(*) FROM lb_expenses WHERE status = 'PAID') = 1 AND (SELECT count(*) FROM lb_expenses WHERE status = 'REJECTED') = 1);

-- ============ 6. an older loan: some instalments already paid before using the app ============
SELECT as_user(:'T1','expenses.record','on');
SELECT chk('add an older loan, 2 of 6 already paid, money not received in the app', try(format($$select loan_create('REF-OLD-00001',%L,'Kenya SACCO','SACCO',NULL,60000,'REDUCING',1,'MONTH',6,'MONTHLY',_loan_today()+5,_loan_today()-90,0,0,false,'MOBILE_MONEY',2,false)$$, :'B1')) = 'OK');
SELECT chk('first 2 are PAID + pre_app, no expense for them', (SELECT count(*) = 2 AND bool_and(pre_app) AND bool_and(expense_id IS NULL) FROM lb_loan_installments i JOIN lb_loans l ON l.id = i.loan_id WHERE l.lender_name = 'Kenya SACCO' AND i.status = 'PAID'));
SELECT chk('the other 4 are PENDING', (SELECT count(*) = 4 FROM lb_loan_installments i JOIN lb_loans l ON l.id = i.loan_id WHERE l.lender_name = 'Kenya SACCO' AND i.status = 'PENDING'));
SELECT chk('a pre-app instalment has no payment to undo (42501)', try(format($$select loan_void_payment(%L)$$, pay_of((SELECT i.id FROM lb_loan_installments i JOIN lb_loans l ON l.id = i.loan_id WHERE l.lender_name = 'Kenya SACCO' AND i.seq = 1)::uuid))) = '42501');
SELECT chk('record_disbursement = false is stored', (SELECT NOT record_disbursement FROM lb_loans WHERE lender_name = 'Kenya SACCO'));

-- ============ 7. auto-pay: posts on the due date, backfilled, never twice ============
-- a loan whose first 3 instalments are already past (first due 70 days ago, monthly): switched to manual first so we can test the permission skip
SELECT as_user(:'T1','','on');
SELECT chk('add a past-due loan on manual', try(format($$select loan_create('REF-AUTO-0001',%L,'Standing Order Ltd','BANK',NULL,60000,'FLAT',12,'YEAR',6,'MONTHLY',_loan_today()-70,_loan_today()-70,0,100,false,'BANK',0,true)$$, :'B1')) = 'OK');
INSERT INTO kv SELECT 'auto', id::text FROM lb_loans WHERE lender_name = 'Standing Order Ltd';
INSERT INTO kv SELECT 'due_n', count(*)::text FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='auto') AND due_date <= _loan_today();
SELECT chk('3 instalments are already due', (SELECT v FROM kv WHERE k = 'due_n') = '3');
SELECT chk('manual loans are NOT auto-posted', (SELECT count(*) FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='auto') AND status = 'PAID') = 0);
-- owner flips auto-pay on while holding no expenses.record: must not error, must not post
SELECT chk('switch on auto-pay by someone who may not record expenses: no error', try(format($$select loan_set_auto_pay(%L,true)$$, (SELECT v FROM kv WHERE k='auto'))) = 'OK');
SELECT chk('...nothing was posted (skipped, not failed)', (SELECT count(*) FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='auto') AND status = 'PAID') = 0);
SELECT chk('loan_post_due reports them skipped', (SELECT (loan_post_due() ->> 'skipped')::int = 3));
SELECT as_user(:'T1','expenses.record','off');
SELECT chk('someone with expenses.record opens the app: 3 posted', (SELECT (loan_post_due() ->> 'posted')::int = 3));
SELECT chk('each posted on its DUE date (paid_on = due_date, expense_date = due_date)', (SELECT bool_and(i.paid_on = i.due_date AND e.expense_date = i.due_date AND i.auto_posted) AND count(*) = 3 FROM lb_loan_installments i JOIN lb_loan_payment_allocations al ON al.installment_id = i.id JOIN lb_expenses e ON e.id = al.expense_id AND e.status = 'PAID' WHERE i.loan_id = (SELECT v::uuid FROM kv WHERE k='auto')));
SELECT chk('each expense = interest + monthly fee (600 + 100 = 700), principal excluded', (SELECT bool_and(e.amount = 700) FROM lb_loan_installments i JOIN lb_loan_payment_allocations al ON al.installment_id = i.id JOIN lb_expenses e ON e.id = al.expense_id AND e.status = 'PAID' WHERE i.loan_id = (SELECT v::uuid FROM kv WHERE k='auto')));
SELECT chk('automatic expenses say so and have no staff member', (SELECT bool_and(e.description LIKE '%(automatic)' AND e.created_by IS NULL) FROM lb_loan_installments i JOIN lb_loan_payment_allocations al ON al.installment_id = i.id JOIN lb_expenses e ON e.id = al.expense_id AND e.status = 'PAID' WHERE i.loan_id = (SELECT v::uuid FROM kv WHERE k='auto')));
SELECT chk('opening the app again posts nothing more', (SELECT (loan_post_due() ->> 'posted')::int = 0) AND (SELECT count(*) FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='auto') AND status = 'PAID') = 3);
SELECT chk('future instalments are left alone', (SELECT count(*) = 3 FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='auto') AND status = 'PENDING'));
-- undo an auto-posted one: it must not be re-posted by the next app-open
SELECT as_user(:'T1','expenses.record','on');
INSERT INTO kv SELECT 'auto_i3', id::text FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='auto') AND seq = 3;
SELECT chk('owner undoes an auto-posted instalment', try(format($$select loan_void_payment(%L)$$, pay_of((SELECT v FROM kv WHERE k='auto_i3')::uuid))) = 'OK');
SELECT chk('the next app-open does NOT re-post it', (SELECT (loan_post_due() ->> 'posted')::int = 0) AND (SELECT status = 'PENDING' FROM lb_loan_installments WHERE id = (SELECT v::uuid FROM kv WHERE k='auto_i3')));
SELECT chk('but it can still be marked paid by hand', try(format($$select loan_mark_paid(%L)$$, (SELECT v FROM kv WHERE k='auto_i3'))) = 'OK');
SELECT chk('the hand-posted one is dated on the due date (paid late is not backdated wrongly: due date wins)', (SELECT e.expense_date = i.due_date AND NOT i.auto_posted FROM lb_loan_installments i JOIN lb_loan_payment_allocations al ON al.installment_id = i.id JOIN lb_expenses e ON e.id = al.expense_id AND e.status = 'PAID' WHERE i.id = (SELECT v::uuid FROM kv WHERE k='auto_i3')));

-- ============ 8. interest-free loan, clearing, and closing ============
SELECT as_user(:'T1','expenses.record','on');
SELECT chk('add an interest-free 1-instalment loan', try(format($$select loan_create('REF-FREE-0001',%L,'Friend','OTHER',NULL,5000,'NONE',0,'YEAR',1,'MONTHLY',_loan_today()+1,_loan_today())$$, :'B1')) = 'OK');
INSERT INTO kv SELECT 'free_i', i.id::text FROM lb_loan_installments i JOIN lb_loans l ON l.id = i.loan_id WHERE l.lender_name = 'Friend';
SELECT chk('mark the interest-free instalment paid', try(format($$select loan_mark_paid(%L)$$, (SELECT v FROM kv WHERE k='free_i'))) = 'OK');
SELECT chk('...no expense at all (nothing is interest)', (SELECT expense_id IS NULL AND status = 'PAID' FROM lb_loan_installments WHERE id = (SELECT v::uuid FROM kv WHERE k='free_i')));
SELECT chk('the loan becomes CLEARED', (SELECT status = 'CLEARED' FROM lb_loans WHERE lender_name = 'Friend'));
SELECT chk('undo it', try(format($$select loan_void_payment(%L)$$, pay_of((SELECT v FROM kv WHERE k='free_i')::uuid))) = 'OK');
SELECT chk('...the loan is ACTIVE again', (SELECT status = 'ACTIVE' FROM lb_loans WHERE lender_name = 'Friend'));
SELECT chk('add a loan with a 500 processing fee', try(format($$select loan_create('REF-FEE-00001',%L,'Fee Bank','BANK',NULL,20000,'NONE',0,'YEAR',2,'MONTHLY',_loan_today()+30,_loan_today(),500)$$, :'B1')) = 'OK');
SELECT chk('...the 500 is posted at once as an expense', (SELECT count(*) = 1 AND sum(amount) = 500 FROM lb_expenses WHERE description LIKE 'Loan processing fee%' AND status = 'PAID'));
INSERT INTO kv SELECT 'fee_loan', id::text FROM lb_loans WHERE lender_name = 'Fee Bank';
SELECT chk('cancel a mistaken loan (nothing paid on it)', try(format($$select loan_close(%L,'CANCEL')$$, (SELECT v FROM kv WHERE k='fee_loan'))) = 'OK');
SELECT chk('...loan CANCELLED, schedule cancelled, fee expense REJECTED',
  (SELECT status = 'CANCELLED' FROM lb_loans WHERE lender_name = 'Fee Bank')
  AND (SELECT bool_and(status = 'CANCELLED') FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='fee_loan'))
  AND (SELECT status = 'REJECTED' FROM lb_expenses WHERE description LIKE 'Loan processing fee%'));
SELECT chk('cancelling a loan that already has payments is refused (22023)', try(format($$select loan_close(%L,'CANCEL')$$, (SELECT v FROM kv WHERE k='loan1'))) = '22023');
SELECT chk('close a loan as paid off early (SETTLED)', try(format($$select loan_close(%L,'SETTLED')$$, (SELECT v FROM kv WHERE k='loan1'))) = 'OK');
SELECT chk('...remaining instalments cancelled, history kept',
  (SELECT status = 'CLOSED' FROM lb_loans WHERE id = (SELECT v::uuid FROM kv WHERE k='loan1'))
  AND (SELECT count(*) = 1 FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='loan1') AND status = 'PAID')
  AND (SELECT count(*) = 11 FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='loan1') AND status = 'CANCELLED'));
SELECT chk('a closed loan is not touched by auto-post or mark-paid', (SELECT loan_mark_paid((SELECT id FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='loan1') AND seq = 5)) ->> 'already') = 'true');


-- ============ 8b. part payments, over payments, interest before principal ============
-- 12 monthly instalments, each 10000 loan + 1200 interest = 11200. First due 70 days ago -> instalments 1,2,3 are already due (arrears), 4+ are in the future.
SELECT as_user(:'T1','expenses.record','on');
SELECT chk('add a loan with 3 instalments already due', try(format($$select loan_create('REF-PAY-00001',%L,'Pay Test','BANK','PT-1',120000,'FLAT',12,'YEAR',12,'MONTHLY',_loan_today()-70,_loan_today()-70)$$, :'B1')) = 'OK');
INSERT INTO kv SELECT 'pt', id::text FROM lb_loans WHERE lender_name = 'Pay Test';
INSERT INTO kv SELECT 'pt_i'||seq, id::text FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt');
SELECT chk('3 instalments are due (11200 each), the rest in the future', (SELECT count(*) = 3 AND bool_and(interest_due = 1200 AND principal_due = 10000) FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt') AND due_date <= _loan_today()));

-- refusals
SELECT chk('amount 0 refused (22023)', try(format($$select loan_record_payment('REF-P-ZERO',%L,0)$$, (SELECT v FROM kv WHERE k='pt'))) = '22023');
SELECT chk('negative amount refused (22023)', try(format($$select loan_record_payment('REF-P-NEG',%L,-5)$$, (SELECT v FROM kv WHERE k='pt'))) = '22023');
SELECT chk('3 decimal places refused (22023)', try(format($$select loan_record_payment('REF-P-DEC',%L,10.001)$$, (SELECT v FROM kv WHERE k='pt'))) = '22023');
SELECT chk('a future date refused (22023)', try(format($$select loan_record_payment('REF-P-FUT',%L,1000,_loan_today()+2)$$, (SELECT v FROM kv WHERE k='pt'))) = '22023');
SELECT chk('more than the whole loan still owes refused (22023)', try(format($$select loan_record_payment('REF-P-BIG',%L,134400.01)$$, (SELECT v FROM kv WHERE k='pt'))) = '22023');
SELECT as_user(:'T1','','off');
SELECT chk('without expenses.record a payment is refused (42501)', try(format($$select loan_record_payment('REF-P-PERM',%L,1000)$$, (SELECT v FROM kv WHERE k='pt'))) = '42501');
SELECT as_user(:'T2','expenses.record','on');
SELECT chk('someone else''s loan cannot be paid (42501)', try(format($$select loan_record_payment('REF-P-OTH',%L,1000)$$, (SELECT v FROM kv WHERE k='pt'))) = '42501');
SELECT as_user(:'T1','expenses.record','on');
SELECT chk('...and nothing was recorded by any refusal', (SELECT count(*) FROM lb_loan_payments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt')) = 0);

-- 1) PART payment 7000 against 33600 due: interest on ALL due instalments first (3 x 1200 = 3600), only then principal (3400) on the oldest
SELECT chk('part payment of 7000 is accepted', try(format($$select loan_record_payment('REF-P-0001',%L,7000,NULL,'MOBILE_MONEY','first part')$$, (SELECT v FROM kv WHERE k='pt'))) = 'OK');
SELECT chk('...split 3600 interest + 3400 principal (interest first)', (SELECT amount = 7000 AND interest_paid = 3600 AND fees_paid = 0 AND principal_paid = 3400 AND payment_method = 'MOBILE_MONEY' AND note = 'first part' FROM lb_loan_payments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt')));
SELECT chk('...interest of all 3 due instalments paid, principal only on the oldest', (SELECT (array_agg(paid_interest ORDER BY seq))[1:3] = ARRAY[1200,1200,1200]::numeric[] AND (array_agg(paid_principal ORDER BY seq))[1:3] = ARRAY[3400,0,0]::numeric[] FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt')));
SELECT chk('...instalment 1 is still PENDING (part paid), nothing else changed', (SELECT count(*) FILTER (WHERE status = 'PAID') = 0 FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt')));
SELECT chk('...only INTEREST reached My Spending: 3 expenses of 1200 = 3600, principal not', (SELECT count(*) = 3 AND sum(amount) = 3600 AND bool_and(description LIKE 'Loan interest%Pay Test%(part payment)') FROM lb_expenses WHERE description LIKE 'Loan interest%Pay Test%' AND status = 'PAID'));
SELECT chk('...each interest expense is dated on its instalment''s due date (paid late)', (SELECT bool_and(e.expense_date = i.due_date) FROM lb_loan_payment_allocations a JOIN lb_loan_installments i ON i.id = a.installment_id JOIN lb_expenses e ON e.id = a.expense_id WHERE i.loan_id = (SELECT v::uuid FROM kv WHERE k='pt')));
SELECT chk('same reference again: no second payment (retry safe)', try(format($$select loan_record_payment('REF-P-0001',%L,7000,NULL,'MOBILE_MONEY','first part')$$, (SELECT v FROM kv WHERE k='pt'))) = 'OK' AND (SELECT count(*) FROM lb_loan_payments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt')) = 1);
SELECT chk('same reference, different amount refused (P0409)', try(format($$select loan_record_payment('REF-P-0001',%L,8000,NULL,'MOBILE_MONEY','first part')$$, (SELECT v FROM kv WHERE k='pt'))) = 'P0409');

-- THE RULE, enforced by the table itself: principal can never be paid while interest is owed (and not the other way round either)
SELECT chk('the table refuses principal on an instalment whose interest is unpaid (23514)', try(format($$update lb_loan_installments set paid_principal = 1 where id = %L$$, (SELECT v FROM kv WHERE k='pt_i4'))) = '23514');
SELECT chk('the table refuses paying more than is due on a part (23514)', try(format($$update lb_loan_installments set paid_interest = 1201 where id = %L$$, (SELECT v FROM kv WHERE k='pt_i2'))) = '23514');

-- owner corrections on a part-paid instalment
SELECT as_user(:'T1','','on');
SELECT chk('a part-paid instalment cannot be set below what was paid (22023)', try(format($$select loan_update_installment(%L,_loan_today()-70,3000,1200,0)$$, (SELECT v FROM kv WHERE k='pt_i1'))) = '22023');
SELECT chk('its interest cannot change once loan principal is being paid (22023)', try(format($$select loan_update_installment(%L,_loan_today()-70,10000,1500,0)$$, (SELECT v FROM kv WHERE k='pt_i1'))) = '22023');
SELECT chk('...but its due date can move', try(format($$select loan_update_installment(%L,_loan_today()-65,10000,1200,0)$$, (SELECT v FROM kv WHERE k='pt_i1'))) = 'OK');
SELECT as_user(:'T1','expenses.record','on');

-- 2) "Mark as paid" on a part-paid instalment pays only the BALANCE (6600 of loan; its interest is already paid -> no new expense)
SELECT chk('mark instalment 1 paid after a part payment', try(format($$select loan_mark_paid(%L)$$, (SELECT v FROM kv WHERE k='pt_i1'))) = 'OK');
SELECT chk('...it paid only the balance: 6600 principal, 0 interest', (SELECT amount = 6600 AND principal_paid = 6600 AND interest_paid = 0 FROM lb_loan_payments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt') ORDER BY n DESC LIMIT 1));
SELECT chk('...instalment 1 is PAID and no extra expense was made', (SELECT status = 'PAID' AND paid_principal = 10000 AND paid_interest = 1200 FROM lb_loan_installments WHERE id = (SELECT v::uuid FROM kv WHERE k='pt_i1')) AND (SELECT count(*) = 3 FROM lb_expenses WHERE description LIKE 'Loan interest%Pay Test%' AND status = 'PAID'));

-- 3) OVER payment 30000: clears the 2 overdue (20000 principal), the rest is paid AHEAD on the next instalment: interest first (1200) then principal (8800)
SELECT chk('an over payment of 30000 is accepted', try(format($$select loan_record_payment('REF-P-0002',%L,30000)$$, (SELECT v FROM kv WHERE k='pt'))) = 'OK');
SELECT chk('...split 1200 interest + 28800 principal', (SELECT amount = 30000 AND interest_paid = 1200 AND principal_paid = 28800 FROM lb_loan_payments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt') ORDER BY n DESC LIMIT 1));
SELECT chk('...instalments 1-3 are PAID', (SELECT bool_and(status = 'PAID') FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt') AND seq <= 3));
SELECT chk('...the extra went to the NEXT instalment: interest 1200 then principal 8800, still PENDING', (SELECT status = 'PENDING' AND paid_interest = 1200 AND paid_principal = 8800 FROM lb_loan_installments WHERE id = (SELECT v::uuid FROM kv WHERE k='pt_i4')));
SELECT chk('...nothing later was touched', (SELECT bool_and(paid_interest + paid_principal + paid_fees = 0) FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt') AND seq >= 5));
SELECT chk('...the ahead-paid interest got its own expense (1200), principal still not in spending', (SELECT count(*) = 4 AND sum(amount) = 4800 FROM lb_expenses WHERE description LIKE 'Loan interest%Pay Test%' AND status = 'PAID'));
SELECT chk('a further 500 is accepted', try(format($$select loan_record_payment('REF-P-0003',%L,500)$$, (SELECT v FROM kv WHERE k='pt'))) = 'OK');
SELECT chk('...and goes to the next instalment''s principal (8800 -> 9300), not further ahead', (SELECT paid_principal = 9300 FROM lb_loan_installments WHERE id = (SELECT v::uuid FROM kv WHERE k='pt_i4')) AND (SELECT bool_and(paid_interest + paid_principal = 0) FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt') AND seq >= 5));

-- invariants for the whole loan after all of that
SELECT chk('every instalment: principal paid only where interest + fees are fully paid', (SELECT bool_and(paid_principal = 0 OR (paid_interest = interest_due AND paid_fees = fees_due)) FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt')));
SELECT chk('payments add up to what instalments say was paid', (SELECT sum(amount) FROM lb_loan_payments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt') AND status = 'ACTIVE') = (SELECT sum(paid_principal + paid_interest + paid_fees) FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt')));
SELECT chk('spending (interest) equals interest + fees paid, to the cent', (SELECT coalesce(sum(amount),0) FROM lb_expenses WHERE description LIKE 'Loan interest%Pay Test%' AND status = 'PAID') = (SELECT sum(paid_interest + paid_fees) FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt')));

-- 4) undo: only the most recent payment, only the owner, in order
SELECT chk('an older payment cannot be undone while a later one exists (22023)', try(format($$select loan_void_payment(%L)$$, (SELECT id FROM lb_loan_payments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt') AND note = 'first part'))) = '22023');
SELECT as_user(:'T1','expenses.record','off');
SELECT chk('a non-owner cannot undo (42501)', try(format($$select loan_void_payment(%L)$$, (SELECT id FROM lb_loan_payments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt') ORDER BY n DESC LIMIT 1))) = '42501');
SELECT as_user(:'T1','expenses.record','on');
SELECT chk('owner undoes the latest (500) payment', try(format($$select loan_void_payment(%L)$$, (SELECT id FROM lb_loan_payments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt') AND status = 'ACTIVE' ORDER BY n DESC LIMIT 1))) = 'OK');
SELECT chk('owner undoes the 30000 payment', try(format($$select loan_void_payment(%L)$$, (SELECT id FROM lb_loan_payments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt') AND status = 'ACTIVE' ORDER BY n DESC LIMIT 1))) = 'OK');
SELECT chk('...instalments 2 and 3 are back to PENDING with only their interest paid; instalment 4 is untouched', (SELECT (array_agg(status ORDER BY seq))[2:4] = ARRAY['PENDING','PENDING','PENDING'] AND (array_agg(paid_principal ORDER BY seq))[2:4] = ARRAY[0,0,0]::numeric[] AND (array_agg(paid_interest ORDER BY seq))[2:4] = ARRAY[1200,1200,0]::numeric[] FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt')));
SELECT chk('...the ahead-paid interest expense is REJECTED, the three older ones are still PAID', (SELECT count(*) FILTER (WHERE status = 'REJECTED') = 1 AND count(*) FILTER (WHERE status = 'PAID') = 3 FROM lb_expenses WHERE description LIKE 'Loan interest%Pay Test%'));
SELECT chk('undoing the same payment again is harmless', (SELECT loan_void_payment((SELECT id FROM lb_loan_payments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt') AND status = 'VOIDED' ORDER BY n DESC LIMIT 1)) ->> 'already') = 'true');
SELECT chk('owner undoes the mark-as-paid payment', try(format($$select loan_void_payment(%L)$$, (SELECT id FROM lb_loan_payments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt') AND status = 'ACTIVE' ORDER BY n DESC LIMIT 1))) = 'OK');
SELECT chk('...then the first part payment (now the latest)', try(format($$select loan_void_payment(%L)$$, (SELECT id FROM lb_loan_payments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt') AND status = 'ACTIVE' ORDER BY n DESC LIMIT 1))) = 'OK');
SELECT chk('...the loan is back to nothing paid and no PAID spending', (SELECT bool_and(paid_interest + paid_principal + paid_fees = 0 AND status = 'PENDING') FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt')) AND (SELECT count(*) = 0 FROM lb_expenses WHERE description LIKE 'Loan interest%Pay Test%' AND status = 'PAID'));
SELECT as_user(:'T1','expenses.record','on');

-- 5) paying the whole loan in one go clears it; nothing more can be paid; undo re-opens it
SELECT chk('paying everything (134400) in one payment is accepted', try(format($$select loan_record_payment('REF-P-FULL',%L,134400)$$, (SELECT v FROM kv WHERE k='pt'))) = 'OK');
SELECT chk('...the loan is CLEARED and every instalment PAID', (SELECT status = 'CLEARED' FROM lb_loans WHERE id = (SELECT v::uuid FROM kv WHERE k='pt')) AND (SELECT bool_and(status = 'PAID') FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt')));
SELECT chk('...interest 14400 total went to spending, principal 120000 did not', (SELECT interest_paid = 14400 AND principal_paid = 120000 FROM lb_loan_payments WHERE note IS NULL AND status = 'ACTIVE' AND loan_id = (SELECT v::uuid FROM kv WHERE k='pt')) AND (SELECT sum(amount) = 14400 FROM lb_expenses WHERE description LIKE 'Loan interest%Pay Test%' AND status = 'PAID'));
SELECT chk('a cleared loan takes no more payments (22023)', try(format($$select loan_record_payment('REF-P-AFTER',%L,1)$$, (SELECT v FROM kv WHERE k='pt'))) = '22023');
SELECT as_user(:'T1','expenses.record','on');
SELECT chk('owner undoes the full payment', try(format($$select loan_void_payment(%L)$$, (SELECT id FROM lb_loan_payments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='pt') AND status = 'ACTIVE'))) = 'OK');
SELECT chk('...which re-opens the loan', (SELECT status = 'ACTIVE' FROM lb_loans WHERE id = (SELECT v::uuid FROM kv WHERE k='pt')));
SELECT as_user(:'T1','expenses.record','on');

-- 6) paid off early with a part-paid instalment: it keeps what it received
SELECT chk('add a second loan with 3 instalments due', try(format($$select loan_create('REF-PAY-00002',%L,'Settle Co','BANK','SC-1',120000,'FLAT',12,'YEAR',12,'MONTHLY',_loan_today()-70,_loan_today()-70)$$, :'B1')) = 'OK');
INSERT INTO kv SELECT 'sc', id::text FROM lb_loans WHERE lender_name = 'Settle Co';
SELECT chk('pay 5000 on it', try(format($$select loan_record_payment('REF-S-0001',%L,5000)$$, (SELECT v FROM kv WHERE k='sc'))) = 'OK');
SELECT as_user(:'T1','expenses.record','on');
SELECT chk('cancelling a loan with a part payment is refused (22023)', try(format($$select loan_close(%L,'CANCEL')$$, (SELECT v FROM kv WHERE k='sc'))) = '22023');
SELECT chk('close it as paid off early', try(format($$select loan_close(%L,'SETTLED')$$, (SELECT v FROM kv WHERE k='sc'))) = 'OK');
SELECT chk('...3 touched instalments kept as PAID at what was paid (1400 principal in total), the other 9 cancelled', (SELECT count(*) = 3 AND sum(principal_due) = 1400 AND sum(interest_due) = 3600 FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='sc') AND status = 'PAID') AND (SELECT count(*) = 9 FROM lb_loan_installments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='sc') AND status = 'CANCELLED'));
SELECT chk('a closed loan takes no more payments (22023)', try(format($$select loan_record_payment('REF-S-0002',%L,1)$$, (SELECT v FROM kv WHERE k='sc'))) = '22023');
SELECT chk('and its payments can no longer be undone (22023)', try(format($$select loan_void_payment(%L)$$, (SELECT id FROM lb_loan_payments WHERE loan_id = (SELECT v::uuid FROM kv WHERE k='sc') LIMIT 1))) = '22023');
SELECT as_user(:'T1','expenses.record','on');

-- ============ 9. invariants over everything above ============
SELECT chk('every active payment slice with interest/fees has its expense', (SELECT count(*) = 0 FROM lb_loan_payment_allocations a JOIN lb_loan_payments p ON p.id = a.payment_id WHERE p.status = 'ACTIVE' AND a.interest + a.fees > 0 AND a.expense_id IS NULL));
SELECT chk('no expense is linked to two payment slices', (SELECT count(*) = 0 FROM (SELECT expense_id FROM lb_loan_payment_allocations WHERE expense_id IS NOT NULL GROUP BY 1 HAVING count(*) > 1) x));
SELECT chk('principal never appears in expenses (all loan expenses are interest/fee sized)', (SELECT coalesce(max(amount),0) <= 1500 FROM lb_expenses WHERE description LIKE 'Loan%'));
SELECT chk('unedited loans: schedule principal adds to the loan amount', (SELECT bool_and(s.sp = l.principal) FROM lb_loans l JOIN (SELECT loan_id, sum(principal_due) sp, bool_or(edited) ed FROM lb_loan_installments GROUP BY 1) s ON s.loan_id = l.id WHERE NOT s.ed));
SELECT chk('audit rows were written for loan actions', (SELECT count(*) >= 8 FROM pos_audit_log WHERE entity_type = 'loan'));
