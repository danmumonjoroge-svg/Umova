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
  link: () => rpc('elimu_parent_link'),
  children: () => rpc('elimu_parent_children'),
  attendance: (id) => rpc('elimu_parent_attendance', { p_student: id }),
  results: (id) => rpc('elimu_parent_results', { p_student: id }),
  calendar: (id) => rpc('elimu_parent_calendar', { p_student: id }),
  fees: (id) => rpc('elimu_parent_fees', { p_student: id }),
  examTimetable: (id) => rpc('elimu_parent_exam_timetable', { p_student: id }),
  progress: (id) => rpc('elimu_parent_progress', { p_student: id }),
  materials: (id) => rpc('elimu_parent_materials', { p_student: id }),
  assignments: (id) => rpc('elimu_parent_assignments', { p_student: id }),
  async handIn({ assignmentId, studentId, file, note }) {
    const r = await rpc('elimu_parent_submission_prepare', { p_assignment: assignmentId, p_student: studentId, p_file_name: file.name, p_mime: file.type || null, p_size: file.size, p_note: note || null });
    const { error } = await parentSupabase.storage.from('elimu-files').upload(r.path, file, { contentType: file.type || 'application/octet-stream', upsert: false });
    if (error) throw new Error(error.message || 'The upload failed. Check the connection and try again.');
    await rpc('elimu_parent_submission_confirm', { p_submission: r.submission_id });
    return r;
  },
  gatePasses: (id) => rpc('elimu_parent_gate_passes', { p_student: id }),
  answerGatePass: (id, accept, note) => rpc('elimu_parent_gate_pass_decide', { p_pass: id, p_accept: accept, p_note: note || null }),
};
