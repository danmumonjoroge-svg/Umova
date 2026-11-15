// Tiny loader hook used by every Elimu page: { data, loading, error, reload }. Keeps the last good data on screen if a reload fails
// (so a bad signal does not blank a list), and never throws into React.
import { useCallback, useEffect, useRef, useState } from 'react';
import { friendlyError } from '../utils/validation.js';

export function useAsync(loader, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const alive = useRef(true);
  const run = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try { const data = await loader(); if (alive.current) setState({ data, loading: false, error: null }); }
    catch (e) { if (alive.current) setState((s) => ({ data: s.data, loading: false, error: friendlyError(e) })); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { alive.current = true; run(); return () => { alive.current = false; }; }, [run]);
  return { ...state, reload: run };
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useOnline() {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  useEffect(() => {
    const u = () => setOn(true), d = () => setOn(false);
    window.addEventListener('online', u); window.addEventListener('offline', d);
    return () => { window.removeEventListener('online', u); window.removeEventListener('offline', d); };
  }, []);
  return on;
}
