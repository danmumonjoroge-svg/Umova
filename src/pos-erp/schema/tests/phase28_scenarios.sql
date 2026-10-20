\set ON_ERROR_STOP off
create function get_current_tenant_id_chk() returns uuid language sql as $$ select 1::text::uuid $$ ; -- placeholder never used
drop function get_current_tenant_id_chk();
alter table pos_staff enable row level security; alter table lb_businesses enable row level security; alter table pos_audit_log enable row level security;
create policy t on pos_staff using (pos_tenant_id = get_current_tenant_id());
create policy t on lb_businesses using (tenant_id = get_current_tenant_id()) with check (tenant_id = get_current_tenant_id());
create policy t on pos_audit_log using (pos_tenant_id = get_current_tenant_id()) with check (pos_tenant_id = get_current_tenant_id());
grant select,insert,update,delete on pos_staff,lb_businesses,pos_audit_log,pos_staff_permission_overrides to authenticated;
grant usage on schema auth to authenticated; grant usage,select on all sequences in schema public to authenticated;
create table t_res(n serial, ok boolean, name text); grant all on t_res to authenticated;
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
  perform set_config('request.jwt.claims', case when p_staff is null then '{}' else json_build_object('pos_staff_id',p_staff,'pos_tenant_id',(select pos_tenant_id from pos_staff where id=p_staff))::text end, false);
  execute 'set role authenticated'; execute p_sql into v; execute 'reset role';
  insert into t_res(ok,name) values (v is not distinct from p_expect, p_name||' (got '||coalesce(v,'null')||')');
end $$;
\set OWN '11111111-0000-0000-0000-000000000001'
\set MGR '11111111-0000-0000-0000-000000000002'
\set CSH '11111111-0000-0000-0000-000000000003'
\set DIS '11111111-0000-0000-0000-000000000004'
\set TA 'a0000000-0000-0000-0000-000000000001'
insert into pos_tenants(id) values (:'TA'),('b0000000-0000-0000-0000-000000000002');
insert into pos_staff(id,pos_tenant_id,auth_user_id,username,name,role,status,role_template) values
 (:'OWN',:'TA',gen_random_uuid(),'own','Owner','owner','active',null),
 (:'MGR',:'TA',gen_random_uuid(),'mgr','Manager','manager','active',null),
 (:'CSH',:'TA',gen_random_uuid(),'cash','Cashier','cashier','active',null),
 (:'DIS',:'TA',gen_random_uuid(),'dis','Gone','cashier','disabled',null),
 ('22222222-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',gen_random_uuid(),'ownb','OwnerB','owner','active',null);
insert into lb_businesses(id,tenant_id,name) values ('c0000000-0000-0000-0000-00000000000a',:'TA','Biz A'),('c0000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-000000000002','Biz B');
-- helpers read the token
select chkv('pos28_staff_id reads token', :'MGR', $$select pos28_staff_id()::text$$, '11111111-0000-0000-0000-000000000002');
select chkv('pos28_tenant_id reads token', :'MGR', $$select pos28_tenant_id()::text$$, 'a0000000-0000-0000-0000-000000000001');
select chkv('no token -> null staff', null, $$select pos28_staff_id()::text$$, null);
-- pos_my_access
select chkv('owner is_owner', :'OWN', $$select (pos_my_access()->>'is_owner')$$, 'true');
select chkv('owner template', :'OWN', $$select (pos_my_access()->>'template')$$, 'owner');
select chkv('owner has all 24 permissions', :'OWN', $$select jsonb_array_length(pos_my_access()->'permissions')::text$$, '24');
select chkv('manager not owner', :'MGR', $$select (pos_my_access()->>'is_owner')$$, 'false');
select chkv('manager lacks settings.manage', :'MGR', $$select (pos_my_access()->'permissions' ? 'settings.manage')::text$$, 'false');
select chkv('manager has refunds.approve', :'MGR', $$select (pos_my_access()->'permissions' ? 'refunds.approve')::text$$, 'true');
select chkv('cashier template falls back to role', :'CSH', $$select (pos_my_access()->>'template')$$, 'cashier');
select chkv('cashier has 5 default permissions', :'CSH', $$select jsonb_array_length(pos_my_access()->'permissions')::text$$, '5');
select chkv('disabled staff: no session', :'DIS', $$select (pos_my_access()->>'ok')$$, 'false');
select chkv('no token: no session', null, $$select (pos_my_access()->>'ok')$$, 'false');
select chk('anon cannot call pos_my_access', null, $$set role anon; select pos_my_access()$$, 'fail');
-- lb_businesses needs settings.manage
select chk('cashier cannot rename business', :'CSH', $$update lb_businesses set name='X' where id='c0000000-0000-0000-0000-00000000000a'$$, 'fail');
select chk('manager cannot change logo (no settings.manage)', :'MGR', $$update lb_businesses set logo_url='http://x/y.png' where id='c0000000-0000-0000-0000-00000000000a'$$, 'fail');
select chk('owner can change logo', :'OWN', $$update lb_businesses set logo_url='http://x/y.png', name='Biz A2' where id='c0000000-0000-0000-0000-00000000000a'$$, 'ok');
select chkv('logo saved', :'OWN', $$select logo_url from lb_businesses where id='c0000000-0000-0000-0000-00000000000a'$$, 'http://x/y.png');
select chk('manager cannot change receipt footer (extras guard)', :'MGR', $$update lb_businesses set receipt_footer='Hi' where id='c0000000-0000-0000-0000-00000000000a'$$, 'fail');
select chk('manager cannot change settings json', :'MGR', $$update lb_businesses set settings='{"x":1}' where id='c0000000-0000-0000-0000-00000000000a'$$, 'fail');
select chk('manager cannot change tax config', :'MGR', $$update lb_businesses set tax_config='{"vat":16}' where id='c0000000-0000-0000-0000-00000000000a'$$, 'fail');
select chk('manager touching nothing sensitive is fine (updated_at-style no-op)', :'MGR', $$update lb_businesses set name=name where id='c0000000-0000-0000-0000-00000000000a'$$, 'ok');
select chk('cashier cannot insert a business', :'CSH', $$insert into lb_businesses(tenant_id,name) values ('a0000000-0000-0000-0000-000000000001','Rogue')$$, 'fail');
select chk('owner changes footer and settings', :'OWN', $$update lb_businesses set receipt_footer='Karibu', settings='{"a":1}' where id='c0000000-0000-0000-0000-00000000000a'$$, 'ok');
-- audit trail append-only for staff
insert into pos_audit_log(pos_tenant_id,actor_type,actor_id,action) values ('a0000000-0000-0000-0000-000000000001','staff',null,'SEED');
select chk('staff can add an audit row for own business', :'CSH', $$insert into pos_audit_log(pos_tenant_id,actor_type,action) values ('a0000000-0000-0000-0000-000000000001','staff','X')$$, 'ok');
select chk('staff cannot add an audit row for another business', :'CSH', $$insert into pos_audit_log(pos_tenant_id,actor_type,action) values ('b0000000-0000-0000-0000-000000000002','staff','X')$$, 'fail');
select chkv('staff cannot rewrite audit rows', :'OWN', $$with u as (update pos_audit_log set action='EDITED' returning 1) select count(*)::text from u$$, '0');
select chkv('staff cannot delete audit rows', :'OWN', $$with d as (delete from pos_audit_log returning 1) select count(*)::text from d$$, '0');
select chkv('audit rows still there', :'OWN', $$select (count(*)>=2)::text from pos_audit_log$$, 'true');
select chk('owner cannot touch other tenant business', :'OWN', $$update lb_businesses set name='HACK' where id='c0000000-0000-0000-0000-00000000000b'$$, 'ok');
select chkv('other tenant business unchanged', '22222222-0000-0000-0000-000000000001', $$select name from lb_businesses where id='c0000000-0000-0000-0000-00000000000b'$$, 'Biz B');
select chk('owner grants settings.manage to manager (existing RPC)', :'OWN', $$select pos_set_staff_permission('11111111-0000-0000-0000-000000000002','settings.manage',true)$$, 'ok');
select chk('manager now can edit branding', :'MGR', $$update lb_businesses set receipt_footer='Thanks' where id='c0000000-0000-0000-0000-00000000000a'$$, 'ok');
select chk('owner revokes it', :'OWN', $$select pos_set_staff_permission('11111111-0000-0000-0000-000000000002','settings.manage',false)$$, 'ok');
select chk('manager blocked again', :'MGR', $$update lb_businesses set receipt_footer='Again' where id='c0000000-0000-0000-0000-00000000000a'$$, 'fail');
select chk('cashier cannot delete business', :'CSH', $$delete from lb_businesses where id='c0000000-0000-0000-0000-00000000000a'$$, 'fail');
-- non-staff (service / SQL editor) is unaffected
do $$ declare n int; begin perform set_config('request.jwt.claims','',false); update lb_businesses set name='Service edit' where id='c0000000-0000-0000-0000-00000000000a'; get diagnostics n = row_count; insert into t_res(ok,name) values (n=1,'service/SQL editor update unaffected'); end $$;
