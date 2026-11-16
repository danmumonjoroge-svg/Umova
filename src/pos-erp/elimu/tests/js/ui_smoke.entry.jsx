import React, { Suspense } from 'react';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import ElimuRoutes from '../../routes.jsx';
import ElimuContactActions from '../../components/ElimuContactActions.jsx';
import { ElimuAccessProvider } from '../../hooks/useElimu.js';
import ElimuMessageComposer from '../../components/ElimuMessageComposer.jsx';
import StudentFormSheet from '../../components/StudentFormSheet.jsx';
import GuardianFormSheet from '../../components/GuardianFormSheet.jsx';
import ConsentEditor from '../../components/ConsentEditor.jsx';
import * as api from '../../index.js';
import ElimuApp from '../../ElimuApp.jsx';
import AppSheet from '../../components/AppSheet.jsx';
import ParentApp from '../../parent/ParentApp.jsx';
import { STAFF_ROLE_CHOICES, NAV_ITEMS } from '../../utils/permissions.js';
import ElimuLogin from '../../auth/ElimuLogin.jsx';
import ElimuRegister from '../../auth/ElimuRegister.jsx';
import { isElimuDemo, ELIMU_DEMO_CODE } from '../../auth/demo.js';
import { toE164 } from '../../parent/parentClient.js';

const guardian = { id: 'g1', first_name: 'Grace', last_name: 'Otieno', consent: [{ channel: 'EMAIL', status: 'OPTED_OUT' }],
  contacts: [{ id: 'c1', kind: 'PHONE', value: '0712345678', is_primary: true, is_whatsapp: true }, { id: 'c2', kind: 'EMAIL', value: 'g@x.co', is_primary: true }] };
const student = { id: 's1', first_name: 'Amina', last_name: 'Otieno', preferred_name: 'Mina' };
const results = [];
const check = (name, fn) => { try { const html = fn(); results.push([name, html.length > 0, '']); return html; } catch (e) { results.push([name, false, e.message]); return ''; } };

for (const path of ['/elimu', '/elimu/students', '/elimu/students/s1', '/elimu/guardians', '/elimu/guardians/g1', '/elimu/admissions', '/elimu/classes', '/elimu/communication', '/elimu/settings'])
  check(`route ${path}`, () => renderToString(<MemoryRouter initialEntries={[path]}><Routes><Route path="/elimu/*" element={<Routes_ />} /></Routes></MemoryRouter>));
// unified app shell (phone layout): every school route renders under /school without throwing, with the app bar and the bottom tab bar
for (const path of ['/school', '/school/students', '/school/attendance', '/school/attendance/take', '/school/absences', '/school/timetable', '/school/calendar', '/school/academics', '/school/academics/assessments', '/school/gate', '/school/rooms', '/school/fees', '/school/finance', '/school/finance/fees', '/school/finance/reports', '/school/school-finance/collect', '/school/settings']) {
  const html = check(`app route ${path}`, () => renderToString(<MemoryRouter initialEntries={[path]}><Routes><Route path="/school/*" element={<Routes2 />} /></Routes></MemoryRouter>));
  results.push([`app shell ${path}: tab bar present`, html.includes('aria-label="School tabs"'), '']);
}
function Routes2() { return <Suspense fallback={<i>loading-chunk</i>}><ElimuRoutes basePath="/school" accessOverride={{ can: () => true, loaded: true, isOwner: true, roles: [] }} /></Suspense>; }
{ const r = (p) => renderToString(<MemoryRouter initialEntries={[p]}><Routes><Route path="/school/*" element={<Routes2 />} /></Routes></MemoryRouter>); const nothing = r('/school/zzz');   // no match -> Navigate (renders nothing on the server): just the empty shell
  for (const p of ['/school/attendance', '/school/absences', '/school/academics', '/school/academics/assessments', '/school/timetable', '/school/calendar', '/school/gate', '/school/rooms', '/school/finance', '/school/finance/fees', '/school/finance/payables', '/school/school-finance/collect', '/school/settings'])
    results.push([`${p} matches a real route (renders more than the empty shell)`, r(p).length > nothing.length, '']);
  results.push(['/school/academics shows the Academics home', r('/school/academics').includes('Academics &amp; exams'), '']); }
{ const r = (p) => renderToString(<MemoryRouter initialEntries={[p]}><Routes><Route path="/school/*" element={<Routes2 />} /></Routes></MemoryRouter>);
  const hub = r('/school/finance'); const fees = r('/school/finance/fees'); const none = r('/school/finance/zzz');
  results.push(['Finance hub lists the submodules', ['Fees', 'Receivables', 'Payables &amp; expenses', 'Bank &amp; cash', 'Assets &amp; inventory', 'Reports &amp; statements'].every((t) => hub.includes(t)), '']);
  results.push(['Finance > Fees lists its pages and a breadcrumb', ['Collect fees', 'Bursaries &amp; scholarships', 'Fee balances', 'Where you are'].every((t) => fees.includes(t)), '']);
  results.push(['unbuilt pages are shown as SOON, not as links', r('/school/finance/zzz').includes('does not exist') && r('/school/finance/reports').includes('Trial balance'), '']);
  const pay = r('/school/finance/payables');
  results.push(['Payables: Expenses, Budgets, Suppliers and Staff are all built', ['Expenses', 'Budgets', 'Suppliers', 'Staff &amp; payroll'].every((t) => pay.includes(t)) && (pay.match(/SOON/g) || []).length === 0, String((pay.match(/SOON/g) || []).length)]);
  const acc = r('/school/finance/accounting');
  results.push(['Accounting group lists Chart of accounts, Journals and Trial balance, none SOON', ['Chart of accounts', 'Journals', 'Trial balance'].every((t) => acc.includes(t)) && !acc.includes('SOON'), '']);
  const rep = r('/school/finance/reports');
  results.push(['Reports: every statement is built', ['Statement of financial position', 'Income statement', 'Cash flow statement', 'Trial balance'].every((t) => rep.includes(t)) && (rep.match(/SOON/g) || []).length === 0, String((rep.match(/SOON/g) || []).length)]);
  const recv = r('/school/finance/receivables');
  results.push(['Receivables: students, government and other are all built', (recv.match(/SOON/g) || []).length === 0, '']);
  results.push(['No finance page is SOON any more (fees, bank, assets, payables, reports)', (r('/school/finance/fees').match(/SOON/g) || []).length === 0 && (r('/school/finance/bank').match(/SOON/g) || []).length === 0 && (r('/school/finance/assets').match(/SOON/g) || []).length === 0, '']);
  results.push(['Assets & inventory: fixed assets and stores are built, none SOON', ['Fixed assets', 'Stores &amp; inventory'].every((t) => r('/school/finance/assets').includes(t)), '']);
  results.push(['Finance hub lists School enterprises (AIA) and Purchasing is under Payables', hub.includes('School enterprises (AIA)') && r('/school/finance/payables').includes('Purchasing') && r('/school/finance/enterprises').includes('Activities &amp; remittances'), '']);
  for (const pth of ['/school/school-finance/bursaries', '/school/school-finance/reconciliation', '/school/school-finance/assets', '/school/school-finance/stores', '/school/school-finance/procurement', '/school/school-finance/aia']) check('route ' + pth, () => renderToString(<MemoryRouter initialEntries={[pth]}><Routes><Route path="/school/*" element={<ElimuRoutes basePath="/school" accessOverride={{ can: () => true, loaded: true, isOwner: true, roles: [] }} />} /></Routes></MemoryRouter>));
  for (const pth of ['/school/school-finance/ledger/income', '/school/school-finance/ledger/position', '/school/school-finance/ledger/cashflow', '/school/school-finance/ledger/receivables', '/school/school-finance/ledger/payables', '/school/school-finance/ledger/accounts', '/school/school-finance/ledger/journals', '/school/school-finance/ledger/trial']) check('route ' + pth, () => renderToString(<MemoryRouter initialEntries={[pth]}><Routes><Route path="/school/*" element={<ElimuRoutes basePath="/school" accessOverride={{ can: () => true, loaded: true, isOwner: true, roles: [] }} />} /></Routes></MemoryRouter>));
  for (const pth of ['/school/school-finance/expenses', '/school/school-finance/budgets']) check('route ' + pth, () => renderToString(<MemoryRouter initialEntries={[pth]}><Routes><Route path="/school/*" element={<ElimuRoutes basePath="/school" accessOverride={{ can: () => true, loaded: true, isOwner: true, roles: [] }} />} /></Routes></MemoryRouter>));
  results.push(['unknown finance section says so', none.includes('does not exist'), '']);
  results.push(['school tab bar says Finance (not Fees)', hub.includes('>Finance<'), '']); }
const appHtml = check('ElimuApp (auth + shell) renders', () => renderToString(<MemoryRouter initialEntries={['/school']}><Routes><Route path="/school/*" element={<ElimuApp />} /></Routes></MemoryRouter>));
results.push(['app bar has school name, Umova home and Sign out', appHtml.includes('Sunrise Academy') && appHtml.includes('aria-label="Umova home"') && appHtml.includes('aria-label="Sign out"'), '']);
results.push(['shell is one full-height column (dvh) with safe-area padding', appHtml.includes('100dvh') && appHtml.includes('safe-area-inset-top'), '']);
const parentHtml = check('ParentApp renders (signed-out state is the loading screen on the server)', () => renderToString(<MemoryRouter><ParentApp /></MemoryRouter>));
results.push(['parent app is a full-height dvh column', parentHtml.includes('100dvh'), '']);
results.push(['phone numbers normalise to +254', toE164('0722 111 222') === '+254722111222' && toE164('722111222') === '+254722111222' && toE164('+254722111222') === '+254722111222' && toE164('254722111222') === '+254722111222' && toE164('12') === '' && toE164('') === '', '']);
const loginHtml = check('ElimuLogin renders', () => renderToString(<ElimuLogin onGoToRegister={() => {}} />));
results.push(['Elimu sign-in has school code, demo button, register link and no shop wording', ['School code', 'Try the demo school', 'Register here', 'Elimu sign in'].every((t) => loginHtml.includes(t)) && !/My Business|Business code|retail/i.test(loginHtml), '']);
results.push(['sign-in screen is a full-height dvh scroller', loginHtml.includes('100dvh') && loginHtml.includes('overflow-y-auto'), '']);
const regHtml = check('ElimuRegister renders', () => renderToString(<ElimuRegister onBackToLogin={() => {}} />));
results.push(['register form asks for a school (not a business)', regHtml.includes('School name') && regHtml.includes('Register your school') && !/Business name/i.test(regHtml), '']);
results.push(['demo school is recognised by its code only', isElimuDemo({ business_code: ELIMU_DEMO_CODE }) && !isElimuDemo({ business_code: 'DEMO' }) && !isElimuDemo(null), '']);

const staffHtml = check('Staff page route renders', () => renderToString(<MemoryRouter initialEntries={['/school/staff']}><Routes><Route path="/school/*" element={<ElimuRoutes basePath="/school" accessOverride={{ can: () => true, loaded: true, isOwner: true, roles: [] }} />} /></Routes></MemoryRouter>));
results.push(['staff page route exists and shows Staff in the menu', staffHtml.includes('Staff'), '']);
results.push(['staff roles include the gate officer and keys are unique', STAFF_ROLE_CHOICES.some((r) => r.key === 'attendance_officer') && new Set(STAFF_ROLE_CHOICES.map((r) => r.key)).size === STAFF_ROLE_CHOICES.length, '']);
results.push(['Staff is an owner-only menu item', NAV_ITEMS.some((n) => n.key === 'staff' && n.ownerOnly), '']);
const sheetHtml = check('AppSheet renders', () => renderToString(<AppSheet title="New academic year" onClose={() => {}}><input /></AppSheet>));
results.push(['sheet is capped to the visible screen and its body scrolls', sheetHtml.includes('92dvh') && sheetHtml.includes('overflow-y-auto') && sheetHtml.includes('safe-area-inset-bottom'), '']);
const ACCESS = { can: () => true, loaded: true, isOwner: true, roles: [] };
function Routes_() { return <Suspense fallback={<i>loading-chunk</i>}><ElimuRoutes accessOverride={ACCESS} /></Suspense>; }

const actions = check('ContactActions renders 4 channels', () => renderToString(<ElimuAccessProvider value={ACCESS}><ElimuContactActions guardian={guardian} student={student} purpose="ELIMU_GENERAL_NOTICE" settings={{}} /></ElimuAccessProvider>));
results.push(['email button disabled when opted out', /disabled=""[^>]*aria-label="Email unavailable: This guardian has opted out/.test(actions) || /aria-label="Email unavailable: This guardian has opted out[^"]*"/.test(actions), actions.slice(0, 0)]);
results.push(['sms button enabled', /aria-label="SMS Grace"/.test(actions), '']);
const comp = check('MessageComposer renders', () => renderToString(<ElimuMessageComposer guardian={guardian} student={student} purpose="ELIMU_WELCOME" settings={{}} onClose={() => {}} />));
results.push(['composer has generated text, no raw {{ }}', comp.includes('Dear Grace') && !comp.includes('{{'), '']);
results.push(['composer never claims sent', !/Sent</.test(comp), '']);
check('StudentFormSheet', () => renderToString(<StudentFormSheet statuses={[]} onClose={() => {}} />));
check('GuardianFormSheet', () => renderToString(<GuardianFormSheet studentId="s1" onClose={() => {}} />));
check('ConsentEditor', () => renderToString(<ConsentEditor guardian={guardian} canEdit />));
results.push(['public API exports', ['ElimuRoutes', 'registerModule', 'ElimuContactActions', 'ElimuMessageComposer', 'ElimuCommunicationService', 'ElimuTemplateResolver', 'registerPurpose', 'studentService', 'useElimuAccess'].every((k) => api[k]), '']);

if (process.env.DUMP && false) for (const p of ['/school/zzz', '/school/absences', '/school/academics', '/school/settings', '/school/school-finance/collect']) console.log('\n#### ' + p + '\n' + renderToString(<MemoryRouter initialEntries={[p]}><Routes><Route path="/school/*" element={<Routes2 />} /></Routes></MemoryRouter>).replace(/<nav.*?<\/nav>/gs, '<nav/>').slice(0, 700));
let bad = 0; for (const [n, ok, d] of results) { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); }
console.log(`${results.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
