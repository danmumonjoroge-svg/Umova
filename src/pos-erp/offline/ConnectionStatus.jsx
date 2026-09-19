// src/pos-erp/offline/ConnectionStatus.jsx
//
// Brief section 26 -- exact wording:
//   Online:        green Online
//   Offline:       orange Offline -- Everything is saved
//   Synchronizing: spinner Updating
//   Complete:      green Updated
//   Optional: "Last updated: 10:42 AM" / "7 transactions waiting to sync."
//
// No technical sync terminology anywhere in what's shown -- no "queue",
// "conflict", "idempotency". Those words exist in the code, not the UI.

import React, { useEffect, useState, useCallback } from 'react';
import { Cloud, CloudOff, RefreshCw, CheckCircle2 } from 'lucide-react';
import { useNetStatus } from './useNetStatus';
import { runSync, countPending } from './syncEngine';

export default function ConnectionStatus() {
  const { isOnline, pendingCount, refreshPendingCount } = useNetStatus();
  const [phase, setPhase] = useState('idle'); // 'idle' | 'syncing' | 'justUpdated'
  const [lastUpdated, setLastUpdated] = useState(null);

  const trySync = useCallback(async () => {
    if (!isOnline) return;
    const pendingNow = await countPending();
    if (pendingNow === 0) return;
    setPhase('syncing');
    const result = await runSync();
    await refreshPendingCount();
    if (!result.skipped) {
      setLastUpdated(new Date());
      setPhase('justUpdated');
      setTimeout(() => setPhase('idle'), 2500);
    } else {
      setPhase('idle');
    }
  }, [isOnline, refreshPendingCount]);

  useEffect(() => { trySync(); }, [isOnline, trySync]);

  // Periodic nudge -- covers "came back online but the browser 'online'
  // event fired before Supabase was actually reachable" and similar edge
  // cases, without the owner needing to know a retry mechanism exists.
  useEffect(() => {
    const id = setInterval(trySync, 20000);
    return () => clearInterval(id);
  }, [trySync]);

  let content;
  if (phase === 'syncing') {
    content = <><RefreshCw size={13} className="animate-spin" /> Updating</>;
  } else if (phase === 'justUpdated') {
    content = <><CheckCircle2 size={13} /> Updated</>;
  } else if (!isOnline) {
    content = <><CloudOff size={13} /> Offline — Everything is saved</>;
  } else {
    content = <><Cloud size={13} /> Online</>;
  }

  const tone = !isOnline ? 'bg-amber-50 text-amber-700 border-amber-200'
    : phase === 'syncing' ? 'bg-sky-50 text-sky-700 border-sky-200'
    : 'bg-emerald-50 text-emerald-700 border-emerald-200';

  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap ${tone}`}>
        {content}
      </span>
      {pendingCount > 0 && phase !== 'syncing' && (
        <span className="text-[11px] text-slate-400 hidden sm:inline">
          {pendingCount} transaction{pendingCount === 1 ? '' : 's'} waiting to sync
        </span>
      )}
      {lastUpdated && phase === 'idle' && pendingCount === 0 && (
        <span className="text-[11px] text-slate-400 hidden lg:inline">
          Last updated: {lastUpdated.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
        </span>
      )}
    </div>
  );
}
