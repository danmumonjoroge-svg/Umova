// elimu/app/notifications/NotificationBell.jsx -- the bell in the app bar: a count of things not yet looked at, and a sheet listing them.
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell } from 'lucide-react';
import AppSheet from '../../components/AppSheet.jsx';
import { badgeText } from './notificationBus.js';
import { EmptyState, LoadingState } from '../shell/states.jsx';

export const TONE_DOT = { warn: 'bg-amber-500', info: 'bg-sky-500', ok: 'bg-emerald-500' };

export function NotificationList({ items, onNavigate, seen }) {
  return (
    <ul className="divide-y divide-[#EEE8CE]">
      {items.map((n) => {
        const body = (<><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[n.tone] || TONE_DOT.info}`} /><span className="min-w-0"><span className={`block text-sm ${seen?.has(n.id) ? 'text-[#5A6B5E]' : 'font-semibold text-[#23382B]'}`}>{n.title}</span>{n.detail && <span className="block text-xs text-[#6F7461]">{n.detail}</span>}</span></>);
        return <li key={n.id}>{n.to ? <Link to={n.to} onClick={onNavigate} className="flex gap-3 py-3 active:bg-black/5">{body}</Link> : <div className="flex gap-3 py-3">{body}</div>}</li>;
      })}
    </ul>
  );
}

export default function NotificationBell({ base, notifications }) {
  const [open, setOpen] = useState(false);
  const { items, unseen, loading, seen, markAllSeen } = notifications;
  const show = () => { setOpen(true); markAllSeen(); };
  const text = badgeText(unseen);
  return (
    <>
      <button type="button" onClick={show} aria-label="Notifications" aria-haspopup="dialog" className="relative flex h-10 w-10 items-center justify-center rounded-full active:bg-white/10">
        <Bell size={19} />{text && <span className="absolute right-0.5 top-0.5 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#C9A227] px-1 text-[10px] font-bold text-[#12261F]" aria-label={`${unseen} new`}>{text}</span>}
      </button>
      {open && (
        <AppSheet title="Notifications" onClose={() => setOpen(false)}>
          <div className="px-4 pb-4">
            {loading && !items.length ? <LoadingState /> : items.length ? <NotificationList items={items} seen={seen} onNavigate={() => setOpen(false)} /> : <EmptyState title="You're all caught up" hint="Nothing needs your attention right now." />}
            <Link to={`${base}/notifications`} onClick={() => setOpen(false)} className="mt-3 block rounded-xl border border-[#D9D2B4] py-3 text-center text-sm font-semibold text-[#173D2A]">See all notifications</Link>
          </div>
        </AppSheet>
      )}
    </>
  );
}
