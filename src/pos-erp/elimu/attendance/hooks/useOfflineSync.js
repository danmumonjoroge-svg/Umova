// elimu/attendance/hooks/useOfflineSync.js -- drains queued attendance work when the connection returns; reports honest status.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getOfflineAttendance } from '../services/offlineAttendance';
import { attendanceService } from '../services/attendanceService';
import { guardianComms } from '../../communication/attendance/guardianComms';
import { useElimu } from '../../shared/hooks/ElimuContext';

export function useOfflineSync() {
  const { tenantId, businessId, userId } = useElimu();
  const [summary, setSummary] = useState({ pending: 0, needsAttention: 0, synced: 0, total: 0 });
  const [syncing, setSyncing] = useState(false); const busy = useRef(false);
  const refresh = useCallback(async () => { if (!tenantId) return; const q = await getOfflineAttendance(); setSummary(await q.summary(tenantId)); }, [tenantId]);
  const syncNow = useCallback(async () => {
    if (!tenantId || busy.current || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
    busy.current = true; setSyncing(true);
    try {
      const q = await getOfflineAttendance();
      const r = await q.drain({ tenantId, handlers: {
        marks: (p) => attendanceService.saveMarks(p.sessionId, p.marks, 'OFFLINE'),
        submit: (p) => attendanceService.submit(p.sessionId, p.confirmUnmarked),
        message: guardianComms.syncQueued({ tenantId, businessId, userId }),
      } });
      await refresh(); return r;
    } finally { busy.current = false; setSyncing(false); }
  }, [tenantId, businessId, userId, refresh]);
  useEffect(() => { refresh(); syncNow(); const on = () => syncNow(); window.addEventListener('online', on); return () => window.removeEventListener('online', on); }, [refresh, syncNow]);
  return { ...summary, syncing, syncNow, refresh };
}
