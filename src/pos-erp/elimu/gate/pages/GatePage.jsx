// elimu/gate/pages/GatePage.jsx -- the security officer's screen on the school-owned phone/tablet.
// Scan the student's ID-card QR (it holds CODE-ADM), or type the admission number / name, then the student's name appears: tap it to check IN (or OUT).
// Arrival time and PRESENT/LATE come from the database using the school's own opening time and grace period.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FitPage, LoadingBlock, ErrorLine, btn } from '../../shared/components/kit';
import { gateService } from '../services/gateService';

const TONE = { RECORDED: 'bg-emerald-50 border-emerald-300 text-emerald-900', ALREADY_IN: 'bg-sky-50 border-sky-300 text-sky-900' };
const ls = { get: (k, d) => { try { return window.localStorage.getItem(k) ?? d; } catch { return d; } }, set: (k, v) => { try { window.localStorage.setItem(k, v); } catch { /* private mode */ } } };

function QrScanner({ onCode, onClose }) {
  const video = useRef(null); const [err, setErr] = useState('');
  useEffect(() => {
    let stream; let stop = false; let timer;
    (async () => {
      try {
        const det = new window.BarcodeDetector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.current.srcObject = stream; await video.current.play();
        const tick = async () => { if (stop) return; try { const c = await det.detect(video.current); if (c[0]?.rawValue) { onCode(c[0].rawValue); return; } } catch { /* keep scanning */ } timer = setTimeout(tick, 250); };
        tick();
      } catch { setErr('Could not open the camera. Allow camera access, or type the admission number instead.'); }
    })();
    return () => { stop = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode]);
  return (
    <div className="mb-3 rounded-2xl overflow-hidden bg-black relative"><video ref={video} playsInline muted className="w-full h-56 object-cover" />
      <button type="button" onClick={onClose} className="absolute top-2 right-2 rounded-full bg-white/90 px-3 py-1 text-sm font-semibold">Close</button>
      {err && <p className="absolute inset-x-0 bottom-0 bg-red-600 text-white text-sm p-2">{err}</p>}</div>
  );
}

function TodayReport() {
  const [d, setD] = useState(null); const [err, setErr] = useState(null);
  const load = useCallback(async () => { try { setD(await gateService.today()); setErr(null); } catch (e) { setErr(e.message); } }, []);
  useEffect(() => { load(); const id = setInterval(load, 30000); return () => clearInterval(id); }, [load]);
  if (err) return <ErrorLine error={err} />; if (!d) return <LoadingBlock />;
  const hm = (iso) => new Date(iso).toTimeString().slice(0, 5);
  return (
    <div>
      <div className="grid grid-cols-4 gap-2 text-center mb-3">{[['Arrived', d.arrived, 'text-emerald-700'], ['Late', d.late, 'text-amber-700'], ['Left', d.left, 'text-slate-700'], ['Issues', d.problems, 'text-red-700']].map(([k, v, c]) => (
        <div key={k} className="rounded-2xl bg-white border border-[#E3DBB8] p-2"><div className={`text-xl font-bold ${c}`}>{v}</div><div className="text-[11px] text-slate-500">{k}</div></div>))}</div>
      <div className="text-xs font-semibold text-slate-500 mb-1">NOT ARRIVED YET ({d.not_arrived.length})</div>
      {d.not_arrived.length === 0 ? <p className="text-sm text-slate-500 mb-3">Everyone enrolled has arrived.</p> : (
        <div className="mb-4 rounded-2xl bg-white border border-[#E3DBB8] divide-y divide-[#EFE8C8]">{d.not_arrived.slice(0, 120).map((s) => (
          <div key={s.admission_no + s.name} className="flex justify-between px-3 py-2 text-sm"><span>{s.name}</span><span className="text-slate-500">{s.class_name} · {s.admission_no}</span></div>))}</div>)}
      <div className="text-xs font-semibold text-slate-500 mb-1">SCANS ({d.scans.length})</div>
      <div className="rounded-2xl bg-white border border-[#E3DBB8] divide-y divide-[#EFE8C8]">{d.scans.map((x, i) => (
        <div key={i} className="flex justify-between px-3 py-2 text-sm"><span>{x.name}<span className="text-xs text-slate-400"> · {x.direction}{x.device ? ` · ${x.device}` : ''}</span></span>
          <span className={x.result === 'RECORDED' ? (x.status === 'LATE' ? 'text-amber-700' : 'text-emerald-700') : x.result === 'ALREADY_IN' ? 'text-sky-700' : 'text-red-700'}>{x.result === 'RECORDED' ? (x.status || 'OK') : x.result.replace('_', ' ').toLowerCase()} · {hm(x.at)}</span></div>))}</div>
    </div>
  );
}

export default function GatePage() {
  const [view, setView] = useState('checkin');
  const [dir, setDir] = useState('IN'); const [q, setQ] = useState(''); const [found, setFound] = useState([]); const [busy, setBusy] = useState(false); const [err, setErr] = useState(null);
  const [res, setRes] = useState(null); const [log, setLog] = useState([]); const [scan, setScan] = useState(false); const [device, setDevice] = useState(() => ls.get('elimu.gate.device', 'Main gate'));
  const [method, setMethod] = useState('MANUAL'); const timer = useRef(null); const input = useRef(null);
  const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window && !!navigator.mediaDevices?.getUserMedia;

  const search = useCallback(async (text) => {
    setErr(null); if ((text || '').trim().length < 2) { setFound([]); return; }
    try { setFound(await gateService.find(text.trim())); } catch (e) { setErr(e.message); }
  }, []);
  useEffect(() => { clearTimeout(timer.current); timer.current = setTimeout(() => search(q), 250); return () => clearTimeout(timer.current); }, [q, search]);

  const checkIn = useCallback(async (s, how) => {
    setBusy(true); setErr(null);
    try {
      const r = await gateService.checkIn({ studentId: s.student_id, direction: dir, method: how || method, device });
      setRes(r); setLog((l) => [{ ...r, at: new Date() }, ...l].slice(0, 12)); setQ(''); setFound([]); setMethod('MANUAL');
      if (navigator.vibrate) navigator.vibrate(r.ok ? 60 : [60, 60, 60]);
      input.current?.focus();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }, [dir, method, device]);

  const onCode = useCallback(async (code) => {
    setScan(false);
    try { const list = await gateService.find(code); if (list.length === 1) await checkIn(list[0], 'CARD'); else { setQ(code); setMethod('CARD'); } } catch (e) { setErr(e.message); }
  }, [checkIn]);

  return (
    <FitPage title="Gate" subtitle="Check students in and out">
      <div className="grid grid-cols-2 gap-1 p-1 mb-3 rounded-xl bg-[#EFE8C8]">{[['checkin', 'Check in'], ['today', 'Today']].map(([k, l]) => (
        <button key={k} type="button" onClick={() => setView(k)} className={`h-10 rounded-lg text-sm font-semibold ${view === k ? 'bg-white text-[#1F6B45] shadow-sm' : 'text-[#6F7461]'}`}>{l}</button>))}</div>
      {view === 'today' ? <TodayReport /> : (<>
      <div className="grid grid-cols-2 gap-2 mb-3">{['IN', 'OUT'].map((d) => (
        <button key={d} type="button" onClick={() => setDir(d)} className={`h-14 rounded-2xl text-lg font-bold border ${dir === d ? (d === 'IN' ? 'bg-[#1F6B45] text-white border-[#1F6B45]' : 'bg-[#8A6D0B] text-white border-[#8A6D0B]') : 'bg-white text-[#23382B] border-[#E3DBB8]'}`}>{d === 'IN' ? 'Arriving' : 'Leaving'}</button>))}</div>
      {scan && <QrScanner onCode={onCode} onClose={() => setScan(false)} />}
      <div className="flex gap-2"><input ref={input} autoFocus value={q} onChange={(e) => setQ(e.target.value)} inputMode="search" placeholder="Admission no. or name" className="flex-1 h-12 rounded-xl border border-[#DDD6B6] px-4 bg-white" />
        {canScan && <button type="button" onClick={() => setScan(true)} className={`${btn} h-12 px-4`}>Scan ID</button>}</div>
      <ErrorLine error={err} />
      {res && <div className={`mt-3 rounded-2xl border p-4 ${TONE[res.result] || 'bg-red-50 border-red-300 text-red-900'} ${res.status === 'LATE' ? '!bg-amber-50 !border-amber-300 !text-amber-900' : ''}`} role="status">
        <div className="text-lg font-bold">{res.name || 'Not recorded'}</div><div className="text-sm mt-0.5">{res.message}</div></div>}
      <div className="mt-3 space-y-2">{found.map((s) => (
        <button key={s.student_id} type="button" disabled={busy} onClick={() => checkIn(s)} className="w-full text-left rounded-2xl bg-white border border-[#E3DBB8] p-3 active:bg-[#EFE8C8] flex items-center justify-between min-h-[64px]">
          <div><div className="font-semibold">{s.name}</div><div className="text-xs text-slate-500">{s.admission_no} · {s.class_name}</div></div>
          <div className="text-right text-xs">{s.arrived_at ? <span className="text-emerald-700 font-semibold">In {String(s.arrived_at).slice(0, 5)}</span> : <span className="text-slate-400">Not in yet</span>}</div></button>))}
        {q.trim().length >= 2 && found.length === 0 && <p className="text-sm text-slate-500 px-1">No enrolled student matches.</p>}</div>
      {log.length > 0 && <div className="mt-5"><div className="text-xs font-semibold text-slate-500 mb-1">THIS SESSION</div>
        {log.map((l, i) => (<div key={i} className="flex justify-between text-sm py-1.5 border-b border-[#EFE8C8]"><span>{l.name}</span><span className={l.ok ? (l.status === 'LATE' ? 'text-amber-700' : 'text-emerald-700') : 'text-red-700'}>{l.direction} · {l.ok ? (l.status || l.result) : 'not recorded'} · {l.at.toTimeString().slice(0, 5)}</span></div>))}</div>}
      <label className="block mt-6 text-xs text-slate-500">This device is called
        <input value={device} onChange={(e) => { setDevice(e.target.value); ls.set('elimu.gate.device', e.target.value); }} className="mt-1 w-full h-10 rounded-lg border border-[#DDD6B6] px-3 bg-white text-sm" /></label>
      <p className="mt-3 text-xs text-slate-500">Fingerprint scanners: an external scanner that identifies the student can call the same check-in with method FINGERPRINT. A phone’s own fingerprint sensor cannot tell which student a finger belongs to, so it is not used here.</p>
      </>)}
    </FitPage>
  );
}
