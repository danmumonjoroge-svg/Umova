-- READ-ONLY. Paste into the Supabase SQL editor and run. Changes nothing.
-- Shows which phases are really in THIS database, so you know which file to run next.
select 'phase28 (permissions)' as phase,
       case when to_regprocedure('public.pos_has_permission(text)') is not null
             and to_regprocedure('public.pos_is_pos_session()') is not null
             and to_regclass('public.pos_staff_permissions') is not null
            then 'INSTALLED' else 'MISSING - run phase28_staff_permissions.sql' end as status
union all
select 'phase29 (sale reversals)',
       case when to_regclass('public.pos_sale_reversals') is not null
             and to_regprocedure('public.pos_request_sale_reversal(uuid,text)') is not null
            then 'INSTALLED' else 'MISSING - run phase29_sale_reversals.sql (after 28)' end
union all
select 'phase30 (reconciliation)',
       case when to_regclass('public.pos_reconciliations') is not null then 'INSTALLED' else 'not yet' end
union all
select 'phase31 (HR and payroll)',
       case when to_regclass('public.pos_payroll_runs') is not null then 'INSTALLED' else 'not yet' end
union all
select 'phase32 (control report)',
       case when to_regprocedure('public.pos_control_report(date,date)') is not null then 'INSTALLED' else 'not yet' end;
