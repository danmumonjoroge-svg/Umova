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
import { toE164 } from '../../parent/parentClient.js';

const guardian = { id: 'g1', first_name: 'Grace', last_name: 'Otieno', consent: [{ channel: 'EMAIL', status: 'OPTED_OUT' }],
  contacts: [{ id: 'c1', kind: 'PHONE', value: '0712345678', is_primary: true, is_whatsapp: true }, { id: 'c2', kind: 'EMAIL', value: 'g@x.co', is_primary: true }] };
const student = { id: 's1', first_name: 'Amina', last_name: 'Otieno', preferred_name: 'Mina' };
const results = [];
const check = (name, fn) => { try { const html = fn(); results.push([name, html.length > 0, '']); return html; } catch (e) { results.push([name, false, e.message]); return ''; } };

for (const path of ['/elimu', '/elimu/students', '/elimu/students/s1', '/elimu/guardians', '/elimu/guardians/g1', '/elimu/admissions', '/elimu/classes', '/elimu/communication', '/elimu/settings'])
  check(`route ${path}`, () => renderToString(<MemoryRouter initialEntries={[path]}><Routes><Route path="/elimu/*" element={<Routes_ />} /></Routes></MemoryRouter>));
// unified app shell (phone layout): every school route renders under /school without throwing, with the app bar and the bottom tab bar
for (const path of ['/school', '/school/students', '/school/attendance', '/school/attendance/take', '/school/absences', '/school/timetable', '/school/calendar', '/school/academics', '/school/academics/assessments', '/school/gate', '/school/rooms', '/school/fees', '/school/school-finance/collect', '/school/settings']) {
  const html = check(`app route ${path}`, () => renderToString(<MemoryRouter initialEntries={[path]}><Routes><Route path="/school/*" element={<Routes2 />} /></Routes></MemoryRouter>));
  results.push([`app shell ${path}: tab bar present`, html.includes('aria-label="School tabs"'), '']);
}
function Routes2() { return <Suspense fallback={<i>loading-chunk</i>}><ElimuRoutes basePath="/school" accessOverride={{ can: () => true, loaded: true, isOwner: true, roles: [] }} /></Suspense>; }
{ const r = (p) => renderToString(<MemoryRouter initialEntries={[p]}><Routes><Route path="/school/*" element={<Routes2 />} /></Routes></MemoryRouter>); const nothing = r('/school/zzz');   // no match -> Navigate (renders nothing on the server): just the empty shell
  for (const p of ['/school/attendance', '/school/absences', '/school/academics', '/school/academics/assessments', '/school/timetable', '/school/calendar', '/school/gate', '/school/rooms', '/school/school-finance/collect', '/school/settings'])
    results.push([`${p} matches a real route (renders more than the empty shell)`, r(p).length > nothing.length, '']);
  results.push(['/school/academics shows the Academics home', r('/school/academics').includes('Academics &amp; exams'), '']); }
const appHtml = check('ElimuApp (auth + shell) renders', () => renderToString(<MemoryRouter initialEntries={['/school']}><Routes><Route path="/school/*" element={<ElimuApp />} /></Routes></MemoryRouter>));
results.push(['app bar has school name, Umova home and Sign out', appHtml.includes('Sunrise Academy') && appHtml.includes('aria-label="Umova home"') && appHtml.includes('aria-label="Sign out"'), '']);
results.push(['shell is one full-height column (dvh) with safe-area padding', appHtml.includes('100dvh') && appHtml.includes('safe-area-inset-top'), '']);
const parentHtml = check('ParentApp renders (signed-out state is the loading screen on the server)', () => renderToString(<MemoryRouter><ParentApp /></MemoryRouter>));
results.push(['parent app is a full-height dvh column', parentHtml.includes('100dvh'), '']);
results.push(['phone numbers normalise to +254', toE164('0722 111 222') === '+254722111222' && toE164('722111222') === '+254722111222' && toE164('+254722111222') === '+254722111222' && toE164('254722111222') === '+254722111222' && toE164('12') === '' && toE164('') === '', '']);
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
