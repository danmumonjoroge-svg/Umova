// elimu/app/notifications/useNotifications.js -- feeds the bell and the notifications page.
// Built-in providers (dashboard counts + the prepared-message queue) plus any module's registered notificationProviders.
// Each provider is independent and silent on failure. Nothing sends a message.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { notificationItems } from '../../communication/notificationCatalog.js';
import { studentService } from '../../services/ElimuStudentService.js';
import { communicationService } from '../../communication/ElimuCommunicationService.js';
import { notificationProviders } from '../../registry.js';
import { useAsync } from '../../hooks/useAsync.js';
import { collectNotifications, mergeNotifications, seenKey, unseenCount } from './notificationBus.js';

const readSeen = (k) => { try { return new Set(JSON.parse(localStorage.getItem(k) || '[]')); } catch { return new Set(); } };
const writeSeen = (k, ids) => { try { localStorage.setItem(k, JSON.stringify([...ids].slice(-300))); } catch { /* private mode: fine */ } };

/** Core Elimu items: who needs a message, data gaps, new applications. */
export function coreProvider(base) {
  return async ({ can }) => {
    const [summary, queue] = await Promise.all([
      can('students.view') ? studentService.dashboard().catch(() => null) : null,
      can('comms.history') ? communicationService.queue().catch(() => []) : [],
    ]);
    return notificationItems({ summary, queue: queue || [], basePath: base });
  };
}

export function useNotifications({ base, can, schoolId, userId, enabled = true }) {
  const key = seenKey(schoolId, userId);
  const { data, loading, reload } = useAsync(async () => {
    if (!enabled) return [];
    return collectNotifications([coreProvider(base), ...notificationProviders()], { can, base });
  }, [enabled, base, schoolId, userId]);
  const items = useMemo(() => mergeNotifications(data || []), [data]);
  const [seen, setSeen] = useState(() => readSeen(key));
  useEffect(() => { setSeen(readSeen(key)); }, [key]);
  const markAllSeen = useCallback(() => { const next = new Set([...seen, ...items.map((i) => i.id)]); setSeen(next); writeSeen(key, next); }, [seen, items, key]);
  return { items, loading, unseen: unseenCount(items, seen), seen, markAllSeen, reload };
}
