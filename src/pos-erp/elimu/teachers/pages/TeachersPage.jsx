// elimu/teachers/pages/TeachersPage.jsx -- every teacher at a glance, to compare. School management only (the database enforces it).
import React, { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { FitPage, LoadingBlock, Notice, fieldClass } from '../../services/platform.js';
import { useAsync } from '../../hooks/useAsync.js';
import { PersonCard, EmptyNote, StatPill, V } from '../../ui/cards/index.js';
import { teacherService, pts, pctText } from '../services/teacherService.js';
import { listCsv, download } from '../services/teacherExport.js';

const SORTS = { name: 'Name', mean: 'Best average', load: 'Heaviest load' };

export default function TeachersPage({ basePath = '/school' }) {
  const [term, setTerm] = useState(''); const [sort, setSort] = useState('name'); const [q, setQ] = useState('');
  const r = useAsync(() => teacherService.list(term), [term]); const [dlErr, setDlErr] = useState('');
  const run = async (fn) => { setDlErr(''); try { await fn(); } catch { setDlErr('We could not save the file. Please try again.'); } };
  const d = r.data; const rows = useMemo(() => {
    const list = (d?.teachers || []).filter((t) => !q || t.name.toLowerCase().includes(q.toLowerCase()));
    const by = { name: (a, b) => a.name.localeCompare(b.name), mean: (a, b) => (b.mean ?? -1) - (a.mean ?? -1), load: (a, b) => b.lessons_per_week - a.lessons_per_week || b.learners - a.learners };
    return [...list].sort(by[sort]);
  }, [d, sort, q]);
  return (
    <FitPage title="Teachers" icon={Users} subtitle="Classes, results, activities and pay for each teacher">
      {r.error && !d && <Notice tone="bad">{r.error}</Notice>}
      {dlErr && <Notice tone="bad">{dlErr}</Notice>}
      {r.loading && !d && <LoadingBlock />}
      {d && (<div className="space-y-3">
        <div className="flex flex-wrap gap-2 items-center">
          <select aria-label="Term" className={`${fieldClass} !w-auto`} value={term || d.term?.id || ''} onChange={(e) => setTerm(e.target.value)}>{(d.terms || []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <input aria-label="Find a teacher" className={`${fieldClass} !w-auto flex-1 min-w-[140px]`} placeholder="Find a teacher" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5">{Object.entries(SORTS).map(([k, l]) => <button key={k} type="button" onClick={() => setSort(k)} aria-pressed={sort === k} className="min-h-[36px] px-3 rounded-full text-xs font-semibold" style={{ background: sort === k ? V.primary : V.soft, color: sort === k ? '#fff' : V.text }}>{l}</button>)}</div>
        <div className="flex flex-wrap items-center gap-1.5"><button type="button" className="min-h-[36px] px-3 rounded-full text-xs font-semibold border bg-white" style={{ borderColor: V.border }} onClick={() => run(() => download(`teachers-${(d.term?.name || 'term').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`, listCsv({ ...d, teachers: rows }), 'text/csv;charset=utf-8'))}>Download CSV</button><StatPill label="teachers" value={rows.length} /><StatPill label="lead an activity" value={rows.filter((t) => t.leads > 0).length} /></div>
        {rows.length === 0 ? <EmptyNote title="No teachers to show yet">Teachers appear here once they are given classes and subjects under Teacher allocations.</EmptyNote> : (
          <div className="space-y-3">{rows.map((t) => (
            <PersonCard key={t.id} name={t.name} to={`${basePath}/teachers/${t.id}`}
              meta={[t.class_teacher_of?.length ? `Class teacher: ${t.class_teacher_of.join(', ')}` : null, `${t.subjects} subject${t.subjects === 1 ? '' : 's'}`, `${t.learners} learners`, t.lessons_per_week ? `${t.lessons_per_week} lessons/week` : null, t.activities ? `${t.activities} activit${t.activities === 1 ? 'y' : 'ies'}` : null].filter(Boolean).join(' - ')}
              aside={t.mean != null ? <span>{pctText(t.mean)}{t.change != null && <span className="ml-1.5 text-[11px]" style={{ color: Number(t.change) < 0 ? V.bad : V.primary }}>{pts(t.change)}</span>}</span> : <span style={{ color: V.muted }}>no results</span>} />))}</div>)}
        <p className="text-xs" style={{ color: V.muted }}>Averages come from this term's finished subject results, weighted by the number of learners in each class taught.</p>
      </div>)}
    </FitPage>);
}
