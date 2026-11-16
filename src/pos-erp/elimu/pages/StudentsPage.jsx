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
import { displayPhone } from '../utils/phone.js';

const FILTERS = [{ value: '', label: 'All' }, { value: 'ACTIVE', label: 'Active' }, { value: 'APPLICANT', label: 'Applicants' }, { value: 'SUSPENDED', label: 'Suspended' }, { value: 'TRANSFERRED', label: 'Transferred' }, { value: 'ALUMNI', label: 'Alumni' }];

export default function StudentsPage({ basePath = '/elimu' }) {
  const { can } = useElimuAccess(); const [sp] = useSearchParams();
  const [search, setSearch] = useState(''); const q = useDebounced(search); const [cat, setCat] = useState('ACTIVE'); const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(sp.get('new') === '1');
  const statuses = useAsync(() => setupService.studentStatuses(), []);
  const list = useAsync(() => studentService.list({ search: q, statusCategory: cat || null, page }), [q, cat, page]);
  return (
    <FitPage title="Students" subtitle={list.data ? `${list.data.total} records in the directory` : 'Student directory'} action={can('students.manage') && <AddButton onClick={() => setAdding(true)} label="Add student" />}
      summary={<div className="grid grid-cols-2 sm:grid-cols-3 gap-2"><div className="rounded-xl border border-[#E3DBB8] bg-white px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-slate-500">Showing</div><div className="text-lg font-bold text-[#1F6B45]">{list.data?.rows.length ?? '—'}</div></div><div className="rounded-xl border border-[#E3DBB8] bg-white px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-slate-500">Total matches</div><div className="text-lg font-bold text-[#23382B]">{list.data?.total ?? '—'}</div></div><div className="hidden sm:block rounded-xl border border-[#E3DBB8] bg-[#FBF8EA] px-3 py-2"><div className="text-[10px] uppercase tracking-wide text-slate-500">Current filter</div><div className="text-sm font-semibold text-[#5C4A12]">{FILTERS.find((x) => x.value === cat)?.label || 'All'}</div></div></div>}
      toolbar={<div className="space-y-2"><SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Search name or admission number" /><FilterChips options={FILTERS} value={cat} onChange={(v) => { setCat(v); setPage(0); }} /></div>}>
      {list.error && <Notice tone="bad">{list.error}</Notice>}
      {list.loading && !list.data ? <LoadingBlock /> : (list.data?.rows.length === 0 ? <EmptyBlock>No students match. {can('students.manage') && 'Add the first one with the button above.'}</EmptyBlock> :
        <CardGrid>{list.data?.rows.map((s) => (
          <DataCard key={s.student_id} thumb={<Avatar person={s} size={44} />} title={fullName(s)} subtitle={[s.admission_no, s.class_name && `${s.class_name}${s.stream_name ? ` · ${s.stream_name}` : ''}`].filter(Boolean).join(' · ') || 'Not enrolled'}
            pill={<StatusPill category={s.status_category} label={s.status_label} />}>
            <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-[#F0EACF]">
              <Link to={`${basePath}/students/${s.student_id}`} className="inline-flex items-center min-h-[34px] text-sm font-semibold text-[#1F6B45] underline underline-offset-2">View profile →</Link>
              <span className="text-xs text-slate-500 truncate text-right">{s.primary_guardian_name ? `${s.primary_guardian_name}${s.primary_guardian_phone ? ` · ${displayPhone(s.primary_guardian_phone)}` : ''}` : 'No guardian'}</span>
            </div>
          </DataCard>))}</CardGrid>)}
      {list.data && <Pager page={page} total={list.data.total} pageSize={list.data.pageSize} onPage={setPage} />}
      {adding && <StudentFormSheet statuses={statuses.data || []} onClose={() => setAdding(false)} onSaved={() => list.reload()} />}
    </FitPage>
  );
}
