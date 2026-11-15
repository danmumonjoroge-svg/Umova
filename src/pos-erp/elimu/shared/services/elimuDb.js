// elimu/shared/services/elimuDb.js -- the ONE place Elimu talks to Supabase. Reuses the POS client (same session, same tenant).
import { posSupabase } from '../../../services/posSupabaseClient';

const FRIENDLY = {
  '42501': 'You do not have permission to do that.',
  'P0002': 'That record was not found.',
  '23505': 'That already exists.',
  '23P01': 'That clashes with something already saved.',
  '55000': 'The Elimu student records are not connected yet. Ask your administrator to finish the setup.',
};
export class ElimuError extends Error {
  constructor(message, { code, cause, network } = {}) { super(message); this.name = 'ElimuError'; this.code = code; this.cause = cause; this.network = !!network; }
}
export function toElimuError(error) {
  if (!error) return null;
  const msg = String(error.message || '');
  const network = /failed to fetch|networkerror|load failed|network request failed/i.test(msg) || error.name === 'TypeError';
  if (network) return new ElimuError('No connection.', { code: 'OFFLINE', cause: error, network: true });
  if (msg.startsWith('FOUNDATION_NOT_CONNECTED')) return new ElimuError(FRIENDLY['55000'], { code: 'FOUNDATION_NOT_CONNECTED', cause: error });
  // database messages we wrote ourselves are already plain language: show them
  const own = error.code === '22023' || error.code === '42501' || error.code === 'P0002' || error.code === '23P01';
  return new ElimuError(own && msg ? msg : (FRIENDLY[error.code] || msg || 'Something went wrong.'), { code: error.code, cause: error });
}
export async function rpc(name, args = {}) {
  let res;
  try { res = await posSupabase.rpc(name, args); } catch (e) { throw toElimuError(e); }
  if (res.error) throw toElimuError(res.error);
  return res.data;
}
export async function select(table, build) {
  let q = posSupabase.from(table).select('*');
  if (build) q = build(q);
  let res;
  try { res = await q; } catch (e) { throw toElimuError(e); }
  if (res.error) throw toElimuError(res.error);
  return res.data || [];
}
export async function write(table, op, payload, build) {
  let q = posSupabase.from(table);
  q = op === 'insert' ? q.insert(payload) : op === 'update' ? q.update(payload) : op === 'upsert' ? q.upsert(payload, build?.onConflict ? { onConflict: build.onConflict } : undefined) : q.delete();
  if (op === 'update' || op === 'delete') q = build ? build(q) : q;
  let res;
  try { res = await q.select(); } catch (e) { throw toElimuError(e); }
  if (res.error) throw toElimuError(res.error);
  return res.data || [];
}
export { posSupabase };
