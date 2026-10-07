// src/pos-erp/components/StaySheets.jsx
//
// The three small forms of Rooms & Stays, shared by the Rooms and Stays pages:
//   NewStaySheet      book a room, or check a guest in right now
//   ChangeStaySheet   move the leaving date / the price / the note
//   CheckOutSheet     leave: shows the nights and the bill before confirming
// Phone-first: one column, 48px targets. Every write needs a connection and says so.

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Sheet, { fieldClass as field } from './workspace/Sheet';
import { kes } from './workspace/WorkspaceKit';
import { roomService, todayLocal, addDays, nightsBetween, formatDay } from '../services/roomService';
import { customerService } from '../services/customerService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { useNetStatus } from '../offline/useNetStatus';

const primary = 'w-full min-h-[52px] rounded-xl bg-[#237A52] hover:bg-[#1B5138] text-white font-bold disabled:opacity-50';
const label = 'block text-[11px] font-bold uppercase tracking-wider text-[#68756D] mb-1';
const Err = ({ children }) => (children ? <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">{children}</div> : null);

function OfflineNote({ isOnline }) {
  return isOnline ? null : <p className="text-xs text-[#68756D] mb-3">This needs a connection, so two people cannot be given the same room. Try again when you are back online.</p>;
}

export function NewStaySheet({ rooms, presetRoomId = '', onClose, onDone }) {
  const { tenant, staffId } = usePosErpAuth();
  const { isOnline } = useNetStatus();
  const today = todayLocal();
  const [customers, setCustomers] = useState([]);
  const [newGuest, setNewGuest] = useState(false);
  const [form, setForm] = useState({
    customerId: '', name: '', phone: '', roomId: presetRoomId, mode: 'now', checkIn: today, checkOut: addDays(today, 1), rate: '', guests: '1', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    customerService.getAll({ limit: 200 }).then((r) => setCustomers(r.data)).catch(() => { /* picker stays empty; "New guest" still works */ });
  }, []);

  const room = rooms.find((r) => r.id === form.roomId);
  const arrival = form.mode === 'now' ? today : form.checkIn;
  const nights = nightsBetween(arrival, form.checkOut);
  const rate = Number(form.rate) > 0 ? Number(form.rate) : Number(room?.rate || 0);
  const datesOk = form.checkOut > arrival;
  const guestOk = newGuest ? form.name.trim().length > 0 : !!form.customerId;
  const canGo = isOnline && !busy && room && guestOk && datesOk && rate > 0;
  const usable = (r) => form.mode === 'later' || ['AVAILABLE', 'RESERVED'].includes(r.display_status);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      let customerId = form.customerId;
      if (newGuest) {
        const c = await customerService.create({ tenant_id: tenant?.id, business_id: tenant?.business_id ?? null, name: form.name, phone: form.phone, created_by: staffId });
        customerId = c.id;
      }
      const stayId = await roomService.book({
        businessId: tenant?.business_id, customerId, roomId: form.roomId, checkIn: form.checkIn, checkOut: form.checkOut,
        rate: form.rate, guests: form.guests, notes: form.notes.trim(), createdBy: staffId, checkInNow: form.mode === 'now',
      });
      onDone?.(stayId, { checkedIn: form.mode === 'now' });
    } catch (err) { setError(err.message || 'Could not save the stay.'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title="Guest and room" onClose={onClose}>
      <div className="grid grid-cols-2 gap-1 bg-[#EEF1EC] rounded-xl p-1 mb-3">
        {[['now', 'Arriving now'], ['later', 'Book for later']].map(([k, l]) => (
          <button key={k} onClick={() => setForm((f) => ({ ...f, mode: k, roomId: f.roomId && rooms.find((r) => r.id === f.roomId && (k === 'later' || ['AVAILABLE', 'RESERVED'].includes(r.display_status))) ? f.roomId : '' }))} aria-pressed={form.mode === k}
            className={`min-h-[40px] rounded-lg text-sm font-semibold ${form.mode === k ? 'bg-white shadow-sm text-[#1B5138]' : 'text-[#68756D]'}`}>{l}</button>
        ))}
      </div>

      <div className="space-y-3">
        <div>
          <span className={label}>Guest</span>
          {!newGuest ? (
            <>
              <select className={field} value={form.customerId} onChange={set('customerId')}>
                <option value="">Choose a guest</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` — ${c.phone}` : ''}</option>)}
              </select>
              <button type="button" onClick={() => setNewGuest(true)} className="text-sm font-semibold text-[#237A52] min-h-[44px]">+ New guest</button>
            </>
          ) : (
            <div className="space-y-2">
              <input className={field} placeholder="Guest name" value={form.name} onChange={set('name')} />
              <input className={field} placeholder="Phone (optional)" inputMode="tel" value={form.phone} onChange={set('phone')} />
              <button type="button" onClick={() => setNewGuest(false)} className="text-sm font-semibold text-[#237A52] min-h-[44px]">Choose an existing guest</button>
            </div>
          )}
        </div>

        <div>
          <span className={label}>Room</span>
          <select className={field} value={form.roomId} onChange={set('roomId')}>
            <option value="">Choose a room</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id} disabled={!usable(r)}>
                Room {r.room_number} · {r.room_type_name} · {kes(r.rate)}{!usable(r) ? ` (${r.display_status.toLowerCase()})` : ''}
              </option>
            ))}
          </select>
        </div>

        {form.mode === 'later' && (
          <div><span className={label}>Arrives</span><input className={field} type="date" min={today} value={form.checkIn} onChange={(e) => setForm((f) => ({ ...f, checkIn: e.target.value, checkOut: e.target.value >= f.checkOut ? addDays(e.target.value, 1) : f.checkOut }))} /></div>
        )}
        <div><span className={label}>Leaves</span><input className={field} type="date" min={addDays(arrival, 1)} value={form.checkOut} onChange={set('checkOut')} /></div>

        <div className="grid grid-cols-2 gap-2">
          <div><span className={label}>Price per night</span><input className={field} type="number" inputMode="decimal" placeholder={room ? String(room.rate) : ''} value={form.rate} onChange={set('rate')} /></div>
          <div><span className={label}>Guests</span><input className={field} type="number" inputMode="numeric" min="1" value={form.guests} onChange={set('guests')} /></div>
        </div>
        <input className={field} placeholder="Note (optional)" value={form.notes} onChange={set('notes')} />

        {room && datesOk && rate > 0 && (
          <div className="bg-[#EEF1EC] rounded-xl p-3 text-sm flex justify-between"><span>{nights} night{nights === 1 ? '' : 's'} × {kes(rate)}</span><span className="font-bold text-[#1B5138]">{kes(nights * rate)}</span></div>
        )}
        {!datesOk && <p className="text-xs text-red-700">The leaving date must be after the arrival date.</p>}
        {room && !(rate > 0) && <p className="text-xs text-red-700">This room has no price yet. Type a price per night, or set one on the room.</p>}
      </div>

      <div className="mt-4">
        <Err>{error}</Err>
        <OfflineNote isOnline={isOnline} />
        <button disabled={!canGo} onClick={submit} className={primary}>{busy ? 'Saving…' : form.mode === 'now' ? 'Check in guest' : 'Save booking'}</button>
      </div>
    </Sheet>
  );
}

export function ChangeStaySheet({ stay, onClose, onDone }) {
  const { staffId } = usePosErpAuth();
  const { isOnline } = useNetStatus();
  const inHouse = stay.status === 'CHECKED_IN';
  const [form, setForm] = useState({ checkIn: stay.check_in_date, checkOut: stay.expected_check_out, rate: String(Number(stay.rate)), notes: stay.notes || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const arrival = inHouse ? stay.check_in_date : form.checkIn;
  const nights = nightsBetween(arrival, form.checkOut);
  const ok = form.checkOut > arrival && Number(form.rate) > 0;

  const submit = async () => {
    setBusy(true); setError('');
    try {
      await roomService.update(stay.id, { checkOut: form.checkOut, rate: form.rate, notes: form.notes, checkIn: inHouse ? null : form.checkIn, by: staffId });
      onDone?.();
    } catch (err) { setError(err.message || 'Could not change the stay.'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet title={`Change · Room ${stay.room_number}`} onClose={onClose}>
      <p className="text-sm text-[#68756D] mb-3">{stay.customer_name}</p>
      <div className="space-y-3">
        {!inHouse && <div><span className={label}>Arrives</span><input className={field} type="date" min={todayLocal()} value={form.checkIn} onChange={set('checkIn')} /></div>}
        <div><span className={label}>Leaves</span><input className={field} type="date" min={addDays(arrival, 1)} value={form.checkOut} onChange={set('checkOut')} /></div>
        <div><span className={label}>Price per night</span><input className={field} type="number" inputMode="decimal" value={form.rate} onChange={set('rate')} /></div>
        <input className={field} placeholder="Note" value={form.notes} onChange={set('notes')} />
        {ok && <div className="bg-[#EEF1EC] rounded-xl p-3 text-sm flex justify-between"><span>{nights} night{nights === 1 ? '' : 's'} × {kes(form.rate)}</span><span className="font-bold text-[#1B5138]">{kes(nights * Number(form.rate))}</span></div>}
        {inHouse && <p className="text-xs text-[#68756D]">The room charge on the guest's bill is updated to match. For a one-off discount, use "Give discount" on the bill.</p>}
      </div>
      <div className="mt-4"><Err>{error}</Err><OfflineNote isOnline={isOnline} />
        <button disabled={!isOnline || busy || !ok} onClick={submit} className={primary}>{busy ? 'Saving…' : 'Save changes'}</button>
      </div>
    </Sheet>
  );
}

export function CheckOutSheet({ stay, onClose, onDone }) {
  const { staffId } = usePosErpAuth();
  const { isOnline } = useNetStatus();
  const navigate = useNavigate();
  const [chargeBooked, setChargeBooked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const preview = useMemo(() => roomService.previewCheckOut(stay, { chargeBooked }), [stay, chargeBooked]);
  const otherCharges = Number(stay.folio_total) - Number(stay.nights_booked) * Number(stay.rate);

  const submit = async () => {
    setBusy(true); setError('');
    try {
      const r = await roomService.checkOut(stay.id, { chargeBooked, by: staffId });
      onDone?.(r);
      if (Number(r.folio_total) > 0) navigate(`/pos/folios?folio=${r.folio_id}&settle=1`);
    } catch (err) { setError(err.message || 'Could not check the guest out.'); setBusy(false); }
  };

  return (
    <Sheet title={`Check out · Room ${stay.room_number}`} onClose={onClose}>
      <p className="font-semibold text-[#26352D]">{stay.customer_name}</p>
      <p className="text-xs text-[#68756D] mb-3">In {formatDay(stay.check_in_date)} · booked to {formatDay(stay.expected_check_out)}</p>
      <div className="bg-[#EEF1EC] rounded-xl p-3 text-sm space-y-1">
        <div className="flex justify-between"><span>Room, {preview.nights} night{preview.nights === 1 ? '' : 's'} × {kes(stay.rate)}</span><span className="font-semibold tabular-nums">{kes(preview.room_total)}</span></div>
        {otherCharges > 0 && <div className="flex justify-between text-[#68756D]"><span>Everything else on the bill</span><span className="tabular-nums">{kes(otherCharges)}</span></div>}
      </div>
      {preview.leavingEarly && (
        <label className="flex items-start gap-3 mt-3 min-h-[44px] cursor-pointer">
          <input type="checkbox" className="mt-1 w-4 h-4" checked={chargeBooked} onChange={(e) => setChargeBooked(e.target.checked)} />
          <span className="text-sm text-[#26352D]">Leaving early. Still charge all {nightsBetween(stay.check_in_date, stay.expected_check_out)} booked nights</span>
        </label>
      )}
      <p className="text-xs text-[#68756D] mt-3">After this the room goes to cleaning and you can settle the bill.</p>
      <div className="mt-4"><Err>{error}</Err><OfflineNote isOnline={isOnline} />
        <button disabled={!isOnline || busy} onClick={submit} className={primary}>{busy ? 'Checking out…' : 'Check out and see the bill'}</button>
      </div>
    </Sheet>
  );
}

export function CancelStaySheet({ stay, onClose, onDone }) {
  const { isOnline } = useNetStatus();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try { await roomService.cancel(stay.id, reason); onDone?.(); }
    catch (err) { setError(err.message || 'Could not cancel the booking.'); }
    finally { setBusy(false); }
  };
  return (
    <Sheet title={`Cancel booking · Room ${stay.room_number}`} onClose={onClose}>
      <p className="text-sm text-[#68756D] mb-3">{stay.customer_name} · {formatDay(stay.check_in_date)} to {formatDay(stay.expected_check_out)}</p>
      <input className={`${field} mb-3`} placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
      <Err>{error}</Err><OfflineNote isOnline={isOnline} />
      <button disabled={!isOnline || busy} onClick={submit} className="w-full min-h-[52px] rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold disabled:opacity-50">{busy ? 'Cancelling…' : 'Cancel this booking'}</button>
    </Sheet>
  );
}
