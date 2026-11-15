#!/bin/sh
# usage: phase36_run.sh   (scratch Postgres only; see README). Needs a local server on $PGHOST/$PGPORT.
export PGHOST=${PGHOST:-/var/tmp/pgnet} PGPORT=${PGPORT:-5536} PGUSER=postgres
D=p36test; cd "$(dirname "$0")"
psql -q -d postgres -c "drop database if exists $D" -c "create database $D" >/dev/null 2>&1
psql -q -v ON_ERROR_STOP=1 -d $D -f phase35_stubs.sql >/dev/null || { echo "stubs failed"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f phase36_stubs.sql >/dev/null || { echo "phase36 stubs failed"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase35_offline_idempotency.sql >/dev/null || { echo "PHASE35 FAILED"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase36_network.sql >/dev/null || { echo "MIGRATION FAILED"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase36_network.sql >/dev/null || { echo "MIGRATION NOT RE-RUNNABLE"; exit 1; }
psql -q -d $D -f phase36_scenarios.sql >/dev/null 2>/tmp/p36_err.txt
# ---- concurrency: two orders each want 7 of a product that has 10. Confirmation A holds its lock for 2s; B arrives meanwhile.
S=00000000-0000-0000-0000-0000000000a1
( psql -q -d $D >/dev/null <<SQL
set test.tenant='$S'; set test.perms='sales.create';
begin; select network_confirm_order((select id from network_orders where client_reference='RACE-ORDER-A'),'RACE-CONF-A1'); select pg_sleep(2); commit;
SQL
) &
sleep 0.7
psql -q -At -d $D -c "set test.tenant='$S'" -c "set test.perms='sales.create'" -c "select try(format('select network_confirm_order(%L,%L)', (select id from network_orders where client_reference='RACE-ORDER-B'), 'RACE-CONF-B1'))" > /tmp/p36_b.txt 2>&1
wait
psql -q -d $D -c "insert into t_res(name, ok) select 'race: exactly one of two competing confirmations succeeded', (select count(*) from network_orders where client_reference like 'RACE-ORDER-%' and status='CONFIRMED')=1"
psql -q -d $D -c "insert into t_res(name, ok) select 'race: the loser was refused for stock (P0412)', '$(tail -1 /tmp/p36_b.txt)'='P0412'"
psql -q -d $D -c "insert into t_res(name, ok) select 'race: reserved never exceeds stock (7 <= 10)', (select coalesce(sum(r.quantity),0) from network_reservations r join network_order_lines l on l.id=r.order_line_id join network_orders o on o.id=l.order_id where r.status='ACTIVE' and o.client_reference like 'RACE-ORDER-%')<=10"
psql -d $D -Atc "select (case when ok then 'PASS ' else 'FAIL ' end)||name from t_res order by n"
psql -d $D -Atc "select 'TOTAL '||count(*)||' FAIL '||count(*) filter (where not ok) from t_res"
