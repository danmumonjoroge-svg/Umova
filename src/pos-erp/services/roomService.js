// src/pos-erp/services/roomService.js
//
// Rooms & Stays (phase20_rooms_stays.sql). Generic: anything sold by the night
// (a hotel room, a lodge cottage, a hostel bed, a conference hall for a day).
//
//   Room type -> Room -> Stay (a reservation until check-in) -> Guest (a customer) -> Folio
//
// The room never touches money. A stay puts ONE room line on the guest's folio
// (nights x rate); the folio (folioService) is where the bill is settled.
//
// All writes that move a stay or a room's status go through SECURITY DEFINER
// functions. Rooms and room types may be added/edited directly (RLS-gated);
// their status may not.
//
// OFFLINE: the room board is cached for reading only. Booking, check-in,
// check-out and housekeeping need a connection, because they change what a
// guest is charged and whether two people can have the same room.

import { posSupabase as supabase } from './posSupabaseClient';
import { db } from '../offline/db';

export const ROOM_STATUS_LABEL = { AVAILABLE: 'Ready', RESERVED: 'Reserved', OCCUPIED: 'Occupied', CLEANING: 'Cleaning', MAINTENANCE: 'Maintenance' };
export const STAY_STATUS_LABEL = { RESERVED: 'Booked', CHECKED_IN: 'In the room', CHECKED_OUT: 'Checked out', CANCELLED: 'Cancelled' };

const DAY = 86400000;
const ymd = (d) => new Date(d).toISOString().slice(0, 10);

/** Today in the business's time zone (Kenya), as YYYY-MM-DD. The database uses the same zone. */
export function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function addDays(dateStr, n) { return ymd(Date.parse(`${dateStr}T00:00:00Z`) + n * DAY); }
/** Calendar nights between two YYYY-MM-DD dates; a same-day stay is one night (matches the database). */
export function nightsBetween(from, to) {
  if (!from || !to) return 0;
  return Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY));
}
export function formatDay(dateStr) {
  if (!dateStr) return '';
  return new Date(`${dateStr}T00:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

async function cacheBoard(rows) {
  try {
    await db.rooms_cache.clear();
    await db.rooms_cache.bulkPut(rows.map((r) => ({
      id: r.id, room_number: r.room_number, room_type_name: r.room_type_name, rate: r.rate, display_status: r.display_status,
      current_guest: r.current_guest, current_check_out: r.current_check_out, next_guest: r.next_guest, next_check_in: r.next_check_in,
    })));
  } catch (err) { console.error('[roomService] cache write failed:', err); }
}

export const roomService = {
  // ---------- rooms and types ----------
  /** The room board (type, price, derived status, who is in it, who is next). Falls back to the device cache when offline. */
  async listBoard({ includeInactive = false } = {}) {
    try {
      let q = supabase.from('lb_room_board').select('*').order('room_number', { ascending: true });
      if (!includeInactive) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (error) throw error;
      const rows = [...(data || [])].sort((a, b) => a.room_number.localeCompare(b.room_number, undefined, { numeric: true }));
      if (!includeInactive) cacheBoard(rows);
      return { rows, fromCache: false };
    } catch (err) {
      if (err?.name === 'TypeError') return { rows: await db.rooms_cache.toArray(), fromCache: true };
      throw err;
    }
  },

  async listTypes({ includeInactive = false } = {}) {
    let q = supabase.from('lb_room_types').select('*').order('name', { ascending: true });
    if (!includeInactive) q = q.eq('is_active', true);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async saveType({ id, tenantId, businessId, name, baseRate, capacity = 2, description = null, isActive = true }) {
    if (!name?.trim()) throw new Error('Give the room type a name, like "Double Room".');
    if (!(Number(baseRate) >= 0)) throw new Error('Enter the price per night.');
    const row = { name: name.trim(), base_rate: Number(baseRate), capacity: Number(capacity) || 1, description: description || null, is_active: isActive };
    const q = id
      ? supabase.from('lb_room_types').update(row).eq('id', id)
      : supabase.from('lb_room_types').insert({ ...row, tenant_id: tenantId, business_id: businessId });
    const { data, error } = await q.select().single();
    if (error) throw error.code === '23505' ? new Error('You already have a room type with that name.') : error;
    return data;
  },

  async saveRoom({ id, tenantId, businessId, roomNumber, roomTypeId, rateOverride = null, notes = null, isActive = true }) {
    if (!String(roomNumber || '').trim()) throw new Error('Enter the room number.');
    if (!roomTypeId) throw new Error('Choose a room type.');
    const price = rateOverride === '' || rateOverride == null ? null : Number(rateOverride);
    const row = { room_number: String(roomNumber).trim(), room_type_id: roomTypeId, rate_override: price, notes: notes || null, is_active: isActive };
    const q = id
      ? supabase.from('lb_rooms').update(row).eq('id', id)
      : supabase.from('lb_rooms').insert({ ...row, tenant_id: tenantId, business_id: businessId });
    const { data, error } = await q.select().single();
    if (error) throw error.code === '23505' ? new Error(`Room ${row.room_number} already exists.`) : error;
    return data;
  },

  /** Housekeeping: 'AVAILABLE' (ready), 'CLEANING' or 'MAINTENANCE'. Never for a room with a guest in it. */
  async setStatus(roomId, status) {
    const { error } = await supabase.rpc('set_room_status', { p_room_id: roomId, p_status: status });
    if (error) throw error;
  },

  // ---------- stays ----------
  /** statuses: e.g. ['CHECKED_IN'] or ['RESERVED'] or ['CHECKED_OUT','CANCELLED']. */
  async listStays({ statuses, customerId, limit = 100 } = {}) {
    let q = supabase.from('lb_stay_summary').select('*').limit(limit);
    if (statuses?.length) q = q.in('status', statuses);
    if (customerId) q = q.eq('customer_id', customerId);
    const past = statuses?.every((s) => ['CHECKED_OUT', 'CANCELLED'].includes(s));
    q = past ? q.order('check_in_date', { ascending: false }) : q.order('check_in_date', { ascending: true });
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async getStay(id) {
    const { data, error } = await supabase.from('lb_stay_summary').select('*').eq('id', id).single();
    if (error) throw error;
    return data;
  },

  /** A guest currently in a room, if any (used to show "Room 204" next to a customer). */
  async currentStayForCustomer(customerId) {
    if (!customerId) return null;
    const rows = await this.listStays({ statuses: ['CHECKED_IN'], customerId, limit: 5 });
    return rows[0] || null;
  },

  /**
   * Book a room. checkInNow = the guest is arriving now (walk-in): the stay starts today,
   * the room becomes occupied and the room charge goes on the guest's folio. Returns the stay id.
   */
  async book({ businessId, customerId, roomId, checkIn, checkOut, rate = null, guests = 1, notes = null, createdBy = null, checkInNow = false }) {
    if (!businessId || !customerId || !roomId) throw new Error('Choose the guest and the room.');
    const { data, error } = await supabase.rpc('create_stay', {
      p_business_id: businessId, p_customer_id: customerId, p_room_id: roomId,
      p_check_in: checkInNow ? null : checkIn, p_check_out: checkOut,
      p_rate: rate === '' || rate == null ? null : Number(rate), p_guests: Number(guests) || 1,
      p_notes: notes || null, p_created_by: createdBy, p_check_in_now: !!checkInNow,
    });
    if (error) throw error;
    return data;
  },

  async checkIn(stayId, by = null) {
    const { data, error } = await supabase.rpc('check_in_stay', { p_stay_id: stayId, p_by: by });
    if (error) throw error;
    return data;
  },

  /** Change the leaving date, the price per night, the note (or, for a booking, the arrival date). The room charge is recalculated. */
  async update(stayId, { checkOut = null, rate = null, notes = null, checkIn = null, by = null } = {}) {
    const { error } = await supabase.rpc('update_stay', {
      p_stay_id: stayId, p_check_out: checkOut, p_rate: rate === '' || rate == null ? null : Number(rate), p_notes: notes,
      p_check_in: checkIn, p_by: by,
    });
    if (error) throw error;
  },

  /** Returns { stay_id, folio_id, nights, room_total, folio_total }. The folio stays open: settle it from Folios. */
  async checkOut(stayId, { chargeBooked = false, by = null } = {}) {
    const { data, error } = await supabase.rpc('check_out_stay', { p_stay_id: stayId, p_charge_booked: !!chargeBooked, p_by: by });
    if (error) throw error;
    return data;
  },

  async cancel(stayId, reason = null) {
    const { error } = await supabase.rpc('cancel_stay', { p_stay_id: stayId, p_reason: reason });
    if (error) throw error;
  },

  /** What a check-out would charge today. The server is the authority; this is only the preview on the screen. */
  previewCheckOut(stay, { chargeBooked = false } = {}) {
    const used = nightsBetween(stay.check_in_date, todayLocal());
    const booked = nightsBetween(stay.check_in_date, stay.expected_check_out);
    const nights = chargeBooked ? Math.max(used, booked) : used;
    return { nights, room_total: nights * Number(stay.rate), leavingEarly: todayLocal() < stay.expected_check_out };
  },
};
