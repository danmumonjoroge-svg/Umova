// elimu/rooms/pages/RoomsPage.jsx -- which rooms are free right now. Built from the timetable (cancellations and room changes for today count).
import React, { useCallback, useEffect, useState } from 'react';
import { FitPage, LoadingBlock, EmptyBlock, ErrorLine } from '../../shared/components/kit';
import { rpc } from '../../shared/services/elimuDb';

const t5 = (t) => (t ? String(t).slice(0, 5) : '');
const STATE = { FREE: ['Free', 'bg-emerald-100 text-emerald-800'], IN_USE: ['In use', 'bg-red-100 text-red-800'], CLOSED: ['Closed', 'bg-slate-100 text-slate-600'] };

export default function RoomsPage() {
  const [data, setData] = useState(null); const [err, setErr] = useState(null); const [freeOnly, setFreeOnly] = useState(false);
  const load = useCallback(async () => { try { setData(await rpc('elimu_rooms_now')); setErr(null); } catch (e) { setErr(e.message); } }, []);
  useEffect(() => { load(); const id = setInterval(load, 60000); return () => clearInterval(id); }, [load]);
  const rooms = (data?.rooms || []).filter((r) => !freeOnly || r.state === 'FREE');
  const free = (data?.rooms || []).filter((r) => r.state === 'FREE').length;
  return (
    <FitPage title="Rooms" subtitle={data ? `${free} of ${data.rooms.length} free now${data.school_day ? '' : ' · not a school day'}` : 'Which rooms are free now'}>
      <ErrorLine error={err} />
      <label className="flex items-center gap-2 text-sm mb-3"><input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} /> Show free rooms only</label>
      {!data && !err ? <LoadingBlock /> : rooms.length === 0 ? <EmptyBlock text={freeOnly ? 'No free rooms right now.' : 'No rooms yet. Add rooms in Timetable setup.'} /> : (
        <div className="grid gap-2 sm:grid-cols-2">{rooms.map((r) => { const st = STATE[r.state] || STATE.FREE; return (
          <div key={r.room_id} className="rounded-2xl bg-white border border-[#E3DBB8] p-3">
            <div className="flex items-center justify-between"><div><div className="font-semibold">{r.name}</div><div className="text-xs text-slate-500">{r.type.replace('_', ' ').toLowerCase()}{r.capacity ? ` · ${r.capacity} seats` : ''}</div></div>
              <span className={`rounded-full px-3 py-1 text-xs font-semibold ${st[1]}`}>{st[0]}</span></div>
            {r.in_use_by && <div className="mt-2 text-sm">{r.in_use_by.class}{r.in_use_by.subject ? ` · ${r.in_use_by.subject}` : ''}<div className="text-xs text-slate-500">{r.in_use_by.teacher || ''} · until {t5(r.in_use_by.until)}</div></div>}
            {r.state === 'FREE' && <div className="mt-2 text-xs text-slate-500">{r.free_until ? `Free until ${t5(r.free_until)}` : 'Free for the rest of the day'}</div>}</div>); })}</div>)}
    </FitPage>
  );
}
