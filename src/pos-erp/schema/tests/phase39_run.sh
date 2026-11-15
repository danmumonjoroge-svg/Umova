#!/bin/sh
# usage: phase39_run.sh   (scratch Postgres only). Needs a local server on $PGHOST/$PGPORT (defaults /var/tmp/pg39, 5539).
export PGHOST=${PGHOST:-/var/tmp/pg39} PGPORT=${PGPORT:-5539} PGUSER=postgres
D=p39test; cd "$(dirname "$0")"
psql -q -d postgres -c "drop database if exists $D" -c "create database $D" >/dev/null 2>&1
psql -q -v ON_ERROR_STOP=1 -d $D -f phase39_stubs.sql >/dev/null || { echo "stubs failed"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase12_mpesa.sql >/dev/null 2>/tmp/p39_p12.txt || { echo "PHASE12 FAILED"; cat /tmp/p39_p12.txt; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -c "ALTER TABLE lb_mpesa_transactions ADD COLUMN IF NOT EXISTS rent_invoice_id uuid; ALTER TABLE lb_mpesa_transactions ALTER COLUMN cart_snapshot DROP NOT NULL;" >/dev/null
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase13_mpesa_client_credentials.sql >/dev/null 2>&1
psql -q -d $D -f ../diagnostics/phase39_precheck.sql >/tmp/p39_pre.txt 2>&1
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase39_mpesa_manual_and_prompt.sql >/dev/null 2>/tmp/p39_mig.txt || { echo "MIGRATION FAILED"; cat /tmp/p39_mig.txt; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase39_mpesa_manual_and_prompt.sql >/dev/null 2>&1 || { echo "MIGRATION NOT RE-RUNNABLE"; exit 1; }
psql -q -At -d $D -f phase39_scenarios.sql 2>&1 | grep -E "^(PASS|FAIL|TOTAL)|NOTICE:  (PASS|FAIL)|ERROR" | sed 's/^psql:[^ ]* //; s/NOTICE:  //'

# ---- existing duplicates: migration still runs, leaves old rows alone, refuses NEW duplicates ----
D2=p39dups
psql -q -d postgres -c "drop database if exists $D2" -c "create database $D2" >/dev/null 2>&1
psql -q -v ON_ERROR_STOP=1 -d $D2 -f phase39_stubs.sql >/dev/null; psql -q -v ON_ERROR_STOP=1 -d $D2 -f ../phase12_mpesa.sql >/dev/null 2>&1
psql -q -d $D2 -c "insert into lb_payments(tenant_id,payment_method,amount,reference_no,created_at) values ('00000000-0000-0000-0000-0000000000a1','MOBILE_MONEY',1,'DEMO-MPESA',now()-interval '1 day'),('00000000-0000-0000-0000-0000000000a1','MOBILE_MONEY',2,'DEMO-MPESA',now()-interval '1 day')" >/dev/null
OUT=$(psql -q -v ON_ERROR_STOP=1 -d $D2 -f ../phase39_mpesa_manual_and_prompt.sql 2>&1)
case "$OUT" in *"already appear more than once"*) echo "PASS migration runs over an existing duplicate and says what it left alone";; *) echo "FAIL no notice: $OUT";; esac
[ "$(psql -At -d $D2 -c "select count(*) from lb_payments where reference_no='DEMO-MPESA'")" = "2" ] && echo "PASS ...old duplicate rows are untouched" || echo "FAIL old rows changed"
psql -q -d $D2 -c "insert into lb_payments(tenant_id,payment_method,amount,reference_no) values ('00000000-0000-0000-0000-0000000000a1','MOBILE_MONEY',5,'NEWCODE001')" >/dev/null
psql -q -d $D2 -c "insert into lb_payments(tenant_id,payment_method,amount,reference_no) values ('00000000-0000-0000-0000-0000000000a1','MOBILE_MONEY',5,'newcode001')" 2>&1 | grep -q uq_lb_payments_mpesa_ref && echo "PASS ...a NEW duplicate is still refused" || echo "FAIL new duplicate accepted"
psql -q -v ON_ERROR_STOP=1 -d $D2 -f ../phase39_mpesa_manual_and_prompt.sql >/dev/null 2>&1 && echo "PASS ...and it is re-runnable" || echo "FAIL not re-runnable"
psql -q -d $D2 -f ../diagnostics/phase39_precheck.sql 2>&1 | grep -q "DEMOMPESA" && echo "PASS precheck query lists the duplicated code" || echo "FAIL precheck did not list it"

# ---- 11. two tills submit the SAME code at the same moment: exactly one wins ----
( psql -q -d $D >/dev/null <<SQL
begin; insert into lb_payments(tenant_id,payment_method,amount,reference_no,status) values ('00000000-0000-0000-0000-0000000000a1','MOBILE_MONEY',10,'RACE000001','COMPLETED'); select pg_sleep(2); commit;
SQL
) &
sleep 0.7
psql -q -At -d $D -c "insert into lb_payments(tenant_id,payment_method,amount,reference_no,status) values ('00000000-0000-0000-0000-0000000000a1','MOBILE_MONEY',10,'race-000001','COMPLETED')" > /tmp/p39_race.txt 2>&1
wait
grep -q uq_lb_payments_mpesa_ref /tmp/p39_race.txt && echo "PASS 11: concurrent same-code submit: the second is refused by the database" || echo "FAIL 11: $(cat /tmp/p39_race.txt)"
[ "$(psql -At -d $D -c "select count(*) from lb_payments where reference_no ilike 'race%'")" = "1" ] && echo "PASS 11: exactly ONE payment exists for that code" || echo "FAIL 11: more than one payment"
