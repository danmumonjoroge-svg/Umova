#!/bin/sh
# usage: phase41_run.sh [scenario-file]   (scratch Postgres only). Builds phase35 -> 37 -> 38 -> (pos_staff stub) -> 40 -> 41 (twice), then runs the scenarios.
# Default scenarios: phase41_scenarios.sql.  Pass phase37_scenarios.sql to see how the OLD loan tests behave on top of phase41.
export PGHOST=${PGHOST:-/var/tmp/pg39} PGPORT=${PGPORT:-5539} PGUSER=postgres
D=p41test; cd "$(dirname "$0")"; S=${1:-phase41_scenarios.sql}
psql -q -d postgres -c "drop database if exists $D" -c "create database $D" >/dev/null 2>&1
for f in phase35_stubs.sql phase37_stubs.sql ../phase35_offline_idempotency.sql ../phase37_loans.sql ../phase38_loan_part_payments.sql; do
  psql -q -v ON_ERROR_STOP=1 -d $D -f $f >/dev/null 2>/tmp/p41_err.txt || { echo "FAILED: $f"; cat /tmp/p41_err.txt; exit 1; }
done
psql -q -v ON_ERROR_STOP=1 -d $D -c "create table pos_staff (id uuid primary key, auth_user_id uuid)" >/dev/null
for f in ../phase40_loan_expense_actor_fix.sql ../phase41_loan_reducing_balance.sql ../phase41_loan_reducing_balance.sql; do
  psql -q -v ON_ERROR_STOP=1 -d $D -f $f >/dev/null 2>/tmp/p41_err.txt || { echo "FAILED: $f"; cat /tmp/p41_err.txt; exit 1; }
done
psql -q -d $D -f $S >/dev/null 2>/tmp/p41_scen_err.txt
psql -d $D -Atc "select (case when ok then 'PASS ' else 'FAIL ' end)||name from t_res order by n"
psql -d $D -Atc "select 'TOTAL '||count(*)||' FAIL '||count(*) filter (where not ok) from t_res"
