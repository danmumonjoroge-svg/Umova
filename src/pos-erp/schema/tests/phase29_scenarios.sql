\set ON_ERROR_STOP on
alter table pos_staff enable row level security; alter table pos_audit_log enable row level security;
alter table lb_sales enable row level security; alter table lb_payments enable row level security;
create policy t on pos_staff using (pos_tenant_id = get_current_tenant_id());
create policy t on pos_audit_log using (pos_tenant_id = get_current_tenant_id()) with check (pos_tenant_id = get_current_tenant_id());
create policy t on lb_sales using (tenant_id = get_current_tenant_id()) with check (tenant_id = get_current_tenant_id());
create policy t on lb_payments using (true) with check (true);
grant select,insert,update,delete on pos_staff,pos_audit_log,lb_sales,lb_payments,lb_sale_items,lb_inventory to authenticated;
grant usage,select on all sequences in schema public to authenticated; grant usage on schema auth to authenticated;
grant select on lb_stock_movements, lb_customers, lb_customer_credit_transactions, lb_warehouses, lb_products to authenticated;
create or replace function t_req(p_num text, p_status text default null) returns uuid language sql security definer as $$ select id from pos_sale_reversals where sale_number=p_num and (p_status is null or status=p_status) limit 1 $$;
create or replace function t_rx(p_num text, p_col text) returns text language plpgsql security definer as $$ declare v text; begin execute format('select %I::text from pos_sale_reversals where sale_number=%L order by requested_at desc limit 1', p_col, p_num) into v; return v; end $$;
grant execute on function t_req(text,text), t_rx(text,text) to authenticated;
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
  perform set_config('request.jwt.claims', case when p_staff is null then '{}' else json_build_object('pos_staff_id',p_staff,'pos_tenant_id',(select pos_tenant_id from pos_staff where id=p_staff))::text end, false);
  execute 'set role authenticated'; execute p_sql into v; execute 'reset role';
  insert into t_res(ok,name) values (v is not distinct from p_expect, p_name||' (got '||coalesce(v,'null')||')');
end $$;
-- error text check: statement must fail with a message containing p_frag
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
\set CS2 '11111111-0000-0000-0000-000000000004'
insert into pos_tenants values ('a0000000-0000-0000-0000-000000000001'),('b0000000-0000-0000-0000-000000000002');
insert into pos_staff(id,pos_tenant_id,auth_user_id,username,name,role) values
 (:'OWN','a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000001','own','Owner','owner'),
 (:'MGR','a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000002','mgr','Manager','manager'),
 (:'CSH','a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000003','cash','Cashier','cashier'),
 (:'CS2','a0000000-0000-0000-0000-000000000001','f0000000-0000-0000-0000-000000000004','cash2','Cashier2','cashier'),
 ('22222222-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002','f0000000-0000-0000-0000-000000000009','ownb','OwnerB','owner');
insert into lb_warehouses(id,tenant_id,business_id,is_default) values ('d0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a',true);
insert into lb_products(id,tenant_id,name,track_inventory) values ('e0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Sugar',true),('e0000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','Haircut',false);
insert into lb_inventory(tenant_id,business_id,warehouse_id,product_id,quantity,average_cost,stock_status) values ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','d0000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',10,50,'NORMAL');
insert into lb_customers(id,tenant_id,name,outstanding_balance) values ('90000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','Mama Jo',300);
-- sales (stock already reduced to 10 after these sales)
-- S1 cash+mpesa, cashier CSH ; S2 credit sale, CSH ; S3 cash, CS2 ; S4 other tenant ; S5 folio sale ; S6 old (3 days) by CSH
insert into lb_sales(id,tenant_id,business_id,cashier_id,customer_id,folio_id,sale_number,status,total_amount,completed_at) values
 ('50000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-000000000003',null,null,'S-000001','COMPLETED',500,now()),
 ('50000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000001',null,'S-000002','COMPLETED',300,now()),
 ('50000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-000000000004',null,null,'S-000003','COMPLETED',100,now()),
 ('50000000-0000-0000-0000-000000000004','b0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-00000000000b','f0000000-0000-0000-0000-000000000009',null,null,'S-000004','COMPLETED',900,now()),
 ('50000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-000000000003',null,'a1000000-0000-0000-0000-000000000001','S-000005','COMPLETED',80,now()),
 ('50000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-000000000003',null,null,'S-000006','COMPLETED',60,now()-interval '3 days');
insert into lb_sale_items(sale_id,product_id,quantity,cost_price) values
 ('50000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000001',4,50),
 ('50000000-0000-0000-0000-000000000001','e0000000-0000-0000-0000-000000000002',1,0),
 ('50000000-0000-0000-0000-000000000002','e0000000-0000-0000-0000-000000000001',2,50),
 ('50000000-0000-0000-0000-000000000003','e0000000-0000-0000-0000-000000000001',1,50),
 ('50000000-0000-0000-0000-000000000006','e0000000-0000-0000-0000-000000000001',1,50);
insert into lb_payments(sale_id,payment_method,amount,change_amount,status,created_at) values
 ('50000000-0000-0000-0000-000000000001','CASH',300,50,'COMPLETED',now()),
 ('50000000-0000-0000-0000-000000000001','MOBILE_MONEY',250,0,'COMPLETED',now()),
 ('50000000-0000-0000-0000-000000000002','CREDIT',300,0,'COMPLETED',now()),
 ('50000000-0000-0000-0000-000000000003','CASH',100,0,'COMPLETED',now()),
 ('50000000-0000-0000-0000-000000000006','CASH',60,0,'COMPLETED',now()-interval '3 days');
insert into lb_customer_credit_transactions(tenant_id,business_id,customer_id,transaction_type,reference_type,reference_id,amount,balance_after) values
 ('a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','90000000-0000-0000-0000-000000000001','CREDIT_SALE','sale','50000000-0000-0000-0000-000000000002',300,300);

-- request rules
select chk('cashier requests reversal of own sale', :'CSH', $$select pos_request_sale_reversal('50000000-0000-0000-0000-000000000001','Customer returned goods')$$, 'ok');
select chke('second request for same sale refused', :'CSH', $$select pos_request_sale_reversal('50000000-0000-0000-0000-000000000001','Customer returned again')$$, 'ALREADY_REQUESTED');
select chke('cashier cannot request a colleague''s sale', :'CSH', $$select pos_request_sale_reversal('50000000-0000-0000-0000-000000000003','Wrong item rung up')$$, 'NOT_ALLOWED');
select chke('cashier cannot request an old sale (3 days)', :'CSH', $$select pos_request_sale_reversal('50000000-0000-0000-0000-000000000006','Wrong item rung up')$$, 'NOT_ALLOWED');
select chke('reason required', :'CS2', $$select pos_request_sale_reversal('50000000-0000-0000-0000-000000000003','x')$$, 'REASON_REQUIRED');
select chke('cannot request another tenant''s sale', :'MGR', $$select pos_request_sale_reversal('50000000-0000-0000-0000-000000000004','Wrong sale rung up')$$, 'SALE_NOT_FOUND');
select chke('folio sale refused', :'MGR', $$select pos_request_sale_reversal('50000000-0000-0000-0000-000000000005','Wrong sale rung up')$$, 'SALE_ON_FOLIO');
select chkv('cashier sees only own sales in picker', :'CSH', $$select jsonb_array_length(pos_recent_sales())::text$$, '3');  -- S1,S2,S5 (S3 other cashier, S6 too old)
select chkv('manager sees all tenant sales in picker', :'MGR', $$select jsonb_array_length(pos_recent_sales())::text$$, '5');
-- approval
select chke('cashier cannot approve', :'CSH', $$select pos_decide_sale_reversal(t_req('S-000001'), true, null)$$, 'NOT_ALLOWED');
select chkv('sale still completed before approval', :'MGR', $$select status from lb_sales where id='50000000-0000-0000-0000-000000000001'$$, 'COMPLETED');
select chkv('stock unchanged before approval', :'MGR', $$select quantity::text from lb_inventory$$, '10');

-- approve S1 (cash 300 paid with 50 change, mpesa 250): stock 4 back, payments marked, warnings
select chk('manager approves cashier request', :'MGR', $$select pos_decide_sale_reversal(t_req('S-000001'),true,'ok')$$, 'ok');
select chkv('sale now VOIDED', :'OWN', $$select status from lb_sales where id='50000000-0000-0000-0000-000000000001'$$, 'VOIDED');
select chkv('stock returned (10+4)', :'OWN', $$select quantity::text from lb_inventory$$, '14');
select chkv('untracked item made no stock row', :'OWN', $$select count(*)::text from lb_stock_movements$$, '1');
select chkv('stock movement references the sale', :'OWN', $$select reference_id::text||'|'||movement_type||'|'||quantity from lb_stock_movements$$, '50000000-0000-0000-0000-000000000001|STOCK_RETURN|4');
select chkv('payments marked REFUNDED', :'OWN', $$select string_agg(distinct status,',') from lb_payments where sale_id='50000000-0000-0000-0000-000000000001'$$, 'REFUNDED');
select chkv('effects: cash net 250 (300-50)', :'OWN', $$select (t_rx('S-000001','effects')::jsonb)->>'cash'$$, '250');
select chkv('effects: mpesa 250', :'OWN', $$select (t_rx('S-000001','effects')::jsonb)->>'mobile_money'$$, '250');
select chkv('warns about M-Pesa payout', :'OWN', $$select (t_rx('S-000001','warnings') like '%MPESA_PAYOUT%')::text$$, 'true');
select chkv('request approved, not self approved', :'OWN', $$select t_rx('S-000001','status')||'|'||t_rx('S-000001','self_approved')$$, 'APPROVED|false');
select chke('cannot decide twice', :'MGR', $$select pos_decide_sale_reversal(t_req('S-000001'),true,'again')$$, 'ALREADY_DECIDED');
select chke('cannot request an already reversed sale', :'MGR', $$select pos_request_sale_reversal('50000000-0000-0000-0000-000000000001','Trying again now')$$, 'ALREADY_REVERSED');
-- credit sale S2: manager self-approves
select chk('manager requests and self-approves credit sale', :'MGR', $$select pos_request_sale_reversal('50000000-0000-0000-0000-000000000002','Customer cancelled the order')$$, 'ok');
select chk('manager approves own request', :'MGR', $$select pos_decide_sale_reversal(t_req('S-000002'),true,null)$$, 'ok');
select chkv('flagged self_approved', :'OWN', $$select t_rx('S-000002','self_approved')$$, 'true');
select chkv('customer balance reduced 300 -> 0', :'OWN', $$select outstanding_balance::text from lb_customers$$, '0');
select chkv('ledger reversal row written (-300)', :'OWN', $$select amount::text from lb_customer_credit_transactions where reference_type='sale_reversal'$$, '-300');
select chkv('stock back for credit sale (14+2)', :'OWN', $$select quantity::text from lb_inventory$$, '16');
-- reject path
select chk('cashier2 requests', :'CS2', $$select pos_request_sale_reversal('50000000-0000-0000-0000-000000000003','Changed my mind')$$, 'ok');
select chke('rejecting needs a note', :'MGR', $$select pos_decide_sale_reversal(t_req('S-000003'),false,null)$$, 'NOTE_REQUIRED');
select chk('manager rejects with note', :'MGR', $$select pos_decide_sale_reversal(t_req('S-000003'),false,'Customer already left with the goods')$$, 'ok');
select chkv('rejected sale untouched', :'OWN', $$select status from lb_sales where id='50000000-0000-0000-0000-000000000003'$$, 'COMPLETED');
select chkv('rejected: stock untouched (16)', :'OWN', $$select quantity::text from lb_inventory$$, '16');
select chk('after rejection a new request is allowed', :'CS2', $$select pos_request_sale_reversal('50000000-0000-0000-0000-000000000003','Manager please check again')$$, 'ok');
select chk('requester cancels pending request', :'CS2', $$select pos_cancel_sale_reversal(t_req('S-000003','PENDING'))$$, 'ok');
select chke('other cashier cannot cancel', :'CSH', $$select pos_cancel_sale_reversal(t_req('S-000003'))$$, 'NOT_ALLOWED');
-- old-day cash: S6 (cash 3 days ago) by manager
select chk('manager reverses old cash sale', :'MGR', $$select pos_request_sale_reversal('50000000-0000-0000-0000-000000000006','Recorded on the wrong day')$$, 'ok');
select chk('...approved by owner', :'OWN', $$select pos_decide_sale_reversal(t_req('S-000006'),true,null)$$, 'ok');
select chkv('old-day cash warning present', :'OWN', $$select (t_rx('S-000006','warnings') like '%CASH_OUT_TODAY%')::text$$, 'true');
-- listing
select chkv('cashier lists only own requests', :'CSH', $$select count(*)::text from jsonb_array_elements(pos_list_sale_reversals())$$, '1');
select chkv('manager lists all requests', :'MGR', $$select (jsonb_array_length(pos_list_sale_reversals())>=5)::text$$, 'true');
-- audit
select chkv('audit trail has request/approve/reject/cancel', :'OWN', $$select count(distinct action)::text from pos_audit_log where action like 'SALE_REVERSAL%' or action='SALE_REVERSED'$$, '4');
-- back doors closed
select chk('cashier cannot set sale VOIDED directly', :'CSH', $$update lb_sales set status='VOIDED' where id='50000000-0000-0000-0000-000000000005'$$, 'fail');
select chkv('sale still completed', :'OWN', $$select status from lb_sales where id='50000000-0000-0000-0000-000000000005'$$, 'COMPLETED');
select chk('owner cannot set sale VOIDED directly either', :'OWN', $$update lb_sales set status='VOIDED' where id='50000000-0000-0000-0000-000000000005'$$, 'fail');
select chk('staff can still update other sale fields', :'CSH', $$update lb_sales set notes='hello' where id='50000000-0000-0000-0000-000000000005'$$, 'ok');
select chk('cashier cannot delete a finished sale', :'CSH', $$delete from lb_sales where id='50000000-0000-0000-0000-000000000005'$$, 'ok');
select chkv('finished sale survives delete', :'OWN', $$select count(*)::text from lb_sales where id='50000000-0000-0000-0000-000000000005'$$, '1');
select chk('cashier cannot edit a payment', :'CSH', $$update lb_payments set amount=1$$, 'ok');
select chkv('payment amounts unchanged', :'OWN', $$select count(*)::text from lb_payments where amount=1$$, '0');
select chk('cashier cannot delete payments', :'CSH', $$delete from lb_payments$$, 'ok');
select chkv('payments survive delete', :'OWN', $$select (count(*)>0)::text from lb_payments$$, 'true');
select chk('service path (no staff session) can still update sales', null::uuid, $$update lb_sales set notes='svc' where id='50000000-0000-0000-0000-000000000005'$$, 'ok');
-- rollback of a just-created folio sale
insert into lb_sales(id,tenant_id,business_id,cashier_id,folio_id,sale_number,status,total_amount,completed_at) values ('50000000-0000-0000-0000-000000000007','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','S-000007','COMPLETED',40,now());
insert into lb_sale_items(sale_id,product_id,quantity,cost_price) values ('50000000-0000-0000-0000-000000000007','e0000000-0000-0000-0000-000000000001',1,50);
select chke('other cashier cannot roll back it', :'CS2', $$select pos_rollback_new_sale('50000000-0000-0000-0000-000000000007','x')$$, 'NOT_ALLOWED');
select chk('own cashier rolls back a folio-failed sale', :'CSH', $$select pos_rollback_new_sale('50000000-0000-0000-0000-000000000007','Could not be charged to the folio')$$, 'ok');
select chkv('rolled back + stock returned (17+1)', :'OWN', $$select (select status from lb_sales where id='50000000-0000-0000-0000-000000000007')||'|'||(select quantity from lb_inventory)$$, 'VOIDED|18');
select chke('rollback refused for a normal (non-folio) sale', :'CS2', $$select pos_rollback_new_sale('50000000-0000-0000-0000-000000000003','x')$$, 'NOT_ALLOWED');
insert into lb_sales(id,tenant_id,business_id,cashier_id,folio_id,sale_number,status,total_amount,completed_at) values ('50000000-0000-0000-0000-000000000008','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-00000000000a','f0000000-0000-0000-0000-000000000003','a1000000-0000-0000-0000-000000000001','S-000008','COMPLETED',40,now());
insert into lb_folio_lines(sale_id) values ('50000000-0000-0000-0000-000000000008');
select chke('rollback refused once a folio line exists', :'CSH', $$select pos_rollback_new_sale('50000000-0000-0000-0000-000000000008','x')$$, 'NOT_ALLOWED');
-- atomicity: a failure inside the core leaves everything untouched
insert into lb_sales(id,tenant_id,business_id,cashier_id,sale_number,status,total_amount,completed_at) values ('50000000-0000-0000-0000-000000000009','a0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-0000000000ff','f0000000-0000-0000-0000-000000000003','S-000009','COMPLETED',40,now());
insert into lb_sale_items(sale_id,product_id,quantity,cost_price) values ('50000000-0000-0000-0000-000000000009','e0000000-0000-0000-0000-000000000001',3,50);
select chk('request on sale whose business has no warehouse', :'MGR', $$select pos_request_sale_reversal('50000000-0000-0000-0000-000000000009','Warehouse missing test')$$, 'ok');
select chke('approval fails cleanly (no warehouse)', :'MGR', $$select pos_decide_sale_reversal(t_req('S-000009'),true,null)$$, 'NO_DEFAULT_WAREHOUSE');
select chkv('failed approval left sale + request untouched', :'OWN', $$select (select status from lb_sales where id='50000000-0000-0000-0000-000000000009')||'|'||t_rx('S-000009','status')||'|'||(select quantity from lb_inventory)$$, 'COMPLETED|PENDING|18');
-- tenant isolation of the request table
select chke('other tenant owner cannot decide our request', '22222222-0000-0000-0000-000000000001', $$select pos_decide_sale_reversal(t_req('S-000009'),true,null)$$, 'NOT_FOUND');
select chk('no direct read of reversal table', :'MGR', $$select * from pos_sale_reversals$$, 'fail');

select case when ok then 'PASS ' else 'FAIL ' end || name from t_res order by n;
select 'TOTAL '||count(*)||' FAIL '||count(*) filter (where not ok) from t_res;
