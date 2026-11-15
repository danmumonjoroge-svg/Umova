// elimu/report_cards/pages/TermResultsPage.jsx — calculate and inspect term results for a class/stream. Incomplete subjects are explained, never graded.
import React, { useState } from 'react';
import { Award } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, SearchBox, Pill } from '../../../components/CardKit';
import { useLoad } from '../../../components/network/networkKit';
import { reportCardService } from '../services/reportCardService';
import { useScope } from '../../academic/hooks/useScope';
import ScopeBar from '../../academic/components/ScopeBar';
import AccessGate from '../../academic/components/AccessGate';
import Note from '../../academic/components/Note';

export default function TermResultsPage() {
  const s = useScope(); const { scope } = s; const [search, setSearch] = useState(''); const [page, setPage] = useState(0); const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false);
  const ready = scope.yearId && scope.termId && scope.classId;
  const list = useLoad(() => (ready ? reportCardService.listResults({ ...scope, search, page }) : Promise.resolve({ rows: [], total: 0 })), [scope.yearId, scope.termId, scope.classId, scope.streamId, search, page]);
  const compute = async () => {
    setBusy(true); setMsg(null);
    try { const r = await reportCardService.computeResults(scope); setMsg({ tone: r.incomplete ? 'warn' : 'good', text: `${r.students} students: ${r.complete} complete, ${r.incomplete} incomplete${r.skipped_locked ? `, ${r.skipped_locked} approved (left unchanged)` : ''}.` }); list.reload(); }
    catch (e) { setMsg({ tone: 'bad', text: e.message }); } finally { setBusy(false); }
  };
  return (
    <FitPage title="Term results" subtitle="Calculated from submitted marks" icon={Award} toolbar={<ScopeBar s={s} />}
      action={<AccessGate need="results.compute">{() => ready ? <button disabled={busy} onClick={compute} className="text-xs font-bold text-white bg-[#1F6B45] rounded-lg px-3 min-h-[36px] disabled:opacity-50">{busy ? 'Calculating…' : 'Calculate results'}</button> : null}</AccessGate>}>
      <AccessGate need={null}>
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        {!ready && <EmptyBlock>Choose a class to see its results.</EmptyBlock>}
        {ready && <div className="mb-2"><SearchBox value={search} onChange={(v) => { setPage(0); setSearch(v); }} placeholder="Search name or admission no." /></div>}
        {list.loading && <LoadingBlock />}{list.error && <Note tone="bad">{list.error.message}</Note>}
        {list.data && <div className="overflow-x-auto bg-white border border-[#E3DBB8] rounded-xl"><table className="w-full text-sm min-w-[560px]"><thead className="bg-[#FBF7E4] text-[11px] uppercase text-[#6F7461]"><tr><th className="px-2 py-2 text-left">Pos</th><th className="px-2 text-left">Adm.</th><th className="px-2 text-left">Student</th><th className="px-2 text-right">Mean %</th><th className="px-2 text-center">Grade</th><th className="px-2 text-left">Subjects</th><th className="px-2 text-left">Card</th></tr></thead>
          <tbody>{list.data.rows.map((r) => <tr key={r.term_result_id} className="border-t border-[#F0E9C8]"><td className="px-2 py-1.5">{r.class_position ?? '—'}</td><td className="px-2 font-mono text-xs">{r.admission_number}</td><td className="px-2">{r.student_name}</td>
            <td className="px-2 text-right tabular-nums">{r.mean_percentage ?? '—'}</td><td className="px-2 text-center font-bold">{r.overall_grade ?? '—'}</td>
            <td className="px-2">{r.is_complete ? <Pill tone="good">Complete</Pill> : <Pill tone="warn">{r.subjects_complete}/{r.subjects_expected} complete</Pill>}{r.locked && <Pill>Locked</Pill>}</td><td className="px-2 text-xs">{r.report_card?.status || '—'}</td></tr>)}
            {!list.data.rows.length && <tr><td colSpan={7} className="text-center text-[#6F7461] py-5">No results calculated yet. Use “Calculate results”.</td></tr>}</tbody></table></div>}
        {list.data && list.data.total > 50 && <div className="flex justify-between mt-2 text-xs"><button disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous</button><span>Page {page + 1}</span><button disabled={(page + 1) * 50 >= list.data.total} onClick={() => setPage(page + 1)}>Next →</button></div>}
      </AccessGate>
    </FitPage>
  );
}
