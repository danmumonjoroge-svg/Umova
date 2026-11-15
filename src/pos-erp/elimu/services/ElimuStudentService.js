// Students. Reads go through v_elimu_student_directory (status, current class, primary guardian in one row).
import { supabase, unwrap } from './platform.js';
import { validateStudent } from '../utils/validation.js';

const DIR = 'v_elimu_student_directory';
const PAGE = 50;

export const studentService = {
  async list({ search = '', statusCategory = null, classId = null, page = 0, includeArchived = false } = {}) {
    let q = supabase.from(DIR).select('*', { count: 'exact' }).order('last_name').order('first_name').range(page * PAGE, page * PAGE + PAGE - 1);
    if (!includeArchived) q = q.is('archived_at', null);
    if (statusCategory) q = q.eq('status_category', statusCategory);
    if (classId) q = q.eq('class_id', classId);
    const term = search.trim().replace(/[%,()]/g, ' ');
    if (term) q = q.or(`full_name.ilike.%${term}%,admission_no.ilike.%${term}%,preferred_name.ilike.%${term}%`);
    const { data, error, count } = await q;
    if (error) throw new Error(error.message);
    return { rows: data || [], total: count ?? 0, pageSize: PAGE };
  },

  async get(id) {
    const [dir, hist, status] = await Promise.all([
      supabase.from(DIR).select('*').eq('student_id', id).maybeSingle(),
      supabase.from('v_elimu_enrollment_history').select('*').eq('student_id', id).order('year_start', { ascending: false }),
      supabase.from('elimu_student_status_history').select('*').eq('student_id', id).order('changed_at', { ascending: false }),
    ]);
    const student = unwrap(await supabase.from('elimu_students').select('*').eq('id', id).single());
    return { student, directory: unwrap(dir), enrollments: unwrap(hist) || [], statusHistory: unwrap(status) || [] };
  },

  async create(input) {
    const v = validateStudent(input); if (!v.ok) throw Object.assign(new Error(Object.values(v.errors)[0]), { fields: v.errors });
    return unwrap(await supabase.from('elimu_students').insert(input).select().single());
  },
  async update(id, patch) {
    const v = validateStudent({ first_name: 'x', last_name: 'x', ...patch }); if (!v.ok) throw Object.assign(new Error(Object.values(v.errors)[0]), { fields: v.errors });
    return unwrap(await supabase.from('elimu_students').update(patch).eq('id', id).select().single());
  },
  /** Status change with reason + effective date; closes open enrolments when the student leaves. */
  async changeStatus(id, statusId, reason, effectiveDate) {
    return unwrap(await supabase.rpc('elimu_change_student_status', { p_student: id, p_status_id: statusId, p_reason: reason || null, p_effective_date: effectiveDate || null }));
  },
  async archive(id) { return unwrap(await supabase.from('elimu_students').update({ archived_at: new Date().toISOString() }).eq('id', id).select().single()); },
  async restore(id) { return unwrap(await supabase.from('elimu_students').update({ archived_at: null }).eq('id', id).select().single()); },

  /** Possible duplicates BEFORE saving a new student (name + date of birth, and shared guardian phone). */
  async findDuplicates({ first_name, last_name, date_of_birth }) {
    return unwrap(await supabase.rpc('elimu_find_duplicate_students', { p_first: first_name, p_last: last_name, p_dob: date_of_birth || null, p_exclude: null })) || [];
  },

  /** Photos live in a PRIVATE bucket; we store only the path and hand out short-lived signed links. */
  async uploadPhoto(studentId, tenantId, file) {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `${tenantId}/${studentId}.${ext}`;
    const up = await supabase.storage.from('elimu-student-photos').upload(path, file, { upsert: true, contentType: file.type });
    if (up.error) throw new Error(up.error.message);
    await this.update(studentId, { photo_path: path });
    return path;
  },
  async photoUrl(path, seconds = 300) {
    if (!path) return null;
    const { data } = await supabase.storage.from('elimu-student-photos').createSignedUrl(path, seconds);
    return data?.signedUrl || null;
  },

  async careNotes(studentId) { return unwrap(await supabase.from('elimu_student_care_notes').select('*').eq('student_id', studentId).maybeSingle()); },
  async saveCareNotes(studentId, patch) { return unwrap(await supabase.from('elimu_student_care_notes').upsert({ student_id: studentId, ...patch }, { onConflict: 'tenant_id,student_id' }).select().single()); },

  async dashboard() { return unwrap(await supabase.rpc('elimu_dashboard_summary')); },
};
