// elimu/trips/services/tripService.js -- trips and activities with parent consent (elimu_1016).
import { rpc } from '../../shared/services/elimuDb';

export const CONSENT_LABEL = { YES: 'Agreed', NO: 'Declined', WAITING: 'No answer yet' };
export const tripMoney = (n) => (Number(n) > 0 ? `KES ${Number(n).toLocaleString('en-KE')}` : 'Free');
export function tripProblems({ title, date, returnDate, cost, deadline }) {
  const p = []; const today = new Date().toISOString().slice(0, 10);
  if (String(title || '').trim().length < 3) p.push('Give the trip a title.');
  if (!date || date < today) p.push('Choose a trip date that is today or later.');
  if (returnDate && date && returnDate < date) p.push('The return date is before the trip date.');
  if (cost !== '' && cost != null && Number(cost) < 0) p.push('The cost cannot be negative.');
  if (deadline && date && (deadline > date || deadline < today)) p.push('The consent deadline must be between today and the trip date.');
  return p;
}
export const tripService = {
  list: (includePast) => rpc('elimu_trip_list', { p_include_past: !!includePast }),
  roster: (id) => rpc('elimu_trip_roster', { p_trip: id }),
  create: (f) => rpc('elimu_trip_create', { p_title: f.title.trim(), p_description: f.description || null, p_destination: f.destination || null, p_date: f.date, p_return: f.returnDate || null, p_class: f.classId || null, p_cost: Number(f.cost || 0), p_deadline: f.deadline || null }),
  cancel: (id, reason) => rpc('elimu_trip_cancel', { p_trip: id, p_reason: reason }),
  attended: (tripId, studentId, v) => rpc('elimu_trip_mark_attended', { p_trip: tripId, p_student: studentId, p_attended: v }),
};
