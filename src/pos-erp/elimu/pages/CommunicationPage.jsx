// Communication hub: the prepared-work queue (events that need a person), recent history, and per-event switches.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { FitPage, LoadingBlock, EmptyBlock, Notice } from '../services/platform.js';
import { communicationService } from '../communication/ElimuCommunicationService.js';
import { useAsync } from '../hooks/useAsync.js';
import { useElimuAccess } from '../hooks/useElimu.js';
import { CommunicationHistory } from '../components/ElimuCommunicationPanel.jsx';
import { EVENTS } from '../communication/notificationCatalog.js';
import { formatDateTime } from '../utils/format.js';
import { friendlyError } from '../utils/validation.js';

export default function CommunicationPage({ basePath = '/elimu' }) {
  const { can } = useElimuAccess(); const [tab, setTab] = useState('queue');
  const q = useAsync(() => (can('comms.send') ? communicationService.queue() : Promise.resolve([])), []);
  const rules = useAsync(() => (can('comms.send') ? communicationService.rules() : Promise.resolve([])), []);
  const [err, setErr] = useState(null);
  const resolve = async (id, st) => { try { await communicationService.resolveQueueItem(id, st); q.reload(); } catch (e) { setErr(friendlyError(e)); } };
  const toggle = async (r) => { try { await communicationService.setRule(r.id, !r.is_active); rules.reload(); } catch (e) { setErr(friendlyError(e)); } };
  const pendingCount = (q.data || []).length;
  const activeRules = (rules.data || []).filter((r) => r.is_active).length;
  return (
    <FitPage title="Communication" subtitle="Review work, message history and reminder rules">
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-xl border border-[#E3DBB8] bg-white p-3"><div className="text-[11px] uppercase tracking-wide text-slate-500">Prepared work</div><div className="text-2xl font-semibold text-[#1F6B45]">{q.loading && !q.data ? '—' : pendingCount}</div><div className="text-xs text-slate-500">Not sent automatically</div></div>
        <div className="rounded-xl border border-[#E3DBB8] bg-white p-3"><div className="text-[11px] uppercase tracking-wide text-slate-500">Active reminder rules</div><div className="text-2xl font-semibold text-[#1F6B45]">{rules.loading && !rules.data ? '—' : activeRules}</div><div className="text-xs text-slate-500">Create review reminders</div></div>
      </div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex gap-1">{[['queue', 'To do'], ['history', 'History'], ['rules', 'Reminders']].map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 min-h-[40px] rounded-full text-sm ${tab === k ? 'bg-[#1F6B45] text-white' : 'bg-white border border-[#E3DBB8]'}`}>{l}</button>)}</div>
        <button type="button" className="px-3 min-h-[40px] rounded-lg border border-[#E3DBB8] text-sm" onClick={() => { q.reload(); rules.reload(); }}>Refresh</button>
      </div>
      <div className="mb-3 rounded-xl border border-[#E3DBB8] bg-[#FBF8EA] px-3 py-2 text-xs text-[#6F7461]">Messages are prepared for staff review. Opening a phone app is not proof of sending; provider delivery appears only when confirmed by the provider.</div>
      {err && <Notice tone="bad">{err}</Notice>}
      {q.error && <Notice tone="bad">Could not load the prepared-work queue: {friendlyError(q.error)}</Notice>}
      {rules.error && <Notice tone="bad">Could not load reminder rules: {friendlyError(rules.error)}</Notice>}
      {tab === 'queue' && (q.loading && !q.data ? <LoadingBlock /> : (q.data || []).length === 0 ? <EmptyBlock>Nothing waiting. When an application is decided or a student is admitted, a reminder to tell the family appears here.</EmptyBlock> :
        <ul className="space-y-2">{q.data.map((n) => (
          <li key={n.id} className="bg-white border border-[#E3DBB8] rounded-xl p-3"><div className="text-sm font-medium">{n.title}</div><div className="text-[11px] text-slate-500 mb-2">{EVENTS[n.event_type]?.label || n.event_type} · {formatDateTime(n.created_at)}</div>
            <div className="flex gap-2 text-sm">{n.application_id ? <Link className="px-3 min-h-[40px] rounded-lg bg-[#1F6B45] text-white flex items-center" to={`${basePath}/admissions`}>Open application</Link> : n.student_id && <Link className="px-3 min-h-[40px] rounded-lg bg-[#1F6B45] text-white flex items-center" to={`${basePath}/students/${n.student_id}`}>Open student</Link>}
              <button type="button" className="px-3 min-h-[40px] rounded-lg border border-[#E3DBB8]" onClick={() => resolve(n.id, 'ACTIONED')}>Done</button><button type="button" className="px-3 min-h-[40px] rounded-lg text-slate-500" onClick={() => resolve(n.id, 'DISMISSED')}>Skip</button></div></li>))}</ul>)}
      {tab === 'history' && <CommunicationHistory />}
      {tab === 'rules' && <div className="bg-white border border-[#E3DBB8] rounded-xl divide-y divide-[#EFE8C8]">{(rules.data || []).map((r) => <label key={r.id} className="flex items-center justify-between px-3 py-3 text-sm"><span>{EVENTS[r.event_type]?.label || r.event_type}<span className="block text-[11px] text-slate-500">Adds a reminder to tell the guardian</span></span><input type="checkbox" checked={r.is_active} disabled={!can('settings.manage')} onChange={() => toggle(r)} aria-label={EVENTS[r.event_type]?.label} /></label>)}</div>}
    </FitPage>
  );
}
