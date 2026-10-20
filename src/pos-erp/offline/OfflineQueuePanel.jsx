// src/pos-erp/offline/OfflineQueuePanel.jsx
//
// "Saved on this phone" -- opened by tapping the connection pill. Shows everything that was done with no internet and
// whether the server has it yet, in the owner's words. This is how the owner SEES that nothing was lost, and how a refused
// sale ("Needs attention") is read, retried, or set aside. Nothing here is hidden behind a developer word.

import React, { useCallback, useEffect, useState } from 'react';
import { X, RefreshCw } from 'lucide-react';
import { listQueue, retryFailed, setAsideFailed, needsSignIn } from './syncEngine';
import { describeRow, saleTotal } from './queueLabels';
import { usePosErpAuth } from '../auth/usePosErpAuth';

const TONES = {
  amber: 'bg-[#C6A15B]/15 text-[#7a5f1f] border-[#C6A15B]/40',
  green: 'bg-[#237A52]/10 text-[#1B5138] border-[#237A52]/25',
  red: 'bg-red-50 text-red-700 border-red-200',
  grey: 'bg-slate-100 text-slate-600 border-slate-200',
};

export default function OfflineQueuePanel({ onClose, onSendNow, isOnline, busy }) {
  const { tenant, isAdmin, staffName } = usePosErpAuth();
  const [rows, setRows] = useState([]);
  const [signInNeeded, setSignInNeeded] = useState(false);
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    try { setRows(await listQueue({ tenantId: tenant?.id })); setSignInNeeded(await needsSignIn()); } catch { /* storage not ready */ }
  }, [tenant?.id]);

  useEffect(() => {
    load();
    window.addEventListener('pos-outbox-changed', load);
    const t = setInterval(load, 4000);
    return () => { window.removeEventListener('pos-outbox-changed', load); clearInterval(t); };
  }, [load]);

  const unsent = rows.filter(r => r.status === 'PENDING' || r.status === 'SYNCING');
  const waitingValue = unsent.filter(r => r.kind === 'sale').reduce((s, r) => s + saleTotal(r.payload), 0);
  const shown = rows.filter(r => r.status !== 'SYNCED').concat(rows.filter(r => r.status === 'SYNCED').slice(0, 10));

  const retry = async (id) => { await retryFailed(id); setMsg('Will try again now.'); onSendNow?.(); load(); };
  const setAside = async (d) => {
    if (!window.confirm('Set this aside? It will NOT be sent. Only do this if the sale was a mistake or has been entered again by hand. It stays on this list as a record.')) return;
    try { await setAsideFailed(d.id, { by: staffName || null, note: 'Set aside by staff' }); setMsg('Set aside.'); } catch (e) { setMsg(e.message); }
    load();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-label="Saved on this phone">
      <div className="bg-white w-full sm:max-w-lg max-h-[88vh] flex flex-col rounded-t-2xl sm:rounded-2xl border border-[#DDE3DD]">
        <div className="flex items-start justify-between gap-3 p-4 border-b border-[#DDE3DD]">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-[#26352D]">Saved on this phone</h2>
            <p className="text-sm text-[#68756D]">
              {unsent.length === 0
                ? 'Everything has been sent. Nothing is waiting.'
                : `${unsent.length} waiting to be sent${waitingValue > 0 ? ` · KES ${waitingValue.toLocaleString()} in sales` : ''}. They are safe and will send by themselves when there is internet.`}
            </p>
          </div>
          <button onClick={onClose} className="p-2 -m-2 text-[#26352D]" aria-label="Close"><X size={20} /></button>
        </div>

        {signInNeeded && (
          <div className="mx-4 mt-3 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
            Your sign-in has run out. Sign in again (with internet) and the saved items will be sent.
          </div>
        )}
        {msg && <div className="mx-4 mt-3 text-sm bg-slate-50 border border-slate-200 text-slate-700 rounded-lg px-3 py-2">{msg}</div>}

        <div className="overflow-y-auto p-4 space-y-2">
          {shown.length === 0 && <p className="text-sm text-[#68756D] text-center py-6">Nothing saved on this phone yet.</p>}
          {shown.map((row) => {
            const d = describeRow(row);
            return (
              <div key={row.id} className="border border-[#DDE3DD] rounded-xl p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-[#26352D] text-sm">{d.title}</div>
                    {d.detail && <div className="text-xs text-[#68756D] mt-0.5 break-words">{d.detail}</div>}
                    <div className="text-xs text-[#68756D] mt-0.5">{d.at ? new Date(d.at).toLocaleString() : ''}{d.ref ? ` · ${d.ref}` : ''}</div>
                  </div>
                  <span className={`shrink-0 text-xs font-semibold px-2 py-1 rounded-full border ${TONES[d.tone]}`}>{d.statusLabel}</span>
                </div>
                {d.status === 'FAILED' && (
                  <div className="mt-2 text-xs text-red-700 bg-red-50 rounded-lg px-2 py-1.5">
                    The server did not accept this{d.error ? `: ${d.error}` : '.'} The sale itself is still recorded here.
                    <div className="flex gap-2 mt-2">
                      {d.canRetry && <button onClick={() => retry(d.id)} className="min-h-[36px] px-3 bg-white border border-red-200 rounded-lg font-semibold">Try again</button>}
                      {d.canSetAside && isAdmin && <button onClick={() => setAside(d)} className="min-h-[36px] px-3 bg-white border border-slate-300 text-slate-700 rounded-lg font-semibold">Set aside</button>}
                      {d.canSetAside && !isAdmin && <span className="self-center text-slate-600">Ask the owner or manager to look at this.</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t border-[#DDE3DD]">
          <button
            onClick={() => { onSendNow?.(); load(); }}
            disabled={!isOnline || busy || unsent.length === 0}
            className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 bg-[#237A52] disabled:bg-slate-300 text-white font-semibold rounded-xl"
          >
            <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
            {isOnline ? 'Send now' : 'Waiting for internet'}
          </button>
        </div>
      </div>
    </div>
  );
}
