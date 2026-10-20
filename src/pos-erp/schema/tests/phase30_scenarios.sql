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
create function t_id() returns uuid language sql security definer as $$ select id from pos_reconciliations limit 1 $$;
create function t_val(p text) returns text language plpgsql security definer as $$ declare v text; begin execute p into v; return v; end $$;
grant execute on function t_id(), t_val(text) to authenticated;
\set OWN '11111111-0000-0000-0000-000000000001'
\set MGR '11111111-0000-0000-0000-000000000002'
\set CSH '11111111-0000-0000-0000-000000000003'
\set ACC '11111111-0000-0000-0000-000000000004'
\set BIZ 'c0000000-0000-0000-0000-00000000000a'
insert into pos_tenants values ('a0000000-0000-0000-0000-000000000001'),('b0000000-0000-0000-0000-000000000002');
insert into pos_staff(id,pos_tenant_id,auth_user_id,username,name,role) values
 (:'OWN','a0000000-0000-0000-0000-000000000001',gen_random_uuid(),'own','Owner','owner'),
 (:'MGR','a0000000-0000-0000-0000-000000000001',gen_random_uuid(),'mgr','Manager','manager'),
 (:'CSH','a0000000-0000-0000-0000-000000000001',gen_random_uuid(),'cash','Cashier','cashier'),
 (:'ACC','a0000000-0000-0000-0000-000000000001',gen_random_uuid(),'acc','Accountant','cashier'),
 ('22222222-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',gen_random_uuid(),'ownb','OwnerB','owner');
update pos_staff set role_template='accountant' where id=:'ACC';
insert into lb_businesses(id,tenant_id,name) values (:'BIZ','a0000000-0000-0000-0000-000000000001','Biz A'),('c0000000-0000-0000-0000-00000000000b','b0000000-0000-0000-0000-000000000002','Biz B');
create table tt as select (now() at time zone 'Africa/Nairobi')::date as d;
grant select on tt to authenticated;
create function at10(p_d date) returns timestamptz language sql as $$ select (p_d::timestamp + interval '10 hours') at time zone 'Africa/Nairobi' $$;
-- sales today
insert into lb_sales(id,tenant_id,business_id,sale_number,status,total_amount,completed_at) select x, 'a0000000-0000-0000-0000-000000000001', :'BIZ', 'S'||n, 'COMPLETED', 100, at10((select d from tt)) from (values ('50000000-0000-0000-0000-000000000001'::uuid,1),('50000000-0000-0000-0000-000000000002',2),('50000000-0000-0000-0000-000000000003',3),('50000000-0000-0000-0000-000000000004',4)) v(x,n);
insert into lb_payments(sale_id,payment_method,amount,change_amount,reference_no,status,created_at) values
 ('50000000-0000-0000-0000-000000000001','CASH',500,0,null,'COMPLETED',at10((select d from tt))),
 ('50000000-0000-0000-0000-000000000002','CASH',350,50,null,'COMPLETED',at10((select d from tt))),
 ('50000000-0000-0000-0000-000000000003','MOBILE_MONEY',250,0,'QWE123','COMPLETED',at10((select d from tt))),
 ('50000000-0000-0000-0000-000000000004','CREDIT',100,0,null,'COMPLETED',at10((select d from tt))),
 ('50000000-0000-0000-0000-000000000003','CASH',999,0,null,'REFUNDED',at10((select d from tt)));   -- refunded: must not count
insert into lb_folio_payments(tenant_id,business_id,payment_method,amount,created_at) values ('a0000000-0000-0000-0000-000000000001',:'BIZ','CASH',200,at10((select d from tt))),('a0000000-0000-0000-0000-000000000001',:'BIZ','MOBILE_MONEY',100,at10((select d from tt)));
insert into lb_cash_movements(business_id,movement_type,amount,created_at) values (:'BIZ','CASH_IN',50,at10((select d from tt))),(:'BIZ','CASH_OUT',20,at10((select d from tt)));
insert into lb_expenses(tenant_id,business_id,expense_date,amount,payment_method,status) values
 ('a0000000-0000-0000-0000-000000000001',:'BIZ',(select d from tt),80,'CASH','PAID'),('a0000000-0000-0000-0000-000000000001',:'BIZ',(select d from tt),999,'MOBILE_MONEY','PAID'),('a0000000-0000-0000-0000-000000000001',:'BIZ',(select d from tt),777,'CASH','CANCELLED');
insert into lb_mpesa_transactions(tenant_id,business_id,status) values ('a0000000-0000-0000-0000-000000000001',:'BIZ','PENDING'),('a0000000-0000-0000-0000-000000000001',:'BIZ','PAID');
-- timezone edge: 22:30 UTC the day before = 01:30 Nairobi today -> belongs to TODAY
insert into lb_sales(id,tenant_id,business_id,sale_number,status,total_amount) values ('50000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000001',:'BIZ','S5','COMPLETED',40);
insert into lb_payments(sale_id,payment_method,amount,status,created_at) values ('50000000-0000-0000-0000-000000000005','CASH',40,'COMPLETED',((select d from tt)::timestamp at time zone 'Africa/Nairobi') + interval '1 hour 30 minutes');

select chkv('expected cash = 500+300+200+50+40-20-80 = 990', :'ACC', $$select (pos_reconcile_preview('c0000000-0000-0000-0000-00000000000a',(select d from tt))->'expected'->>'expected_cash')$$, '990');
select chkv('expected M-Pesa = 250 sale + 100 folio', :'ACC', $$select (pos_reconcile_preview('c0000000-0000-0000-0000-00000000000a',(select d from tt))->'expected'->>'expected_mpesa')$$, '350');
select chkv('credit sale shown but not expected cash', :'ACC', $$select (pos_reconcile_preview('c0000000-0000-0000-0000-00000000000a',(select d from tt))->'expected'->>'credit_sales')$$, '100');
select chkv('warnings: pending, paid-without-sale', :'ACC', $$select jsonb_array_length(pos_reconcile_preview('c0000000-0000-0000-0000-00000000000a',(select d from tt))->'expected'->'warnings')::text$$, '2');
select chke('cashier cannot reconcile', :'CSH', $$select pos_reconcile_preview('c0000000-0000-0000-0000-00000000000a',(select d from tt))$$, 'NOT_ALLOWED');
select chke('other tenant business refused', :'MGR', $$select pos_reconcile_preview('c0000000-0000-0000-0000-00000000000b',(select d from tt))$$, 'NOT_FOUND');
select chke('future date refused', :'MGR', $$select pos_reconcile_save('c0000000-0000-0000-0000-00000000000a',(select d from tt)+1,0,0,0,null)$$, 'FUTURE_DATE');
select chke('negative amount refused', :'MGR', $$select pos_reconcile_save('c0000000-0000-0000-0000-00000000000a',(select d from tt),0,-5,0,null)$$, 'BAD_AMOUNT');
select chke('variance needs a reason', :'ACC', $$select pos_reconcile_save('c0000000-0000-0000-0000-00000000000a',(select d from tt),1000,1900,350,null)$$, 'REASON_REQUIRED');
select chk('variance with reason saves', :'ACC', $$select pos_reconcile_save('c0000000-0000-0000-0000-00000000000a',(select d from tt),1000,1900,350,'Short by 90, change given wrongly')$$, 'ok');
select chkv('variance recorded (-90 cash)', :'OWN', $$select t_val($q$select variance_cash::text from pos_reconciliations$q$)$$, '-90.00');
select chk('re-count to exact match saves without reason', :'ACC', $$select pos_reconcile_save('c0000000-0000-0000-0000-00000000000a',(select d from tt),1000,1990,350,null)$$, 'ok');
select chkv('variance now zero, one row per day', :'OWN', $$select t_val($q$select count(*)||'|'||max(variance_cash)||'|'||max(variance_mpesa) from pos_reconciliations$q$)$$, '1|0.00|0.00');
select chke('accountant cannot sign off (no payments.approve)', :'ACC', $$select pos_reconcile_signoff(t_id())$$, 'NOT_ALLOWED');
select chk('owner grants payments.approve to ACC', :'OWN', $$select pos_set_staff_permission('11111111-0000-0000-0000-000000000004','payments.approve',true)$$, 'ok');
select chke('preparer cannot sign off own count (not owner)', :'ACC', $$select pos_reconcile_signoff(t_id())$$, 'SECOND_PERSON');
select chk('a different person signs off', :'MGR', $$select pos_reconcile_signoff(t_id())$$, 'ok');
select chkv('signed off, not self signed', :'OWN', $$select t_val($q$select status||'|'||self_signed from pos_reconciliations$q$)$$, 'SIGNED_OFF|false');
select chke('signed-off day is locked', :'ACC', $$select pos_reconcile_save('c0000000-0000-0000-0000-00000000000a',(select d from tt),1000,1,1,'try to change')$$, 'LOCKED');
select chke('cannot sign twice', :'OWN', $$select pos_reconcile_signoff(t_id())$$, 'LOCKED');
select chk('direct read of reconciliations is denied', :'MGR', $$select * from pos_reconciliations$$, 'fail');
select chkv('list shows the day with names', :'OWN', $$select (pos_reconcile_list('c0000000-0000-0000-0000-00000000000a',(select d from tt)-7,(select d from tt))->0->>'signed_by_name')$$, 'Manager');
select chkv('audit has save + signoff', :'OWN', $$select t_val($q$select count(*)::text from pos_audit_log where action like 'RECONCILIATION_%'$q$)$$, '3');
-- owner can sign own count (flag), yesterday: sale paid 3 days ago reversed today -> cash given back counted today
insert into lb_sales(id,tenant_id,business_id,sale_number,status,total_amount,completed_at) values ('50000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000001',:'BIZ','S6','VOIDED',100,at10((select d from tt)-3)),('50000000-0000-0000-0000-000000000007','a0000000-0000-0000-0000-000000000001',:'BIZ','S7','VOIDED',60,at10((select d from tt)));
insert into pos_sale_reversals(pos_tenant_id,business_id,sale_id,sale_number,sale_total,reason,status,requested_by,decided_by,decided_at,effects,warnings) values
 ('a0000000-0000-0000-0000-000000000001',:'BIZ','50000000-0000-0000-0000-000000000006','S6',100,'wrong day entry','APPROVED',:'CSH',:'MGR',now(),'{"cash":100,"mobile_money":30}','["CASH_OUT_TODAY: x"]'),
 ('a0000000-0000-0000-0000-000000000001',:'BIZ','50000000-0000-0000-0000-000000000007','S7',60,'same day, payments marked','APPROVED',:'CSH',:'MGR',now(),'{"cash":60}','[]');
create function _rx() returns jsonb language sql security definer as $$ select _reconcile_expected('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a',(select d from tt)) $$;
grant execute on function _rx() to authenticated; grant select on tt to authenticated;
select chkv('old-day reversal: cash given back 100 today; same-day marked one ignored', :'MGR', $$select (_rx()->>'reversal_cash_given_back')||'|'||(_rx()->>'reversal_mpesa_to_send')||'|'||(_rx()->>'expected_cash')$$, '100|30|890');
select chkv('other day unaffected (yesterday expected 0)', :'MGR', $$select (pos_reconcile_preview('c0000000-0000-0000-0000-00000000000a',(select d from tt)-1)->'expected'->>'expected_cash')$$, '0');
select case when ok then 'PASS ' else 'FAIL ' end || name from t_res order by n;
select 'TOTAL '||count(*)||' FAIL '||count(*) filter (where not ok) from t_res;
