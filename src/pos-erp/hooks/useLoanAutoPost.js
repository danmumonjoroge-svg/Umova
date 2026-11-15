// src/pos-erp/hooks/useLoanAutoPost.js
//
// "Post on the due date" without a server job: whenever the app opens (and when it comes back to the front), bring every
// auto-pay loan instalment whose date has come up to date. Each one is dated on its DUE date, so the books are right even if
// nobody opened the app that day. Safe to run often: the database never posts one twice. Silent on failure (offline, or the
// loan tables not installed yet): nothing here may ever get in the way of selling.

import { useEffect } from 'react';
import { loanService } from '../services/loanService';
import { isOfflineNow } from '../offline/netErrors';

let lastRun = 0;
const EVERY_MS = 30 * 60 * 1000;

export function useLoanAutoPost({ businessId, allowed }) {
  useEffect(() => {
    if (!businessId || !allowed) return undefined;
    const run = async () => {
      if (isOfflineNow() || Date.now() - lastRun < EVERY_MS) return;
      lastRun = Date.now();
      try { await loanService.postDue(businessId); } catch (e) { console.warn('[loans] auto-post skipped:', e?.message || e); }
    };
    run();
    const onShow = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, [businessId, allowed]);
}
