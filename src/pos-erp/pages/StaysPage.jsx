// src/pos-erp/pages/StaysPage.jsx
//
// Current stays, reservations and past stays in ONE page (a reservation is just a
// stay that has not arrived yet). A stay card shows the guest, the room, the dates
// and the guest's running bill, with the few actions that matter: open the bill,
// change, check in / out, cancel. Phone-first cards, no tables.

import React, { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BedDouble, Plus, Loader2 } from 'lucide-react';
import { roomService, STAY_STATUS_LABEL, formatDay, nightsBetween, todayLocal } from '../services/roomService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { useNetStatus } from '../offline/useNetStatus';
import { WorkspacePage, kes } from '../components/workspace/WorkspaceKit';
import { NewStaySheet, ChangeStaySheet, CheckOutSheet, CancelStaySheet } from '../components/StaySheets';

const TABS = [['house', 'In the room', ['CHECKED_IN']], ['booked', 'Booked', ['RESERVED']], ['past', 'Past', ['CHECKED_OUT', 'CANCELLED']]];
const btn = 'min-h-[44px] rounded-xl text-sm font-semibold border border-[#DDE3DD] bg-white px-3 disabled:opacity-50 flex items-center justify-center';
const btnPrimary = 'min-h-[44px] rounded-xl text-sm font-bold bg-[#237A52] hover:bg-[#1B5138] text-white px-3 disabled:opacity-50 flex items-center justify-center';

function StayCard({ s, canWrite, onAct, busy }) {
  const today = todayLocal();
  const overdue = s.status === 'CHECKED_IN' && s.expected_check_out < today;
  const dueOut = s.status === 'CHECKED_IN' && s.expected_check_out === today;
  const arrivingToday = s.status === 'RESERVED' && s.check_in_date <= today;
  const billOpen = s.folio_id && s.folio_status === 'OPEN';
  return (
    <div className={`bg-white border rounded-xl p-4 min-w-0 ${overdue ? 'border-l-4 border-l-red-500 border-[#DDE3DD]' : (dueOut || arrivingToday) ? 'border-l-4 border-l-[#C6A15B] border-[#DDE3DD]' : 'border-[#DDE3DD]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-bold text-[#26352D] truncate">{s.customer_name}</div>
          <div className="text-xs text-[#68756D] truncate">Room {s.room_number} · {s.room_type_name} · {s.stay_number}</div>
        </div>
        <span className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full ${s.status === 'CHECKED_IN' ? 'bg-[#1B5138] text-white' : s.status === 'RESERVED' ? 'bg-[#C6A15B]/20 text-[#7a5f1f]' : 'bg-[#EEF1EC] text-[#68756D]'}`}>{STAY_STATUS_LABEL[s.status]}</span>
      </div>

      <div className="mt-2 text-sm text-[#26352D]">
        {formatDay(s.check_in_date)} → {formatDay(s.expected_check_out)}
        <span className="text-[#68756D]"> · {s.status === 'CHECKED_OUT' ? s.nights_charged : s.nights_booked} night{(s.status === 'CHECKED_OUT' ? s.nights_charged : s.nights_booked) === 1 ? '' : 's'} × {kes(s.rate)}</span>
      </div>
      {overdue && <div className="text-xs font-semibold text-red-600 mt-1">Should have left on {formatDay(s.expected_check_out)}</div>}
      {dueOut && <div className="text-xs font-semibold text-[#7a5f1f] mt-1">Leaving today</div>}
      {arrivingToday && <div className="text-xs font-semibold text-[#7a5f1f] mt-1">{s.check_in_date < today ? 'Was due on ' + formatDay(s.check_in_date) : 'Arriving today'}</div>}
      {s.status === 'CANCELLED' && s.cancel_reason && <div className="text-xs text-[#68756D] mt-1">{s.cancel_reason}</div>}

      {s.folio_id && s.status !== 'CANCELLED' && (
        <div className="mt-2 flex items-center justify-between bg-[#EEF1EC] rounded-lg px-3 py-2 text-sm">
          <span className="text-[#68756D]">{s.folio_status === 'SETTLED' ? 'Bill paid' : 'Bill so far'}</span>
          <span className="font-bold tabular-nums text-[#1B5138]">{kes(s.folio_status === 'SETTLED' ? s.folio_total : s.folio_balance)}</span>
        </div>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        {s.status === 'CHECKED_IN' && (<>
          <Link to={`/pos/folios?folio=${s.folio_id}`} className={btn}>Open bill</Link>
          <button className={btn} disabled={!canWrite || busy} onClick={() => onAct('change', s)}>Change</button>
          <button className={`${btnPrimary} col-span-2`} disabled={!canWrite || busy} onClick={() => onAct('checkout', s)}>Check out</button>
        </>)}
        {s.status === 'RESERVED' && (<>
          <button className={btnPrimary} disabled={!canWrite || busy} onClick={() => onAct('checkin', s)}>Check in</button>
          <button className={btn} disabled={!canWrite || busy} onClick={() => onAct('change', s)}>Change</button>
          <button className={`${btn} col-span-2 text-red-600`} disabled={!canWrite || busy} onClick={() => onAct('cancel', s)}>Cancel booking</button>
        </>)}
        {s.status === 'CHECKED_OUT' && s.folio_id && (
          <Link to={`/pos/folios?folio=${s.folio_id}${billOpen ? '&settle=1' : ''}`} className={`${billOpen ? btnPrimary : btn} col-span-2`}>{billOpen ? 'Settle the bill' : 'See the bill'}</Link>
        )}
      </div>
    </div>
  );
}

export default function StaysPage() {
  const { staffId } = usePosErpAuth();
  const { isOnline } = useNetStatus();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some(([k]) => k === params.get('tab')) ? params.get('tab') : 'house';
  const [rows, setRows] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(null); // { kind: 'new' | 'change' | 'checkout' | 'cancel', stay? }

  const load = useCallback(async () => {
    setRows(null);
    try {
      const statuses = TABS.find(([k]) => k === tab)[2];
      setRows(await roomService.listStays({ statuses }));
      setError('');
    } catch (err) { setError(err.message || 'Could not load the stays.'); setRows([]); }
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const openNew = async () => {
    setError('');
    try { setRooms((await roomService.listBoard()).rows); setSheet({ kind: 'new' }); }
    catch (err) { setError(err.message || 'Could not load the rooms.'); }
  };

  const onAct = async (kind, stay) => {
    if (kind !== 'checkin') { setSheet({ kind, stay }); return; }
    setBusy(true); setError('');
    try { await roomService.checkIn(stay.id, staffId); setParams({ tab: 'house' }); await load(); }
    catch (err) { setError(err.message || 'Could not check the guest in.'); }
    finally { setBusy(false); }
  };
  const done = () => { setSheet(null); load(); };

  return (
    <WorkspacePage title="Stays" subtitle="Who is in the rooms, who is coming, and who has been.">
      <div className="flex items-center gap-2 mb-3">
        <div className="grid grid-cols-3 gap-1 bg-[#EEF1EC] rounded-xl p-1 flex-1">
          {TABS.map(([k, l]) => (
            <button key={k} onClick={() => setParams({ tab: k })} aria-pressed={tab === k} className={`min-h-[40px] rounded-lg text-sm font-semibold ${tab === k ? 'bg-white shadow-sm text-[#1B5138]' : 'text-[#68756D]'}`}>{l}</button>
          ))}
        </div>
        <button onClick={openNew} disabled={!isOnline} className="shrink-0 min-h-[48px] px-4 rounded-xl bg-[#237A52] text-white text-sm font-bold flex items-center gap-1.5 disabled:opacity-50"><Plus size={16} /> New</button>
      </div>

      {error && <div className="bg-red-50 text-red-700 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}
      {rows === null && <div className="flex items-center gap-2 text-sm text-[#68756D]"><Loader2 size={16} className="animate-spin" /> Loading…</div>}
      {rows?.length === 0 && !error && (
        <div className="bg-white border border-[#DDE3DD] rounded-xl p-6 text-center text-sm text-[#68756D]">
          <BedDouble className="mx-auto mb-2 text-[#237A52]" />
          {tab === 'house' ? 'Nobody is in a room right now.' : tab === 'booked' ? 'No bookings coming up.' : 'No past stays yet.'}
        </div>
      )}
      {!isOnline && <p className="text-xs text-[#68756D] mb-2">Checking in, checking out and changing a stay need a connection.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {(rows || []).map((s) => <StayCard key={s.id} s={s} canWrite={isOnline} busy={busy} onAct={onAct} />)}
      </div>

      {sheet?.kind === 'new' && (
        <NewStaySheet rooms={rooms} onClose={() => setSheet(null)}
          onDone={(_id, { checkedIn }) => { setSheet(null); setParams({ tab: checkedIn ? 'house' : 'booked' }); load(); }} />
      )}
      {sheet?.kind === 'change' && <ChangeStaySheet stay={sheet.stay} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === 'checkout' && <CheckOutSheet stay={sheet.stay} onClose={() => setSheet(null)} onDone={done} />}
      {sheet?.kind === 'cancel' && <CancelStaySheet stay={sheet.stay} onClose={() => setSheet(null)} onDone={done} />}
    </WorkspacePage>
  );
}
