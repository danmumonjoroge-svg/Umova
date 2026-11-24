// Parent screens added in piece 50: My child (class, teachers, subjects, school leaders), Class performance, and What's new.
import React, { useEffect, useState } from 'react';
import { parentApi } from './parentClient.js';
import { buildUpdates } from './updates.js';
import { humanMessage } from '../utils/humanError.js';
import { Skeleton } from './ParentHome.jsx';

function useLoad(fn, deps) {
  const [s, set] = useState({ loading: true, data: null, error: '' });
  useEffect(() => { let live = true; set({ loading: true, data: null, error: '' });
    fn().then((data) => live && set({ loading: false, data, error: '' })).catch((e) => live && set({ loading: false, data: null, error: humanMessage(e) }));
    return () => { live = false; }; /* eslint-disable-next-line */ }, deps);
  return s;
}
const Wrap = ({ s, children }) => (s.loading ? <Skeleton /> : s.error ? <p className="m-3 rounded-xl bg-red-50 text-red-800 text-sm p-3">{s.error}</p> : children(s.data));
const Card = ({ children, className = '' }) => <div className={`rounded-2xl bg-white border border-[#E3DBB8] p-3 ${className}`}>{children}</div>;
const ROLE = { principal: 'Principal', headteacher: 'Head teacher', deputy: 'Deputy principal' };

export function ChildDetails({ id, colour = '#1F6B45' }) {
  const s = useLoad(() => parentApi.details(id), [id]);
  return (<Wrap s={s}>{(d) => !d.enrolled ? <p className="p-4 text-sm text-slate-500">Your child is not enrolled in a class yet.</p> : (
    <div className="p-3 space-y-3">
      <Card><div className="text-xs uppercase tracking-wide text-slate-500">Class</div><div className="text-xl font-bold" style={{ color: colour }}>{d.class_name}{d.stream_name ? ` · ${d.stream_name}` : ''}</div><div className="text-xs text-slate-500">{d.year}</div>
        <div className="mt-2 text-sm"><span className="text-slate-500">Class teacher: </span><b>{d.class_teacher || 'Not assigned yet'}</b></div></Card>
      <Card><div className="text-xs uppercase tracking-wide text-slate-500 mb-2">Subjects and teachers</div>
        {d.subjects.length === 0 ? <p className="text-sm text-slate-500">No subjects have been set up for this class yet.</p> :
          <ul className="divide-y divide-[#EFE9CC]">{d.subjects.map((x) => <li key={x.subject} className="py-2 flex justify-between gap-2 text-sm"><span className="font-medium">{x.subject}{x.optional ? <span className="ml-1 text-[11px] text-slate-500">(chosen)</span> : null}</span><span className="text-slate-600 text-right">{x.teacher || '—'}</span></li>)}</ul>}</Card>
      {d.leadership.length > 0 && <Card><div className="text-xs uppercase tracking-wide text-slate-500 mb-2">School leadership</div>
        {d.leadership.map((l, i) => <div key={i} className="flex justify-between text-sm py-1"><span className="text-slate-500">{ROLE[l.role] || l.role}</span><b>{l.name}</b></div>)}</Card>}
    </div>)}</Wrap>);
}

export function ClassPerformance({ id, allowed, colour = '#1F6B45' }) {
  const s = useLoad(() => (allowed ? parentApi.classPerformance(id) : Promise.resolve(null)), [id, allowed]);
  if (!allowed) return <p className="p-4 text-sm text-slate-500">Results are not shared with this login. Ask the school if you need access.</p>;
  return (<Wrap s={s}>{(d) => !d?.available ? <p className="p-4 text-sm text-slate-600">{d?.reason || 'Not available yet.'}</p> : (
    <div className="p-3 space-y-3">
      <Card>
        <div className="text-xs text-slate-500">{d.term} · {d.year} · class of {d.class_size}</div>
        <div className="mt-1 flex items-end gap-4"><div><div className="text-3xl font-bold" style={{ color: colour }}>{d.child_mean}%</div><div className="text-xs text-slate-500">your child</div></div>
          <div><div className="text-2xl font-bold text-slate-600">{d.class_mean}%</div><div className="text-xs text-slate-500">class average</div></div></div>
        <div className="mt-3 text-sm font-semibold">{d.band}</div>
        <div className="relative h-3 rounded-full bg-[#EFE9CC] mt-3" aria-label="Where your child sits among the class">
          <span className="absolute top-0 h-3 rounded-full bg-[#C9A227]/60" style={{ left: `${Math.min(100, d.middle_half_low)}%`, width: `${Math.max(2, Math.min(100, d.middle_half_high) - Math.min(100, d.middle_half_low))}%` }} />
          <span className="absolute -top-1 h-5 w-1.5 rounded" style={{ left: `calc(${Math.min(100, d.child_mean)}% - 3px)`, background: colour }} /></div>
        <div className="text-[11px] text-slate-500 mt-1">The gold band is where the middle half of the class scored ({d.middle_half_low}%–{d.middle_half_high}%).</div></Card>
      {d.subjects.length > 0 && <Card><div className="text-xs uppercase tracking-wide text-slate-500 mb-2">By subject</div>
        {d.subjects.map((x) => { const up = x.child >= x.class_average; return (
          <div key={x.subject} className="py-1.5"><div className="flex justify-between text-sm"><span className="font-medium">{x.subject}</span><span><b style={{ color: up ? '#1F6B45' : '#8A4B2A' }}>{x.child}%</b> <span className="text-slate-500">vs {x.class_average}%</span></span></div>
            <div className="h-1.5 rounded-full bg-[#EFE9CC] mt-1 relative"><span className="absolute top-0 h-1.5 rounded-full" style={{ width: `${Math.min(100, x.child)}%`, background: up ? '#1F6B45' : '#8A4B2A' }} /><span className="absolute -top-0.5 h-2.5 w-0.5 bg-slate-700" style={{ left: `${Math.min(100, x.class_average)}%` }} /></div></div>); })}</Card>}
      <p className="text-xs text-slate-500 px-1">Only the class as a whole is shown. Other children's names and marks are private.</p>
    </div>)}</Wrap>);
}

export function WhatsNew({ id, canResults, canFees, onOpen }) {
  const s = useLoad(async () => {
    const safe = async (p, d) => { try { return await p; } catch { return d; } };
    const [notices, calendar, trips, passes, results, fees] = await Promise.all([safe(parentApi.notices(id), []), safe(parentApi.calendar(id), []), safe(parentApi.trips(id), []), safe(parentApi.gatePasses(id), []),
      canResults ? safe(parentApi.results(id), []) : [], canFees ? safe(parentApi.fees(id), null) : null]);
    return buildUpdates({ notices, calendar, trips, passes, results, fees });
  }, [id, canResults, canFees]);
  return (<Wrap s={s}>{(items) => items.length === 0 ? <p className="p-4 text-sm text-slate-500">Nothing new right now.</p> : (
    <ul className="space-y-2">{items.map((x) => (
      <li key={x.key}><button type="button" onClick={() => onOpen(x.tab)} className="w-full text-left rounded-2xl bg-white border p-3 flex gap-3 items-start" style={{ borderColor: x.urgent ? '#C9A227' : '#E3DBB8', background: x.urgent ? '#FFF8DC' : '#fff' }}>
        <span className="mt-1 h-2.5 w-2.5 rounded-full shrink-0" style={{ background: x.urgent ? '#C9A227' : '#1F6B45' }} />
        <span className="min-w-0 flex-1"><span className="block font-semibold text-sm">{x.title}</span>{x.detail && <span className="block text-xs text-slate-600">{x.detail}</span>}</span>
        {x.when && <span className="text-[11px] text-slate-500 shrink-0">{x.when.slice(5)}</span>}</button></li>))}</ul>)}</Wrap>);
}
