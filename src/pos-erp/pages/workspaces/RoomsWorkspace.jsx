// src/pos-erp/pages/workspaces/RoomsWorkspace.jsx
//
// Rooms & Stays landing page. Every number is read from real rooms and stays;
// a card whose query fails shows "—", never a made-up figure.

import React from 'react';
import { BedDouble, CalendarClock, DoorOpen, BookUser } from 'lucide-react';
import { roomService, todayLocal } from '../../services/roomService';
import { folioService } from '../../services/folioService';
import { useCapabilities } from '../../navigation/CapabilitiesContext';
import { WorkspacePage, CardGrid, ActionCard, ActivityList, Stat, useStat, kes } from '../../components/workspace/WorkspaceKit';

export default function RoomsWorkspace() {
  const { enabled } = useCapabilities();
  const foliosOn = enabled.includes('folios');
  const rooms = useStat(async () => {
    const { rows } = await roomService.listBoard();
    return { total: rows.length, occupied: rows.filter((r) => r.display_status === 'OCCUPIED').length, cleaning: rows.filter((r) => r.display_status === 'CLEANING').length };
  }, []);
  const house = useStat(() => roomService.listStays({ statuses: ['CHECKED_IN'] }), []);
  const booked = useStat(() => roomService.listStays({ statuses: ['RESERVED'] }), []);
  const folios = useStat(async () => {
    if (!foliosOn) return null;
    const { rows } = await folioService.listOpen();
    return { count: rows.length, amount: rows.reduce((s, f) => s + Number(f.balance_due || 0), 0) };
  }, [foliosOn]);

  const today = todayLocal();
  const leaving = (house.value || []).filter((s) => s.expected_check_out <= today);
  const arriving = (booked.value || []).filter((s) => s.check_in_date <= today);
  const todo = [
    ...leaving.map((s) => ({ key: `o${s.id}`, primary: `${s.customer_name} leaves`, secondary: `Room ${s.room_number}${s.expected_check_out < today ? ' · overdue' : ' · today'}`, right: 'Check out' })),
    ...arriving.map((s) => ({ key: `i${s.id}`, primary: `${s.customer_name} arrives`, secondary: `Room ${s.room_number}`, right: 'Check in' })),
  ];

  return (
    <WorkspacePage title="Rooms" subtitle="Your rooms, the guests in them, and what is coming up.">
      <CardGrid>
        <ActionCard
          variant="feature" to="/pos/room-list" icon={BedDouble} title="Rooms"
          stat={<Stat state={rooms} format={(r) => `${r.occupied} of ${r.total}`} />} statLabel="occupied"
          description={rooms.value?.cleaning > 0 ? `${rooms.value.cleaning} being cleaned. Set prices, mark rooms ready.` : 'Every room as a card. Set prices, mark rooms ready.'}
          action="View Rooms"
        />
        <ActionCard
          variant={leaving.length + arriving.length > 0 ? 'alert' : 'default'}
          to="/pos/stays?tab=house" icon={DoorOpen} title="Current Stays"
          stat={<Stat state={house} format={(r) => String(r.length)} />} statLabel="in the rooms"
          description="Check a guest out, extend a stay, open their bill."
          action="See Who Is In"
        />
        <ActionCard
          to="/pos/stays?tab=booked" icon={CalendarClock} title="Reservations"
          stat={<Stat state={booked} format={(r) => String(r.length)} />} statLabel="booked"
          description="Book a room for later and check the guest in when they arrive."
          action="See Bookings"
        />
        {foliosOn && (
          <ActionCard
            to="/pos/folios" icon={BookUser} title="Guest Folios"
            stat={<Stat state={folios} format={(f) => kes(f.amount)} />}
            statLabel={folios.value ? `on ${folios.value.count} open` : undefined}
            description="One bill per guest. Room, food, drinks and activities, settled at once."
            action="Open Folios"
          />
        )}
      </CardGrid>
      {(house.value || booked.value) && (
        <div className="mt-2">
          <ActivityList title="Needs you today" rows={todo} emptyText="Nobody arriving or leaving today." viewAllTo="/pos/stays?tab=house" viewAllLabel="All stays" />
        </div>
      )}
    </WorkspacePage>
  );
}
