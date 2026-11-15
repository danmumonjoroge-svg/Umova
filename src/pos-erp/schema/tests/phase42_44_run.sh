#!/bin/sh
# usage: phase42_44_run.sh   (scratch Postgres ONLY). Needs a local server on $PGHOST/$PGPORT (defaults /var/tmp/pg42, 5542).
# Loads the stand-in tables, the REAL phase12, 13, 19, then phases 42, 43, 44 TWICE (proves re-runnable), then the scenarios.
# Expected last line: TOTAL <n> FAIL 0
export PGHOST=${PGHOST:-/var/tmp/pg42} PGPORT=${PGPORT:-5542} PGUSER=postgres
D=p4244test; cd "$(dirname "$0")"
psql -q -d postgres -c "drop database if exists $D" -c "create database $D" >/dev/null 2>&1
run() { psql -q -v ON_ERROR_STOP=1 -d $D -f "$1" >/dev/null 2>/tmp/p4244_err.txt || { echo "FAILED: $1"; cat /tmp/p4244_err.txt; exit 1; }; }
run phase42_44_stubs.sql
run ../phase12_mpesa.sql
psql -q -v ON_ERROR_STOP=1 -d $D -c "ALTER TABLE lb_mpesa_transactions ADD COLUMN IF NOT EXISTS rent_invoice_id uuid; ALTER TABLE lb_mpesa_transactions ALTER COLUMN cart_snapshot DROP NOT NULL;" >/dev/null
run ../phase13_mpesa_client_credentials.sql
run ../phase19_folios.sql
for i in 1 2; do run ../phase42_product_classes.sql; run ../phase43_mpesa_c2b_inbox.sql; run ../phase44_budgets.sql; done
echo "migrations: applied twice without error"
psql -q -At -d $D -f phase42_44_scenarios.sql 2>&1 | grep -E "^(PASS|FAIL|TOTAL)|NOTICE:  (PASS|FAIL|TOTAL)|ERROR" | sed 's/^psql:[^ ]* //; s/NOTICE:  //'
