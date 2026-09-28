// src/pos-erp/offline/ConnectionStatus.jsx
//
// Automatic, never manual (brief section 11): there is NO online/offline
// switch anywhere. useNetStatus() probes the network; this component
// only reports what it finds and drains the queue when the way is clear.
// Offline is presented as a normal working state, not an error.
//
//   Online, nothing waiting         ● Online
//   Online, just synced             ● Online · Up to date      (a few seconds)
//   Offline                         ● Offline · Everything is saved
//   Offline, sales waiting          ● Offline · 3 sales saved
//   Back online, sending            ↻ Updating · 3 sales
//   Something the server rejected   ● 1 sale needs attention
//
// Only sales are queued today (outbox kind 'sale', see syncEngine.js),
// so the count is worded as sales. If another kind is ever added to the
// outbox this wording needs to grow with it.
//
// No sync jargon in what the owner sees -- no "queue", "conflict",
// "idempotency". Those words live in the code, not the UI.

import React, { useEffect, useState, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { useNetStatus } from './useNetStatus';
import { runSync, countPending } from './syncEngine';
import { db } from './db';

const salesWord = (n) => `${n} sale${n === 1 ? '' : 's'}`;

export default function ConnectionStatus() {
  const { isOnline, pendingCount, refreshPendingCount } = useNetStatus();
  const [phase, setPhase] = useState('idle'); // 'idle' | 'syncing' | 'justUpdated'
  const [syncingCount, setSyncingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);

  const refreshFailed = useCallback(async () => {
    try { setFailedCount(await db.outbox.where('status').equals('FAILED').count()); } catch { /* Dexie not ready yet */ }
  }, []);

  const trySync = useCallback(async () => {
    if (!isOnline) return;
    const pendingNow = await countPending();
    if (pendingNow === 0) { refreshFailed(); return; }
    setSyncingCount(pendingNow);
    setPhase('syncing');
    const result = await runSync();
    await refreshPendingCount();
    await refreshFailed();
    if (!result.skipped && result.synced > 0) {
      setPhase('justUpdated');
      setTimeout(() => setPhase('idle'), 4000);
    } else {
      setPhase('idle');
    }
  }, [isOnline, refreshPendingCount, refreshFailed]);

  useEffect(() => { trySync(); }, [isOnline, trySync]);

  // Keep the "N sales saved" count live while OFFLINE too. Nothing else
  // refreshes it then (trySync only runs online), so without this the
  // pill would still say "Everything is saved" after the 3rd offline
  // sale. offlineSaleService fires 'pos-outbox-changed' the instant it
  // queues a sale; the slow interval is only a safety net.
  useEffect(() => {
    const refreshBoth = () => { refreshPendingCount(); refreshFailed(); };
    refreshBoth();
    window.addEventListener('pos-outbox-changed', refreshBoth);
    const id = setInterval(refreshBoth, 5000);
    return () => { window.removeEventListener('pos-outbox-changed', refreshBoth); clearInterval(id); };
  }, [refreshPendingCount, refreshFailed]);

  // Periodic nudge -- covers "the browser said online before Supabase was
  // actually reachable" without the owner needing to know a retry exists.
  useEffect(() => {
    const id = setInterval(trySync, 20000);
    return () => clearInterval(id);
  }, [trySync]);

  // FAILED rows are counted inside pendingCount too (they still need the
  // owner). "Waiting" below excludes them so the wording stays honest.
  const waiting = Math.max(0, pendingCount - failedCount);

  let dot = 'bg-[#237A52]';
  let tone = 'bg-[#237A52]/10 text-[#1B5138] border-[#237A52]/25';
  let content;

  if (phase === 'syncing') {
    tone = 'bg-[#C6A15B]/15 text-[#7a5f1f] border-[#C6A15B]/40';
    content = (
      <>
        <RefreshCw size={12} className="animate-spin shrink-0" />
        <span>Updating{syncingCount > 0 && <span className="hidden sm:inline"> · {salesWord(syncingCount)}</span>}</span>
      </>
    );
  } else if (!isOnline) {
    dot = 'bg-[#C6A15B]';
    tone = 'bg-[#C6A15B]/15 text-[#7a5f1f] border-[#C6A15B]/40';
    content = (
      <>
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        {waiting > 0 ? (
          <>
            <span className="hidden sm:inline">Offline · {salesWord(waiting)} saved</span>
            <span className="sm:hidden">Offline · {waiting}</span>
          </>
        ) : (
          <>
            <span className="hidden sm:inline">Offline · Everything is saved</span>
            <span className="sm:hidden">Offline</span>
          </>
        )}
      </>
    );
  } else if (failedCount > 0) {
    dot = 'bg-red-500';
    tone = 'bg-red-50 text-red-700 border-red-200';
    content = (
      <>
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span>{salesWord(failedCount)} <span className="hidden sm:inline">need{failedCount === 1 ? 's' : ''} attention</span></span>
      </>
    );
  } else if (waiting > 0) {
    // Online but not yet sent (the next nudge will send them).
    content = (
      <>
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span>Online<span className="hidden sm:inline"> · {salesWord(waiting)} to send</span></span>
      </>
    );
  } else if (phase === 'justUpdated') {
    content = (
      <>
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span>Online<span className="hidden sm:inline"> · Up to date</span></span>
      </>
    );
  } else {
    content = (
      <>
        <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
        <span>Online</span>
      </>
    );
  }

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-full border whitespace-nowrap shrink-0 ${tone}`}
    >
      {content}
    </span>
  );
}
