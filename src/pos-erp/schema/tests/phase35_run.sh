#!/bin/sh
# usage: phase35_run.sh   (scratch Postgres only; see README). Needs a local server on $PGHOST/$PGPORT.
export PGHOST=${PGHOST:-/var/tmp/pg35} PGPORT=${PGPORT:-5535} PGUSER=postgres
D=p35test; cd "$(dirname "$0")"
psql -q -d postgres -c "drop database if exists $D" -c "create database $D" >/dev/null 2>&1
psql -q -v ON_ERROR_STOP=1 -d $D -f phase35_stubs.sql >/dev/null || { echo "stubs failed"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase35_offline_idempotency.sql >/dev/null || { echo "MIGRATION FAILED"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase35_offline_idempotency.sql >/dev/null || { echo "MIGRATION NOT RE-RUNNABLE"; exit 1; }
psql -q -d $D -f phase35_scenarios.sql >/dev/null 2>/tmp/p35_err.txt
# concurrency: A holds the claim open for 2s; B arrives meanwhile with the SAME reference
T1=00000000-0000-0000-0000-0000000000a1; B1=00000000-0000-0000-0000-0000000000b1
psql -q -d $D -c "set test.tenant='$T1'; set test.perms='expenses.record'" -c "select 1" >/dev/null
( psql -q -d $D >/dev/null <<SQL
set test.tenant='$T1'; set test.perms='expenses.record';
begin; select pos_apply_expense('CONC-REF-0001','$B1',null,null,current_date,500,'CASH','race',null,'PAID',null); select pg_sleep(2); commit;
SQL
) &
sleep 0.7
psql -q -At -d $D -c "set test.tenant='$T1'" -c "set test.perms='expenses.record'" -c "select pos_apply_expense('CONC-REF-0001','$B1',null,null,current_date,500,'CASH','race',null,'PAID',null)->>'duplicate'" > /tmp/p35_b.txt 2>&1
wait
psql -q -d $D -c "insert into t_res(name, ok) select 'concurrent same-reference calls save ONE expense', (select count(*) from lb_expenses where description='race')=1"
psql -q -d $D -c "insert into t_res(name, ok) select 'the second concurrent call gets the first one''s result (duplicate=true)', '$(tail -1 /tmp/p35_b.txt)'='true'"
psql -d $D -Atc "select (case when ok then 'PASS ' else 'FAIL ' end)||name from t_res order by n"
psql -d $D -Atc "select 'TOTAL '||count(*)||' FAIL '||count(*) filter (where not ok) from t_res"
