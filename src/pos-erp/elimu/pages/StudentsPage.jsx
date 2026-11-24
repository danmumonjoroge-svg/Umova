import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FitPage, SearchBox, FilterChips, DataCard, CardGrid, AddButton, LoadingBlock, EmptyBlock, Notice } from '../services/platform.js';
import { studentService } from '../services/ElimuStudentService.js';
import { setupService } from '../services/ElimuSetupService.js';
import { useAsync, useDebounced } from '../hooks/useAsync.js';
import { useElimuAccess } from '../hooks/useElimu.js';
import { StatusPill, Pager, Avatar } from '../components/ui.jsx';
import StudentFormSheet from '../components/StudentFormSheet.jsx';
import ElimuContactActions from '../components/ElimuContactActions.jsx';
import { fullName } from '../utils/format.js';
import { PersonCard } from '../ui/cards/index.js';
import { displayPhone } from '../utils/phone.js';

const FILTERS = [{ key: '', label: 'All' }, { key: 'ACTIVE', label: 'Active' }, { key: 'APPLICANT', label: 'Applicants' }, { key: 'SUSPENDED', label: 'Suspended' }, { key: 'TRANSFERRED', label: 'Transferred' }, { key: 'ALUMNI', label: 'Alumni' }];

export default function StudentsPage({ basePath = '/elimu' }) {
  const { can } = useElimuAccess(); const [sp] = useSearchParams();
  const [search, setSearch] = useState(''); const q = useDebounced(search); const [cat, setCat] = useState('ACTIVE'); const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(sp.get('new') === '1');
  const statuses = useAsync(() => setupService.studentStatuses(), []);
  const list = useAsync(() => studentService.list({ search: q, statusCategory: cat || null, page }), [q, cat, page]);
  return (
    <FitPage title="Students" subtitle={list.data ? `${list.data.total} found` : ''} action={can('students.manage') && <AddButton onClick={() => setAdding(true)} label="Add student" />}
      toolbar={<><SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Name or admission number" /><FilterChips options={FILTERS} value={cat} onChange={(v) => { setCat(v); setPage(0); }} /></>}>
      {list.error && <Notice tone="bad">{list.error}</Notice>}
      {list.loading && !list.data ? <LoadingBlock /> : (list.data?.rows.length === 0 ? <EmptyBlock>No students match. {can('students.manage') && 'Add the first one with the button above.'}</EmptyBlock> :
        <div className="space-y-3 pl-6 sm:grid sm:grid-cols-2 sm:gap-x-4 sm:space-y-0 sm:gap-y-3">{list.data?.rows.map((s) => (
          <PersonCard key={s.student_id} name={fullName(s)} to={`${basePath}/students/${s.student_id}`}
            meta={[s.admission_no, s.class_name && `${s.class_name}${s.stream_name ? ` ${s.stream_name}` : ''}`].filter(Boolean).join(' · ') || 'Not enrolled'}
            status={{ label: s.status_label || s.status_category, tone: { ACTIVE: 'ok', APPLICANT: 'warn', SUSPENDED: 'bad' }[s.status_category] || 'quiet' }}
            aside={s.primary_guardian_name ? `${s.primary_guardian_name}${s.primary_guardian_phone ? ` · ${displayPhone(s.primary_guardian_phone)}` : ''}` : 'No guardian'} />))}</div>)}
      {list.data && <Pager page={page} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />}
      {adding && <StudentFormSheet statuses={statuses.data || []} onClose={() => setAdding(false)} onSaved={() => list.reload()} />}
    </FitPage>
  );
}
