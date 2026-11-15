// src/pos-erp/hooks/useNotifications.js

import { useState, useEffect, useCallback } from 'react';
import { notificationsService } from '../services/notificationsService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

export function useNotifications() {
  const { tenant, posStaffId } = usePosErpAuth();
  const [notifications, setNotifications] = useState([]);
  const [readKeys, setReadKeys] = useState(() => new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ctx = { tenantId: tenant?.id, businessId: tenant?.business_id };
      const [data, keys] = await Promise.all([
        notificationsService.getAll(ctx),
        notificationsService.getReadKeys({ tenantId: tenant?.id, staffId: posStaffId }).catch(() => new Set()),
      ]);
      setNotifications(data);
      setReadKeys(keys);
    } catch (err) {
      console.error('[useNotifications] fetch failed:', err);
      setError(err.message || 'Failed to load notifications.');
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, [tenant, posStaffId]);

  useEffect(() => { fetch(); }, [fetch]);

  const markRead = useCallback(async (keys) => {
    setReadKeys((prev) => new Set([...prev, ...keys]));
    try { await notificationsService.markRead({ tenantId: tenant?.id, staffId: posStaffId, keys }); } catch { /* read state is a convenience */ }
  }, [tenant, posStaffId]);

  const unread = notifications.filter((n) => !readKeys.has(n.id));
  // `count` stays the number needing attention (unread), so the bell badge clears once you have looked.
  return { notifications, readKeys, count: unread.length, loading, error, refetch: fetch, markRead };
}
