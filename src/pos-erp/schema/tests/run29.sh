#!/bin/sh
# usage: run29.sh <db> [check-constraint-sql]   (scratch DB only)
export PGHOST=/var/tmp/pg20 PGPORT=5544 PGUSER=postgres
D=$1; CHK=${2:-}
psql -q -d postgres -c "drop database if exists $D" -c "create database $D" 2>/dev/null
cd "$(dirname "$0")"
psql -q -d $D -f phase28_stubs.sql
sed "s#/\*CHK\*/#$CHK#" phase29_stubs.sql | psql -q -d $D
psql -q -d $D -f ../phase28_staff_permissions.sql >/dev/null 2>&1
psql -q -d $D -f ../phase29_sale_reversals.sql 2>&1 | grep -i error
psql -q -d $D -f phase29_scenarios.sql >/dev/null 2>/tmp/err29.txt; grep -i error /tmp/err29.txt | head -3
psql -d $D -Atc "select 'TOTAL '||count(*)||' FAIL '||count(*) filter (where not ok) from t_res"
psql -d $D -Atc "select name from t_res where not ok"
