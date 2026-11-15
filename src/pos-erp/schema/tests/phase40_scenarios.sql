-- phase40 (scratch DB after phase37_run.sh): reproduce the live FK, prove the fix. Prints PASS/FAIL.
CREATE TABLE IF NOT EXISTS users (id uuid PRIMARY KEY);
CREATE TABLE IF NOT EXISTS pos_staff (id uuid PRIMARY KEY, auth_user_id uuid);
INSERT INTO users VALUES ('00000000-0000-0000-0000-00000000aaaa') ON CONFLICT DO NOTHING;
INSERT INTO pos_staff VALUES ('00000000-0000-0000-0000-00000000bbbb','00000000-0000-0000-0000-00000000aaaa') ON CONFLICT DO NOTHING;
ALTER TABLE lb_expenses DROP CONSTRAINT IF EXISTS lb_expenses_created_by_fkey;
ALTER TABLE lb_expenses ADD CONSTRAINT lb_expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES users(id) NOT VALID;
SET test.tenant='00000000-0000-0000-0000-0000000000a1'; SET test.owner='on'; SET test.perms='expenses.record';
SET test.jwt='{"pos_staff_id":"00000000-0000-0000-0000-00000000bbbb"}';
SELECT loan_create('REF-FK-0001','00000000-0000-0000-0000-0000000000b1','FK Bank','BANK',NULL,12000,'FLAT',12,'YEAR',3,'MONTHLY',_loan_today()+5,_loan_today(),0,0,false,'BANK',0,true);
\echo --- before fix: expected 23503
DO $$ BEGIN PERFORM loan_record_payment('loanpay-fk-0001', (SELECT id FROM lb_loans WHERE lender_name='FK Bank'), 500, NULL, NULL, NULL);
  RAISE NOTICE 'RESULT no error'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'RESULT %', SQLSTATE; END $$;
\i ../phase40_loan_expense_actor_fix.sql
\i ../phase40_loan_expense_actor_fix.sql
DO $$ BEGIN PERFORM loan_record_payment('loanpay-fk-0002', (SELECT id FROM lb_loans WHERE lender_name='FK Bank'), 500, NULL, NULL, NULL);
  RAISE NOTICE 'RESULT after fix: no error'; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'RESULT after fix: % %', SQLSTATE, SQLERRM; END $$;
SELECT 'created_by on the expense is the auth user: ' || (SELECT bool_and(created_by = '00000000-0000-0000-0000-00000000aaaa') FROM lb_expenses);
