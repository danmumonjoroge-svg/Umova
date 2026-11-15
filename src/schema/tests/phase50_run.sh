#!/bin/sh
# usage: phase50_run.sh   (scratch Postgres only). Runs phase48 + phase49 + phase50 and the scenarios.
export PGHOST=${PGHOST:-/var/tmp/pg49} PGPORT=${PGPORT:-5549} PGUSER=postgres
D=p50test; cd "$(dirname "$0")"
psql -q -d postgres -c "drop database if exists $D" -c "create database $D" >/dev/null 2>&1
psql -q -v ON_ERROR_STOP=1 -d $D -f phase48_stubs.sql >/dev/null || { echo "stubs failed"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f phase50_stubs.sql >/dev/null || { echo "stubs50 failed"; exit 1; }
for f in ../phase48_etims_foundation.sql ../phase49_etims_secrets.sql ../phase50_etims_queue.sql; do
  psql -q -v ON_ERROR_STOP=1 -d $D -f $f >/dev/null 2>/tmp/p50_mig.txt || { echo "MIGRATION FAILED: $f"; grep -v NOTICE /tmp/p50_mig.txt | head -5; exit 1; }
done
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase50_etims_queue.sql >/dev/null 2>&1 || { echo "phase50 NOT RE-RUNNABLE"; exit 1; }
psql -q -d $D -f phase50_scenarios.sql >/dev/null 2>/tmp/p50_err.txt
psql -d $D -Atc "select (case when ok then 'PASS ' else 'FAIL ' end)||name from t_res order by n"
psql -d $D -Atc "select 'TOTAL '||count(*)||' FAIL '||count(*) filter (where not ok) from t_res"
