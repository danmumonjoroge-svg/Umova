-- loans_precheck.sql   READ-ONLY. Run on STAGING before phase37_loans.sql and send me every result. It changes nothing.

-- 1. Things phase37 REQUIRES (each must say true) -----------------------------------------------------------------
SELECT 'phase27 is_pos_owner'      AS needs, to_regprocedure('is_pos_owner()') IS NOT NULL AS present
UNION ALL SELECT 'phase27 is_pos_session',  to_regprocedure('is_pos_session()') IS NOT NULL
UNION ALL SELECT 'phase28 pos_require',     to_regprocedure('pos_require(text[])') IS NOT NULL
UNION ALL SELECT 'phase35 _pos_claim_op',   to_regprocedure('_pos_claim_op(text,text,text)') IS NOT NULL
UNION ALL SELECT 'phase35 _pos_finish_op',  to_regprocedure('_pos_finish_op(text,jsonb)') IS NOT NULL
UNION ALL SELECT 'get_current_tenant_id',   to_regprocedure('get_current_tenant_id()') IS NOT NULL
UNION ALL SELECT 'lb_businesses',           to_regclass('public.lb_businesses') IS NOT NULL
UNION ALL SELECT 'lb_expenses',             to_regclass('public.lb_expenses') IS NOT NULL
UNION ALL SELECT 'lb_expense_categories',   to_regclass('public.lb_expense_categories') IS NOT NULL
UNION ALL SELECT 'pos_audit_log (optional: loan actions are logged if present)', to_regclass('public.pos_audit_log') IS NOT NULL;

-- 2. The expense function the loans post through (the one thing I could not see). Needed for the future midnight job:
--    does it work with NO signed-in person? Does it fill tenant_id itself? Does it check a permission?
SELECT pg_get_functiondef(p.oid) FROM pg_proc p WHERE p.proname = 'record_expense';

-- 3. The two enums phase37 casts to (BANK, MOBILE_MONEY, CASH, OTHER must be in the first; PAID and REJECTED in the second).
SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels
FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid WHERE t.typname IN ('lb_payment_method', 'lb_expense_status') GROUP BY 1;

-- 4. Everything that fires when a row is inserted or changed in lb_expenses (phase28 guard, anything else).
SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger WHERE tgrelid = 'public.lb_expenses'::regclass AND NOT tgisinternal;

-- 5. Is the category already there, and who can see it?
SELECT id, tenant_id, business_id, name, is_system, is_active FROM lb_expense_categories WHERE lower(name) IN ('loan interest & charges', 'depreciation');
