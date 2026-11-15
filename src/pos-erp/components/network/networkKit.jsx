// src/pos-erp/components/network/networkKit.jsx
// Small shared pieces for the My Business Network screens. Uses the existing CardKit / Sheet look; adds nothing new visually.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, WifiOff } from 'lucide-react';
import { newClientRef, progressFor } from '../../utils/networkHelpers';

/** Loads something once (and again on demand). Never shows stale data as fresh: `error` is kept until a load succeeds. */
export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const alive = useRef(true);
  const seq = useRef(0);
  const run = useCallback(async () => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await loader();
      if (alive.current && mine === seq.current) setState({ data, loading: false, error: null });
    } catch (error) {
      if (alive.current && mine === seq.current) setState((s) => ({ data: s.data, loading: false, error }));
    }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { alive.current = true; run(); return () => { alive.current = false; }; }, [run]);
  return { ...state, reload: run };
}

export function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  useEffect(() => {
    const up = () => setOn(true); const down = () => setOn(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);
  return on;
}

/** Shown when there is no internet: Find Stock and ordering need a connection (v1), so we say so instead of failing quietly. */
export function OfflineBanner() {
  return (
    <div className="mb-2 flex items-center gap-2 border rounded-xl px-3 py-2 text-[12.5px] bg-[#FBF3D5] border-[#EBD98A] text-[#6B4F0B]">
      <WifiOff size={15} className="shrink-0" /> No internet. You can look, but orders and answers need a connection.
    </div>
  );
}

export const primaryBtn = 'w-full inline-flex items-center justify-center gap-2 bg-[#1F6B45] hover:bg-[#17553A] text-white font-semibold rounded-xl min-h-[48px] px-4 border-b-2 border-[#C9A227] disabled:opacity-50';
export const ghostBtn = 'w-full inline-flex items-center justify-center gap-2 bg-white hover:bg-[#FBF7E4] text-[#1F6B45] font-semibold rounded-xl min-h-[48px] px-4 border border-[#E3DBB8] disabled:opacity-50';
export const dangerBtn = 'w-full inline-flex items-center justify-center gap-2 bg-white hover:bg-[#FBE4E0] text-[#A3352A] font-semibold rounded-xl min-h-[48px] px-4 border border-[#F0C2BB] disabled:opacity-50';
export const smallPrimary = 'flex-1 min-w-0 inline-flex items-center justify-center bg-[#1F6B45] hover:bg-[#17553A] text-white text-[12px] font-bold rounded-lg min-h-[36px] px-2 border-b-2 border-[#C9A227] disabled:opacity-50';

export function Field({ label, hint, children }) {
  return (
    <label className="block mb-3">
      <span className="block text-[12px] font-bold text-[#4B5646] mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-[#8B8766] mt-1">{hint}</span>}
    </label>
  );
}

/** A row of label / value pairs, for the detail sheets. */
export function KeyValues({ rows }) {
  return (
    <dl className="rounded-xl border border-[#E3DBB8] bg-[#FFFDF4] divide-y divide-[#F0EACF] mb-3">
      {rows.filter((r) => r && r.value != null && r.value !== '').map((r) => (
        <div key={r.label} className="flex items-start justify-between gap-3 px-3 py-2">
          <dt className="text-[12px] text-[#8B8766] shrink-0">{r.label}</dt>
          <dd className="text-[13px] font-semibold text-[#23382B] text-right min-w-0 break-words">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The simple stage indicator for an order. */
export function ProgressBar({ status }) {
  const { steps, note } = progressFor(status);
  return (
    <div className="mb-3">
      <ol className="flex items-start">
        {steps.map((s, i) => (
          <li key={s.label} className="flex-1 min-w-0 flex flex-col items-center relative">
            {i > 0 && <span className={`absolute top-3 right-1/2 w-full h-0.5 ${s.state === 'todo' ? 'bg-[#E3DBB8]' : 'bg-[#1F6B45]'}`} />}
            <span className={`relative z-10 w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold border-2 ${
              s.state === 'done' ? 'bg-[#1F6B45] border-[#1F6B45] text-white' : s.state === 'now' ? 'bg-white border-[#C9A227] text-[#8A6A12]' : 'bg-white border-[#E3DBB8] text-[#B5B195]'}`}>
              {s.state === 'done' ? <Check size={13} /> : i + 1}
            </span>
            <span className={`mt-1 text-[10px] leading-tight text-center ${s.state === 'todo' ? 'text-[#A9A58A]' : 'text-[#23382B] font-semibold'}`}>{s.label}</span>
          </li>
        ))}
      </ol>
      {note && <p className="mt-2 text-[12px] text-[#8F2E24] text-center">{note}</p>}
    </div>
  );
}

/**
 * A reference for a confirm / dispatch attempt. The SAME request retried reuses it (the database then answers "already done"
 * instead of doing it twice); a changed request gets a fresh one.
 */
export function useIdempotentRef(prefix) {
  const r = useRef({ sig: null, id: newClientRef(prefix) });
  return (sig) => {
    if (r.current.sig !== null && r.current.sig !== sig) r.current = { sig, id: newClientRef(prefix) };
    else r.current.sig = sig;
    return r.current.id;
  };
}
