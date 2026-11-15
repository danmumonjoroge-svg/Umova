#!/bin/sh
sh /home/claude/uitest/start_pg.sh
export PGHOST=/var/tmp/pgnet PGPORT=5536 PGUSER=postgres
T=/home/claude/proj/pos-erp/schema
psql -q -d postgres -c "drop database if exists ${UI_DB:-p36ui}" -c "create database ${UI_DB:-p36ui}" >/dev/null 2>&1
for f in $T/tests/phase35_stubs.sql $T/tests/phase36_stubs.sql $T/phase35_offline_idempotency.sql $T/phase36_network.sql /home/claude/uitest/seed.sql; do
  psql -q -v ON_ERROR_STOP=1 -d ${UI_DB:-p36ui} -f $f >/dev/null 2>/tmp/ui_seed_err.txt || { echo "FAILED: $f"; cat /tmp/ui_seed_err.txt | head -5; exit 1; }
done
echo seeded
