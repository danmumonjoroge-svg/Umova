import fs from 'fs'; let fail=0;
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c) fail++;};
const nav=fs.readFileSync('navigation/navConfig.js','utf8');
const app=fs.readFileSync('POSApp.jsx','utf8');
const lay=fs.readFileSync('POSLayout.jsx','utf8');
const set=fs.readFileSync('pages/SettingsPage.jsx','utf8');
const sql=fs.readFileSync('schema/phase28_staff_permissions.sql','utf8');
const svc=fs.readFileSync('services/permissionService.js','utf8');
const cst=fs.readFileSync('constants/permissions.js','utf8');
// The LIVE catalogue (pos_all_permissions() as read from the real database). The app must only use these keys.
const keySet=new Set(['sales.view','sales.create','sales.discount','refunds.request','refunds.approve','products.manage','inventory.view','inventory.scan','inventory.receive','inventory.adjust','inventory.stocktake','inventory.transfer','purchases.create','finance.view','balances.view','expenses.record','payments.record','payments.approve','reports.export','employees.manage','payroll.access','settings.manage','audit.view','operations.use']);
// every permission the UI mentions exists in the DB catalogue
const uiKeys=[...cst.matchAll(/\['([a-z]+\.[\w.]+)'/g)].map(m=>m[1]);
for(const k of uiKeys) ok(keySet.has(k),'UI permission exists in DB catalogue: '+k);
const routeKeys=[...nav.matchAll(/perm: \[([^\]]*)\]|: \[('[a-z.@]+'(?:, ?'[a-z.@]+')*)\]/g)].flatMap(m=>[...(m[1]||m[2]||'').matchAll(/'([a-z.@]+)'/g)].map(x=>x[1])).filter(k=>/^[a-z]+\.[a-z]+$/.test(k));
for(const k of new Set([...routeKeys, ...[...nav.matchAll(/(?:RETAIL|MONEY|PEOPLE)_PERMS = \[([^\]]*)\]/g)].flatMap(m=>[...m[1].matchAll(/'([a-z.]+)'/g)].map(x=>x[1]))])) ok(keySet.has(k),'route/nav permission exists in live catalogue: '+k);
ok(!/page\.[a-z]+'/.test(nav),'no invented page.* keys remain in navigation');
ok(/PermissionsProvider/.test(lay),'layout provides permissions');
ok(/path="staff"/.test(app)&&/StaffPage/.test(app),'staff route registered');
for(const r of ['settings','audit','cash','expenses','customers','products']) ok(new RegExp(`path="${r}"[^\\n]*RequirePermission`).test(app),'route guarded: '+r);
ok(/permsLoaded \? can\('settings.manage'\)/.test(set),'settings gate uses DB permission when loaded');
ok(!/ALTER TABLE.*DISABLE ROW LEVEL/i.test(sql),'migration never disables RLS');
ok(!/DROP POLICY IF EXISTS (t|tenant_isolation)/.test(sql),'does not drop tenant policies');
ok(!/CREATE (OR REPLACE )?FUNCTION (pos_has_permission|pos_my_permissions|pos_list_staff|pos_create_staff|pos_set_staff_\w+|pos_all_permissions|pos_role_default_permissions|is_pos_session|pos_enforce_permission|_pos_\w+|pos_current_\w+)\b/i.test(sql),'phase28 does not redefine any existing function');
ok(!/CREATE TABLE/i.test(sql),'phase28 creates no tables (no second permission system)');
for(const f of ['pos_list_staff','pos_create_staff','pos_set_staff_template','pos_set_staff_permission','pos_set_staff_status','pos_reset_staff_password','pos_my_access']) ok(svc.includes("'"+f+"'"),'service calls existing RPC: '+f);
ok(svc.includes('p_perm:')&&!svc.includes('p_permission'),'pos_set_staff_permission called with the live parameter name p_perm');
ok(!/auth\.users|signInWith|ALTER TABLE auth/.test(sql),'phase28 does not touch auth');
for(const f of ['29_sale_reversals','30_reconciliation','31_hr_payroll','32_control_report']){const s=fs.readFileSync('schema/phase'+f+'.sql','utf8'); ok(!/pos_has_permission\('(sales\.reverse|cash\.|hr\.|payroll\.(view|run)|settings\.edit|staff\.|page\.)/.test(s)&&!/pos_current_(staff|tenant)_id\(\)|pos_is_pos_session/.test(s),'phase'+f+' uses only live permission keys and token helpers');}
console.log(fail?'\nFAILURES: '+fail:'\nALL PERMISSION JS CHECKS PASSED'); process.exit(fail?1:0);
