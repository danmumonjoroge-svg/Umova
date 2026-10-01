# Phase 17 SQL tests (scratch database ONLY — never run these on production)

These ran against a throwaway PostgreSQL 16 with *stand-in* base tables, not your live Supabase.
1. createdb scratch
2. psql -f tests/scratch_db_stubs.sql
3. psql -f phase5_property.sql -f phase7_communication.sql -f phase12_mpesa.sql -f phase13_mpesa_client_credentials.sql
4. psql -f phase17a_enum_values.sql, then -f phase17_invoices_maintenance.sql
5. psql -f tests/phase17_scenarios.sql  — lines headed "must ERROR" are meant to fail.

The stubs fake lb_businesses, lb_customers, record_expense(), record_customer_payment(), expense categories, auth.role().
Passing here proves the new logic; it does NOT prove the live record_expense()/record_customer_payment() behave the same — retest on a staging project.
