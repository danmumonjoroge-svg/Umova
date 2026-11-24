// elimu/academic/services/rpc.js
// The ONLY place the academic module talks to Supabase. Reuses the POS client (posSupabase) and its session/tenant claims.
// All business rules live in the database functions; their error messages are written for people, so they are shown as-is.
import { posSupabase as supabase } from '../../../services/posSupabaseClient';
import { humanMessage } from '../../utils/humanError.js';

export class ElimuError extends Error {
  constructor(message, { code, details } = {}) { super(message); this.name = 'ElimuError'; this.code = code; this.details = details; }
}

/** Call a database function. Throws ElimuError with a readable message. Network failures keep `.isNetwork = true` for offline handling. */
export async function rpc(fn, args = {}) {
  let res;
  try { res = await supabase.rpc(fn, args); }
  catch (e) { const err = new ElimuError(humanMessage(e), { code: 'NETWORK' }); err.isNetwork = true; throw err; }
  if (res.error) {
    const e = new ElimuError(humanMessage(res.error), { code: res.error.code, details: res.error.details });
    if (/failed to fetch|networkerror|load failed/i.test(res.error.message || '')) e.isNetwork = true;
    throw e;
  }
  return res.data;
}

/** Plain table read (RLS-scoped). */
export function table(name) { return supabase.from(name); }

function cleanMessage(m = '') {
  if (/row-level security/i.test(m)) return 'You do not have permission to do that.';
  if (/permission denied/i.test(m)) return 'You do not have permission to do that.';
  if (/duplicate key value.*ux_elimu_subjects_code/i.test(m)) return 'A subject with that code already exists.';
  if (/ux_elimu_assessment_name/i.test(m)) return 'An assessment with that name already exists for this subject, class and term.';
  if (/ux_elimu_atype_code/i.test(m)) return 'An assessment type with that code already exists.';
  if (/elimu_rule_no_overlap/i.test(m)) return 'Two grade bands overlap. Adjust the percentage ranges.';
  if (/elimu_rule_unique_grade/i.test(m)) return 'That grade already exists in this scheme.';
  return m;
}
