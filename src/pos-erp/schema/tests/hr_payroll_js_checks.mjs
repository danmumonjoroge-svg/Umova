// run from the pos-erp folder: node schema/tests/hr_payroll_js_checks.mjs
import fs from 'fs'; let fail=0;
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m); if(!c) fail++;};
const rd=(p)=>fs.readFileSync(p,'utf8');
const sqls={hr:rd('schema/phase31_hr_payroll.sql'), rec:rd('schema/phase30_reconciliation.sql'), ctl:rd('schema/phase32_control_report.sql')};
const svcs={'services/hrService.js':sqls.hr,'services/reconcileService.js':sqls.rec,'services/controlReportService.js':sqls.ctl};
for (const [f,sql] of Object.entries(svcs)) {
  const s=rd(f);
  for (const fn of [...s.matchAll(/rpc\('(pos_\w+)'/g)].map(m=>m[1])) ok(new RegExp(`FUNCTION ${fn}\\(`).test(sql), `${f}: RPC exists: ${fn}`);
  for (const a of new Set([...s.matchAll(/\bp_(\w+):/g)].map(m=>m[1]))) ok(new RegExp(`p_${a}\\b`).test(sql), `${f}: argument exists: p_${a}`);
}
const nav=rd('navigation/navConfig.js'), app=rd('POSApp.jsx');
for (const [k,perm,page] of [['reconcile','finance.view','ReconciliationPage'],['hr','employees.manage','HrPage'],['payroll','payroll.access','PayrollPage'],['control','audit.view','ControlReportPage']]) {
  ok(new RegExp(`${k}: \\['${perm.replace('.','\\.')}'\\]`).test(nav), `route permission: ${k}`);
  ok(new RegExp(`path="${k}" element=\\{<RequirePermission perm=\\{ROUTE_PERMISSIONS\\["${k}"\\]\\}><${page} />`).test(app), `route guarded: ${k}`);
  ok(fs.existsSync(`pages/${page}.jsx`) && new RegExp(`/pos/${k}'`).test(nav), `page and menu entry: ${k}`);
}
const pay=rd('pages/PayrollPage.jsx'), hr=rd('pages/HrPage.jsx');
ok(!/\.from\(['"]pos_(hr|payroll)/.test(pay+hr+rd('services/hrService.js')), 'no direct table access from client');
ok(/RATES_NOT_CONFIRMED/.test(rd('services/hrService.js')) && /Confirm after checking/.test(pay), 'rate confirmation is surfaced');
ok(!/net\s*=|paye\s*=|\* 0\.0|0\.06|0\.0275/.test(pay), 'no pay arithmetic or statutory rates hard-coded in PayrollPage');
ok(/businessHeaderHtml/.test(pay) && /escapeHtml/.test(pay), 'payslip uses business header and escaping');
ok(/can\('payroll\.access'\)/.test(hr) && /canSalary/.test(hr), 'HR page hides salary without payroll.access');
ok(/REVOKE ALL ON pos_hr_employees/.test(sqls.hr) && /ENABLE ROW LEVEL SECURITY/.test(sqls.hr), 'HR/payroll tables RLS on, no client grants');
ok(!/auth\.users|DISABLE ROW LEVEL/i.test(sqls.hr+sqls.ctl+sqls.rec), 'no auth or RLS tampering');
ok(/not legal or tax advice|NOT confirmed/i.test(sqls.hr), 'migration states rates are unconfirmed');
console.log(fail?'\nFAILURES: '+fail:'\nALL HR/PAYROLL/REPORT JS CHECKS PASSED'); process.exit(fail?1:0);
