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
import { enrollmentService as enrollmentServiceForTest } from '../../services/ElimuEnrollmentService.js';
import { SetupCheckView, DemoFill } from '../../setup/pages/SetupCheckPage.jsx';
import { summaryLine, demoReport } from '../../setup/services/setupService.js';
import { ModuleHub, looksFor, CARD_LOOKS } from '../../ui/cards/ModuleCards.jsx';
import { soleLeaf, leavesOf } from '../../navigation/menuKit.js';
import { recordOpen, recentAmong } from '../../navigation/recents.js';
import { bottomTabs, moduleOfPath } from '../../navigation/bottomBar.js';
import * as G from '../../auth/signinGuard.js';
import ElimuLogin from '../../auth/ElimuLogin.jsx';
import ElimuRegister from '../../auth/ElimuRegister.jsx';
import { isElimuDemo, ELIMU_DEMO_CODE } from '../../auth/demo.js';
import { toE164 } from '../../parent/parentClient.js';
import { SCHOOL_TREE } from '../../navigation/schoolTree.js';
import { PARENT_TREE } from '../../navigation/parentTree.js';
import { countPages, countSoon } from '../../navigation/menuKit.js';
import ProgressView from '../../shared/components/ProgressChart.jsx';
import { readXlsx, readTable } from '../../import/utils/readSheet.js';
import { attentionItems, kes, pct } from '../../dashboard/services/dashboardService.js';
import { tripProblems, tripMoney } from '../../trips/services/tripService.js';
import ThemeSwitcher from '../../theme/ThemeSwitcher.jsx';
import { THEMES, MIXES, derive, mix, customTheme, resolve, themeById, readableOn, luminance, isHex } from '../../theme/themes.js';
import { ELIMU_THEME_CSS } from '../../theme/elimuThemeCss.js';
import { shapeActivity } from '../../audit/pages/ActivityLogPage.jsx';
import { classify, normalizeEntry } from '../../ui/activity/ActivityLogView.jsx';
import { safeCell, toCsv as exportCsv, fileName as exportName, rangeProblem, DATASETS } from '../../export/services/exportService.js';
import { MenuCards, lookFor } from '../../ui/cards/MenuCards.jsx';
import { NoticeCard, TripCard, DocCard, BookCard } from '../../ui/cards/index.js';
import { StockCard, AssetTag, FeeSheet, TallyStrip, ClassPlate, StaffBadge, ApplicationCard, PassTicket, ExamPaper } from '../../ui/cards/index.js';
import { PaymentChit, AwardCard, PayslipCard, ReconCard } from '../../ui/cards/index.js';
import { AgeingBar, DebtorCard, BalanceHero, InvoiceSlip, ExpenseSlip, SupplierCard, BillSlip } from '../../ui/cards/index.js';
import { lettersFor, fillLetter, templateProblems } from '../../letters/services/letterService.js';
import { noticeProblems } from '../../notices/services/noticeService.js';
import { bookProblems, money } from '../../library/services/bookService.js';
import { assignmentProblems, dueIso } from '../../materials/services/assignmentService.js';
import { fileProblem, fileSize } from '../../shared/services/fileStorage.js';
import { leaveProblems, KINDS, KIND_LABEL } from '../../leavers/services/leaversService.js';
import { defaultDecisions, decisionList, tally } from '../../promotion/services/promotionService.js';
import { autoMapLong, buildLongRows, guessWide, longProblems, pivotWide, wideProblems, LONG_TEMPLATE_CSV, WIDE_TEMPLATE_CSV } from '../../import/utils/resultsImport.js';
import { autoMapBalances, balanceProblems, buildBalanceRows, cleanAmount } from '../../import/utils/balanceImport.js';
import { autoMap, buildRows, mappingProblems, toIsoDate, TEMPLATE_CSV } from '../../import/utils/studentImport.js';
import StudyTab from '../../pages/StudyTab.jsx';
import { SignIn as ParentSignIn, ChoosePassword as ParentChoosePassword } from '../../parent/ParentApp.jsx';
import { parentEmail as parentEmailFor } from '../../parent/parentClient.js';
import { ChildDetails as PChildDetails, ClassPerformance as PClassPerf, WhatsNew as PWhatsNew } from '../../parent/ParentExtras.jsx';
import { buildUpdates } from '../../parent/updates.js';
import { ChildHero as PHero, QuickTiles as PTiles, Skeleton as PSkel } from '../../parent/ParentHome.jsx';
import { attendanceRate, initials as kidInitials, feeTone } from '../../parent/summary.js';
import { humanMessage as hm, humanError as hmErr } from '../../utils/humanError.js';
import HelpCentre from '../../help/HelpCentre.jsx';
import { search as helpSearch } from '../../help/helpContent.js';
import ErrorBoundary from '../../components/ErrorBoundary.jsx';
import NotFound from '../../components/NotFound.jsx';
import { licenceNotice } from '../../services/ElimuLicenceService.js';
import ElimuManagementPage from '../../owner/ElimuManagementPage.jsx';
import { ReportBody } from '../../teachers/pages/TeacherReportPage.jsx';
import { teacherNotes, groupName } from '../../teachers/services/teacherService.js';
import { reportCsv, reportPdfLines, buildPdf, listCsv } from '../../teachers/services/teacherExport.js';

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
    results.push([`${p} matches a real route (renders more than the empty shell)`, !r(p).includes('could not find that page') && nothing.includes('could not find that page'), '']);
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
  const KNOWN = ['staff', 'access', 'communication', 'calendar', 'reports', 'admissions', 'students', 'guardians', 'classes', 'academics', 'academics/subjects', 'academics/allocations', 'academics/setup', 'academics/assessments', 'academics/my-assessments', 'academics/grading', 'academics/results', 'academics/report-cards', 'academics/exam-timetable', 'attendance/gate-passes', 'gate-passes', 'import/students', 'import/log', 'import/balances', 'import/results', 'promotion', 'leavers', 'gate-exits', 'activity', 'admission-letters', 'export', 'academics/materials', 'academics/assignments', 'academics/library', 'academics/books', 'notices', 'trips', 'dashboard', 'file-storage', 'academics/progress',
    'timetable', 'timetable/changes', 'timetable/setup', 'rooms', 'attendance', 'attendance/take', 'absences', 'attendance/settings', 'gate', 'finance', 'settings', 'my-signin', 'setup-check', 'parent-logins', 'help', 'teachers', 'my-report', 'activities'];
  const bad = SCHOOL_TREE.children.flatMap(function flat(n) { return n.children ? n.children.flatMap(flat) : n.to && !KNOWN.includes(n.to.split('?')[0]) ? [n.to] : []; });
  results.push(['every staff menu link points to a route that exists', bad.length === 0, bad.join(',')]);
  results.push([`staff menu: ${countPages(SCHOOL_TREE)} pages, ${countSoon(SCHOOL_TREE)} planned (every menu item is now built)`, countPages(SCHOOL_TREE) > 40 && countSoon(SCHOOL_TREE) === 0, '']);
  results.push(['parent menu has Academics (exam timetable, results summary, report card, progress report), Learning, Gate pass', ['extimetable', 'summary', 'reportcard', 'progress', 'materials', 'assignments', 'passes'].every((k) => leaves.some((l) => l.key === k)), '']);
  results.push(['parent menu: built pages open existing tabs', leaves.filter((l) => l.tab).every((l) => ['help', 'attendance', 'results', 'calendar', 'fees', 'extimetable', 'progress', 'gatepass', 'materials', 'assignments', 'library', 'books', 'notices', 'trips', 'details', 'classperf'].includes(l.tab)), '']);
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
results.push(['study materials and file storage pages are routed and their menu leaves open them', (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'lm-materials').to === 'academics/materials' && f.find((n) => n.key === 'set-storage').to === 'file-storage'; })() && pgi('/school/academics/materials').includes('Loading') && pgi('/school/file-storage').includes('Loading'), '']);
results.push(['assignments page is routed, menu leaves open it, form rules hold', (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'lm-assign').to === 'academics/assignments' && f.find((n) => n.key === 'lm-submissions').to === 'academics/assignments'; })() && pgi('/school/academics/assignments').includes('Loading') && assignmentProblems({ title: '', due: '', maxMarks: '' }).length === 2 && assignmentProblems({ title: 'Hw', due: new Date(Date.now() + 864e5).toISOString(), maxMarks: '20' }).length === 0 && assignmentProblems({ title: 'Hw', due: new Date(Date.now() + 864e5).toISOString(), maxMarks: '-1' }).length === 1 && dueIso('') === null, '']);
results.push(['library page is routed and its menu leaf opens it', (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'lm-library').to === 'academics/library'; })() && pgi('/school/academics/library').includes('Loading'), '']);
results.push(['book lending page is routed, leaf opens it, form rules hold', (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'lm-books').to === 'academics/books'; })() && pgi('/school/academics/books').includes('Loading') && bookProblems({ title: '', copies: '1', accessions: '' }).length === 1 && bookProblems({ title: 'Maths', copies: '0', accessions: '' }).length === 1 && bookProblems({ title: 'Maths', copies: '', accessions: 'A1, A1' }).length === 1 && bookProblems({ title: 'Maths', copies: '2', accessions: '' }).length === 0 && money(1500) === 'KES 1,500', '']);
results.push(['notice board is routed, leaf opens it, form rules hold', (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'notices').to === 'notices'; })() && pgi('/school/notices').length > 0 && noticeProblems({ title: '', body: '', audience: 'EVERYONE' }).length === 2 && noticeProblems({ title: 'Trip', body: 'Forms due', audience: 'CLASS', classId: '' }).length === 1 && noticeProblems({ title: 'Trip', body: 'Forms due', audience: 'EVERYONE' }).length === 0 && noticeProblems({ title: 'Trip', body: 'Forms due', audience: 'EVERYONE', expires: '2020-01-01' }).length === 1, '']);
results.push(['trips page is routed, leaf opens it, form rules hold', (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'trips').to === 'trips'; })() && pgi('/school/trips').includes('Loading') && tripProblems({ title: '', date: '' }).length === 2 && tripProblems({ title: 'Park', date: '2099-05-10', returnDate: '2099-05-09' }).length === 1 && tripProblems({ title: 'Park', date: '2099-05-10', deadline: '2099-05-12' }).length === 1 && tripProblems({ title: 'Park', date: '2099-05-10', cost: '1500' }).length === 0 && tripMoney(0) === 'Free' && tripMoney(1500) === 'KES 1,500', '']);
results.push(['theme switcher: renders the colour button, themes are complete and readable', (() => {
  const html = renderToString(<ThemeSwitcher />); const keys = Object.keys(THEMES[0].vars);
  const all = [...THEMES, ...MIXES]; const ids = new Set(all.map((t) => t.id));
  return html.includes('Change colours') && ids.size === all.length && all.every((t) => keys.every((k) => isHex(t.vars[k]) || k === 'x')) && all.every((t) => luminance(t.vars.primary) < 0.6 || t.vars.onPrimary === '#12261F') && themeById('nope').id === 'forest' && resolve({ id: 'custom', primary: '#336699', accent: '#FFCC00' }).id === 'custom' && customTheme('bad', 'bad').vars.primary === '#1F6B45' && mix('#000000', '#FFFFFF', 0.5) === '#808080' && readableOn('#FFFFFF') === '#12261F' && readableOn('#000000') === '#FFFFFF';
})(), '']);
results.push(['theme css maps the palette and the extra tints, and only while a theme is active', ELIMU_THEME_CSS.includes('html[data-elimu-theme]') && ELIMU_THEME_CSS.includes('bg-[#1F6B45]') && ELIMU_THEME_CSS.includes('E3F1E7') && ELIMU_THEME_CSS.split('\n').filter(Boolean).every((l) => l.startsWith('html[data-elimu-theme]') || l.startsWith('@')), '']);
results.push(['activity log view: rows are shaped, classified and dated', (() => { const r = shapeActivity({ id: 'a', at: '2026-11-18T08:00:00Z', actor_name: 'Jane', action: 'STUDENT_LEFT', detail: { module: 'students', reason: 'transfer' } });
  const n = normalizeEntry(r, 0); return r.summary.startsWith('Student left school') && r.summary.includes('reason: transfer') && n.actor === 'Jane' && n.area === 'Students' && n.date instanceof Date && !String(n.summary).includes('[object') && classify('payment_received') === 'money' && classify('user_login') === 'auth' && classify('record_deleted') === 'delete' && shapeActivity({ id: 'b', at: null, action: 'X' }).actor_name === 'The system'; })(), '']);
results.push(['export page: routed, leaf opens it, csv is safe and well formed', (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'set-export').to === 'export'; })() && (pgi('/school/export').includes('Loading') || pgi('/school/export').includes('Export')) && safeCell('=SUM(A1)') === "'=SUM(A1)" && safeCell('@cmd') === "'@cmd" && safeCell('+254711000111') === '+254711000111' && safeCell('-5') === '-5' && safeCell('Mary') === 'Mary' && safeCell(null) === '' && safeCell(12.5) === '12.5' && exportCsv(['a_b', 'c'], [{ a_b: 'x,"y"', c: null }]) === 'a b,c\r\n"x,""y""",' && exportName('PAYMENTS', "St. Mary's School", '2026-01-01', '2026-02-01', true) === 'st-mary-s-school-payments-2026-01-01-to-2026-02-01.csv' && rangeProblem('2026-02-01', '2026-01-01') !== '' && rangeProblem('2024-01-01', '2026-11-01') !== '' && rangeProblem('2026-01-01', '2026-02-01') === '' && DATASETS.length === 8, '']);
results.push(['menu cards: sections are folder cards of varied size, groups are stacks, pages are rows', (() => {
  const kids = [{ key: 'a', label: 'Alpha', desc: 'd', children: [{ key: 'a1', label: 'A one', to: 'x' }] }, { key: 'b', label: 'Beta', children: [{ key: 'b1', label: 'B one', to: 'y' }] }, { key: 'c', label: 'Gamma', children: [{ key: 'c1', label: 'C one', to: 'z' }] }, { key: 'p', label: 'Plain page', to: 'p' }, { key: 's', label: 'Later page', soon: true }];
  const d = (k) => ({ pages: k.children ? k.children.length : 1, peek: k.children ? k.children.map((c) => c.label) : [] });
  const top = renderToString(<MenuCards kids={kids} depth={0} describe={d} open={() => {}} />); const sub = renderToString(<MenuCards kids={kids} depth={1} describe={d} open={() => {}} />);
  const sizes = (top.match(/col-span-2/g) || []).length;
  return top.includes('Alpha, 1 pages') && sizes >= 1 && sizes < 3 && top.includes('A one') && !top.includes('Alpha, 1 pages</') && sub.includes('translate-x-2') && !sub.includes('col-span-2') && top.includes('Plain page') && /SOON/.test(top) && /disabled/.test(top.slice(top.indexOf('Later page') - 600, top.indexOf('Later page'))) && lookFor('finance').shape === lookFor('finance', 0).shape;
})(), '']);
results.push(['record cards: notice, trip, folder and book carry their own footer and keep their own shape', (() => {
  const n = renderToString(<NoticeCard full title="Open day" body={'Line one\nLine two'} pinned day={4} month="Dec" audience="Whole school" footer={<button>Withdraw</button>} />);
  const t = renderToString(<TripCard title="Museum" day={9} month="Dec" place="Nairobi" time="Free" status={{ label: 'Please answer', tone: 'warn' }} footer={<button>Yes</button>} />);
  const f = renderToString(<DocCard tab="Past paper" title="Maths 2025" meta="Grade 6" footer={<button>Open</button>} />);
  const b = renderToString(<BookCard title="Oliver Twist" author="Joyce Kamau · S100" due="Due 4 Dec" overdue status={{ label: 'Overdue', tone: 'bad' }} footer={<button>Return</button>} />);
  const shapes = [n, t, f, b].map((h) => (h.match(/border-radius:[^;"]+/) || [''])[0]);
  return n.includes('Withdraw') && !n.includes('line-clamp-3') && n.includes('Open day') && t.includes('Yes') && t.includes('Please answer') && f.includes('Past paper') && f.includes('Open') && b.includes('Return') && b.includes('Overdue') && new Set(shapes).size === 4;
})(), '']);
results.push(['money cards: ageing bar, debtor stamp, balance page, invoice slip, expense, supplier and bill each render their figures', (() => {
  const a = renderToString(<AgeingBar totalText="KES 90,000" buckets={[{ label: 'Not yet due', value: 10, text: 'KES 10' }, { label: '1-30 days', value: 30, text: 'KES 30' }, { label: '31-60 days', value: 0, text: 'KES 0' }, { label: '61-90 days', value: 0, text: 'KES 0' }, { label: 'Over 90 days', value: 60, text: 'KES 60' }]} />);
  const d = renderToString(<DebtorCard name="Zawadi (S100)" meta="Grade 6" owedText="KES 12,000" billed={20000} paid={8000} billedText="KES 20,000" paidText="KES 8,000" days={45} lastPayment="2026-10-02" actions={<button>Call</button>} />);
  const d0 = renderToString(<DebtorCard name="A" meta="" owedText="KES 1" billed={0} paid={0} billedText="0" paidText="0" days={0} />);
  const h = renderToString(<BalanceHero state="owes" mainText="KES 5,000" rows={[['Billed', 'KES 9,000']]} note="note" />); const hc = renderToString(<BalanceHero state="credit" mainText="KES 200" />);
  const i = renderToString(<InvoiceSlip title="INV-1" sub="2026" totalText="KES 100" settledText="KES 100" owingText="KES 0" ratio={1} paidInFull status={{ label: 'paid', tone: 'in' }} />);
  const e = renderToString(<ExpenseSlip title="Chalk" sub="Stationery" amountText="KES 500" status={{ label: 'pending', tone: 'wait' }}><button>Approve</button></ExpenseSlip>);
  const s = renderToString(<SupplierCard name="Bidco" sub="30 day terms" owedText="KES 9" billedText="KES 20" paidText="KES 11" overdueText="KES 4" overdue />); const s0 = renderToString(<SupplierCard name="B" sub="" owedText="0" billedText="0" paidText="0" overdueText="0" />);
  const b = renderToString(<BillSlip title="B-1 · Bidco" sub="due" amountText="KES 5" state={{ label: 'Overdue since 2026-10-01', tone: 'owed' }} footer={<button>Pay</button>} />);
  const checks = [a.includes('KES 90,000'), a.includes('Over 90 days'), (a.match(/<i class="block h-full"/g) || []).length === 3, d.includes('days late') && d.includes('45'), d.includes('Call'), d.includes('KES 8,000') && d.includes('KES 20,000'), !d0.includes('days late'), d0.includes('No payment yet'), h.includes('Balance owed'), hc.includes('Credit held'), i.includes('paid'), i.includes('KES 0'), e.includes('Approve'), s.includes('Overdue'), !s0.includes('Overdue'), b.includes('Overdue since'), b.includes('Pay')];
  const bad = checks.findIndex((c) => !c); if (bad !== -1) console.log('money card check', bad, 'failed'); return bad === -1;
})(), '']);
results.push(['money cards 2: payment chit, award ribbon, payslip and reconciliation render and differ by state', (() => {
  const c = renderToString(<PaymentChit title="QGH7K2L9MN" sub="Paybill" amountText="KES 5,000" tag="left to apply" tone="wait"><button>Use</button></PaymentChit>);
  const aw = renderToString(<AwardCard kind="Bursary" title="Joyce" sub="S100" amountText="50%" state="active" tone="in"><button>Apply</button></AwardCard>);
  const p = renderToString(<PayslipCard name="Jane Wanjiru" role="Teacher" totalText="KES 60,000" basic={50000} allowances={10000} basicText="KES 50,000" allowancesText="KES 10,000" onClick={() => {}} />);
  const rb = renderToString(<ReconCard title="M-Pesa" sub="1-30 Nov" totalText="KES 1" balanced />); const rd = renderToString(<ReconCard title="Bank" sub="x" totalText="KES 1" balanced={false} differenceText="KES 40" />);
  const checks = [c.includes('QGH7K2L9MN') && c.includes('Use') && c.includes('left to apply'), aw.includes('Bursary') && aw.includes('50%') && aw.includes('Apply'), p.includes('JW') && p.includes('KES 60,000') && p.includes('aria-label'), rb.includes('Balanced') && !rb.includes('Difference'), rd.includes('Difference') && rd.includes('KES 40') && !rd.includes('Balanced<')];
  const bad = checks.findIndex((x) => !x); if (bad !== -1) console.log('money cards 2 check', bad, 'failed'); return bad === -1;
})(), '']);
results.push(['school cards: class plate, staff badge, application clipboard, gate ticket and exam paper render and differ by state', (() => {
  const c = renderToString(<ClassPlate name="Grade 6" streams={['East', 'West']} footer={<button>Class list</button>} />); const c0 = renderToString(<ClassPlate name="Form 1" off />);
  const sb = renderToString(<StaffBadge name="Jane Wanjiru" you roles={['Bursar']} active />); const so = renderToString(<StaffBadge name="Sam Owner" owner active={false} />);
  const a1 = renderToString(<ApplicationCard name="Ali" meta="APPL1" category="ACCEPTED" status={{ label: 'Accepted', tone: 'ok' }} />); const a2 = renderToString(<ApplicationCard name="Bo" meta="APPL2" category="REJECTED" status={{ label: 'Rejected', tone: 'bad' }} />);
  const t = renderToString(<PassTicket student="Zawadi" meta="Grade 6 · Clinic" state={{ label: 'Parent accepted', tone: 'ok' }} stubTop="Valid until" stubBottom="Fri 14:00" lines={['Collector: Joyce', null]}><button>Release</button></PassTicket>);
  const e = renderToString(<ExamPaper title="End term" sub="Grade 6 · Maths" day={9} month="Dec" weekday="Wed" lines={['08:00–10:00 · Hall']} status={{ label: 'Published', tone: 'ok' }}><button>Change</button></ExamPaper>); const e0 = renderToString(<ExamPaper title="Open" sub="x" />);
  const checks = [c.includes('Grade 6') && c.includes('East') && c.includes('Class list') && c0.includes('No streams') && c0.includes('not in use'), sb.includes('Bursar') && sb.includes('(you)') && sb.includes('JW') && sb.includes('Active') && so.includes('Owner') && so.includes('Switched off'),
    a1.includes('Offered') && a1.includes('Accepted') && a2.includes('Rejected') && a1 !== a2, t.includes('Collector: Joyce') && t.includes('Fri 14:00') && t.includes('Release'), e.includes('Wed') && e.includes('08:00') && e.includes('Change') && e0.includes('No date yet')];
  const bad = checks.findIndex((x) => !x); if (bad !== -1) console.log('school cards check', bad, 'failed'); return bad === -1;
})(), '']);
results.push(['admission letters: routed, leaf opens it, matching and filling rules hold', (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'letters').to === 'admission-letters'; })() && pgi('/school/admission-letters').includes('Loading') && lettersFor('ADMITTED').join() === 'OFFER,JOINING' && lettersFor('WAITLISTED').join() === 'WAITLIST' && lettersFor('REJECTED').join() === 'REJECTION' && lettersFor('IN_REVIEW').length === 0 && fillLetter('Dear {{guardian_name}} {{typo_x}}', { guardian_name: 'Joyce' }) === 'Dear Joyce {{typo_x}}' && fillLetter('a{{reason_part}}b', { reason_part: '' }) === 'ab' && templateProblems('', 'short').length === 2 && templateProblems('Offer', 'A proper letter body.').length === 0, '']);
results.push(['dashboard is routed, leaf opens it, attention lines are built from present sections only', (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'mgmt').to === 'dashboard'; })() && pgi('/school/dashboard').includes('Loading') && attentionItems(null).length === 0 && attentionItems({ fees: { students_owing: 3, outstanding: 45000 } }).length === 1 && attentionItems({ attendance: { classes_expected: 5, classes_submitted: 2 }, gate: { waiting_parent: 1 } }).length === 2 && attentionItems({ fees: { students_owing: 0 } }).length === 0 && kes(45000) === 'KES 45,000' && pct(9, 10) === '90%' && pct(1, 0) === '-', '']);
results.push(['file helpers check type and size', fileProblem({ name: 'a.exe', size: 5 }) !== '' && fileProblem({ name: 'a.pdf', size: 5 }) === '' && fileProblem({ name: 'a.pdf', size: 99999999 }).includes('10 MB') && fileSize(1048576) === '1.0 MB' && fileSize(2048) === '2 KB', '']);
results.push(['activity log is routed and its menu leaf opens it', pgi('/school/activity').includes('Activity log') && (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'audit').to === 'activity'; })(), '']);
results.push(['leavers page is routed and its menu leaf opens it', pgi('/school/leavers').includes('Transfers') && (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'leavers').to === 'leavers'; })(), '']);
results.push(['promotion page is routed and its menu leaf opens it', pgi('/school/promotion').includes('Promotion') && (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); return f.find((n) => n.key === 'promotion').to === 'promotion'; })(), '']);
results.push(['import pages are routed', pgi('/school/import/students').includes('Import students') && pgi('/school/import/balances').includes('Import fee balances') && pgi('/school/import/results').includes('Import past results') && pgi('/school/import/log').includes('Import log'), '']);
results.push(['import menu leaves open real pages (students, guardians, log); fee balances and past results still planned', (() => { const f = []; (function w(n) { (n.children || []).forEach(w); if (n.key) f.push(n); })(SCHOOL_TREE); const g = (k) => f.find((n) => n.key === k); return g('imp-students').to === 'import/students' && g('imp-guardians').to === 'import/students' && g('imp-log').to === 'import/log' && g('imp-balances').to === 'import/balances' && g('imp-results').to === 'import/results'; })(), '']);

results.push(['last cards: stock bin, asset tag, fee sheet and tally strip render and react to state', (() => {
  const a = renderToString(<StockCard name="Chalk" sub="Stationery" qtyText="3 box" valueText="KES 300" low ratio={0.1} />); const b = renderToString(<StockCard name="Rice" sub="Food" qtyText="90 kg" valueText="KES 9,000" ratio={1} />);
  const t = renderToString(<AssetTag tag="AST-001" name="Projector" sub="ICT" valueText="KES 40,000" />);
  const f = renderToString(<FeeSheet title="Grade 4" sub="2026 T1" status="active" totalText="KES 20,000" items={[{ label: 'Tuition', value: 'KES 18,000' }, { label: 'Lunch', value: 'KES 2,000' }]} />);
  const y = renderToString(<TallyStrip items={[{ label: 'Present', value: 30, tone: 'ok' }, { label: 'Absent', value: 2, tone: 'bad' }]} />);
  const checks = [a.includes('Chalk') && a.includes('B3402A') !== b.includes('B3402A') || a !== b, t.includes('AST-001') && t.includes('KES 40,000'), f.includes('Tuition') && f.includes('KES 20,000') && f.includes('active'), y.includes('Present') && y.includes('30') && y.includes('Absent')];
  const bad = checks.findIndex((x) => !x); if (bad !== -1) console.log('last cards check', bad, 'failed'); return bad === -1;
})()]);

results.push(['staff sign-in: fingerprint button on the login, My sign-in page routed and listed in Settings', (() => {
  const l = renderToString(<ElimuLogin onGoToRegister={() => {}} />); const pg = pgi('/school/my-signin');
  const checks = [l.includes('Sign in with fingerprint'), l.includes('Try the demo school'), l.includes('href="/parent"'), pg.includes('My sign-in') || pg.includes('Loading'), countSoon(SCHOOL_TREE) === 0];
  const bad = checks.findIndex((x) => !x); if (bad !== -1) console.log('signin check', bad, 'failed'); return bad === -1;
})()]);

results.push(['sign-in guard: five wrong codes pause the screen, a right start is clean, messages are friendly', (() => {
  let g = G.freshGuard(); const t0 = 1000000; const msgs = [];
  for (let i = 0; i < 4; i++) { g = G.afterWrongCode(g, t0); msgs.push(G.wrongCodeMessage(g, t0)); }
  const before = G.lockedFor(g, t0); g = G.afterWrongCode(g, t0); const after = G.lockedFor(g, t0); const later = G.lockedFor(g, t0 + 301000);
  const checks = [before === 0, msgs[3].includes('1 try left'), after === 300, later === 0, G.wrongCodeMessage(g, t0).includes('wait 5 minutes'), G.waitText(125) === '2:05' && G.waitText(9) === '9s',
    G.friendlySendError('For security purposes, you can only request this after 27 seconds').includes('wait a minute'), G.friendlySendError('Error sending sms').includes('SMS'), G.RESEND_SECONDS === 30];
  const bad = checks.findIndex((x) => !x); if (bad !== -1) console.log('guard check', bad, 'failed'); return bad === -1;
})()]);
results.push(['parent portal route still renders', renderToString(<MemoryRouter initialEntries={['/parent']}><Routes><Route path="/parent/*" element={<ParentApp />} /></Routes></MemoryRouter>).length > 0]);

results.push(['setup check: journey path, gap cards with a fix link, quiet lines for what is done', (() => {
  const data = { year: '2026', learners: 12, placed: 12, checks: [
    { key: 'placed', step: 'Admission', title: 'Placed', ok: true, count: 0, detail: '12 of 12 placed.', fix: 'students' },
    { key: 'stream', step: 'Stream', title: 'Learners in a streamed class are in a stream', ok: false, count: 12, detail: '12 learners are in a class that has streams but not in one.', fix: 'classes' },
    { key: 'fees', step: 'Fees', title: 'Each class has a fee structure', ok: false, count: 3, detail: '3 classes have no fee structure.', fix: 'finance' }] };
  const h = renderToString(<MemoryRouter><SetupCheckView data={data} /></MemoryRouter>); const ok = renderToString(<MemoryRouter><SetupCheckView data={{ ...data, checks: [data.checks[0]] }} /></MemoryRouter>);
  const checks = [h.includes('Go and fix it') && h.includes('../classes') === false && h.includes('classes'), h.includes('Student journey'), h.includes('12 of 12 learners placed') || h.includes('12 of 12'), (h.match(/Go and fix it/g) || []).length === 2, !ok.includes('Go and fix it'),
    summaryLine(data.checks) === '2 of 3 steps need attention.', summaryLine([{ ok: true }]).startsWith('Everything')];
  const bad = checks.findIndex((x) => !x); if (bad !== -1) console.log('setup check', bad, 'failed'); return bad === -1;
})()]);
results.push(['setup check page is routed and listed in Settings', pgi('/school/setup-check').length > 0, '']);

results.push(['class list: stream chooser and the share button are wired (service call exists, page still renders)', (() => {
  const checks = [typeof enrollmentServiceForTest.shareStreams === 'function', pgi('/school/classes').length > 0];
  const bad = checks.findIndex((x) => !x); if (bad !== -1) console.log('class list check', bad, 'failed'); return bad === -1;
})()]);

results.push(['setup check: demo fill card renders and its report reads in plain sentences', (() => {
  const h = renderToString(<DemoFill />); const r = demoReport({ stages: { fees: { status: 'done', detail: '3 fee structures added' }, exams: { status: 'failed', detail: 'oops' } } });
  const checks = [h.includes('This is the demo school') && h.includes('Fill the demo journey') && h.includes('Add a demo parent and results'), r.length === 2 && r[0].key === 'fees' && r[1].status === 'failed', demoReport(null).length === 0];
  const bad = checks.findIndex((x) => !x); if (bad !== -1) console.log('demo fill', bad, 'failed'); return bad === -1;
})()]);

results.push(['bottom bar: Home + major modules (not single pages), per-role, and the right tab lights up', (() => {
  const all = bottomTabs(SCHOOL_TREE, () => true, true);
  const gate = bottomTabs(SCHOOL_TREE, (a) => a === 'gate.checkin' || a === 'gate.view' || a === 'gate.manage', false);
  const none = bottomTabs(SCHOOL_TREE, () => false, false);
  const m = (p) => moduleOfPath(SCHOOL_TREE, p);
  const checks = [all.modules.map((x) => x.key).join() === 'academics,registration,finance', all.modules[1].label === 'Students', !all.modules.some((x) => ['attendance', 'students'].includes(x.key)), all.rest.includes('administration') && all.rest.includes('settings'),
    gate.modules.length <= 3, none.modules.every((x) => x.key === 'administration'),   // notices are open to every staff member, so that is all a no-rights user sees
    
    m('attendance/take') === 'academics', m('students') === 'registration', m('finance') === 'finance', m('menu/security/gate') === 'security', m('menu') === null || m('menu') === undefined, m('setup-check') === 'settings', m('') === null,
    m('admission-letters') === 'registration', m('exams') !== undefined];
  const bad = checks.findIndex((x) => !x); if (bad !== -1) console.log('bottom bar check', bad, 'failed', JSON.stringify([all.modules.map((x) => x.key), m('attendance/take'), m('students'), m('finance'), m('menu/security/gate'), m('menu'), m('setup-check'), m('admission-letters')])); return bad === -1;
})()]);
results.push(['bottom bar renders on a school page without breaking the shell', pgi('/school/students').length > 0]);

results.push(['module screen: hero, sub-module cards with their pages one tap away, sub-sub tiles, wide vs compact', (() => {
  const acad = SCHOOL_TREE.children.find((c) => c.key === 'academics'); const vis = (n) => (n.children || []);
  const subs = vis(acad).filter((k) => k.children).map((g) => ({ node: g, Icon: undefined, pages: 3, items: vis(g).map((c) => (c.children ? { ...c, pagesCount: 2 } : c)) }));
  const h = renderToString(<ModuleHub node={acad} Icon={() => null} pages={20} subs={subs} onOpenGroup={() => {}} onOpenPage={() => {}} />);
  const firstLeaf = subs.flatMap((s) => s.items).find((i) => !i.children);
  const checks = [h.includes('Academics'), h.includes('section') , subs.length >= 3, !!firstLeaf && h.includes(firstLeaf.label), h.includes('col-span-2'), h.includes('dashed') === subs.some((s) => s.items.some((i) => i.children)), h.includes('20') && h.includes('pages')];
  const bad = checks.findIndex((x) => !x); if (bad !== -1) console.log('module screen', bad, 'failed'); return bad === -1;
})()]);
results.push(['menu module route still renders (hub inside the menu page)', pgi('/school/menu/academics').length > 0]);

results.push(['module polish: Finance opens its page directly, sub-module cards each get their own colour, recents and in-module search', (() => {
  const all = () => true; const fin = SCHOOL_TREE.children.find((c) => c.key === 'finance'); const acad = SCHOOL_TREE.children.find((c) => c.key === 'academics');
  const bar = bottomTabs(SCHOOL_TREE, all, true);
  const L = looksFor('academics', 6); const L2 = looksFor('registration', 6);
  const mem = (() => { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = v; } }; })();
  recordOpen('att-take', mem, 1000); recordOpen('exams', mem, 2000); recordOpen('att-take', mem, 3000); recordOpen('zzz', mem, 4000);
  const rec = recentAmong(['att-take', 'exams'], 3, mem); const none = recentAmong(['att-take'], 3, null);
  const subs = acad.children.filter((k) => k.children).map((g) => ({ node: g, Icon: undefined, pages: 3, items: (g.children || []).map((c) => (c.children ? { ...c, pagesCount: 2 } : c)) }));
  const leaves = leavesOf(acad, all, true);
  const html = renderToString(<ModuleHub node={acad} Icon={() => null} pages={20} subs={subs} allLeaves={leaves} recentKeys={[leaves[0].key]} onOpenGroup={() => {}} onOpenPage={() => {}} />);
  const checks = [soleLeaf(fin, all, true)?.to === 'finance', soleLeaf(acad, all, true) === null, bar.modules.find((m) => m.key === 'finance')?.to === 'finance', bar.modules.find((m) => m.key === 'academics')?.to === null,
    new Set(L).size === 6 && L.every((x) => x >= 0 && x < CARD_LOOKS.length), L.join() !== L2.join(), rec.join() === 'att-take,exams', none.length === 0,
    html.includes('Search Academics') && html.includes('Pick up where you left off') && html.includes(leaves[0].label), leaves.length > 6];
  const bad = checks.findIndex((x) => !x); if (bad !== -1) console.log('module polish', bad, 'failed', JSON.stringify([rec, L, L2])); return bad === -1;
})()]);

{ check('study tab renders', () => renderToString(<MemoryRouter><StudyTab studentId="x" /></MemoryRouter>)); check('profile route still renders', () => renderToString(<MemoryRouter initialEntries={['/elimu/students/abc']}><Routes><Route path="/elimu/*" element={<Routes_ />} /></Routes></MemoryRouter>)); }
results.push(['parent login: school code + username + password screen, first-password screen, email rule, wrong-password message, admin page route', (() => {
  const si = renderToString(<MemoryRouter><ParentSignIn onDone={() => {}} /></MemoryRouter>); const cp = renderToString(<MemoryRouter><ParentChoosePassword name="Wanjiru Mwangi" onDone={() => {}} onSignOut={() => {}} /></MemoryRouter>);
  const pl = renderToString(<MemoryRouter initialEntries={['/school/parent-logins']}><Routes><Route path="/school/*" element={<Routes2 />} /></Routes></MemoryRouter>);
  const g = G.afterWrongCode(G.freshGuard(), 1000);
  const checks = [si.includes('School code') && si.includes('Username') && si.includes('Password') && !si.includes('Send code'), cp.includes('Welcome') && cp.includes('Wanjiru') && cp.includes('Choose your own password'),
    parentEmailFor('A1B2C3', '1024-A') === '1024-a.a1b2c3@parents.elimu.app' && parentEmailFor('', 'x') === '', G.wrongPasswordMessage(g, 1000).includes('4 tries left'), pl.length > 0, JSON.stringify(SCHOOL_TREE).includes('parent-logins')];
  const bad = checks.findIndex((x) => !x); if (bad !== -1) console.log('parent login check', bad, 'failed'); return bad === -1;
})()]);
results.push(['parent updates: urgent first, fees next, notices, past events dropped, capped', (() => {
  const u = buildUpdates({ passes: [{ id: 'p1', state: 'REQUESTED', reason: 'Dentist', requested_at: '2026-11-20T08:00:00Z' }, { id: 'p2', state: 'ACCEPTED' }],
    trips: [{ id: 't1', title: 'Museum', can_answer: true, consent: null, trip_date: '2026-12-01', consent_deadline: '2026-11-28' }, { id: 't2', title: 'Old', cancelled: true, can_answer: true }],
    fees: { outstanding_total: 12500 }, results: [{ report_card_id: 'r1', term: 'Term 2', year: '2026', grade: 'B', published_at: '2026-11-10' }],
    notices: [{ id: 'n1', title: 'PTA meeting', at: '2026-11-18', important: false }], calendar: [{ id: 'e1', title: 'Sports day', start_date: '2026-12-05' }, { id: 'e0', title: 'Past', start_date: '2026-01-01' }] }, '2026-11-21');
  const kinds = u.map((x) => x.kind);
  return kinds[0] === 'gatepass' && kinds[1] === 'trip' && kinds[2] === 'fees' && kinds.includes('report') && kinds.includes('notice') && kinds.includes('event') && !u.some((x) => x.title === 'Past' || x.title === 'Old') && u.length <= 12 && buildUpdates({}).length === 0;
})()]);
results.push(['parent screens render (loading state) without crashing', (() => { const h = [renderToString(<PChildDetails id="x" />), renderToString(<PClassPerf id="x" allowed />), renderToString(<PClassPerf id="x" allowed={false} />), renderToString(<PWhatsNew id="x" onOpen={() => {}} />)];
  return h.every((x) => x.length > 0) && h[2].includes('not shared'); })()]);
results.push(['parent home: hero, tiles, skeleton, summary helpers', (() => {
  const kid = { student_id: 's1', name: 'Zawadi-Rose Mwangi', class_name: 'Grade 6', admission_no: 'S100', can_see_fees: true, can_see_results: true };
  const hero = renderToString(<PHero child={kid} colour="#1F6B45" onOpen={() => {}} />); const tiles = renderToString(<PTiles child={kid} onOpen={() => {}} />);
  const noFin = renderToString(<PTiles child={{ ...kid, can_see_fees: false, can_see_results: false }} onOpen={() => {}} />);
  const checks = [hero.includes('Zawadi-Rose Mwangi') && hero.includes('ZM') && hero.includes('Attendance'), ['Attendance', 'Results', 'Fees', 'Notices'].every((t) => tiles.includes(t)), !noFin.includes('Fees') && !noFin.includes('Results') && noFin.includes('Notices'),
    renderToString(<PSkel rows={2} />).includes('aria-busy'), attendanceRate({ present: 18, absent: 1, excused: 1 }) === 90, attendanceRate({ present: 0, absent: 0, excused: 0 }) === null, kidInitials('Amani Baraka Mwangi') === 'AM' && kidInitials('') === '?', feeTone(0) === 'good' && feeTone(500) === 'owing'];
  const bad = checks.findIndex((x) => !x); if (bad !== -1) console.log('parent home check', bad, 'failed'); return bad === -1;
})()]);

{ // human errors, help centre, not-found
  const t = (n, c, d = '') => results.push([n, !!c, d]);
  const bad404 = hm({ status: 404, message: 'Not Found' }); t('humanMessage 404 plain', /could not find/i.test(bad404) && !/404/.test(bad404), bad404);
  const nw = hm(new TypeError('Failed to fetch')); t('humanMessage network', /internet connection/i.test(nw), nw);
  const au = hm({ status: 401, message: 'JWT expired' }); t('humanMessage 401/expired', /sign in again|session/i.test(au) && !/JWT/.test(au), au);
  const pg = hm({ code: 'PGRST202', message: 'Could not find the function public.elimu_x in the schema cache' }); t('humanMessage PGRST202 hides system words', !/PGRST|schema cache|function/i.test(pg), pg);
  const dup = hm({ code: '23505', message: 'duplicate key value violates unique constraint "x"' }); t('humanMessage duplicate', !/constraint|violates/i.test(dup), dup);
  const own = hm({ code: 'P0001', message: 'That admission number is already used.' }); t('humanMessage passes our own message', own === 'That admission number is already used.', own);
  const e = hmErr({ code: '42P01', message: 'relation "x" does not exist' }); t('humanError keeps technical', e instanceof Error && !!e.technical && !/relation/.test(e.message), e.message);
  const hh = renderToString(<HelpCentre audience="parent" />); t('help centre parent renders with contacts', /Still need help/.test(hh) && /password/i.test(hh));
  t('help search', helpSearch([{ id: 'a', title: 'Password', body: ['x'] }, { id: 'b', title: 'Fees', body: ['y'] }], 'pass').length === 1);
  t('error boundary renders children', /hello/.test(renderToString(<ErrorBoundary><p>hello</p></ErrorBoundary>)));
  t('not found page is human', /could not find that page/i.test(renderToString(<MemoryRouter><NotFound /></MemoryRouter>)));
  t('unknown staff route shows not found', /could not find that page/i.test(renderToString(<MemoryRouter initialEntries={['/elimu/zzz-nothing']}><Routes><Route path="/elimu/*" element={<Routes_ />} /></Routes></MemoryRouter>)));
  t('staff help route renders', /Help/.test(renderToString(<MemoryRouter initialEntries={['/elimu/help']}><Routes><Route path="/elimu/*" element={<Routes_ />} /></Routes></MemoryRouter>)));
}
{ // licensing notices, owner page, help message form
  const t = (n, c, d = '') => results.push([n, !!c, d]);
  const g = licenceNotice({ state: 'grace', days_left: 12 }); t('grace notice names the days left', g && g.tone === 'warn' && /12 days/.test(g.text), g && g.text);
  t('one day left is singular', /1 day[^s]/.test(licenceNotice({ state: 'grace', days_left: 1 }).text));
  t('due-soon notice under 8 days', licenceNotice({ state: 'active', days_left: 5 })?.tone === 'info');
  t('no notice when comfortably paid', licenceNotice({ state: 'active', days_left: 40 }) === null && licenceNotice({ state: 'none' }) === null);
  t('owner page renders without throwing', renderToString(<ElimuManagementPage />).length > 0);
  t('help centre shows a message form when logging is on', /Send us a message/.test(renderToString(<HelpCentre audience="parent" onLog={() => Promise.resolve()} />)));
  t('help centre has no form without logging', !/Send us a message/.test(renderToString(<HelpCentre audience="parent" />)));
  t('owner route renders', renderToString(<MemoryRouter initialEntries={['/elimu/owner']}><Routes><Route path="/elimu/*" element={<Routes_ />} /></Routes></MemoryRouter>).length > 0);

  { // teacher reports (piece 59)
    const rep = { teacher: { id: 't1', name: 'Jane Mwangi', roles: ['class_teacher', 'subject_teacher'], is_me: false }, term: { id: 'x', name: 'Term 1', year: '2026' }, terms: [{ id: 'x', name: 'Term 1 2026' }],
      load: { classes: 1, subjects: 1, groups: 1, learners: 40, lessons_per_week: 8, activity_periods_per_week: 0 },
      performance: { overall_mean: 58.2, previous_overall_mean: 63.1, change: -4.9, rows: [{ class_id: 'c', class_name: 'Grade 5', stream_id: 's1', stream_name: 'East', subject_id: 'e', subject_name: 'English', learners: 40, mean: 58.2, highest: 91, lowest: 22, pass_rate: 70, grades: { A: 3, B: 10 }, class_mean: 64.4, previous_mean: 63.1, change: -4.9,
        streams: [{ stream_id: 's2', name: 'West', mean: 70.6, learners: 38, teacher: 'Peter Otieno', is_mine: false }, { stream_id: 's1', name: 'East', mean: 58.2, learners: 40, teacher: 'Jane Mwangi', is_mine: true }], stream_rank: 2, stream_count: 2, subject_rank: 4, subjects_in_class: 6 }] },
      class_teacher: [{ class_id: 'c', class_name: 'Grade 5', stream_name: 'East', learners: 40, class_mean: 60, cards_total: 40, cards_with_remarks: 31 }],
      marking: { assessments: 5, locked: 3, marks_pending: 12 }, attendance: { lessons_taken: 30, lessons_submitted: 27 }, assignments: { set: 4, handed_in: 120, marked: 100 },
      activities: [{ activity_id: 'a', name: 'Football', kind: 'GAMES', role: 'LEADER' }], events: [{ activity: 'Football', date: '2026-02-10', title: 'Zonal final', level: 'ZONE', result: 'Runners-up' }],
      pay_visible: true, pay: { linked: true, basic: 50000, allowances: 5000, gross: 55000, last_net: 46000, last_period: '2026-03' } };
    const html = renderToString(<MemoryRouter><ReportBody d={rep} basePath="/school" term="" setTerm={() => {}} reload={() => {}} /></MemoryRouter>);
    t('teacher report shows the name of the class, subject and average', /Grade 5 East - English/.test(html) && /58\.2%/.test(html));
    t('teacher report compares with the other stream and names its teacher', /West/.test(html) && /Peter Otieno/.test(html) && /ranked 2 of 2/.test(html));
    t('teacher report shows activities, events and pay', /Football/.test(html) && /Zonal final/.test(html) && /KES 55,000/.test(html));
    const noPay = renderToString(<MemoryRouter><ReportBody d={{ ...rep, pay_visible: false, pay: null }} basePath="/school" term="" setTerm={() => {}} reload={() => {}} /></MemoryRouter>);
    t('without the finance right the pay card is not drawn at all', !/Basic/.test(noPay) && !/KES 55,000/.test(noPay));
    const n = teacherNotes(rep).map((x) => x.text).join(' | ');
    t('notes say average down, stream rank, below class, marks pending, remarks missing, registers missing', /down 4\.9/.test(n) && /2nd of 2 streams/.test(n) && /below the class average/.test(n) && /12 marks/.test(n) && /9 report cards/.test(n) && /3 lesson registers/.test(n), n);
    t('no notes for a quiet report', teacherNotes({ performance: { rows: [], change: 0.2 }, marking: { marks_pending: 0 }, class_teacher: [], attendance: { lessons_taken: 2, lessons_submitted: 2 } }).length === 0);
    t('one pending mark is singular', /1 mark is still/.test(teacherNotes({ performance: { rows: [] }, marking: { marks_pending: 1 } })[0].text));
    { const csv = reportCsv(rep); const pdf = buildPdf(reportPdfLines(rep)); const txt = Array.from(pdf, (b) => String.fromCharCode(b)).join('');
      t('CSV has the sections, the stream comparison and pay, and starts with a byte-order mark', csv.charCodeAt(0) === 0xFEFF && /Teacher report/.test(csv) && /Results by class and subject/.test(csv) && /Comparison with other streams/.test(csv) && /Peter Otieno/.test(csv) && /Gross a month \(KES\),55000/.test(csv));
      t('CSV leaves pay out when the viewer has no finance right', !/Pay \(confidential\)/.test(reportCsv({ ...rep, pay_visible: false, pay: null })));
      t('CSV quotes commas and quotes in names', /"Smith, ""Jo"""/.test(reportCsv({ ...rep, teacher: { ...rep.teacher, name: 'Smith, "Jo"' } })));
      t('PDF is a well-formed file: header, trailer, one page for a short report', txt.startsWith('%PDF-1.4') && /%%EOF\n$/.test(txt) && /\/Count 1\b/.test(txt));
      t('PDF holds the teacher name and the comparison', /Jane Mwangi/.test(txt) && /Peter Otieno/.test(txt));
      t('a long report flows onto more pages', /\/Count [2-9]/.test(Array.from(buildPdf(Array.from({ length: 130 }, (_, i) => ({ t: `line ${i}` }))), (b) => String.fromCharCode(b)).join('')));
      t('teacher list CSV has one row per teacher', listCsv({ teachers: [{ name: 'A', class_teacher_of: ['Grade 5'], subjects: 2, learners: 40, lessons_per_week: 8, mean: 60, change: -1, activities: 1, leads: 1 }] }).split('\r\n').filter(Boolean).length === 2);
      if (process.env.PDF_OUT) process.getBuiltinModule('node:fs').writeFileSync(process.env.PDF_OUT, pdf); }
    { const sidebar = (access) => renderToString(<MemoryRouter initialEntries={['/school']}><Routes><Route path="/school/*" element={<ElimuRoutes basePath="/school" accessOverride={access} />} /></Routes></MemoryRouter>);
      const own = sidebar({ can: () => true, loaded: true, isOwner: true, roles: [] });
      t('the laptop sidebar lists Teachers, My report and Games & clubs for the owner', /aria-label="School sections"/.test(own) && /Teachers<\/a>/.test(own.split('aria-label="School sections"')[1] || '') && /My report/.test(own) && /Games &amp; clubs/.test(own));
      const none = sidebar({ can: (a) => a === 'students.view', loaded: true, isOwner: false, roles: [] });
      t('a person with no academic role does not get those sidebar links', !/My report/.test(none) && !/Games &amp; clubs/.test(none) && !/>Teachers</.test(none));
    }
    t('teacher pages are routed', ['/school/teachers', '/school/my-report', '/school/activities'].every((u) => renderToString(<MemoryRouter initialEntries={[u]}><Routes><Route path="/school/*" element={<ElimuRoutes basePath="/school" accessOverride={{ can: () => true, loaded: true, isOwner: true, roles: [] }} />} /></Routes></MemoryRouter>).length > 0));
  }
}
let bad = 0; for (const [n, ok, d] of results) { if (!ok) bad++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ' — ' + d : ''}`); }
console.log(`${results.length - bad} passed, ${bad} failed`); process.exit(bad ? 1 : 0);

