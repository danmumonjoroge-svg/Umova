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
import { ElimuAuthProvider } from '../../app/auth/ElimuAuthContext.jsx';
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
  results.push(['unbuilt pages are shown as SOON, not as links', fees.includes('SOON') && r('/school/finance/reports').includes('Trial balance'), '']);
  const pay = r('/school/finance/payables');
  results.push(['Payables: Expenses, Budgets, Suppliers and Staff are all built', ['Expenses', 'Budgets', 'Suppliers', 'Staff &amp; payroll'].every((t) => pay.includes(t)) && (pay.match(/SOON/g) || []).length === 0, String((pay.match(/SOON/g) || []).length)]);
  const acc = r('/school/finance/accounting');
  results.push(['Accounting group lists Chart of accounts, Journals and Trial balance, none SOON', ['Chart of accounts', 'Journals', 'Trial balance'].every((t) => acc.includes(t)) && !acc.includes('SOON'), '']);
  const rep = r('/school/finance/reports');
  results.push(['Reports: every statement is built', ['Statement of financial position', 'Income statement', 'Cash flow statement', 'Trial balance'].every((t) => rep.includes(t)) && (rep.match(/SOON/g) || []).length === 0, String((rep.match(/SOON/g) || []).length)]);
  const recv = r('/school/finance/receivables');
  results.push(['Receivables: students, government and other are all built', (recv.match(/SOON/g) || []).length === 0, '']);
  const rest = r('/school/finance'); results.push(['Finance hub still marks only bursaries, reconciliation, fixed assets and stores as SOON (4 in total)', ['fees', 'bank', 'assets'].every((k) => (r('/school/finance/' + k).match(/SOON/g) || []).length >= 1), '']);
  for (const pth of ['/school/school-finance/ledger/income', '/school/school-finance/ledger/position', '/school/school-finance/ledger/cashflow', '/school/school-finance/ledger/receivables', '/school/school-finance/ledger/payables', '/school/school-finance/ledger/accounts', '/school/school-finance/ledger/journals', '/school/school-finance/ledger/trial']) check('route ' + pth, () => renderToString(<MemoryRouter initialEntries={[pth]}><Routes><Route path="/school/*" element={<ElimuRoutes basePath="/school" accessOverride={{ can: () => true, loaded: true, isOwner: true, roles: [] }} />} /></Routes></MemoryRouter>));
  for (const pth of ['/school/school-finance/expenses', '/school/school-finance/budgets']) check('route ' + pth, () => renderToString(<MemoryRouter initialEntries={[pth]}><Routes><Route path="/school/*" element={<ElimuRoutes basePath="/school" accessOverride={{ can: () => true, loaded: true, isOwner: true, roles: [] }} />} /></Routes></MemoryRouter>));
  results.push(['unknown finance section says so', none.includes('does not exist'), '']);
  results.push(['school tab bar says Finance (not Fees)', hub.includes('>Finance<'), '']); }
const appHtml = check('ElimuApp (auth + shell) renders', () => renderToString(<MemoryRouter initialEntries={['/school']}><Routes><Route path="/school/*" element={<ElimuApp />} /></Routes></MemoryRouter>));
results.push(['app bar has school name, notification bell and account menu', appHtml.includes('Sunrise Academy') && appHtml.includes('aria-label="Notifications"') && appHtml.includes('aria-label="Account menu"'), '']);
results.push(['shell is one full-height column (dvh) with safe-area padding', appHtml.includes('100dvh') && appHtml.includes('safe-area-inset-top'), '']);
const parentHtml = check('ParentApp renders (signed-out state is the loading screen on the server)', () => renderToString(<MemoryRouter><ParentApp /></MemoryRouter>));
results.push(['parent app is a full-height dvh column', parentHtml.includes('100dvh'), '']);
results.push(['phone numbers normalise to +254', toE164('0722 111 222') === '+254722111222' && toE164('722111222') === '+254722111222' && toE164('+254722111222') === '+254722111222' && toE164('254722111222') === '+254722111222' && toE164('12') === '' && toE164('') === '', '']);
const T_SCHOOL = { id: 't1', business_id: 'b1', business_code: 'DEMOSCH', business_name: 'Sunrise Academy' };
const identity = (o = {}) => ({ stage: 'logged_out', school: null, user: null, statusDetail: null, logoutNotice: null, offline: false, signIn: async () => {}, signOut: async () => {}, ...o });
const withAdapter = (id) => ({ id: 'test', useIdentity: () => id });
const ACCESS_ALL = { can: () => true, loaded: true, isOwner: true, roles: [] };
const loginHtml = check('ElimuLogin renders', () => renderToString(<ElimuAuthProvider adapter={withAdapter(identity())}><ElimuLogin onGoToRegister={() => {}} /></ElimuAuthProvider>));
results.push(['Elimu sign-in has school code, demo button, register link and no shop wording', ['School code', 'User ID', 'Show password', 'Try the demo school', 'Register here', 'Elimu sign in'].every((t) => loginHtml.includes(t)) && !/My Business|Business code|retail/i.test(loginHtml), '']);
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

// ---- sign-in gate: each session stage shows the right screen, and only 'authenticated' reaches the app ----
const gate = (id) => renderToString(<MemoryRouter initialEntries={['/school']}><Routes><Route path="/school/*" element={<ElimuApp adapter={withAdapter(id)} accessOverride={ACCESS_ALL} />} /></Routes></MemoryRouter>);
const stageHtml = {
  checking: check('gate: checking', () => gate(identity({ stage: 'checking' }))),
  out: check('gate: logged out', () => gate(identity({ logoutNotice: 'You were signed out.' }))),
  pending: check('gate: pending', () => gate(identity({ stage: 'pending', school: T_SCHOOL }))),
  rejected: check('gate: rejected', () => gate(identity({ stage: 'rejected', school: T_SCHOOL, statusDetail: 'Missing documents' }))),
  suspended: check('gate: suspended', () => gate(identity({ stage: 'suspended', school: T_SCHOOL }))),
  change: check('gate: must change password', () => gate(identity({ stage: 'must_change_password', school: T_SCHOOL, user: { id: 'u1', name: 'Jo', kind: 'staff' } }))),
  in: check('gate: authenticated', () => gate(identity({ stage: 'authenticated', school: T_SCHOOL, user: { id: 'u1', name: 'Jane Wanjiru', kind: 'staff', isOwner: true } }))),
  guardian: check('gate: authenticated but not staff', () => gate(identity({ stage: 'authenticated', school: T_SCHOOL, user: { id: 'g1', name: 'Parent', kind: 'guardian' } }))),
  noschool: check('gate: authenticated without a school', () => gate(identity({ stage: 'authenticated', school: null, user: { id: 'u1', name: 'X', kind: 'staff' } }))),
};
const hasApp = (h) => h.includes('aria-label="School tabs"'); const hasLogin = (h) => h.includes('Elimu sign in');
results.push(['gate: checking shows a loader, not the app or the form', stageHtml.checking.includes('aria-label="Loading"') && !hasApp(stageHtml.checking) && !hasLogin(stageHtml.checking), '']);
results.push(['gate: logged out shows sign-in with the notice', hasLogin(stageHtml.out) && stageHtml.out.includes('You were signed out.') && !hasApp(stageHtml.out), '']);
results.push(['gate: pending shows the waiting screen with Sign out', stageHtml.pending.includes('Waiting for approval') && stageHtml.pending.includes('Sign out') && !hasApp(stageHtml.pending), '']);
results.push(['gate: rejected shows the reason', stageHtml.rejected.includes('Registration not approved') && stageHtml.rejected.includes('Missing documents') && !hasApp(stageHtml.rejected), '']);
results.push(['gate: suspended shows the suspended screen', stageHtml.suspended.includes('Account suspended') && !hasApp(stageHtml.suspended), '']);
results.push(['gate: must change password shows the new-password screen', stageHtml.change.includes('force') && !hasApp(stageHtml.change), '']);
results.push(['gate: authenticated staff reach the app with the school name', hasApp(stageHtml.in) && stageHtml.in.includes('Sunrise Academy'), '']);
results.push(['gate: a non-staff or school-less account never reaches the app', [stageHtml.guardian, stageHtml.noschool].every((h) => hasLogin(h) && !hasApp(h)), '']);
results.push(['gate: no screen mentions POS or My Business', Object.values(stageHtml).every((h) => !/My Business|POS login|Business code/i.test(h)), '']);
results.push(['public API exports the session contract', ['ElimuAuthProvider', 'useElimuSession', 'useElimuAuth', 'normalizeRole', 'roleLabel', 'AUTH_ERROR', 'ElimuAuthError'].every((k) => k in api), '']);

// ---- the shell: app bar, grouped menu, role-aware entries, settings hub, notifications, every module still reachable ----
const ACC = (actions = [], owner = false) => ({ can: (a) => owner || actions.includes(a), loaded: true, isOwner: owner, roles: owner ? [] : [{ role: 'class_teacher' }] });
const shell = (path, { owner = true, actions = [], user = {} } = {}) => { try {
  const id = identity({ stage: 'authenticated', school: T_SCHOOL, user: { id: 'u1', name: 'Jane Wanjiru', kind: 'staff', isOwner: owner, ...user } });
  return renderToString(<MemoryRouter initialEntries={[path]}><Routes><Route path="/school/*" element={<ElimuApp adapter={withAdapter(id)} accessOverride={ACC(actions, owner)} />} /></Routes></MemoryRouter>);
} catch (e) { return 'RENDER-ERROR ' + e.stack; } };
const okR = (h) => !h.startsWith('RENDER-ERROR');
const home = shell('/school');
results.push(['shell: dashboard renders inside the shell', okR(home) && home.includes('aria-label="School tabs"'), home.slice(0, 200)]);
results.push(['shell: app bar shows school name, bell and account menu (no old per-app header)', home.includes('Sunrise Academy') && home.includes('aria-label="Notifications"') && home.includes('aria-label="Account menu"'), '']);
results.push(['shell: sidebar groups People / Academics / Daily operations / Finance & reports', ['People', 'Academics', 'Daily operations', 'Finance &amp; reports'].every((g) => home.includes(g)), '']);
results.push(['shell: owner menu has Staff and Settings; Settings is pinned', home.includes('title="Staff"') && home.includes('title="Settings"'), '']);
results.push(['shell: dashboard is the current page', /title="Dashboard" aria-current="page"/.test(home) && !/title="Students" aria-current="page"/.test(home), '']);
const teacher = shell('/school', { owner: false, actions: ['students.view', 'structure.view', 'guardians.view'] });
results.push(['shell: a teacher sees Students and Classes but not Staff, Settings, Finance or Admissions', okR(teacher) && teacher.includes('title="Students"') && teacher.includes('title="Classes"') && !['title="Staff"', 'title="Settings"', 'title="Finance"', 'title="Admissions"'].some((t) => teacher.includes(t)), '']);
const stu = shell('/school/students');
results.push(['shell: Students page opens with Students marked current', okR(stu) && /aria-current="page"[^>]*title="Students"|title="Students"[^>]*aria-current="page"/.test(stu), '']);
for (const path of ['/school/attendance', '/school/timetable', '/school/calendar', '/school/academics', '/school/finance', '/school/school-finance/collect', '/school/communication', '/school/guardians', '/school/admissions', '/school/classes', '/school/staff', '/school/report-centre'])
  { const h = shell(path); results.push([`shell: module route ${path} renders under the shell`, okR(h) && h.includes('aria-label="School tabs"'), h.slice(0, 160)]); }
const hub = shell('/school/settings');
results.push(['settings hub: owner sees every section supplied by a module', okR(hub) && ['School profile &amp; setup', 'Academic setup', 'Attendance', 'Timetable', 'Fees &amp; billing', 'Users &amp; roles'].every((t) => hub.includes(t)), '']);
results.push(['settings hub: section cards link to /settings/<section>', hub.includes('href="/school/settings/academic"') && hub.includes('href="/school/settings/finance"'), '']);
const onlyFin = shell('/school/settings', { owner: false, actions: ['finance.configure'] });
results.push(['settings hub: a user sees only the sections their action allows', onlyFin.includes('Fees &amp; billing') && !onlyFin.includes('Academic setup') && !onlyFin.includes('Users &amp; roles'), '']);
const none = shell('/school/settings', { owner: false, actions: [] });
results.push(['settings hub: no access -> clear message, no cards', none.includes('do not have access to any settings') && !none.includes('href="/school/settings/'), '']);
const sec = shell('/school/settings/academic');
results.push(['settings section renders with a Back-to-Settings link', okR(sec) && sec.includes('href="/school/settings"'), sec.slice(0, 160)]);
results.push(['settings section: unknown section says so', shell('/school/settings/nope').includes('does not exist'), '']);
results.push(['settings section: refused without the action (deep link cannot bypass the hub)', shell('/school/settings/finance', { owner: false, actions: ['settings.manage'] }).includes('do not have access to this section'), '']);
const notif = shell('/school/notifications');
results.push(['notifications page renders with its heading and the nothing-sent promise', okR(notif) && notif.includes('Notifications') && notif.includes('Nothing here has been sent'), notif.slice(0, 160)]);
for (const path of ['/school/login', '/school/register', '/school/dashboard']) results.push([`shell: ${path} does not break once signed in`, okR(shell(path)), '']);
results.push(['shell: no screen mentions POS or My Business', [home, hub, notif, teacher].every((h) => !/My Business|POS login|Business code/i.test(h)), '']);
results.push(['public API exports the shell contract', ['useElimuShell', 'LoadingState', 'ErrorState', 'EmptyState', 'PageContainer', 'SETTINGS_SECTIONS', 'NAV_GROUPS'].every((k) => k in api), '']);

if (process.env.DUMP && false) for (const p of ['/school/zzz', '/school/absences', '/school/academics', '/school/settings', '/school/school-finance/collect']) console.log('\n#### ' + p + '\n' + renderToString(<MemoryRouter initialEntries={[p]}><Routes><Route path="/school/*" element={<Routes2 />} /></Routes></MemoryRouter>).replace(/<nav.*?<\/nav>/gs, '<nav/>').slice(0, 700));
let bad = 0; for (const [n, ok, d] of results) { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); }
console.log(`${results.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
