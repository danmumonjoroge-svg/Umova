#!/bin/sh
PGHOST=/var/tmp/pgnet PGPORT=5536 psql -U postgres -d postgres -Atc "select 1" >/dev/null 2>&1 && exit 0
su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /var/tmp/pgnet/data -o '-k /var/tmp/pgnet -p 5536 -c listen_addresses=' -l /var/tmp/pgnet/log start" >/dev/null 2>&1
sleep 3
