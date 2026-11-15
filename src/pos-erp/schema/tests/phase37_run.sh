#!/bin/sh
# usage: phase37_run.sh   (scratch Postgres only; see README). Needs a local server on $PGHOST/$PGPORT.
export PGHOST=${PGHOST:-/var/tmp/pgloan} PGPORT=${PGPORT:-5537} PGUSER=postgres
D=p37test; cd "$(dirname "$0")"
psql -q -d postgres -c "drop database if exists $D" -c "create database $D" >/dev/null 2>&1
psql -q -v ON_ERROR_STOP=1 -d $D -f phase35_stubs.sql >/dev/null || { echo "stubs failed"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f phase37_stubs.sql >/dev/null || { echo "phase37 stubs failed"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase35_offline_idempotency.sql >/dev/null 2>/tmp/p37_p35.txt || { echo "PHASE35 FAILED"; cat /tmp/p37_p35.txt; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase37_loans.sql >/dev/null || { echo "MIGRATION FAILED"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase37_loans.sql >/dev/null || { echo "MIGRATION NOT RE-RUNNABLE"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase38_loan_part_payments.sql >/dev/null || { echo "PHASE38 FAILED"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase38_loan_part_payments.sql >/dev/null || { echo "PHASE38 NOT RE-RUNNABLE"; exit 1; }
psql -q -d $D -f phase37_scenarios.sql >/dev/null 2>/tmp/p37_err.txt
# ---- concurrency: two phones tap "Mark as paid" on the SAME instalment at the same moment. A holds its lock for 2s.
psql -q -At -d $D <<SQL >/dev/null
select set_config('test.tenant','00000000-0000-0000-0000-0000000000a1',false);
select set_config('test.owner','on',false);
select loan_create('REF-RACE-0001','00000000-0000-0000-0000-0000000000b1','Race Bank','BANK',NULL,10000,'FLAT',12,'YEAR',2,'MONTHLY',_loan_today()+5,_loan_today());
SQL
I=$(psql -At -d $D -c "select i.id from lb_loan_installments i join lb_loans l on l.id=i.loan_id where l.lender_name='Race Bank' and i.seq=1")
( psql -q -d $D >/dev/null <<SQL
set test.tenant='00000000-0000-0000-0000-0000000000a1'; set test.perms='expenses.record'; set test.owner='off';
begin; select loan_mark_paid('$I'); select pg_sleep(2); commit;
SQL
) &
sleep 0.7
psql -q -At -d $D -c "set test.tenant='00000000-0000-0000-0000-0000000000a1'" -c "set test.perms='expenses.record'" -c "set test.owner='off'" -c "select loan_mark_paid('$I') ->> 'already'" > /tmp/p37_b.txt 2>&1
wait
psql -q -d $D -c "insert into t_res(name, ok) select 'race: two simultaneous Mark-as-paid taps made exactly ONE expense', (select count(*) from lb_expenses where description like 'Loan interest%Race Bank%')=1"
psql -q -d $D -c "insert into t_res(name, ok) select 'race: the second tap was told it was already paid', '$(tail -1 /tmp/p37_b.txt)'='true'"
# ---- concurrency: two phones open the app together; auto-pay must post each due instalment once
psql -q -At -d $D <<SQL >/dev/null
select set_config('test.tenant','00000000-0000-0000-0000-0000000000a1',false); select set_config('test.owner','on',false); select set_config('test.perms','expenses.record',false);
select loan_create('REF-RACE-0002','00000000-0000-0000-0000-0000000000b1','Race Auto','BANK',NULL,30000,'FLAT',12,'YEAR',3,'MONTHLY',_loan_today()-50,_loan_today()-50,0,0,false,'BANK',0,true);
update lb_loans set auto_pay = true where lender_name = 'Race Auto';
SQL
( psql -q -d $D >/dev/null <<SQL
set test.tenant='00000000-0000-0000-0000-0000000000a1'; set test.perms='expenses.record'; set test.owner='off';
begin; select loan_post_due(); select pg_sleep(2); commit;
SQL
) &
sleep 0.7
psql -q -At -d $D -c "set test.tenant='00000000-0000-0000-0000-0000000000a1'" -c "set test.perms='expenses.record'" -c "set test.owner='off'" -c "select loan_post_due() ->> 'posted'" > /tmp/p37_c.txt 2>&1
wait
psql -q -d $D -c "insert into t_res(name, ok) select 'race: two phones opening the app together post each due instalment once', (select count(*) from lb_expenses where description like 'Loan interest%Race Auto%')=(select count(*) from lb_loan_installments i join lb_loans l on l.id=i.loan_id where l.lender_name='Race Auto' and i.due_date<=_loan_today() and i.status='PAID')"
psql -q -d $D -c "insert into t_res(name, ok) select 'race: ...and that is 2 (the 3rd is not due yet)', (select count(*) from lb_expenses where description like 'Loan interest%Race Auto%')=2"
psql -d $D -Atc "select (case when ok then 'PASS ' else 'FAIL ' end)||name from t_res order by n"
psql -d $D -Atc "select 'TOTAL '||count(*)||' FAIL '||count(*) filter (where not ok) from t_res"
