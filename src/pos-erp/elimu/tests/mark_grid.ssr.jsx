import React from 'react'; import { renderToStaticMarkup } from 'react-dom/server';
import MarkSheetGrid from '../exams/components/MarkSheetGrid.jsx';
const rows = [
 { enrollment_id: 'e1', admission_number: 'A001', student_name: 'Amina Ali', mark_status: 'PRESENT', marksText: '15', entry_status: 'SUBMITTED' },
 { enrollment_id: 'e2', admission_number: 'A002', student_name: 'Brian Bett', mark_status: 'ABSENT', marksText: '', entry_status: 'DRAFT', dirty: true },
 { enrollment_id: 'e3', admission_number: 'A003', student_name: 'Carol <b>Chege</b>', mark_status: 'PENDING', marksText: '', entry_status: 'DRAFT', localState: 'PENDING' },
 { enrollment_id: 'e4', admission_number: 'A004', student_name: 'David Dawa', mark_status: 'PRESENT', marksText: '9', entry_status: 'DRAFT', localState: 'CONFLICT', localMessage: 'Someone else changed this mark', pendingId: 7 },
];
const html = renderToStaticMarkup(<MarkSheetGrid rows={rows} maxMarks={20} onEdit={() => {}} onResolve={() => {}} onHistory={() => {}} />);
const checks = {
 'shows marks out of max': html.includes('Marks / 20'), 'submitted badge': html.includes('Submitted'),
 'offline badge says NOT sent': html.includes('On this phone, not sent'), 'conflict needs attention': html.includes('Needs attention') && html.includes('Keep mine') && html.includes('Use the saved one'),
 'blank pending shows placeholder, not 0': html.includes('placeholder="blank"') && !/value="0"/.test(html),
 'all five statuses offered': ['Present','Absent','Exempted','Not submitted','Pending'].every((l) => html.includes(`>${l}<`)),
 'submitted row is locked (disabled)': /disabled=""[^>]*aria-label="Marks for Amina Ali"|aria-label="Marks for Amina Ali"[^>]*disabled=""/.test(html),
 'absent row marks input disabled': /aria-label="Marks for Brian Bett"[^>]*disabled=""|disabled=""[^>]*aria-label="Marks for Brian Bett"/.test(html),
 'student names are escaped': html.includes('Carol &lt;b&gt;Chege&lt;/b&gt;'),
};
for (const [k, v] of Object.entries(checks)) console.log(v ? 'PASS' : 'FAIL', k);
