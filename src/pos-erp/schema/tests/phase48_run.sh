#!/bin/sh
# usage: phase48_run.sh   (scratch Postgres only; see README). Needs a local server on $PGHOST/$PGPORT.
export PGHOST=${PGHOST:-/var/tmp/pg48} PGPORT=${PGPORT:-5548} PGUSER=postgres
D=p48test; cd "$(dirname "$0")"
psql -q -d postgres -c "drop database if exists $D" -c "create database $D" >/dev/null 2>&1
psql -q -v ON_ERROR_STOP=1 -d $D -f phase48_stubs.sql >/dev/null || { echo "stubs failed"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase48_etims_foundation.sql >/dev/null || { echo "MIGRATION FAILED"; exit 1; }
psql -q -v ON_ERROR_STOP=1 -d $D -f ../phase48_etims_foundation.sql >/dev/null || { echo "MIGRATION NOT RE-RUNNABLE"; exit 1; }
psql -q -d $D -f phase48_scenarios.sql >/dev/null 2>/tmp/p48_err.txt
psql -d $D -Atc "select (case when ok then 'PASS ' else 'FAIL ' end)||name from t_res order by n"
psql -d $D -Atc "select 'TOTAL '||count(*)||' FAIL '||count(*) filter (where not ok) from t_res"
