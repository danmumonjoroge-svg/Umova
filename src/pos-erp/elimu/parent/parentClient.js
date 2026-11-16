// Parents sign in with their own Supabase client (same project, its own storage key), so a parent session can never mix with
// the SACCO app's session or a school staff (POS) session in the same browser.
import { createClient } from '@supabase/supabase-js';

export const parentSupabase = createClient(process.env.REACT_APP_SUPABASE_URL, process.env.REACT_APP_SUPABASE_KEY, {
  auth: { storageKey: 'sb-elimu-parent-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

/** 0722 111 222 / 722111222 / +254722111222  ->  +254722111222 (Kenya). Anything else that already starts with + is kept. */
export function toE164(raw) {
  const t = String(raw || '').trim(); const d = t.replace(/\D/g, '');
  if (t.startsWith('+')) return d ? `+${d}` : '';
  if (d.startsWith('254') && d.length === 12) return `+${d}`;
  if (d.startsWith('0') && d.length === 10) return `+254${d.slice(1)}`;
  if (d.length === 9 && /^[17]/.test(d)) return `+254${d}`;
  return '';
}

async function rpc(name, args) {
  const { data, error } = await parentSupabase.rpc(name, args);
  if (error) throw new Error(error.message || 'Something went wrong');
  return data;
}
export const parentApi = {
  children: () => rpc('elimu_parent_children'),
  attendance: (id) => rpc('elimu_parent_attendance', { p_student: id }),
  results: (id) => rpc('elimu_parent_results', { p_student: id }),
  calendar: (id) => rpc('elimu_parent_calendar', { p_student: id }),
  fees: (id) => rpc('elimu_parent_fees', { p_student: id }),
};
