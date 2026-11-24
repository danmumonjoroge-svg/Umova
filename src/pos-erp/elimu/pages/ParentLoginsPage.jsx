// Registration > Guardians > Parent logins: give a parent access, reset a lost password, pause or resume. The one-time password is shown once.
import React, { useState } from 'react';
import { FitPage, LoadingBlock, EmptyBlock, Notice, SearchBox, Sheet, saveBtnCls } from '../services/platform.js';
import { parentAccessService, handoverText } from '../services/ElimuParentAccessService.js';
import { useAsync } from '../hooks/useAsync.js';
import { useElimuAccess } from '../hooks/useElimu.js';
import { friendlyError } from '../utils/validation.js';
import { formatDate } from '../utils/format.js';

function Handover({ r, onClose }) {
  const text = handoverText(r, typeof window !== 'undefined' ? window.location.origin : '');
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(text); setCopied(true); } catch { setCopied(false); } };
  return (
    <Sheet title={`Login for ${r.name}`} onClose={onClose}>
      <Notice tone="warn">Show or send this now. The password is not kept anywhere, so if it is lost you will need to reset it.</Notice>
      <pre className="mt-3 whitespace-pre-wrap rounded-xl bg-[#FBF8EA] border border-[#E3DBB8] p-3 text-sm">{text}</pre>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <button type="button" className={saveBtnCls} onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
        <a className="min-h-[44px] flex items-center justify-center rounded-xl border border-[#E3DBB8] bg-white text-sm font-semibold" target="_blank" rel="noreferrer" href={`https://wa.me/?text=${encodeURIComponent(text)}`}>WhatsApp</a>
      </div>
    </Sheet>);
}

export default function ParentLoginsPage() {
  const { can } = useElimuAccess(); const manage = can('guardians.manage');
  const r = useAsync(() => parentAccessService.list(), []);
  const [q, setQ] = useState(''); const [busy, setBusy] = useState(''); const [err, setErr] = useState(''); const [given, setGiven] = useState(null);
  const rows = (r.data || []).filter((x) => !q || `${x.name} ${(x.children || []).join(' ')} ${x.username || ''}`.toLowerCase().includes(q.toLowerCase()));
  const run = async (id, fn) => { setBusy(id); setErr(''); try { const out = await fn(); if (out?.temp_password) setGiven(out); r.reload(); } catch (e) { setErr(friendlyError(e)); } finally { setBusy(''); } };
  const none = (r.data || []).filter((x) => !x.created).length;
  return (
    <FitPage title="Parent logins" subtitle={r.data ? `${none} parent${none === 1 ? '' : 's'} without a login` : ''} toolbar={<SearchBox value={q} onChange={setQ} placeholder="Parent, child or username" />}>
      {err && <Notice tone="bad">{err}</Notice>}
      {r.loading && !r.data ? <LoadingBlock /> : rows.length === 0 ? <EmptyBlock>No parents found. Link guardians to learners first.</EmptyBlock> : (
        <div className="space-y-2">{rows.map((x) => (
          <div key={x.guardian_id} className="rounded-2xl bg-white border border-[#E3DBB8] p-3">
            <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="font-semibold">{x.name}</div><div className="text-xs text-slate-500">{(x.children || []).join(', ')}</div></div>
              <span className={`text-[11px] font-semibold rounded-full px-2 py-1 ${!x.created ? 'bg-slate-100 text-slate-600' : x.status === 'PAUSED' ? 'bg-amber-100 text-amber-800' : 'bg-[#E4F0E8] text-[#1F6B45]'}`}>{!x.created ? 'No login' : x.status === 'PAUSED' ? 'Paused' : x.must_change ? 'Not signed in yet' : 'Active'}</span></div>
            {x.created && <div className="text-xs text-slate-500 mt-1">Username <b>{x.username}</b>{x.last_signin_at ? ` · last sign-in ${formatDate(x.last_signin_at)}` : ''}</div>}
            {manage && <div className="flex gap-2 mt-2">
              {!x.created
                ? <button type="button" disabled={busy === x.guardian_id} className={`${saveBtnCls} flex-1`} onClick={() => run(x.guardian_id, () => parentAccessService.issue(x.guardian_id, !!x.username))}>Give access</button>
                : <>
                  <button type="button" disabled={busy === x.guardian_id} className="flex-1 min-h-[44px] rounded-xl border border-[#E3DBB8] bg-white text-sm font-semibold" onClick={() => run(x.guardian_id, () => parentAccessService.issue(x.guardian_id, true))}>Reset password</button>
                  <button type="button" disabled={busy === x.guardian_id} className="flex-1 min-h-[44px] rounded-xl border border-[#E3DBB8] bg-white text-sm font-semibold" onClick={() => run(x.guardian_id, () => parentAccessService.setPaused(x.guardian_id, x.status !== 'PAUSED'))}>{x.status === 'PAUSED' ? 'Resume' : 'Pause'}</button></>}
            </div>}
          </div>))}</div>)}
      {given && <Handover r={given} onClose={() => setGiven(null)} />}
    </FitPage>);
}
