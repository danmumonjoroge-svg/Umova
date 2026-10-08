// src/pos-erp/services/efficiencyService.js
//
// "How we are doing" (phase24_efficiency.sql). One read-only call that returns real
// figures for a date range from rooms, stays, folios, packages and production runs.
// A section is only in the answer when that kind of data exists, and a figure that
// cannot be worked out (for example occupancy with no rooms) comes back empty --
// nothing is estimated or made up. Needs a connection; there is no offline copy.

import { posSupabase as supabase } from './posSupabaseClient';
import { todayLocal, addDays } from './roomService';

export const RANGES = [
  ['today', 'Today'],
  ['week', 'Last 7 days'],
  ['month', 'This month'],
  ['30', 'Last 30 days'],
];

export function rangeDates(key) {
  const today = todayLocal();
  if (key === 'today') return { from: today, to: today };
  if (key === 'month') return { from: `${today.slice(0, 8)}01`, to: today };
  if (key === '30') return { from: addDays(today, -29), to: today };
  return { from: addDays(today, -6), to: today };
}

export const efficiencyService = {
  async report({ businessId, from, to }) {
    const { data, error } = await supabase.rpc('efficiency_report', { p_business_id: businessId, p_from: from, p_to: to });
    if (error) throw error;
    return data || {};
  },
};
