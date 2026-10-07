// src/pos-erp/pages/RoomsPage.jsx
//
// The room board: one card per room (number, type, price, status, who is in it,
// who is next). Housekeeping buttons live on the card. Rooms and room types are
// set up here too. Money never moves from this page; a stay (see StaysPage)
// puts the room charge on the guest's folio.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BedDouble, Plus, Loader2, Settings2, UserRound } from 'lucide-react';
import { roomService, ROOM_STATUS_LABEL, formatDay } from '../services/roomService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { useNetStatus } from '../offline/useNetStatus';
import { WorkspacePage, kes } from '../components/workspace/WorkspaceKit';
import Sheet, { fieldClass as field } from '../components/workspace/Sheet';
import { NewStaySheet } from '../components/StaySheets';

const TONE = {
  AVAILABLE: 'bg-[#237A52]/10 text-[#1B5138]',
  RESERVED: 'bg-[#C6A15B]/20 text-[#7a5f1f]',
  OCCUPIED: 'bg-[#1B5138] text-white',
  CLEANING: 'bg-sky-100 text-sky-800',
  MAINTENANCE: 'bg-red-100 text-red-700',
};
const FILTERS = [['ALL', 'All'], ['AVAILABLE', 'Ready'], ['OCCUPIED', 'Occupied'], ['CLEANING', 'Cleaning'], ['MAINTENANCE', 'Maintenance']];
const btn = 'min-h-[44px] rounded-xl text-sm font-semibold border border-[#DDE3DD] bg-white px-3 disabled:opacity-50';
const btnPrimary = 'min-h-[44px] rounded-xl text-sm font-bold bg-[#237A52] hover:bg-[#1B5138] text-white px-3 disabled:opacity-50';

function RoomCard({ room, canWrite, onCheckIn, onStatus, onEdit, busy }) {
  const s = room.display_status;
  return (
    <div className="bg-white border border-[#DDE3DD] rounded-xl p-4 flex flex-col min-w-0">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-2xl font-bold text-[#26352D] leading-none">{room.room_number}</div>
          <div className="text-xs text-[#68756D] mt-1 truncate">{room.room_type_name} · {kes(room.rate)}/night</div>
        </div>
        <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${TONE[s]}`}>{ROOM_STATUS_LABEL[s]}</span>
      </div>

      <div className="mt-3 text-sm min-h-[40px]">
        {s === 'OCCUPIED' && (
          <div className="flex items-start gap-1.5"><UserRound size={15} className="mt-0.5 shrink-0 text-[#237A52]" />
            <div className="min-w-0"><div className="font-semibold text-[#26352D] truncate">{room.current_guest}</div><div className="text-xs text-[#68756D]">leaves {formatDay(room.current_check_out)}</div></div>
          </div>
        )}
        {s === 'RESERVED' && room.next_guest && <div className="text-[#26352D]">Expecting <span className="font-semibold">{room.next_guest}</span> <span className="text-xs text-[#68756D]">· {formatDay(room.next_check_in)}</span></div>}
        {room.next_guest && s === 'OCCUPIED' && <div className="text-xs text-[#68756D] mt-1">Next: {room.next_guest}, {formatDay(room.next_check_in)}</div>}
        {s === 'AVAILABLE' && room.next_guest && <div className="text-xs text-[#68756D]">Next: {room.next_guest}, {formatDay(room.next_check_in)}</div>}
        {room.notes && s !== 'OCCUPIED' && <div className="text-xs text-[#68756D] truncate">{room.notes}</div>}
      </div>

      {canWrite && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {(s === 'AVAILABLE' || s === 'RESERVED') && <button className={btnPrimary} onClick={() => onCheckIn(room)}>Check in</button>}
          {s === 'OCCUPIED' && <Link to="/pos/stays?tab=house" className={`${btnPrimary} flex items-center justify-center`}>Open stay</Link>}
          {s === 'CLEANING' && <button className={btnPrimary} disabled={busy} onClick={() => onStatus(room, 'AVAILABLE')}>Mark ready</button>}
          {s === 'MAINTENANCE' && <button className={btnPrimary} disabled={busy} onClick={() => onStatus(room, 'AVAILABLE')}>Back in service</button>}
          {(s === 'AVAILABLE' || s === 'RESERVED') && <button className={btn} disabled={busy} onClick={() => onStatus(room, 'MAINTENANCE')}>Maintenance</button>}
          {s === 'CLEANING' && <button className={btn} disabled={busy} onClick={() => onStatus(room, 'MAINTENANCE')}>Maintenance</button>}
          <button className={`${btn} ${(s === 'OCCUPIED' || s === 'CLEANING' || s === 'MAINTENANCE') ? '' : 'col-span-2'}`} onClick={() => onEdit(room)}>Edit room</button>
        </div>
      )}
    </div>
  );
}

function RoomSheet({ room, types, onClose, onSaved }) {
  const { tenant } = usePosErpAuth();
  const [form, setForm] = useState({ roomNumber: room?.room_number || '', roomTypeId: room?.room_type_id || types[0]?.id || '', rate: room?.rate_override ?? '', notes: room?.notes || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const type = types.find((t) => t.id === form.roomTypeId);
  const save = async (isActive = true) => {
    setBusy(true); setError('');
    try {
      await roomService.saveRoom({ id: room?.id, tenantId: tenant?.id, businessId: tenant?.business_id, roomNumber: form.roomNumber, roomTypeId: form.roomTypeId, rateOverride: form.rate, notes: form.notes, isActive });
      onSaved();
    } catch (err) { setError(err.message || 'Could not save the room.'); }
    finally { setBusy(false); }
  };
  return (
    <Sheet title={room ? `Room ${room.room_number}` : 'Add a room'} onClose={onClose}>
      <div className="space-y-2">
        <input className={field} placeholder="Room number (e.g. 204)" value={form.roomNumber} onChange={set('roomNumber')} />
        <select className={field} value={form.roomTypeId} onChange={set('roomTypeId')}>{types.map((t) => <option key={t.id} value={t.id}>{t.name} · {kes(t.base_rate)}</option>)}</select>
        <input className={field} type="number" inputMode="decimal" placeholder={`Own price per night (blank = ${type ? kes(type.base_rate) : 'type price'})`} value={form.rate} onChange={set('rate')} />
        <input className={field} placeholder="Note (e.g. sea view)" value={form.notes} onChange={set('notes')} />
        {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
        <button disabled={busy || !form.roomNumber.trim() || !form.roomTypeId} onClick={() => save(true)} className="w-full min-h-[52px] rounded-xl bg-[#237A52] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save room'}</button>
        {room && <button disabled={busy} onClick={() => save(false)} className="w-full min-h-[44px] text-sm font-semibold text-red-600">Stop using this room</button>}
      </div>
    </Sheet>
  );
}

function TypesSheet({ types, onClose, onSaved }) {
  const { tenant } = usePosErpAuth();
  const [editing, setEditing] = useState(null); // type row | {} for new
  const [form, setForm] = useState({ name: '', baseRate: '', capacity: '2' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const edit = (t) => { setEditing(t); setForm(t.id ? { name: t.name, baseRate: String(Number(t.base_rate)), capacity: String(t.capacity) } : { name: '', baseRate: '', capacity: '2' }); setError(''); };
  const save = async () => {
    setBusy(true); setError('');
    try { await roomService.saveType({ id: editing.id, tenantId: tenant?.id, businessId: tenant?.business_id, name: form.name, baseRate: form.baseRate, capacity: form.capacity }); setEditing(null); onSaved(); }
    catch (err) { setError(err.message || 'Could not save.'); }
    finally { setBusy(false); }
  };
  return (
    <Sheet title="Room types" onClose={onClose}>
      {!editing ? (
        <>
          <p className="text-xs text-[#68756D] mb-2">A room type sets the usual price per night. A single room can have its own price too.</p>
          <div className="divide-y divide-[#DDE3DD] border border-[#DDE3DD] rounded-xl mb-3">
            {types.length === 0 && <div className="px-3 py-4 text-sm text-[#68756D] text-center">No room types yet.</div>}
            {types.map((t) => (
              <button key={t.id} onClick={() => edit(t)} className="w-full flex items-center justify-between gap-3 px-3 min-h-[52px] text-left">
                <span className="min-w-0"><span className="block text-sm font-semibold text-[#26352D] truncate">{t.name}</span><span className="block text-xs text-[#68756D]">sleeps {t.capacity}</span></span>
                <span className="text-sm font-semibold tabular-nums">{kes(t.base_rate)}</span>
              </button>
            ))}
          </div>
          <button onClick={() => edit({})} className="w-full min-h-[48px] rounded-xl bg-[#237A52] text-white font-bold flex items-center justify-center gap-1.5"><Plus size={16} /> Add a room type</button>
        </>
      ) : (
        <div className="space-y-2">
          <input className={field} placeholder="Name (e.g. Double Room)" value={form.name} onChange={set('name')} />
          <div className="flex gap-2">
            <input className={field} type="number" inputMode="decimal" placeholder="Price per night" value={form.baseRate} onChange={set('baseRate')} />
            <input className={field} type="number" inputMode="numeric" placeholder="Sleeps" value={form.capacity} onChange={set('capacity')} />
          </div>
          {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>}
          <button disabled={busy || !form.name.trim() || !(Number(form.baseRate) >= 0) || form.baseRate === ''} onClick={save} className="w-full min-h-[52px] rounded-xl bg-[#237A52] text-white font-bold disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
          <button onClick={() => setEditing(null)} className="w-full min-h-[44px] text-sm font-semibold text-[#68756D]">Back</button>
        </div>
      )}
    </Sheet>
  );
}

export default function RoomsPage() {
  const { isOnline } = useNetStatus();
  const navigate = useNavigate();
  const [rows, setRows] = useState(null);
  const [types, setTypes] = useState([]);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [sheet, setSheet] = useState(null); // {kind:'room', room?} | {kind:'types'} | {kind:'stay', roomId?}
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await roomService.listBoard();
      setRows(r.rows); setFromCache(r.fromCache); setError('');
      if (!r.fromCache) setTypes(await roomService.listTypes());
    } catch (err) { setError(err.message || 'Could not load the rooms.'); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => {
    const c = { AVAILABLE: 0, RESERVED: 0, OCCUPIED: 0, CLEANING: 0, MAINTENANCE: 0 };
    (rows || []).forEach((r) => { c[r.display_status] = (c[r.display_status] || 0) + 1; });
    return c;
  }, [rows]);
  const shown = (rows || []).filter((r) => filter === 'ALL' || r.display_status === filter || (filter === 'AVAILABLE' && r.display_status === 'RESERVED'));

  const setStatus = async (room, status) => {
    setBusy(true); setError('');
    try { await roomService.setStatus(room.id, status); await load(); }
    catch (err) { setError(err.message || 'That did not work.'); }
    finally { setBusy(false); }
  };
  const canWrite = isOnline && !fromCache;

  return (
    <WorkspacePage title="Rooms" subtitle="Every room, who is in it, and what it needs.">
      <div className="flex items-center gap-2 mb-3">
        <button onClick={() => setSheet({ kind: 'stay' })} disabled={!canWrite || !rows?.length} className="flex-1 min-h-[48px] rounded-xl bg-[#237A52] text-white text-sm font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"><BedDouble size={16} /> New guest</button>
        <button onClick={() => setSheet({ kind: 'room' })} disabled={!canWrite || types.length === 0} className="min-h-[48px] px-4 rounded-xl border border-[#DDE3DD] bg-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"><Plus size={16} /> Room</button>
        <button onClick={() => setSheet({ kind: 'types' })} disabled={!canWrite} aria-label="Room types" className="min-h-[48px] w-12 rounded-xl border border-[#DDE3DD] bg-white flex items-center justify-center disabled:opacity-50"><Settings2 size={18} /></button>
      </div>

      {rows && rows.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 mb-1">
          {FILTERS.map(([k, l]) => {
            const n = k === 'ALL' ? rows.length : counts[k] + (k === 'AVAILABLE' ? counts.RESERVED : 0);
            return <button key={k} onClick={() => setFilter(k)} aria-pressed={filter === k} className={`shrink-0 min-h-[40px] px-3 rounded-full text-sm font-semibold border ${filter === k ? 'bg-[#237A52] text-white border-[#237A52]' : 'bg-white border-[#DDE3DD] text-[#26352D]'}`}>{l} {n}</button>;
          })}
        </div>
      )}

      {fromCache && <p className="text-xs text-[#68756D] mb-2">Showing the rooms saved on this device. They may be out of date until you are back online.</p>}
      {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}
      {rows === null && <div className="flex items-center gap-2 text-sm text-[#68756D]"><Loader2 size={16} className="animate-spin" /> Loading…</div>}

      {rows?.length === 0 && !error && (
        <div className="bg-white border border-[#DDE3DD] rounded-xl p-6 text-center text-sm text-[#68756D]">
          <BedDouble className="mx-auto mb-2 text-[#237A52]" />
          {types.length === 0 ? 'Start by adding a room type, like "Double Room", with its price per night. Then add your rooms.' : 'No rooms yet. Tap Room to add your first one.'}
          <div className="mt-3"><button onClick={() => setSheet({ kind: types.length === 0 ? 'types' : 'room' })} disabled={!canWrite} className="min-h-[44px] px-4 rounded-xl bg-[#237A52] text-white font-bold disabled:opacity-50">{types.length === 0 ? 'Add a room type' : 'Add a room'}</button></div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {shown.map((r) => (
          <RoomCard key={r.id} room={r} canWrite={canWrite} busy={busy}
            onCheckIn={(room) => setSheet({ kind: 'stay', roomId: room.id })} onStatus={setStatus} onEdit={(room) => setSheet({ kind: 'room', room })} />
        ))}
      </div>

      {sheet?.kind === 'room' && <RoomSheet room={sheet.room} types={types} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); load(); }} />}
      {sheet?.kind === 'types' && <TypesSheet types={types} onClose={() => setSheet(null)} onSaved={load} />}
      {sheet?.kind === 'stay' && (
        <NewStaySheet rooms={rows || []} presetRoomId={sheet.roomId} onClose={() => setSheet(null)}
          onDone={(stayId, { checkedIn }) => { setSheet(null); load(); if (checkedIn) navigate('/pos/stays?tab=house'); else navigate('/pos/stays?tab=booked'); }} />
      )}
    </WorkspacePage>
  );
}
