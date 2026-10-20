\set ON_ERROR_STOP on
grant usage on schema auth to authenticated;

create table t_res(n serial, ok boolean, name text); grant all on t_res to authenticated; grant usage on all sequences in schema public to authenticated;
create or replace function chk(p_name text, p_staff uuid, p_sql text, p_expect text) returns void language plpgsql as $$
declare good boolean; msg text; begin
  perform set_config('request.jwt.claims', case when p_staff is null then '{}' else json_build_object('pos_staff_id',p_staff,'pos_tenant_id',(select pos_tenant_id from pos_staff where id=p_staff))::text end, false);
  execute 'set role authenticated';
  begin execute p_sql; good := (p_expect='ok'); msg := '';
  exception when others then good := (p_expect='fail'); msg := sqlerrm; end;
  execute 'reset role'; insert into t_res(ok,name) values (good,p_name||case when good then '' else ' [got '||msg||']' end);
end $$;
create or replace function chkv(p_name text, p_staff uuid, p_sql text, p_expect text) returns void language plpgsql as $$
declare v text; begin
  perform set_config('request.jwt.claims', json_build_object('pos_staff_id',p_staff,'pos_tenant_id',(select pos_tenant_id from pos_staff where id=p_staff))::text, false);
  execute 'set role authenticated'; execute p_sql into v; execute 'reset role';
  insert into t_res(ok,name) values (v is not distinct from p_expect, p_name||' (got '||coalesce(v,'null')||')');
end $$;
create or replace function chke(p_name text, p_staff uuid, p_sql text, p_frag text) returns void language plpgsql as $$
declare good boolean := false; msg text := 'no error'; begin
  perform set_config('request.jwt.claims', json_build_object('pos_staff_id',p_staff,'pos_tenant_id',(select pos_tenant_id from pos_staff where id=p_staff))::text, false);
  execute 'set role authenticated';
  begin execute p_sql; exception when others then msg := sqlerrm; good := position(p_frag in sqlerrm) > 0; end;
  execute 'reset role'; insert into t_res(ok,name) values (good,p_name||case when good then '' else ' [got '||msg||']' end);
end $$;
\set OWN '11111111-0000-0000-0000-000000000001'
\set MGR '11111111-0000-0000-0000-000000000002'
\set CSH '11111111-0000-0000-0000-000000000003'
\set HRO '11111111-0000-0000-0000-000000000005'
\set BIZ 'c0000000-0000-0000-0000-00000000000a'
\set BIZB 'c0000000-0000-0000-0000-00000000000b'
insert into pos_tenants values ('a0000000-0000-0000-0000-000000000001'),('b0000000-0000-0000-0000-000000000002');
insert into pos_staff(id,pos_tenant_id,auth_user_id,username,name,role) values
 (:'OWN','a0000000-0000-0000-0000-000000000001',gen_random_uuid(),'own','Owner','owner'),
 (:'MGR','a0000000-0000-0000-0000-000000000001',gen_random_uuid(),'mgr','Manager','manager'),
 (:'CSH','a0000000-0000-0000-0000-000000000001',gen_random_uuid(),'cash','Cashier','cashier'),
 (:'HRO','a0000000-0000-0000-0000-000000000001',gen_random_uuid(),'hro','HR Officer','cashier'),
 ('22222222-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',gen_random_uuid(),'ownb','OwnerB','owner');
update pos_staff set role_template='hr_officer' where id=:'HRO';
insert into lb_businesses(id,tenant_id,name) values (:'BIZ','a0000000-0000-0000-0000-000000000001','Biz A'),(:'BIZB','b0000000-0000-0000-0000-000000000002','Biz B');
\set OWNB '22222222-0000-0000-0000-000000000001'

create function t_cnt(p text) returns text language plpgsql security definer as $$ declare v text; begin execute p into v; return v; end $$;
create function t_emp(p text) returns uuid language sql security definer as $$ select id from pos_hr_employees where employee_no=p $$;
create function t_run(p text) returns uuid language sql security definer as $$ select id from pos_payroll_runs where period_start=p::date and status<>'CANCELLED' $$;
create function t_line(p text) returns uuid language sql security definer as $$ select l.id from pos_payroll_lines l join pos_hr_employees e on e.id=l.employee_id where e.employee_no=p order by l.id desc limit 1 $$;
grant execute on function t_cnt(text),t_emp(text),t_run(text),t_line(text) to authenticated;
select chk('owner: rates list', :'OWN', $q$select pos_payroll_rates_list()$q$, 'ok');
select chkv('5 default rates seeded', :'OWN', $q$select t_cnt('select count(*) from pos_payroll_rates')$q$, '5');
select chkv('none confirmed by default', :'OWN', $q$select t_cnt('select count(*) from pos_payroll_rates where confirmed_at is not null')$q$, '0');
-- permissions on rates
select chk('manager cannot view rates', :'MGR', $q$select pos_payroll_rates_list()$q$, 'fail');
select chk('hr officer cannot view rates', :'HRO', $q$select pos_payroll_rates_list()$q$, 'fail');
select chk('manager cannot confirm', :'MGR', $q$select pos_payroll_rate_confirm('NSSF','2026-02-01')$q$, 'fail');
select chk('manager cannot set rate', :'MGR', $q$select pos_payroll_rate_set('SHIF','2026-07-01','{"rate":0.03}','KRA notice 1')$q$, 'fail');
select chk('rate set needs source', :'OWN', $q$select pos_payroll_rate_set('SHIF','2026-07-01','{"rate":0.03}','')$q$, 'fail');
select chk('rate set bad params', :'OWN', $q$select pos_payroll_rate_set('NSSF','2026-07-01','{"rate":0.06}','NSSF notice')$q$, 'fail');
select chk('cashier cannot call hr list', :'CSH', $q$select pos_hr_list_employees('c0000000-0000-0000-0000-00000000000a')$q$, 'fail');

-- employees: hr officer adds (no salary right), owner sets salary
select chk('hro adds employee', :'HRO', $q$select pos_hr_save_employee('c0000000-0000-0000-0000-00000000000a', null, '{"full_name":"Alice Wanjiru","employee_no":"E1","job_title":"Cook","basic_salary":50000,"tax_pin":"A001"}')$q$, 'ok');
select chkv('hro cannot set salary (stays 0)', :'OWN', $q$select t_cnt('select basic_salary::text from pos_hr_employees where employee_no=''E1''')$q$, '0.00');
select chk('hro sees employee list', :'HRO', $q$select pos_hr_list_employees('c0000000-0000-0000-0000-00000000000a')$q$, 'ok');
select chkv('hro list hides salary', :'HRO', $q$select (pos_hr_list_employees('c0000000-0000-0000-0000-00000000000a')->0->>'basic_salary') is null$q$, 'true');
select chk('owner sets salary E1', :'OWN', $q$select pos_hr_save_employee('c0000000-0000-0000-0000-00000000000a', t_emp('E1'), '{"full_name":"Alice Wanjiru","employee_no":"E1","job_title":"Cook","basic_salary":50000,"tax_pin":"A001"}')$q$, 'ok');
select chk('owner adds E2 (15000)', :'OWN', $q$select pos_hr_save_employee('c0000000-0000-0000-0000-00000000000a', null, '{"full_name":"Brian Otieno","employee_no":"E2","basic_salary":15000}')$q$, 'ok');
select chk('owner adds E3 (150000)', :'OWN', $q$select pos_hr_save_employee('c0000000-0000-0000-0000-00000000000a', null, '{"full_name":"Carol Achieng","employee_no":"E3","basic_salary":150000}')$q$, 'ok');
select chk('duplicate employee_no refused', :'OWN', $q$select pos_hr_save_employee('c0000000-0000-0000-0000-00000000000a', null, '{"full_name":"Dup Person","employee_no":"E3"}')$q$, 'fail');
select chk('short name refused', :'OWN', $q$select pos_hr_save_employee('c0000000-0000-0000-0000-00000000000a', null, '{"full_name":"A"}')$q$, 'fail');
select chk('other tenant business refused', :'OWN', $q$select pos_hr_save_employee('c0000000-0000-0000-0000-00000000000b', null, '{"full_name":"Spy Person"}')$q$, 'fail');
select chk('tenant B cannot see A employees list (business)', :'OWNB', $q$select pos_hr_list_employees('c0000000-0000-0000-0000-00000000000a')$q$, 'fail');
select chk('tenant B cannot edit A employee', :'OWNB', $q$select pos_hr_save_employee('c0000000-0000-0000-0000-00000000000b', t_emp('E1'), '{"full_name":"Hacked Name"}')$q$, 'fail');
select chkv('A employee name intact', :'OWN', $q$select t_cnt('select full_name from pos_hr_employees where employee_no=''E1''')$q$, 'Alice Wanjiru');
select chkv('owner list shows salary', :'OWN', $q$select (select (x->>'basic_salary') from jsonb_array_elements(pos_hr_list_employees('c0000000-0000-0000-0000-00000000000a')) x where x->>'employee_no'='E1')$q$, '50000.00');
-- direct table access denied
select chk('direct select employees denied', :'OWN', $q$select * from pos_hr_employees$q$, 'fail');
select chk('direct select payroll lines denied', :'OWN', $q$select * from pos_payroll_lines$q$, 'fail');

-- attendance & leave
select chk('hro sets attendance', :'HRO', $q$select pos_hr_set_attendance(t_emp('E1'), (now() at time zone 'Africa/Nairobi')::date, 'PRESENT')$q$, 'ok');
select chk('attendance upsert', :'HRO', $q$select pos_hr_set_attendance(t_emp('E1'), (now() at time zone 'Africa/Nairobi')::date, 'LATE','bus')$q$, 'ok');
select chkv('one attendance row', :'OWN', $q$select t_cnt('select count(*) from pos_hr_attendance')$q$, '1');
select chk('future attendance refused', :'HRO', $q$select pos_hr_set_attendance(t_emp('E1'), (now() at time zone 'Africa/Nairobi')::date+2, 'PRESENT')$q$, 'fail');
select chk('bad status refused', :'HRO', $q$select pos_hr_set_attendance(t_emp('E1'), (now() at time zone 'Africa/Nairobi')::date-1, 'DRUNK')$q$, 'fail');
select chk('cashier cannot set attendance', :'CSH', $q$select pos_hr_set_attendance(t_emp('E1'), (now() at time zone 'Africa/Nairobi')::date-1, 'PRESENT')$q$, 'fail');
select chk('leave request', :'HRO', $q$select pos_hr_leave_request(t_emp('E2'),'ANNUAL','2026-03-02','2026-03-06','family')$q$, 'ok');
select chk('overlapping leave refused', :'HRO', $q$select pos_hr_leave_request(t_emp('E2'),'SICK','2026-03-05','2026-03-07')$q$, 'fail');
select chk('reversed dates refused', :'HRO', $q$select pos_hr_leave_request(t_emp('E2'),'SICK','2026-04-07','2026-04-01')$q$, 'fail');
create function t_lv() returns uuid language sql security definer as $$ select id from pos_hr_leave limit 1 $$; grant execute on function t_lv() to authenticated;
select chk('approve leave', :'OWN', $q$select pos_hr_leave_decide(t_lv(), true)$q$, 'ok');
select chkv('leave marks 5 attendance days', :'OWN', $q$select t_cnt('select count(*) from pos_hr_attendance where status=''LEAVE''')$q$, '5');
select chk('second decision refused', :'OWN', $q$select pos_hr_leave_decide(t_lv(), false)$q$, 'fail');
-- own leave cannot be self-decided
update pos_hr_employees set staff_id = '11111111-0000-0000-0000-000000000005' where employee_no='E1';
select chk('hro requests own leave', :'HRO', $q$select pos_hr_leave_request(t_emp('E1'),'ANNUAL','2026-05-04','2026-05-05')$q$, 'ok');
create function t_lv2() returns uuid language sql security definer as $$ select id from pos_hr_leave where status='REQUESTED' limit 1 $$; grant execute on function t_lv2() to authenticated;
select chk('own leave cannot be self-decided', :'HRO', $q$select pos_hr_leave_decide(t_lv2(), true)$q$, 'fail');
select chk('owner can decide it', :'OWN', $q$select pos_hr_leave_decide(t_lv2(), false)$q$, 'ok');

-- payroll: blocked while rates unconfirmed
select chk('hro cannot create run', :'HRO', $q$select pos_payroll_create_run('c0000000-0000-0000-0000-00000000000a','2026-03-01','2026-03-31')$q$, 'fail');
select chk('owner creates March run', :'OWN', $q$select pos_payroll_create_run('c0000000-0000-0000-0000-00000000000a','2026-03-01','2026-03-31')$q$, 'ok');
select chkv('run has 3 lines', :'OWN', $q$select t_cnt('select count(*) from pos_payroll_lines')$q$, '3');
select chk('duplicate month refused', :'OWN', $q$select pos_payroll_create_run('c0000000-0000-0000-0000-00000000000a','2026-03-01','2026-03-31')$q$, 'fail');
select chk('month > 31 days refused', :'OWN', $q$select pos_payroll_create_run('c0000000-0000-0000-0000-00000000000a','2026-04-01','2026-06-30')$q$, 'fail');
-- numbers
select chkv('E1 nssf 3000', :'OWN', $q$select t_cnt('select nssf::text from pos_payroll_lines where id=t_line(''E1'')')$q$, '3000.00');
select chkv('E1 shif 1375', :'OWN', $q$select t_cnt('select shif::text from pos_payroll_lines where id=t_line(''E1'')')$q$, '1375.00');
select chkv('E1 housing 750', :'OWN', $q$select t_cnt('select housing::text from pos_payroll_lines where id=t_line(''E1'')')$q$, '750.00');
select chkv('E1 taxable 44875', :'OWN', $q$select t_cnt('select taxable::text from pos_payroll_lines where id=t_line(''E1'')')$q$, '44875.00');
select chkv('E1 tax before relief 8245.85', :'OWN', $q$select t_cnt('select paye_before_relief::text from pos_payroll_lines where id=t_line(''E1'')')$q$, '8245.85');
select chkv('E1 paye 5845.85', :'OWN', $q$select t_cnt('select paye::text from pos_payroll_lines where id=t_line(''E1'')')$q$, '5845.85');
select chkv('E1 net 39029.15', :'OWN', $q$select t_cnt('select net::text from pos_payroll_lines where id=t_line(''E1'')')$q$, '39029.15');
select chkv('E2 nssf 900', :'OWN', $q$select t_cnt('select nssf::text from pos_payroll_lines where id=t_line(''E2'')')$q$, '900.00');
select chkv('E2 shif 412.50', :'OWN', $q$select t_cnt('select shif::text from pos_payroll_lines where id=t_line(''E2'')')$q$, '412.50');
select chkv('E2 housing 225', :'OWN', $q$select t_cnt('select housing::text from pos_payroll_lines where id=t_line(''E2'')')$q$, '225.00');
select chkv('E2 paye 0 (relief > tax)', :'OWN', $q$select t_cnt('select paye::text from pos_payroll_lines where id=t_line(''E2'')')$q$, '0.00');
select chkv('E2 net 13462.50', :'OWN', $q$select t_cnt('select net::text from pos_payroll_lines where id=t_line(''E2'')')$q$, '13462.50');
select chkv('E3 nssf capped 6480', :'OWN', $q$select t_cnt('select nssf::text from pos_payroll_lines where id=t_line(''E3'')')$q$, '6480.00');
select chkv('E3 shif 4125', :'OWN', $q$select t_cnt('select shif::text from pos_payroll_lines where id=t_line(''E3'')')$q$, '4125.00');
select chkv('E3 housing 2250', :'OWN', $q$select t_cnt('select housing::text from pos_payroll_lines where id=t_line(''E3'')')$q$, '2250.00');
select chkv('E3 paye 33526.85', :'OWN', $q$select t_cnt('select paye::text from pos_payroll_lines where id=t_line(''E3'')')$q$, '33526.85');
select chkv('E3 net 103618.15', :'OWN', $q$select t_cnt('select net::text from pos_payroll_lines where id=t_line(''E3'')')$q$, '103618.15');
select chkv('totals gross 215000', :'OWN', $q$select pos_payroll_get_run(t_run('2026-03-01'))->'run'->'totals'->>'gross'$q$, '215000.00');
select chkv('totals net sum', :'OWN', $q$select pos_payroll_get_run(t_run('2026-03-01'))->'run'->'totals'->>'net'$q$, '156109.80');
-- approval blocked until confirmed
select chke('approve blocked: rates unconfirmed', :'OWN', $q$select pos_payroll_approve(t_run('2026-03-01'))$q$, 'RATES_NOT_CONFIRMED');
select chk('owner confirms PAYE', :'OWN', $q$select pos_payroll_rate_confirm('PAYE_BANDS','2026-01-01')$q$, 'ok');
select chk('owner confirms RELIEF', :'OWN', $q$select pos_payroll_rate_confirm('PERSONAL_RELIEF','2026-01-01')$q$, 'ok');
select chk('owner confirms NSSF', :'OWN', $q$select pos_payroll_rate_confirm('NSSF','2026-02-01')$q$, 'ok');
select chke('still blocked: SHIF+levy unconfirmed', :'OWN', $q$select pos_payroll_approve(t_run('2026-03-01'))$q$, 'RATES_NOT_CONFIRMED');
select chk('owner confirms SHIF', :'OWN', $q$select pos_payroll_rate_confirm('SHIF','2026-01-01')$q$, 'ok');
select chk('owner confirms HOUSING', :'OWN', $q$select pos_payroll_rate_confirm('HOUSING_LEVY','2026-01-01')$q$, 'ok');
select chk('confirm unknown rate fails', :'OWN', $q$select pos_payroll_rate_confirm('NSSF','2030-01-01')$q$, 'fail');
-- edit in draft
select chk('edit line allowances', :'OWN', $q$select pos_payroll_edit_line(t_line('E2'), 5000, 1000, 'bonus')$q$, 'ok');
select chkv('edited gross 20000', :'OWN', $q$select t_cnt('select gross::text from pos_payroll_lines where id=t_line(''E2'')')$q$, '20000.00');
select chkv('edited other deductions shown', :'OWN', $q$select t_cnt('select other_deductions::text from pos_payroll_lines where id=t_line(''E2'')')$q$, '1000.00');
select chk('negative allowance refused', :'OWN', $q$select pos_payroll_edit_line(t_line('E2'), -1, 0)$q$, 'fail');
select chk('deductions > pay refused', :'OWN', $q$select pos_payroll_edit_line(t_line('E2'), 0, 99999999)$q$, 'fail');
select chk('manager cannot edit line', :'MGR', $q$select pos_payroll_edit_line(t_line('E2'), 0, 0)$q$, 'fail');
select chk('owner approves', :'OWN', $q$select pos_payroll_approve(t_run('2026-03-01'))$q$, 'ok');
select chkv('owner self_approved flagged', :'OWN', $q$select t_cnt('select self_approved::text from pos_payroll_runs where status=''APPROVED''')$q$, 'true');
select chke('approved run locked for edit', :'OWN', $q$select pos_payroll_edit_line(t_line('E2'), 0, 0)$q$, 'LOCKED');
select chk('approve twice refused', :'OWN', $q$select pos_payroll_approve(t_run('2026-03-01'))$q$, 'fail');
select chk('mark paid', :'OWN', $q$select pos_payroll_mark_paid(t_run('2026-03-01'))$q$, 'ok');
select chke('paid run cannot be cancelled', :'OWN', $q$select pos_payroll_cancel(t_run('2026-03-01'),'mistake here')$q$, 'LOCKED');
select chk('mark paid twice refused', :'OWN', $q$select pos_payroll_mark_paid(t_run('2026-03-01'))$q$, 'fail');
-- rate change does not alter approved snapshot/lines
select chk('owner adds new SHIF rate', :'OWN', $q$select pos_payroll_rate_set('SHIF','2026-04-01','{"rate":0.03,"minimum":300}','SHA notice 2026-03')$q$, 'ok');
select chkv('approved line unchanged', :'OWN', $q$select t_cnt('select shif::text from pos_payroll_lines where id=t_line(''E1'')')$q$, '1375.00');
select chk('April run created', :'OWN', $q$select pos_payroll_create_run('c0000000-0000-0000-0000-00000000000a','2026-04-01','2026-04-30')$q$, 'ok');
select chkv('April uses new SHIF 3% (E1 1500)', :'OWN', $q$select t_cnt('select l.shif::text from pos_payroll_lines l join pos_payroll_runs r on r.id=l.run_id where r.period_start=''2026-04-01'' and l.employee_id=t_emp(''E1'')')$q$, '1500.00');
select chke('April approve blocked (new SHIF unconfirmed)', :'OWN', $q$select pos_payroll_approve(t_run('2026-04-01'))$q$, 'RATES_NOT_CONFIRMED');
select chk('cancel draft April', :'OWN', $q$select pos_payroll_cancel(t_run('2026-04-01'),'wrong month')$q$, 'ok');
select chk('cancel needs reason', :'OWN', $q$select pos_payroll_cancel(t_run('2026-03-01'),'')$q$, 'fail');
select chk('April can be re-created after cancel', :'OWN', $q$select pos_payroll_create_run('c0000000-0000-0000-0000-00000000000a','2026-04-01','2026-04-30')$q$, 'ok');
-- missing rates before the NSSF start date
select chke('Jan run: NSSF not yet in force', :'OWN', $q$select pos_payroll_create_run('c0000000-0000-0000-0000-00000000000a','2026-01-01','2026-01-31')$q$, 'RATES_MISSING');
-- second person rule: owner grants payroll.access to manager
select chk('owner grants payroll.access to MGR', :'OWN', $q$select pos_set_staff_permission('11111111-0000-0000-0000-000000000002','payroll.access',true)$q$, 'ok');
select chk('owner confirms new SHIF', :'OWN', $q$select pos_payroll_rate_confirm('SHIF','2026-04-01')$q$, 'ok');
select chk('manager prepares May run', :'MGR', $q$select pos_payroll_create_run('c0000000-0000-0000-0000-00000000000a','2026-05-01','2026-05-31')$q$, 'ok');
select chke('manager cannot approve own run', :'MGR', $q$select pos_payroll_approve(t_run('2026-05-01'))$q$, 'SECOND_PERSON');
select chk('cashier sees no salary list w/o payroll.access', :'CSH', $q$select pos_payroll_list_runs('c0000000-0000-0000-0000-00000000000a')$q$, 'fail');
select chk('owner approves manager run', :'OWN', $q$select pos_payroll_approve(t_run('2026-05-01'))$q$, 'ok');
select chkv('not flagged self_approved', :'OWN', $q$select t_cnt('select self_approved::text from pos_payroll_runs where period_start=''2026-05-01''')$q$, 'false');
-- tenant isolation on payroll
select chk('tenant B cannot read A run', :'OWNB', $q$select pos_payroll_get_run(t_run('2026-03-01'))$q$, 'fail');
select chk('tenant B cannot approve A run', :'OWNB', $q$select pos_payroll_approve(t_run('2026-04-01'))$q$, 'fail');
select chkv('tenant B has own seeded rates only', :'OWNB', $q$select (select count(*) from jsonb_array_elements(pos_payroll_rates_list()))::text$q$, '5');
-- audit
select chkv('audit has run created', :'OWN', $q$select (t_cnt('select count(*) from pos_audit_log where action=''PAYROLL_RUN_CREATED''')::int >= 3)::text$q$, 'true');
select chkv('audit has approval', :'OWN', $q$select (t_cnt('select count(*) from pos_audit_log where action=''PAYROLL_RUN_APPROVED''')::int = 2)::text$q$, 'true');
select chkv('audit has rate confirm x6', :'OWN', $q$select t_cnt('select count(*) from pos_audit_log where action=''PAYROLL_RATE_CONFIRMED''')$q$, '6');
select chkv('audit leave decisions', :'OWN', $q$select t_cnt('select count(*) from pos_audit_log where action in (''HR_LEAVE_APPROVED'',''HR_LEAVE_REJECTED'')')$q$, '2');
select chkv('audit does not store salary values of HR add', :'OWN', $q$select t_cnt('select count(*) from pos_audit_log where action=''HR_EMPLOYEE_ADDED'' and metadata::text ilike ''%50000%''')$q$, '0');
