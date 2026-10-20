// src/pos-erp/offline/OfflinePageGate.jsx
//
// With no internet, a page that needs the server used to show raw errors or an endless spinner. This stands in front of the
// pages and, ONLY when the phone itself says it is offline, shows a plain message instead -- with a way to carry on selling,
// and an "Open anyway" for the rare case the phone is wrong about being offline.
//
// Which pages work offline is a list. Today:
//   * OFFLINE_READY_PATHS      -- Sell: reads AND writes work with no internet (sales are saved on the phone and sent later).
//   * OFFLINE_READ_ONLY_PATHS  -- look-only pages: they show the copy saved on the phone (see offline/readThrough.js and
//                                 warmCache.js). Anything that changes data on them still needs internet until that action
//                                 is made offline-capable. A banner says so, with when the copy was saved.
// Every other page needs the server to calculate or save, and says so honestly instead of showing zeros or errors.

import React, { useEffect, useState } from 'react';
import { getMeta } from './db';
import { Link, useLocation } from 'react-router-dom';
import { WifiOff } from 'lucide-react';

export const OFFLINE_READY_PATHS = ['/pos'];
export const OFFLINE_READ_ONLY_PATHS = ['/pos/products', '/pos/inventory', '/pos/expenses', '/pos/suppliers', '/pos/customers'];
const OFFLINE_PAGES = [
  { to: '/pos', label: 'Sell' }, { to: '/pos/products', label: 'My Items (look only)' }, { to: '/pos/inventory', label: 'My Stock (look only)' },
  { to: '/pos/expenses', label: 'My Spending (look only)' }, { to: '/pos/suppliers', label: 'Suppliers (look only)' }, { to: '/pos/customers', label: 'Customers (look only)' },
];

function useBrowserOnline() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

export const normalisePath = (p) => (p || '').replace(/\/+$/, '') || '/';

export function isOfflineReady(pathname) {
  const p = normalisePath(pathname);
  return OFFLINE_READY_PATHS.includes(p) || OFFLINE_READ_ONLY_PATHS.includes(p);
}
export function isReadOnlyOffline(pathname) {
  return OFFLINE_READ_ONLY_PATHS.includes(normalisePath(pathname));
}

function SavedCopyBanner() {
  const [when, setWhen] = useState(undefined);
  useEffect(() => { getMeta('lastWarmedAt').then((v) => setWhen(v || null)).catch(() => setWhen(null)); }, []);
  const text = when === undefined ? '' : when
    ? `Saved on this phone: ${new Date(when).toLocaleString()}. It may not show the newest changes.`
    : 'No saved copy time is known. What you see may be old.';
  return (
    <div role="status" className="mx-3 mt-3 rounded-xl border border-[#C6A15B]/40 bg-[#C6A15B]/15 px-3 py-2 text-xs text-[#5c4713]">
      <div className="font-semibold">No internet: you can look, but not change anything here yet.</div>
      {text && <div className="mt-0.5">{text}</div>}
    </div>
  );
}

export default function OfflinePageGate({ children }) {
  const { pathname } = useLocation();
  const online = useBrowserOnline();
  const [openAnyway, setOpenAnyway] = useState(null);

  if (online || openAnyway === pathname) return children;
  if (isOfflineReady(pathname)) {
    return isReadOnlyOffline(pathname) ? (<><SavedCopyBanner />{children}</>) : children;
  }

  return (
    <div className="p-6 max-w-md mx-auto text-center">
      <div className="w-12 h-12 rounded-full bg-[#C6A15B]/15 text-[#7a5f1f] flex items-center justify-center mx-auto mb-3"><WifiOff size={22} /></div>
      <h2 className="text-lg font-bold text-[#26352D]">This page needs internet</h2>
      <p className="text-sm text-[#68756D] mt-1">
        You can keep selling. Everything you sell is saved on this phone and sent by itself when the internet is back.
      </p>
      <p className="text-xs text-[#68756D] mt-3">Pages that work without internet:</p>
      <div className="flex flex-wrap gap-2 justify-center mt-2">
        {OFFLINE_PAGES.map((p) => (
          <Link key={p.to} to={p.to} className="min-h-[40px] inline-flex items-center px-3 rounded-lg bg-[#F7F6F0] text-xs font-semibold text-[#26352D]">{p.label}</Link>
        ))}
      </div>
      <div className="flex flex-col gap-2 mt-4">
        <Link to="/pos" className="min-h-[48px] inline-flex items-center justify-center bg-[#237A52] text-white font-semibold rounded-xl">Go to Sell</Link>
        <button onClick={() => setOpenAnyway(pathname)} className="min-h-[44px] text-sm font-semibold text-[#26352D] bg-[#F7F6F0] rounded-xl">Open anyway</button>
      </div>
    </div>
  );
}
