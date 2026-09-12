// src/pos-erp/hooks/useNotifications.js

import { useState, useEffect, useCallback } from 'react';
import { notificationsService } from '../services/notificationsService';

export function useNotifications() {
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await notificationsService.getAll();
      setNotifications(data);
    } catch (err) {
      console.error('[useNotifications] fetch failed:', err);
      setError(err.message || 'Failed to load notifications.');
      setNotifications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  return { notifications, count: notifications.length, loading, error, refetch: fetch };
}
