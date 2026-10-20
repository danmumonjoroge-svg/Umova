#!/bin/sh
# usage: run_chain.sh <db> <scenario.sql> <migration.sql>...   (scratch DB only)
export PGHOST=/var/tmp/pg20 PGPORT=5544 PGUSER=postgres
D=$1; SC=$2; shift 2
psql -q -d postgres -c "drop database if exists $D" -c "create database $D" 2>/dev/null
cd "$(dirname "$0")"
psql -q -d $D -f phase28_stubs.sql
sed "s#/\*CHK\*/##" phase29_stubs.sql | psql -q -d $D
[ -f phase30_stubs.sql ] && psql -q -d $D -f phase30_stubs.sql
for f in ../phase28_staff_permissions.sql ../phase29_sale_reversals.sql "$@"; do psql -q -d $D -f $f 2>&1 | grep -i "error"; done
psql -q -d $D -f $SC >/dev/null 2>/tmp/err_$D.txt; grep -i error /tmp/err_$D.txt | head -3
psql -d $D -Atc "select 'TOTAL '||count(*)||' FAIL '||count(*) filter (where not ok) from t_res"
psql -d $D -Atc "select name from t_res where not ok"
