#!/bin/sh
# usage: sh comm_run.sh   (scratch Postgres only; socket dir/port via PGHOST/PGPORT)
export PGHOST=${PGHOST:-/var/tmp/pgcomm} PGPORT=${PGPORT:-5550} PGUSER=${PGUSER:-pgu}
D=comm50test; cd "$(dirname "$0")"
psql -q -d postgres -c "drop database if exists $D" -c "create database $D" >/dev/null 2>&1
q() { psql -q -v ON_ERROR_STOP=1 -d $D "$@" >/dev/null || { echo "FAILED: $*"; exit 1; }; }
q -f live_stubs.sql
q -f comm_stubs.sql
q -f ../phase7_communication.sql
q -f ../phase8_whatsapp.sql
q -f ../phase10_supplier_messaging.sql
q -f ../phase50a_comm_enum_values.sql
q -f ../phase50_communication_engine.sql
q -f ../phase50_communication_engine.sql   # re-runnable
q -f ../phase51_comm_scheduler.sql
q -f ../phase51_comm_scheduler.sql
psql -q -d $D -f comm_scenarios.sql >/dev/null 2>/tmp/comm_err.txt
psql -d $D -Atc "select (case when ok then 'PASS ' else 'FAIL ' end)||name from t_res order by n"
psql -d $D -Atc "select 'TOTAL '||count(*)||' FAIL '||count(*) filter (where not ok) from t_res"
