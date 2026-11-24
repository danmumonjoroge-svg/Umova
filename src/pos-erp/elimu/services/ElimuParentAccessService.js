// Parent logins: the school gives each guardian a username + one-time password (school code + username + password to sign in).
import { supabase, unwrap } from './platform.js';
import { humanError } from '../utils/humanError.js';

export const parentAccessService = {
  async list() { return unwrap(await supabase.rpc('elimu_parent_logins_list')) || []; },
  /** Creates the login (or resets the password). Returns { name, username, school_code, temp_password } -- shown once. */
  async issue(guardianId, reset = false) {
    const { data, error } = await supabase.functions.invoke('elimu-parent-access', { body: { guardian_id: guardianId, reset } });
    if (error) { let body = null; try { body = await error.context?.json?.(); } catch { /* keep generic */ } throw humanError(body?.message ? { message: body.message, code: body.error } : error); }
    if (!data?.ok) throw humanError({ message: data?.message || 'Could not create the login.' });
    return data;
  },
  async setPaused(guardianId, paused) { return unwrap(await supabase.rpc('elimu_parent_set_status', { p_guardian: guardianId, p_paused: paused })); },
};

/** The note the school hands over with the login. */
export function handoverText(r, origin) {
  return `Elimu parent portal\nSchool code: ${r.school_code}\nUsername: ${r.username}\nFirst password: ${r.temp_password}\nOpen: ${origin || ''}/parent\nYou will be asked to choose your own password the first time.`;
}
