// elimu/app/notifications/NotificationsPage.jsx -- every notification in one list (the bell shows the same items).
import React from 'react';
import { PageContainer, EmptyState, LoadingState } from '../shell/states.jsx';
import { NotificationList } from './NotificationBell.jsx';
import { useElimuShell } from '../shell/ElimuShell.jsx';

export default function NotificationsPage() {
  const { notifications } = useElimuShell();
  const { items, loading, seen, reload } = notifications;
  return (
    <PageContainer title="Notifications" subtitle="Work waiting for a person. Nothing here has been sent." actions={<button type="button" onClick={reload} className="h-10 rounded-xl border border-[#D9D2B4] bg-white px-3 text-sm font-semibold">Refresh</button>}>
      {loading && !items.length ? <LoadingState /> : items.length ? <div className="rounded-2xl border border-[#E3DBB8] bg-white px-4"><NotificationList items={items} seen={seen} /></div> : <EmptyState title="You're all caught up" hint="Nothing needs your attention right now." />}
    </PageContainer>
  );
}
