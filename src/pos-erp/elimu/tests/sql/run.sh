#!/bin/sh
# usage: sh run.sh      (needs Postgres 16 binaries; runs as the postgres OS user from root)
set -e
D=/var/tmp/elimu_pg; PORT=5561
HERE=$(cd "$(dirname "$0")" && pwd); ROOT=$(cd "$HERE/../.." && pwd)
BIN=/usr/lib/postgresql/16/bin
if [ ! -d $D ]; then mkdir -p $D && chown postgres $D && runuser -u postgres -- $BIN/initdb -D $D/data >/dev/null; fi
runuser -u postgres -- $BIN/pg_ctl -D $D/data -o "-p $PORT -k $D" -l $D/log -w start >/dev/null 2>&1 || true
export PGHOST=$D PGPORT=$PORT PGUSER=postgres
psql -q -d postgres -c "drop database if exists elimutest" -c "create database elimutest" >/dev/null
q() { psql -q -v ON_ERROR_STOP=1 -d elimutest "$@" >/dev/null || { echo "FAILED: $*"; exit 1; }; }
q -f $HERE/foundation_stubs.sql
for f in shared/schema/001_core.sql calendar/schema/002_calendar.sql attendance/schema/003_settings_reasons.sql timetable/schema/004_rooms_periods_entries.sql timetable/schema/005_availability_changes_conflicts.sql attendance/schema/006_sessions_records.sql attendance/schema/007_followups_notices.sql attendance/schema/008_dashboard_reports.sql; do
  q -f $ROOT/$f; q -f $ROOT/$f   # twice: must be re-runnable
done
echo MIGRATIONS_OK
if [ -f $HERE/scenarios.sql ]; then
  psql -q -d elimutest -f $HERE/scenarios.sql >/dev/null 2>/var/tmp/elimu_err.txt || true
  psql -d elimutest -Atc "select (case when ok then 'PASS ' else 'FAIL ' end)||name||coalesce(' -- '||detail,'') from t_res order by n"
  psql -d elimutest -Atc "select 'TOTAL '||count(*)||' FAIL '||count(*) filter (where not ok) from t_res"
  grep -i "error" /var/tmp/elimu_err.txt | head -5 || true
fi
