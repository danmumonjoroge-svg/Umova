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
create function t_cnt(p text) returns text language plpgsql security definer as $$ declare v text; begin execute p into v; return v; end $$;
grant execute on function t_cnt(text) to authenticated;
\set OWN '11111111-0000-0000-0000-000000000001'
\set MGR '11111111-0000-0000-0000-000000000002'
\set CSH '11111111-0000-0000-0000-000000000003'
\set ACC '11111111-0000-0000-0000-000000000004'
\set BIZ 'c0000000-0000-0000-0000-00000000000a'
\set TA 'a0000000-0000-0000-0000-000000000001'
\set TB 'b0000000-0000-0000-0000-000000000002'
insert into pos_tenants values (:'TA'),(:'TB');
insert into pos_staff(id,pos_tenant_id,auth_user_id,username,name,role) values
 (:'OWN',:'TA',gen_random_uuid(),'own','Owner','owner'),(:'MGR',:'TA',gen_random_uuid(),'mgr','Manager','manager'),
 (:'CSH',:'TA',gen_random_uuid(),'cash','Cashier','cashier'),(:'ACC',:'TA',gen_random_uuid(),'acc','Accountant','cashier'),
 ('22222222-0000-0000-0000-000000000001',:'TB',gen_random_uuid(),'ownb','OwnerB','owner');
update pos_staff set role_template='accountant' where id=:'ACC';
insert into lb_businesses(id,tenant_id,name) values (:'BIZ',:'TA','Biz A'),('c0000000-0000-0000-0000-00000000000b',:'TB','Biz B');
create table tt as select (now() at time zone 'Africa/Nairobi')::date as d; grant select on tt to authenticated;
-- sales on day-3, day-2 (counted), day-1 (not counted)
insert into lb_sales(tenant_id,business_id,sale_number,status,total_amount,completed_at)
 select :'TA',:'BIZ','S'||n,'COMPLETED',100,((select d from tt)-n)::timestamp + interval '10 hours' - interval '3 hours' from generate_series(1,3) n;
insert into pos_reconciliations(pos_tenant_id,business_id,rec_date,expected_cash,expected_mpesa,counted_cash,counted_mpesa,variance_cash,variance_mpesa,components,status,prepared_by,self_signed)
 values (:'TA',:'BIZ',(select d from tt)-2,1000,500,950,500,-50,0,'{}','SIGNED_OFF',:'MGR',false),
        (:'TA',:'BIZ',(select d from tt)-3,1000,500,1020,480,20,-20,'{}','SIGNED_OFF',:'OWN',true),
        (:'TB','c0000000-0000-0000-0000-00000000000b',(select d from tt)-2,1,1,1,1,-999,0,'{}','DRAFT','22222222-0000-0000-0000-000000000001',false);
insert into pos_sale_reversals(pos_tenant_id,business_id,sale_id,sale_number,sale_total,reason,status,requested_by,self_approved) values
 (:'TA',:'BIZ',gen_random_uuid(),'S1',100,'customer returned','APPROVED',:'CSH',false),
 (:'TA',:'BIZ',gen_random_uuid(),'S2',250,'wrong item','APPROVED',:'OWN',true),
 (:'TA',:'BIZ',gen_random_uuid(),'S3',80,'duplicate entry','REJECTED',:'CSH',false),
 (:'TB',null,gen_random_uuid(),'X1',9999,'other tenant','APPROVED','22222222-0000-0000-0000-000000000001',false);
insert into pos_audit_log(pos_tenant_id,actor_type,actor_id,action,entity_type,metadata) values
 (:'TA','staff',:'OWN','STAFF_ROLE_CHANGED','pos_staff','{}'),(:'TA','staff',:'OWN','STAFF_PERMISSION_CHANGED','pos_staff','{}'),(:'TA','staff',:'OWN','STAFF_PERMISSION_CHANGED','pos_staff','{}'),
 (:'TB','staff','22222222-0000-0000-0000-000000000001','STAFF_ROLE_CHANGED','pos_staff','{}');
insert into pos_hr_employees(pos_tenant_id,business_id,full_name,basic_salary) values (:'TA',:'BIZ','Emp One',1000);
insert into pos_payroll_runs(pos_tenant_id,business_id,period_start,period_end,status,totals,prepared_by,self_approved) values
 (:'TA',:'BIZ',(select d from tt)-30,(select d from tt)-1,'PAID','{"net":5000}',:'OWN',true);

select chk('owner can run report', :'OWN', $q$select pos_control_report((select d from tt)-10,(select d from tt))$q$, 'ok');
select chk('manager can run report', :'MGR', $q$select pos_control_report((select d from tt)-10,(select d from tt))$q$, 'ok');
select chk('accountant (no audit.view) cannot run report', :'ACC', $q$select pos_control_report((select d from tt)-10,(select d from tt))$q$, 'fail');
select chk('manager can run report', :'MGR', $q$select pos_control_report((select d from tt)-10,(select d from tt))$q$, 'ok');
select chk('cashier cannot', :'CSH', $q$select pos_control_report((select d from tt)-10,(select d from tt))$q$, 'fail');
select chk('no login cannot', null, $q$select pos_control_report((select d from tt)-10,(select d from tt))$q$, 'fail');
select chk('bad range refused', :'OWN', $q$select pos_control_report((select d from tt),(select d from tt)-1)$q$, 'fail');
select chk('over a year refused', :'OWN', $q$select pos_control_report((select d from tt)-400,(select d from tt))$q$, 'fail');
select chkv('reversals requested 3 (own tenant)', :'OWN', $q$select pos_control_report((select d from tt)-10,(select d from tt))->'reversals'->>'requested'$q$, '3');
select chkv('approved 2', :'OWN', $q$select pos_control_report((select d from tt)-10,(select d from tt))->'reversals'->>'approved'$q$, '2');
select chkv('approved value 350', :'OWN', $q$select pos_control_report((select d from tt)-10,(select d from tt))->'reversals'->>'approved_value'$q$, '350');
select chkv('self approved 1', :'OWN', $q$select pos_control_report((select d from tt)-10,(select d from tt))->'reversals'->>'self_approved'$q$, '1');
select chkv('refused 1', :'OWN', $q$select pos_control_report((select d from tt)-10,(select d from tt))->'reversals'->>'refused'$q$, '1');
select chkv('days counted 2 (tenant A only)', :'OWN', $q$select pos_control_report((select d from tt)-10,(select d from tt))->'reconciliation'->>'days_counted'$q$, '2');
select chkv('self signed 1', :'OWN', $q$select pos_control_report((select d from tt)-10,(select d from tt))->'reconciliation'->>'self_signed'$q$, '1');
select chkv('cash short 50', :'OWN', $q$select pos_control_report((select d from tt)-10,(select d from tt))->'reconciliation'->>'cash_short'$q$, '50.00');
select chkv('cash over 20', :'OWN', $q$select pos_control_report((select d from tt)-10,(select d from tt))->'reconciliation'->>'cash_over'$q$, '20.00');
select chkv('mpesa short 20', :'OWN', $q$select pos_control_report((select d from tt)-10,(select d from tt))->'reconciliation'->>'mpesa_short'$q$, '20.00');
select chkv('one uncounted day (day-1)', :'OWN', $q$select jsonb_array_length(pos_control_report((select d from tt)-10,(select d from tt))->'reconciliation'->'days_without_count')::text$q$, '1');
select chkv('uncounted day is yesterday', :'OWN', $q$select (pos_control_report((select d from tt)-10,(select d from tt))->'reconciliation'->'days_without_count'->>0) = ((select d from tt)-1)::text$q$, 'true');
select chkv('role changes 1', :'OWN', $q$select pos_control_report((select d from tt)-10,(select d from tt))->'staff_changes'->>'role_changes'$q$, '1');
select chkv('permission changes 2', :'OWN', $q$select pos_control_report((select d from tt)-10,(select d from tt))->'staff_changes'->>'permission_changes'$q$, '2');
select chkv('owner sees payroll self-approved 1', :'OWN', $q$select pos_control_report((select d from tt)-40,(select d from tt))->'payroll'->>'self_approved'$q$, '1');
select chkv('manager (no payroll.access) sees no payroll', :'MGR', $q$select (pos_control_report((select d from tt)-40,(select d from tt))->'payroll') = 'null'::jsonb$q$, 'true');
select chkv('tenant B sees only own reversals (1)', '22222222-0000-0000-0000-000000000001', $q$select pos_control_report((select d from tt)-10,(select d from tt))->'reversals'->>'requested'$q$, '1');
select chkv('tenant B sees own variance only', '22222222-0000-0000-0000-000000000001', $q$select pos_control_report((select d from tt)-10,(select d from tt))->'reconciliation'->>'cash_short'$q$, '999.00');
select chkv('report writes nothing (audit count unchanged)', :'OWN', $q$select t_cnt('select count(*) from pos_audit_log')$q$, '4');
select chkv('empty period gives zero counts', :'OWN', $q$select pos_control_report((select d from tt)-300,(select d from tt)-290)->'reversals'->>'requested'$q$, '0');
