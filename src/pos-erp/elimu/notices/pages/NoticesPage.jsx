// elimu/notices/pages/NoticesPage.jsx -- the school notice board. Everyone on staff reads it; people who may send messages post to their audience.
import React, { useState } from 'react';
import { Megaphone } from 'lucide-react';
import { FitPage, LoadingBlock, EmptyBlock, Notice, Sheet, fieldClass } from '../../services/platform.js';
import { useAsync } from '../../hooks/useAsync.js';
import { useElimuAccess } from '../../hooks/useElimu.js';
import { setupService } from '../../services/ElimuSetupService.js';
import { materialService } from '../../materials/services/materialService.js';
import { noticeService, noticeProblems, AUDIENCES, AUDIENCE_LABEL } from '../services/noticeService.js';
import { friendlyError } from '../../utils/validation.js';

const btnP = 'min-h-[44px] px-4 rounded-xl text-sm font-semibold bg-[#1F6B45] text-white disabled:opacity-50';
const btnS = 'min-h-[40px] px-3 rounded-xl text-xs font-semibold border border-[#E3DBB8] bg-white text-[#23382B]';
const day = (v) => new Date(v).toLocaleDateString('en-KE', { day: 'numeric', month: 'short' });

function PostSheet({ audiences, classes, onClose, onDone }) {
  const [f, setF] = useState({ title: '', body: '', audience: audiences[0][0], classId: classes[0]?.id || '', important: false, expires: '', publishFrom: '' }); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })); const probs = noticeProblems(f);
  const send = async () => { setBusy(true); setErr(''); try { await noticeService.post(f); onDone(); } catch (e) { setErr(friendlyError(e)); } setBusy(false); };
  return (
    <Sheet title="Post a notice" onClose={onClose}><div className="space-y-3">{err && <Notice tone="bad">{err}</Notice>}
      <label className="text-xs block">Who is it for<select className={fieldClass} value={f.audience} onChange={set('audience')}>{audiences.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      {f.audience === 'CLASS' && <label className="text-xs block">Class<select className={fieldClass} value={f.classId} onChange={set('classId')}>{classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
      <input className={fieldClass} placeholder="Title" value={f.title} onChange={set('title')} />
      <textarea className={fieldClass} rows={5} placeholder="Write the notice" value={f.body} onChange={set('body')} />
      <div className="grid grid-cols-2 gap-2"><label className="text-xs block">Show from (optional)<input type="datetime-local" className={fieldClass} value={f.publishFrom} onChange={set('publishFrom')} /></label><label className="text-xs block">Hide after (optional)<input type="date" className={fieldClass} value={f.expires} onChange={set('expires')} /></label></div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.important} onChange={set('important')} /> Mark as important (shown first)</label>
      <button type="button" className={btnP} disabled={busy || probs.length > 0} onClick={send}>{busy ? 'Posting...' : 'Post notice'}</button>{(f.title || f.body) && probs[0] && <p className="text-xs text-[#6F7461]">{probs[0]}</p>}
      <p className="text-xs text-[#6F7461]">Parents see it in their portal. To send an SMS as well, use Messages to parents.</p></div></Sheet>
  );
}

export default function NoticesPage() {
  const { can } = useElimuAccess(); const canPost = can('comms.send') || can('comm.send'); const mgmt = can('settings.manage') || can('marks.manage_all') || can('admissions.manage');
  const [tick, setTick] = useState(0); const [old, setOld] = useState(false); const [open, setOpen] = useState(false); const [msg, setMsg] = useState(''); const [err, setErr] = useState('');
  const board = useAsync(() => noticeService.board(old), [tick, old]);
  const classes = useAsync(() => (mgmt ? setupService.classes() : materialService.scopes().then((s) => Array.from(new Map((s || []).map((x) => [x.class_id, { id: x.class_id, name: x.class_name }])).values()))), [mgmt]);
  const audiences = mgmt ? AUDIENCES : AUDIENCES.filter(([k]) => k === 'CLASS'); const classList = classes.data || [];
  const withdraw = async (n) => { if (!window.confirm(`Withdraw "${n.title}"? It will no longer be shown.`)) return; try { await noticeService.withdraw(n.id); setMsg('Withdrawn.'); setTick((x) => x + 1); } catch (e) { setErr(friendlyError(e)); } };
  const rows = board.data || [];
  return (
    <FitPage title="Notices" icon={Megaphone} subtitle="Circulars to parents and staff">
      <div className="space-y-3">{msg && <Notice tone="good">{msg}</Notice>}{err && <Notice tone="bad">{err}</Notice>}
        <div className="flex items-center justify-between gap-2"><label className="text-xs flex items-center gap-1.5"><input type="checkbox" checked={old} onChange={(e) => setOld(e.target.checked)} /> Show old and scheduled</label>
          {canPost && (mgmt || classList.length > 0) && <button type="button" className={btnP} onClick={() => setOpen(true)}>Post a notice</button>}</div>
        {board.loading ? <LoadingBlock /> : board.error ? <Notice tone="bad">{friendlyError(board.error)}</Notice> : rows.length === 0 ? <EmptyBlock title="No notices right now" /> : (
          <ul className="space-y-2">{rows.map((n) => (
            <li key={n.id} className={`rounded-2xl border bg-white p-3 text-sm ${n.important ? 'border-[#C98A1B]' : 'border-[#E3DBB8]'}`}>
              <div className="flex justify-between gap-2"><b>{n.important ? '! ' : ''}{n.title}</b><span className="text-xs text-[#6F7461] shrink-0">{n.class_name || AUDIENCE_LABEL[n.audience]}</span></div>
              <div className="text-xs whitespace-pre-line mt-1">{n.body}</div>
              <div className="text-xs text-[#6F7461] mt-1">{n.posted_by || 'School'} · {day(n.publish_from)}{n.expires_on ? ` · until ${day(n.expires_on)}` : ''}{n.status === 'WITHDRAWN' ? ' · withdrawn' : !n.live ? ' · not live' : ''}</div>
              {n.can_withdraw && <button type="button" className={`${btnS} mt-2`} onClick={() => withdraw(n)}>Withdraw</button>}
            </li>))}</ul>)}
      </div>
      {open && <PostSheet audiences={audiences} classes={classList} onClose={() => setOpen(false)} onDone={() => { setOpen(false); setMsg('Notice posted. Parents can see it in their portal.'); setTick((x) => x + 1); }} />}
    </FitPage>
  );
}
