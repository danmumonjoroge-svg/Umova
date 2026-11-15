# Phase 17 SQL tests (scratch database ONLY — never run these on production)

These ran against a throwaway PostgreSQL 16 with *stand-in* base tables, not your live Supabase.
1. createdb scratch
2. psql -f tests/scratch_db_stubs.sql
3. psql -f phase5_property.sql -f phase7_communication.sql -f phase12_mpesa.sql -f phase13_mpesa_client_credentials.sql
4. psql -f phase17a_enum_values.sql, then -f phase17_invoices_maintenance.sql
5. psql -f tests/phase17_scenarios.sql  — lines headed "must ERROR" are meant to fail.

The stubs fake lb_businesses, lb_customers, record_expense(), record_customer_payment(), expense categories, auth.role().
Passing here proves the new logic; it does NOT prove the live record_expense()/record_customer_payment() behave the same — retest on a staging project.

# Phase 36 SQL tests (My Business Network) - scratch database ONLY
Needs a local PostgreSQL server (the script defaults to socket /var/tmp/pgnet, port 5536; override PGHOST / PGPORT).
Run:  sh phase36_run.sh      (loads phase35_stubs.sql + phase36_stubs.sql, then the REAL phase35 and phase36 files twice to prove re-runnability,
then phase36_scenarios.sql, then a two-session concurrency race). Expected last line: `TOTAL 98 FAIL 0`.
The stubs fake the lb_* tables from the columns the app code uses; passing here proves the new logic, NOT that the live database matches.
Run schema/diagnostics/network_precheck.sql on staging first and compare.

# Phase 37 SQL tests (My Loans) - scratch database ONLY
Needs a local PostgreSQL server (the script defaults to socket /var/tmp/pgloan, port 5537; override PGHOST / PGPORT).
Run:  sh phase37_run.sh      (loads phase35_stubs.sql + phase37_stubs.sql, then the REAL phase35, phase37 and phase38 (part payments) files twice to prove re-runnability,
then phase37_scenarios.sql, then two-session races: two phones tapping Mark-as-paid together, and two phones opening the app together).
Expected last line: `TOTAL 101 FAIL 0`.
The stubs fake record_expense() and the expense tables from the columns the owner sent from the live database (2026-10-27) and mimic the phase28
expenses.record guard; passing here proves the new logic, NOT that the live record_expense() behaves the same. Run schema/diagnostics/loans_precheck.sql on staging first.
JS side:  node --test tests/loan_helpers.test.mjs   (from src/pos-erp)  -> 16 tests.
