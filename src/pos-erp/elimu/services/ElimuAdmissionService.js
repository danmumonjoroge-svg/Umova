// Admissions workflow: Application -> Review -> Accepted / Rejected / Waitlisted -> Admission -> Enrolment.
// Stages are configurable lookup rows mapped to fixed CATEGORIES; the rules live in the database (004/005).
import { supabase, unwrap } from './platform.js';
import { validateApplication } from '../utils/validation.js';

const PAGE = 50;

export const admissionService = {
  async list({ category = null, search = '', page = 0 } = {}) {
    let q = supabase.from('elimu_admission_applications')
      .select('*, student:elimu_students(id, first_name, last_name, preferred_name, date_of_birth), status:elimu_admission_statuses(id, label, category)', { count: 'exact' })
      .order('application_date', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
    const { data, error, count } = await q; if (error) throw new Error(error.message);
    let rows = data || [];
    if (category) rows = rows.filter((r) => r.status?.category === category);
    const term = search.trim().toLowerCase();
    if (term) rows = rows.filter((r) => `${r.student?.first_name} ${r.student?.last_name} ${r.application_no}`.toLowerCase().includes(term));
    return { rows, total: count ?? rows.length, pageSize: PAGE };
  },
  async get(id) {
    return unwrap(await supabase.from('elimu_admission_applications').select('*, student:elimu_students(*), status:elimu_admission_statuses(*)').eq('id', id).single());
  },
  async history(id) { return unwrap(await supabase.from('elimu_admission_status_history').select('*').eq('application_id', id).order('changed_at', { ascending: false })) || []; },

  /** One atomic call: creates the applicant, guardian, contacts, link and application together (all or nothing). */
  async submit(input) {
    const v = validateApplication(input); if (!v.ok) throw Object.assign(new Error(Object.values(v.errors)[0]), { fields: v.errors });
    return unwrap(await supabase.rpc('elimu_submit_application', { p: input }));
  },

  async setStatus(applicationId, statusId, { reason = null } = {}) {
    return unwrap(await supabase.from('elimu_admission_applications').update({ status_id: statusId, decision_reason: reason }).eq('id', applicationId).select().single());
  },

  /** Final step: accepted -> admission number, Active student, enrolment. Repeating it is harmless. */
  async admit(applicationId, { classId, streamId, academicYearId, termId, admissionNo, admissionDate } = {}) {
    return unwrap(await supabase.rpc('elimu_admit_application', {
      p_application: applicationId, p_class_id: classId || null, p_stream_id: streamId || null, p_academic_year_id: academicYearId || null,
      p_term_id: termId || null, p_admission_no: admissionNo || null, p_admission_date: admissionDate || null,
    }));
  },
};
