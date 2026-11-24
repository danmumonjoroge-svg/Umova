// Progress report (staff): pick a student; see every term result and every finished assessment, with the progress graph.
import React, { useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, SearchBox } from '../../../components/CardKit';
import { useLoad } from '../../../components/network/networkKit';
import AccessGate from '../../academic/components/AccessGate';
import Note from '../../academic/components/Note';
import ProgressView from '../../shared/components/ProgressChart';
import { studentService } from '../../services/ElimuStudentService';
import { examScheduleService } from '../../academic/services/examScheduleService';

export default function ProgressReportPage() {
  const [search, setSearch] = useState(''); const [pick, setPick] = useState(null);
  const found = useLoad(() => (search.trim().length >= 2 ? studentService.list({ search }) : Promise.resolve({ rows: [] })), [search]);
  const prog = useLoad(() => (pick ? examScheduleService.progress(pick.id) : Promise.resolve(null)), [pick?.id]);
  return (
    <FitPage title="Progress report" subtitle="Every exam a student has done, with a progress graph" icon={TrendingUp}>
      <AccessGate>{() => (
        <div className="space-y-3">
          {!pick ? (<>
            <SearchBox value={search} onChange={setSearch} placeholder="Search by name or admission number" />
            {search.trim().length < 2 ? <EmptyBlock>Type at least two letters of the student's name or their admission number.</EmptyBlock>
              : found.loading ? <LoadingBlock /> : (found.data?.rows || []).length === 0 ? <EmptyBlock>No student matches.</EmptyBlock> : (
                <ul className="space-y-2">{found.data.rows.map((r) => (<li key={r.id}><button type="button" onClick={() => setPick(r)} className="w-full text-left rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-3 min-h-[56px]"><div className="font-semibold">{r.full_name}</div><div className="text-xs text-[#6F7461]">{r.admission_no || 'No admission no.'}{r.class_name ? ` · ${r.class_name}` : ''}</div></button></li>))}</ul>)}
          </>) : (<>
            <div className="flex items-center justify-between"><div><div className="font-bold">{pick.full_name}</div><div className="text-xs text-[#6F7461]">{pick.admission_no}</div></div>
              <button type="button" onClick={() => setPick(null)} className="px-3 min-h-[38px] rounded-lg border border-[#E3DBB8] text-sm">Change student</button></div>
            <Note tone="warn">Staff see every finished and open mark; parents only see published report cards and locked exams.</Note>
            {prog.loading ? <LoadingBlock /> : prog.error ? <Note tone="bad">{prog.error.message}</Note> : <ProgressView data={prog.data} />}
          </>)}
        </div>)}
      </AccessGate>
    </FitPage>);
}
