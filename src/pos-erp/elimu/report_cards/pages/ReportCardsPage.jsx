// elimu/report_cards/pages/ReportCardsPage.jsx — generate, remark, review, approve, publish, print (one / selected / class / stream),
// notify guardians, and open a correction for a published card. Every rule is enforced by the database; this page only offers the buttons.
import React, { useMemo, useState } from 'react';
import { FileText, Printer, Bell } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, SearchBox, Pill, FilterChips } from '../../../components/CardKit';
import Sheet from '../../../components/workspace/Sheet';
import { useLoad } from '../../../components/network/networkKit';
import { usePosErpAuth } from '../../../auth/usePosErpAuth';
import { reportCardService, STATUS_LABEL, NEXT_ACTIONS } from '../services/reportCardService';
import { printReportCards, printClassReportCards } from '../services/printReportCards';
import { useScope } from '../../academic/hooks/useScope';
import ScopeBar from '../../academic/components/ScopeBar';
import AccessGate from '../../academic/components/AccessGate';
import NotifyGuardiansSheet from '../../communication/academic/NotifyGuardiansSheet';
import Note from '../../academic/components/Note';

const TONE = { DRAFT: 'neutral', REVIEW: 'warn', APPROVED: 'good', PUBLISHED: 'good', SUPERSEDED: 'neutral' };
export default function ReportCardsPage() {
  const { tenant } = usePosErpAuth(); const s = useScope(); const { scope } = s;
  const [status, setStatus] = useState(''); const [search, setSearch] = useState(''); const [page, setPage] = useState(0); const [sel, setSel] = useState(new Set());
  const [msg, setMsg] = useState(null); const [remarks, setRemarks] = useState(null); const [notify, setNotify] = useState(null); const [busy, setBusy] = useState(false);
  const ready = scope.yearId && scope.termId && scope.classId;
  const list = useLoad(() => (ready ? reportCardService.listCards({ ...scope, status, search, page }) : Promise.resolve({ rows: [], total: 0, counts: {} })), [scope.yearId, scope.termId, scope.classId, scope.streamId, status, search, page]);
  const rows = list.data?.rows || []; const ids = useMemo(() => [...sel], [sel]);
  const toggle = (id) => setSel((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const run = async (fn, ok) => { setBusy(true); setMsg(null); try { const r = await fn(); setMsg({ tone: r?.ok === false ? 'warn' : 'good', text: r?.message || (typeof ok === 'function' ? ok(r) : ok) }); list.reload(); } catch (e) { setMsg({ tone: 'bad', text: e.message }); } finally { setBusy(false); } };
  const bulk = (to, label) => run(async () => { const reason = to === 'REVIEW' && rows.some((r) => ids.includes(r.card_id) && r.status === 'APPROVED') ? window.prompt('Reason?') : null; return reportCardService.bulkTransition(ids, to, { reason }); },
    (r) => `${label}: ${r.succeeded} done${r.failed ? `, ${r.failed} could not be moved (${(r.results.find((x) => !x.ok) || {}).message || 'see each card'})` : ''}.`);
  const filters = [{ key: '', label: 'All' }, ...Object.keys(STATUS_LABEL).filter((k) => k !== 'SUPERSEDED').map((k) => ({ key: k, label: STATUS_LABEL[k], count: list.data?.counts?.[k] ?? null }))];
  return (
    <FitPage title="Report cards" subtitle="Draft → review → approved → published" icon={FileText} toolbar={<div className="space-y-2"><ScopeBar s={s} /><FilterChips options={filters} value={status} onChange={(v) => { setPage(0); setStatus(v); }} /></div>}
      action={<AccessGate need="results.compute">{() => ready ? <button disabled={busy} onClick={() => run(() => reportCardService.generateCards(scope), (r) => `${r.created} report card${r.created === 1 ? '' : 's'} created.`)} className="text-xs font-bold text-white bg-[#1F6B45] rounded-lg px-3 min-h-[36px]">Create cards</button> : null}</AccessGate>}>
      <AccessGate need={null}>{(a) => (<>
        {msg && <Note tone={msg.tone}>{msg.text}</Note>}
        {!ready ? <EmptyBlock>Choose a class.</EmptyBlock> : (
          <div className="flex flex-wrap items-center gap-2 mb-2"><div className="flex-1 min-w-[150px]"><SearchBox value={search} onChange={(v) => { setPage(0); setSearch(v); }} placeholder="Search name or admission no." /></div>
            <button className="text-xs underline" onClick={() => setSel(new Set(rows.map((r) => r.card_id)))}>Select page</button><button className="text-xs underline" onClick={() => setSel(new Set())}>Clear</button></div>)}
        {ids.length > 0 && (
          <div className="sticky top-0 z-10 flex flex-wrap gap-1.5 items-center bg-[#FBF7E4] border border-[#E3DBB8] rounded-xl p-2 mb-2 text-xs"><b>{ids.length} selected</b>
            <button className="underline inline-flex items-center gap-1" onClick={() => run(() => printReportCards(ids, { tenantId: tenant?.id }), (n) => `Sent ${n} to print.`)}><Printer size={12} />Print</button>
            {a.can('reportcard.review') && <button className="underline" onClick={() => bulk('REVIEW', 'Sent to review')}>Send to review</button>}
            {a.can('reportcard.approve') && <button className="underline" onClick={() => bulk('APPROVED', 'Approved')}>Approve</button>}
            {a.can('reportcard.publish') && <button className="underline" onClick={() => bulk('PUBLISHED', 'Published')}>Publish</button>}
            {a.can('comm.send') && <button className="underline inline-flex items-center gap-1" onClick={() => setNotify(ids)}><Bell size={12} />Notify guardians</button>}</div>)}
        {ready && <div className="flex gap-3 mb-2 text-xs"><button className="underline" onClick={() => run(() => printClassReportCards({ ...scope, tenantId: tenant?.id }), (n) => `Sent ${n} report cards to print.`)}>Print whole {scope.streamId ? 'stream' : 'class'}</button></div>}
        {list.loading && <LoadingBlock />}{list.error && <Note tone="bad">{list.error.message}</Note>}
        <div className="space-y-1.5">{rows.map((r) => (
          <div key={r.card_id} className="flex flex-wrap items-center gap-2 bg-white border border-[#E3DBB8] rounded-xl p-2.5">
            <input type="checkbox" checked={sel.has(r.card_id)} onChange={() => toggle(r.card_id)} aria-label={`Select ${r.student_name}`} />
            <div className="min-w-0 flex-1 text-sm"><b>{r.student_name}</b> <span className="text-xs text-[#6F7461]">{r.admission_number}</span>
              <div className="text-xs text-[#6F7461]">{r.mean_percentage != null ? `${r.mean_percentage}% · ${r.overall_grade ?? '—'}` : 'No grade yet'}{r.class_position ? ` · position ${r.class_position}/${r.class_size}` : ''}{r.revision_no > 1 ? ` · correction (rev ${r.revision_no})` : ''}{!r.is_complete ? ' · incomplete' : ''}</div></div>
            <Pill tone={TONE[r.status]}>{STATUS_LABEL[r.status]}</Pill>
            {['DRAFT', 'REVIEW'].includes(r.status) && <button className="text-xs underline" onClick={() => setRemarks(r)}>Remarks</button>}
            {(NEXT_ACTIONS[r.status] || []).map((n) => (a.can(n.to === 'REVIEW' || n.to === 'DRAFT' ? 'reportcard.review' : n.to === 'APPROVED' ? 'reportcard.approve' : 'reportcard.publish') || (r.status === 'DRAFT' && n.to === 'REVIEW')) &&
              <button key={n.to} disabled={busy} className="text-xs font-bold text-[#1F6B45] underline" onClick={() => run(async () => { const reason = n.needsReason ? window.prompt('Reason?') : null; if (n.needsReason && !reason) return { ok: false, message: 'Cancelled.' }; const res = await reportCardService.transition(r.card_id, n.to, { reason, allowIncomplete: false }); if (res.code === 'INCOMPLETE_RESULTS' && window.confirm(`${res.message} Send to review anyway?`)) return reportCardService.transition(r.card_id, n.to, { allowIncomplete: true }); return res; }, `${r.student_name}: ${STATUS_LABEL[n.to]}.`)}>{n.label}</button>)}
            {r.status === 'PUBLISHED' && a.can('reportcard.correct') && <button className="text-xs underline text-[#A3352A]" onClick={() => { const reason = window.prompt('Why does this published report card need correcting?'); if (reason) run(() => reportCardService.openCorrection(r.card_id, reason), 'Correction opened as a new draft. The published copy stays visible until the corrected one is published.'); }}>Correct…</button>}
            <button className="text-xs underline" onClick={() => run(() => printReportCards([r.card_id], { tenantId: tenant?.id }), 'Sent to print.')}>Print</button>
          </div>))}
          {ready && list.data && !rows.length && <EmptyBlock>No report cards yet. Calculate results, then “Create cards”.</EmptyBlock>}</div>
        {list.data && list.data.total > 50 && <div className="flex justify-between mt-2 text-xs"><button disabled={page === 0} onClick={() => setPage(page - 1)}>← Previous</button><span>Page {page + 1}</span><button disabled={(page + 1) * 50 >= list.data.total} onClick={() => setPage(page + 1)}>Next →</button></div>}
        {remarks && <RemarksSheet row={remarks} a={a} onClose={() => { setRemarks(null); list.reload(); }} />}
        {notify && <NotifyGuardiansSheet cardIds={notify} onClose={() => setNotify(null)} />}
      </>)}</AccessGate>
    </FitPage>
  );
}

function RemarksSheet({ row, a, onClose }) {
  const [ct, setCt] = useState(''); const [head, setHead] = useState(''); const [msg, setMsg] = useState(null);
  const go = async (fn) => { setMsg(null); try { await fn(); setMsg({ tone: 'good', text: 'Saved.' }); } catch (e) { setMsg({ tone: 'bad', text: e.message }); } };
  return (
    <Sheet title={`Remarks: ${row.student_name}`} onClose={onClose}>
      <label className="block text-xs text-[#6F7461] mb-2">Class teacher's remarks<textarea rows={3} className="w-full border border-[#E3DBB8] rounded-xl p-2 text-sm" value={ct} onChange={(e) => setCt(e.target.value)} /></label>
      <button className="text-sm font-semibold text-white bg-[#1F6B45] rounded-lg px-3 min-h-[38px] mb-3" onClick={() => go(() => reportCardService.saveClassTeacherRemarks(row.card_id, ct))}>Save class teacher remarks</button>
      {a.can('remarks.head') && <><label className="block text-xs text-[#6F7461] mb-2">Head teacher's remarks<textarea rows={3} className="w-full border border-[#E3DBB8] rounded-xl p-2 text-sm" value={head} onChange={(e) => setHead(e.target.value)} /></label>
        <button className="text-sm font-semibold text-white bg-[#1F6B45] rounded-lg px-3 min-h-[38px]" onClick={() => go(() => reportCardService.saveHeadRemarks(row.card_id, head))}>Save head teacher remarks</button></>}
      {msg && <div className="mt-2"><Note tone={msg.tone}>{msg.text}</Note></div>}
    </Sheet>
  );
}
