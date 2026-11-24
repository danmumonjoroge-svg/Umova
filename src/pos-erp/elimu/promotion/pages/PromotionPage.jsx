// elimu/promotion/pages/PromotionPage.jsx -- year-end promotion. Choose the ending and starting years, adjust each class, apply.
// Promote / Repeat enrol the student in the new year; Graduate closes the student's record as Graduated; Hold changes nothing yet.
import React, { useMemo, useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { FitPage, LoadingBlock, Notice, fieldClass } from '../../services/platform.js';
import { ConfirmSheet } from '../../shared/components/kit.jsx';
import { useAsync } from '../../hooks/useAsync.js';
import { setupService } from '../../services/ElimuSetupService.js';
import { promotionService, defaultDecisions, decisionList, tally } from '../services/promotionService.js';
import { friendlyError } from '../../utils/validation.js';

const btnP = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#1F6B45] text-white disabled:opacity-50';
const btnS = 'min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[#E3DBB8] bg-white text-[#23382B] disabled:opacity-50';
const ACTIONS = [['PROMOTE', 'Promote'], ['REPEAT', 'Repeat'], ['GRADUATE', 'Graduate'], ['HOLD', 'Hold']];

export default function PromotionPage() {
  const years = useAsync(() => setupService.years(), []);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [preview, setPreview] = useState(null); const [dec, setDec] = useState({}); const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [confirm, setConfirm] = useState(false);
  const list = years.data || [];
  const fromId = from || list.find((y) => y.status === 'CURRENT')?.id || ''; const toId = to || list.filter((y) => y.id !== fromId && y.status !== 'CLOSED').sort((a, b) => a.start_date.localeCompare(b.start_date)).find((y) => y.start_date > (list.find((x) => x.id === fromId)?.start_date || ''))?.id || '';
  const counts = useMemo(() => tally(dec), [dec]); const toSend = useMemo(() => decisionList(dec), [dec]);
  const className = (id) => preview?.class_options?.find((c) => c.id === id)?.name || '';

  const load = async () => {
    setErr(''); setRes(null); setBusy(true);
    try { const p = await promotionService.preview(fromId, toId); setPreview(p); setDec(defaultDecisions(p)); } catch (x) { setErr(friendlyError(x)); setPreview(null); }
    setBusy(false);
  };
  const setOne = (id, patch) => setDec((d) => ({ ...d, [id]: { ...d[id], ...patch } }));
  const setClassAll = (c, action) => setDec((d) => { const n = { ...d }; for (const s of c.students) if (!s.placed) n[s.student_id] = { action, class_id: action === 'PROMOTE' ? (n[s.student_id]?.class_id || c.next_class_id) : null }; return n; });
  const setClassDest = (c, classId) => setDec((d) => { const n = { ...d }; for (const s of c.students) if (!s.placed && n[s.student_id]?.action === 'PROMOTE') n[s.student_id] = { action: 'PROMOTE', class_id: classId }; return n; });
  const apply = async () => {
    setBusy(true); setErr('');
    try { setRes(await promotionService.apply(fromId, toId, toSend)); setConfirm(false); setPreview(null); } catch (x) { setErr(friendlyError(x)); setConfirm(false); }
    setBusy(false);
  };

  return (
    <FitPage title="Promotion & class changes" subtitle="Move students up at the end of the year" icon={ArrowUpRight}>
      <div className="space-y-3">
        {err && <Notice tone="bad">{err}</Notice>}
        {res && (<Notice tone="good">Done: {res.promoted} promoted, {res.repeated} repeating, {res.graduated} graduated{res.held > 0 ? `, ${res.held} held` : ''}.
          {res.skipped.length > 0 && <ul className="mt-1 list-disc pl-4 text-xs">{res.skipped.map((s, i) => <li key={i}>{s.name || 'Student'}: {s.reason}</li>)}</ul>}</Notice>)}

        {!preview && (
          <div className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-3 space-y-3">
            <div className="text-sm font-semibold">1. Choose the years</div>
            {years.loading && !years.data ? <LoadingBlock /> : (<div className="grid sm:grid-cols-2 gap-2">
              <label className="block text-xs text-[#6F7461]">Year that is ending<select className={`${fieldClass} mt-1`} value={fromId} onChange={(e) => setFrom(e.target.value)}><option value="">Choose…</option>{list.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label>
              <label className="block text-xs text-[#6F7461]">Year that is starting<select className={`${fieldClass} mt-1`} value={toId} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{list.filter((y) => y.status !== 'CLOSED').map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}</select></label></div>)}
            <p className="text-xs text-[#6F7461]">Set up the new academic year and its terms first (Settings). You will see every enrolled student by class and can change each one before anything is saved. Fees are not billed by promotion; bill the new term in Finance as usual.</p>
            <button type="button" className={`${btnP} w-full`} disabled={busy || !fromId || !toId || fromId === toId} onClick={load}>{busy ? 'Loading…' : 'Show students'}</button>
          </div>)}

        {preview && (<div className="space-y-3">
          <div className="text-sm"><b>{preview.from_year}</b> → <b>{preview.to_year}</b></div>
          {(preview.classes || []).length === 0 && <Notice tone="gold">No enrolled students were found in {preview.from_year}.</Notice>}
          {(preview.classes || []).map((c) => (
            <section key={c.class_id} className="rounded-[18px] border border-[#E3DBB8] bg-white shadow-[0_1px_2px_rgba(18,38,31,.06),0_6px_14px_-8px_rgba(18,38,31,.18)] p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2"><div className="font-semibold">{c.name} <span className="text-xs font-normal text-[#6F7461]">{c.students.length} students</span></div>
                <label className="text-xs text-[#6F7461] flex items-center gap-1">Promote to<select className={`${fieldClass} !h-9 !py-0`} value={dec[c.students.find((s) => !s.placed)?.student_id]?.class_id || c.next_class_id || ''} onChange={(e) => setClassDest(c, e.target.value)}><option value="">—</option>{preview.class_options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label></div>
              <div className="flex flex-wrap gap-1.5">{ACTIONS.map(([k, l]) => <button key={k} type="button" className={btnS} onClick={() => setClassAll(c, k)}>All {l.toLowerCase()}</button>)}</div>
              <ul className="divide-y divide-[#EFE9CF]">{c.students.map((s) => (
                <li key={s.student_id} className="py-1.5 flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{s.name} <span className="text-xs text-[#6F7461]">{s.admission_no}{s.stream ? ` · ${s.stream}` : ''}</span></span>
                  {s.placed ? <span className="text-xs text-emerald-800">Already placed in {preview.to_year}</span> : (
                    <span className="flex items-center gap-1.5"><select aria-label="Action" className={`${fieldClass} !h-9 !py-0 !w-28`} value={dec[s.student_id]?.action || 'HOLD'} onChange={(e) => setOne(s.student_id, { action: e.target.value, class_id: e.target.value === 'PROMOTE' ? (dec[s.student_id]?.class_id || c.next_class_id) : null })}>{ACTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                      {dec[s.student_id]?.action === 'PROMOTE' && <span className="text-xs text-[#6F7461]">→ {className(dec[s.student_id].class_id) || 'next class'}</span>}</span>)}
                </li>))}</ul>
            </section>))}
          <div className="grid grid-cols-4 gap-2 text-center text-xs">{ACTIONS.map(([k, l]) => <div key={k} className="rounded-xl border border-[#E3DBB8] bg-white p-2"><div className="text-lg font-bold">{counts[k] || 0}</div>{l}</div>)}</div>
          <div className="flex gap-2"><button type="button" className={btnS} disabled={busy} onClick={() => setPreview(null)}>Back</button><button type="button" className={`${btnP} flex-1`} disabled={busy || toSend.length === 0} onClick={() => setConfirm(true)}>Apply to {toSend.length} student{toSend.length === 1 ? '' : 's'}</button></div>
        </div>)}
      </div>
      {confirm && <ConfirmSheet title="Apply this promotion?" confirmLabel="Apply" busy={busy} onConfirm={apply} onCancel={() => setConfirm(false)}>
        <p>{counts.PROMOTE} promoted, {counts.REPEAT} repeating, {counts.GRADUATE} graduating{counts.HOLD ? `, ${counts.HOLD} held (not changed)` : ''}.</p><p>Old enrolments are marked completed and kept. Graduated students are closed as Graduated. A mistake is corrected by moving the student's enrolment, so check the list first.</p></ConfirmSheet>}
    </FitPage>);
}
