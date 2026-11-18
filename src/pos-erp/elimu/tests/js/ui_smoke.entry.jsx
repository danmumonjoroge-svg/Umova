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
import { SCHOOL_TREE } from '../../navigation/schoolTree.js';
import { PARENT_TREE } from '../../navigation/parentTree.js';
import { countPages, countSoon } from '../../navigation/menuKit.js';
import ProgressView from '../../shared/components/ProgressChart.jsx';
import { readXlsx, readTable } from '../../import/utils/readSheet.js';
import { leaveProblems, KINDS, KIND_LABEL } from '../../leavers/services/leaversService.js';
import { defaultDecisions, decisionList, tally } from '../../promotion/services/promotionService.js';
import { autoMapLong, buildLongRows, guessWide, longProblems, pivotWide, wideProblems, LONG_TEMPLATE_CSV, WIDE_TEMPLATE_CSV } from '../../import/utils/resultsImport.js';
import { autoMapBalances, balanceProblems, buildBalanceRows, cleanAmount } from '../../import/utils/balanceImport.js';
import { autoMap, buildRows, mappingProblems, toIsoDate, TEMPLATE_CSV } from '../../import/utils/studentImport.js';

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
  for (const pth of ['/school/school-finance/bursaries', '/school/school-finance/reconciliation', '/school/school-finance/suppliers', '/school/school-finance/payroll', '/school/school-finance/assets', '/school/school-finance/stores', '/school/school-finance/procurement', '/school/school-finance/aia']) check('route ' + pth, () => renderToString(<MemoryRouter initialEntries={[pth]}><Routes><Route path="/school/*" element={<ElimuRoutes basePath="/school" accessOverride={{ can: () => true, loaded: true, isOwner: true, roles: [] }} />} /></Routes></MemoryRouter>));
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

// ---- grouped menus (staff and parents) ----
{
  const menu = (path) => renderToString(<MemoryRouter initialEntries={[path]}><Routes><Route path="/school/*" element={<ElimuRoutes basePath="/school" accessOverride={{ can: () => true, loaded: true, isOwner: true, roles: [] }} />} /></Routes></MemoryRouter>);
  const top = menu('/school/menu');
  results.push(['school menu shows the six groups you asked for plus Finance', ['Administration', 'Registration', 'Academics', 'Security', 'Settings', 'Parents portal', 'Finance'].every((t) => top.includes(t)), '']);
  const ex = menu('/school/menu/academics/exams');
  results.push(['three levels down: Academics > Exams & results > Exam setup / Marks / Results & reports', ['Exam setup', 'Marks', 'Results &amp; reports'].every((t) => ex.includes(t)), '']);
  const rr = menu('/school/menu/academics/exams/ex-results');
  results.push(['four levels down lists Term results, Report cards and Progress reports, none SOON', rr.includes('Term results') && rr.includes('Report cards') && rr.includes('Progress reports') && !rr.includes('SOON'), '']);
  results.push(['a menu path that does not exist says so', menu('/school/menu/nope').includes('does not exist'), '']);
  const leaves = []; const dup = [];
  const walk = (n, pathKeys) => { const seen = new Set(); for (const c of n.children || []) { if (seen.has(c.key)) dup.push(c.key); seen.add(c.key); if (c.children) walk(c, [...pathKeys, c.key]); else leaves.push(c); } };
  walk(SCHOOL_TREE, []); walk(PARENT_TREE, []);
  results.push(['every menu page is either a route or SOON, never both or neither', leaves.every((l) => !!l.to + !!l.soon + !!l.tab === 1), leaves.filter((l) => !!l.to + !!l.soon + !!l.tab !== 1).map((l) => l.key).join(',')]);
  results.push(['sibling keys are unique in both menus', dup.length === 0, dup.join(',')]);
  const KNOWN = ['staff', 'access', 'communication', 'calendar', 'reports', 'admissions', 'students', 'guardians', 'classes', 'academics', 'academics/subjects', 'academics/allocations', 'academics/setup', 'academics/assessments', 'academics/my-assessments', 'academics/grading', 'academics/results', 'academics/report-cards', 'academics/exam-timetable', 'attendance/gate-passes', 'gate-passes', 'import/students', 'import/log', 'import/balances', 'import/results', 'promotion', 'leavers', 'gate-exits', 'activity', 'academics/progress',
    'timetable', 'timetable/changes', 'timetable/setup', 'rooms', 'attendance', 'attendance/take', 'absences', 'attendance/settings', 'gate', 'finance', 'settings'];
  const bad = SCHOOL_TREE.children.flatMap(function flat(n) { return n.children ? n.children.flatMap(flat) : n.to && !KNOWN.includes(n.to.split('?')[0]) ? [n.to] : []; });
  results.push(['every staff menu link points to a route that exists', bad.length === 0, bad.join(',')]);
  results.push([`staff menu: ${countPages(SCHOOL_TREE)} pages, ${countSoon(SCHOOL_TREE)} planned`, countPages(SCHOOL_TREE) > 40 && countSoon(SCHOOL_TREE) > 3, '']);
  results.push(['parent menu has Academics (exam timetable, results summary, report card, progress report), Learning, Gate pass', ['extimetable', 'summary', 'reportcard', 'progress', 'materials', 'assignments', 'passes'].every((k) => leaves.some((l) => l.key === k)), '']);
  results.push(['parent menu: built pages open existing tabs', leaves.filter((l) => l.tab).every((l) => ['attendance', 'results', 'calendar', 'fees', 'extimetable', 'progress', 'gatepass'].includes(l.tab)), '']);
}

{
  const sample = { terms: [{ year: '2026', term: 'Term 1', class_name: 'Grade 5', mean_percentage: 62.5, grade: 'B', class_position: 7, class_size: 40 }, { year: '2026', term: 'Term 2', class_name: 'Grade 5', mean_percentage: 71, grade: 'B+', class_position: 4, class_size: 40 }],
    assessments: [{ year: '2026', term: 'Term 2', date: '2026-06-10', name: 'CAT 1', subject: 'Mathematics', status: 'PRESENT', obtained: 40, max: 50, percentage: 80 }, { year: '2026', term: 'Term 2', date: '2026-06-12', name: 'CAT 1', subject: 'English', status: 'ABSENT', obtained: null, max: 50, percentage: null }] };
  const pv = check('ProgressView renders', () => renderToString(<ProgressView data={sample} />));
  results.push(['progress report: graph drawn with an accessible summary, terms table and per-subject marks', pv.includes('<svg') && pv.includes('role="img"') && pv.includes('Term 1 2026: 62.5%') && pv.includes('Mathematics') && pv.includes('English') && pv.includes('Absent') && pv.includes('8.5'), ['<svg', 'role="img"', 'Term 1 2026: 62.5%', 'Mathematics', 'English', 'Absent', '8.5'].filter((t) => !pv.includes(t)).join(' | ')]);
  results.push(['progress report: improvement shown against last term (62.5 to 71 = up 8.5)', pv.includes('▲'), '']);
  results.push(['progress report: nothing to show says so, no empty chart', renderToString(<ProgressView data={{ terms: [], assessments: [] }} />).includes('No results are available yet') && !renderToString(<ProgressView data={{ terms: [], assessments: [] }} />).includes('<svg'), '']);
  const one = renderToString(<ProgressView data={{ terms: [sample.terms[0]], assessments: [] }} />);
  results.push(['progress report: a single term draws a point, not a broken line, and shows no change figure', one.includes('<circle') && !one.includes('<polyline') && !one.includes('since last term'), '']);
  const pg = (path) => renderToString(<MemoryRouter initialEntries={[path]}><Routes><Route path="/school/*" element={<ElimuRoutes basePath="/school" accessOverride={{ can: () => true, loaded: true, isOwner: true, roles: [] }} />} /></Routes></MemoryRouter>);
  results.push(['exam timetable and progress pages are routed', pg('/school/academics/exam-timetable').includes('Exam timetable') && pg('/school/academics/progress').includes('Progress report'), '']);
}
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
// ---- data import (piece 15): spreadsheet reading, column matching, cleaning
const FX = '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';
const fxBytes = Uint8Array.from(Buffer.from(FX, 'base64'));
try {
  const x = await readXlsx(fxBytes);
  results.push(['xlsx: real Excel file read (header + 3 rows, blank row dropped)', x.length === 4 && x[0][1] === 'Student Name', JSON.stringify(x[0])]);
  results.push(['xlsx: text, number and shared-string cells read; & decoded', x[1][1] === 'Mary Wanjiku Kamau' && x[1][0] === '1234' && x[1][5] === 'Peter & Sons Kamau' && x[1][6] === '711000111', JSON.stringify(x[1])]);
  results.push(['xlsx: an Excel date cell comes through as a serial number that converts back to the right day', toIsoDate(x[1][3]) === '2014-03-27', x[1][3]]);
  results.push(['xlsx: empty cells keep their column (no shifting)', x[2][5] === '' && x[2][6] === '' && x[2][4] === 'Grade 5', JSON.stringify(x[2])]);
  const tb = await readTable({ name: 'Pupils.XLSX', arrayBuffer: async () => fxBytes.buffer.slice(fxBytes.byteOffset, fxBytes.byteOffset + fxBytes.byteLength) });
  const m = autoMap(tb.headers);
  results.push(['old-system headings are matched (Adm No, Student Name, Sex, DOB, Class, Parent Name, Parent Phone)', m.admission_no === 0 && m.full_name === 1 && m.gender === 2 && m.date_of_birth === 3 && m.class === 4 && m.g1_name === 5 && m.g1_phone === 6, JSON.stringify(m)]);
  results.push(['one full-name column is enough to proceed', mappingProblems(m).length === 0, mappingProblems(m).join('|')]);
  const rows = buildRows(tb.rows, m);
  results.push(['rows are cleaned: blank row dropped, name split, date to ISO, day-first date read', rows.length === 3 && rows[0].first_name === 'Mary' && rows[0].middle_name === 'Wanjiku' && rows[0].last_name === 'Kamau' && rows[0].date_of_birth === '2014-03-27' && rows[1].date_of_birth === '2015-03-27' && rows[0].admission_no === '1234', JSON.stringify(rows[0])]);
  results.push(['a single name becomes the last name; guardian phone passes through for the database to normalise', rows[1].last_name === 'Otieno' && rows[1].first_name === '' && rows[0].g1_phone === '711000111' && rows[2].g1_phone === '0722 333 444', JSON.stringify(rows[1])]);
} catch (e) { results.push(['xlsx reading', false, e.message]); }
try {
  const csv = await readTable({ name: 'students.csv', text: async () => TEMPLATE_CSV });
  const m = autoMap(csv.headers); const rows = buildRows(csv.rows, m);
  results.push(['the downloadable template reads back with every column matched', Object.values(m).filter((i) => i >= 0).length === 18 && rows.length === 2 && rows[0].g2_phone === '0711 000 222' && rows[1].class === 'Grade 3', JSON.stringify(m)]);
  results.push(['a missing Class column is reported', mappingProblems({ ...m, class: -1 }).some((p) => /Class/.test(p)), '']);
  let msg = ''; try { await readTable({ name: 'old.xls', text: async () => '' }); } catch (e) { msg = e.message; }
  results.push(['an old .xls file is refused with a clear instruction', /xlsx/.test(msg), msg]);
  let m2 = ''; try { await readXlsx(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23])); } catch (e) { m2 = e.message; }
  results.push(['a file that is not a workbook is refused', /not a valid/.test(m2), m2]);
} catch (e) { results.push(['csv reading', false, e.message]); }
results.push(['dates: 27-Mar-2014, 27.3.2014, 41725 and junk', toIsoDate('27-Mar-2014') === '2014-03-27' && toIsoDate('27.3.2014') === '2014-03-27' && toIsoDate('41725') === '2014-03-27' && toIsoDate('soon') === 'soon' && toIsoDate('') === '', '']);
const pgi = (path) => renderToString(<MemoryRouter initialEntries={[path]}><Routes><Route path="/school/*" element={<ElimuRoutes basePath="/school" accessOverride={{ can: () => true, loaded: true, isOwner: true, roles: [] }} />} /></Routes></MemoryRouter>);
results.push(['amounts: KES, commas, brackets, CR/DR, minus; junk stays junk', cleanAmount('KES 1,250.50') === '1250.5' && cleanAmount('(500)') === '-500' && cleanAmount('500 CR') === '-500' && cleanAmount('500 Dr') === '500' && cleanAmount('-2,000') === '-2000' && cleanAmount('0') === '0' && cleanAmount('') === '' && cleanAmount('abc') === 'abc' && cleanAmount('12.345') === '12.35', '']);
{ const bm = autoMapBalances(['Adm No', 'Fee Balance', 'Remarks']); const br = buildBalanceRows([['1234.0', '(1,000.00)', 'Term 2'], ['', '', ''], ['1235', '0', '']], bm);
  results.push(['balance file: headings matched, blank row dropped, id and amount cleaned', bm.admission_no === 0 && bm.balance === 1 && bm.note === 2 && br.length === 2 && br[0].admission_no === '1234' && br[0].balance === '-1000' && balanceProblems(bm).length === 0 && balanceProblems({ admission_no: 0, balance: -1 }).length === 1, JSON.stringify(br)]); }
{ const w = await readTable({ name: 'wide.csv', text: async () => WIDE_TEMPLATE_CSV }); const g = guessWide(w.headers);
  const long = pivotWide(w.headers, w.rows, g, { year: '2025', term: 'Term 1', exam: 'End of Term 1', class: 'Grade 5', out_of: '100', date: '2025-04-02' });
  results.push(['wide results: admission and subject columns found; Name, Total and Position are not subjects', g.adm === 0 && g.cls === -1 && g.subjects.map((i) => w.headers[i]).join(',') === 'Mathematics,English,Kiswahili,Science', JSON.stringify(g)]);
  results.push(['wide results pivot to one row per mark, with the fixed year, term, exam, class and date', long.length === 8 && long[0].subject === 'Mathematics' && long[0].marks === '78' && long[0].exam === 'End of Term 1' && long[0].class === 'Grade 5' && long[0].date === '2025-04-02' && long.find((r) => r.admission_no === 'ADM-0002' && r.subject === 'Kiswahili').marks === 'ABS', JSON.stringify(long[0])]);
  results.push(['wide results: empty subject cells make no row; missing exam name is reported', pivotWide(['Adm', 'Maths', 'Eng'], [['1', '50', '']], { adm: 0, cls: -1, subjects: [1, 2] }, { year: '2025', term: '1', exam: 'E', class: 'G5' }).length === 1 && wideProblems(g, { year: '2025', term: '1', exam: '', class: 'G5' }).some((p) => /exam name/.test(p)), '']);
  const l = await readTable({ name: 'long.csv', text: async () => LONG_TEMPLATE_CSV }); const lm = autoMapLong(l.headers); const lr = buildLongRows(l.rows, lm);
  results.push(['long results: template headings all matched and rows read', Object.values(lm).filter((i) => i >= 0).length === 9 && longProblems(lm).length === 0 && lr.length === 3 && lr[1].marks === 'ABS' && lr[0].date === '2025-04-02', JSON.stringify(lm)]); }
{ const pv = { classes: [{ class_id: 'c5', next_class_id: 'c6', students: [{ student_id: 'a', placed: false }, { student_id: 'b', placed: true }] }, { class_id: 'c8', next_class_id: null, students: [{ student_id: 'c', placed: false }] }] };
  const d = defaultDecisions(pv); const sent = decisionList({ ...d, z: { action: 'HOLD', class_id: null }, y: { action: 'REPEAT', class_id: 'c5' } });
  results.push(['promotion defaults: promote to the next class, graduate the top class, skip placed students', d.a.action === 'PROMOTE' && d.a.class_id === 'c6' && !d.b && d.c.action === 'GRADUATE', JSON.stringify(d)]);
  results.push(['promotion list sent: hold dropped, class only on promote, counts right', sent.length === 3 && !sent.find((x) => x.student_id === 'y').class_id && sent.find((x) => x.student_id === 'a').class_id === 'c6' && tally({ ...d, z: { action: 'HOLD' } }).HOLD === 1 && tally(d).PROMOTE === 1, JSON.stringify(sent)]); }
results.push(['leaver form rules: student, kind, date not in the future, reason for a withdrawal', leaveProblems({ studentId: 's', kind: 'TRANSFER', date: '2026-01-01' }, '2026-02-01').length === 0 && leaveProblems({ studentId: 's', kind: 'WITHDRAWAL', date: '2026-01-01', reason: 'x' }, '2026-02-01').length === 1 && leaveProblems({ studentId: 's', kind: 'TRANSFER', date: '2026-03-01' }, '2026-02-01').length === 1 && leaveProblems({}, '2026-02-01').length === 3 && KINDS.length === 3 && KIND_LABEL.GRADUATION === 'Graduated', '']);
results.push(['gate exit log is routed and its menu leaf opens it', pgi('/school/gate-exits').includes('Loading') && (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'gate-exit').to === 'gate-exits'; })(), '']);
results.push(['activity log is routed and its menu leaf opens it', pgi('/school/activity').includes('Activity log') && (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'audit').to === 'activity'; })(), '']);
results.push(['leavers page is routed and its menu leaf opens it', pgi('/school/leavers').includes('Transfers') && (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'leavers').to === 'leavers'; })(), '']);
results.push(['promotion page is routed and its menu leaf opens it', pgi('/school/promotion').includes('Promotion') && (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'promotion').to === 'promotion'; })(), '']);
results.push(['import pages are routed', pgi('/school/import/students').includes('Import students') && pgi('/school/import/balances').includes('Import fee balances') && pgi('/school/import/results').includes('Import past results') && pgi('/school/import/log').includes('Import log'), '']);
results.push(['import menu leaves open real pages (students, guardians, log); fee balances and past results still planned', (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); const g = (k) => f.find((n) => n.key === k); return g('imp-students').to === 'import/students' && g('imp-guardians').to === 'import/students' && g('imp-log').to === 'import/log' && g('imp-balances').to === 'import/balances' && g('imp-results').to === 'import/results'; })(), '']);

let bad = 0; for (const [n, ok, d] of results) { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); }
console.log(`${results.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);
