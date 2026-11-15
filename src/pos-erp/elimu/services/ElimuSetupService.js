// School configuration: setup/seed, settings, structure (years, terms, classes, streams), lookup statuses.
import { supabase, unwrap } from './platform.js';

const T = {
  settings: 'elimu_settings', studentStatuses: 'elimu_student_statuses', admissionStatuses: 'elimu_admission_statuses',
  years: 'elimu_academic_years', terms: 'elimu_terms', classes: 'elimu_classes', streams: 'elimu_streams',
};

export const setupService = {
  /** Idempotent: seeds default statuses, number sequences and the settings row. Safe to call on every Elimu start. */
  async ensureSetup() { return unwrap(await supabase.rpc('elimu_ensure_setup')); },
  async seedNotificationRules() { return unwrap(await supabase.rpc('elimu_seed_notification_rules')); },

  /** { school_code, business_id, name } for the signed-in school. The code is permanent; quote it as CODE-ADMNO on payments. */
  async mySchool() { return unwrap(await supabase.rpc('elimu_my_school')); },
  async resolveRef(ref) { return unwrap(await supabase.rpc('elimu_resolve_student_ref', { p_ref: ref })); },

  async getSettings() { return unwrap(await supabase.from(T.settings).select('*').limit(1).maybeSingle()); },
  /** Merge one or more keys into the settings jsonb (reads the latest row first so two admins do not overwrite each other's other keys). */
  async saveSettings(id, patch) {
    const cur = unwrap(await supabase.from(T.settings).select('settings').eq('id', id).single());
    return unwrap(await supabase.from(T.settings).update({ settings: { ...(cur?.settings || {}), ...patch } }).eq('id', id).select().single());
  },

  async studentStatuses() { return unwrap(await supabase.from(T.studentStatuses).select('*').order('sort_order')); },
  async admissionStatuses() { return unwrap(await supabase.from(T.admissionStatuses).select('*').order('sort_order')); },
  async saveStatus(kind, row) {
    const table = kind === 'admission' ? T.admissionStatuses : T.studentStatuses;
    return unwrap(row.id ? await supabase.from(table).update(row).eq('id', row.id).select().single() : await supabase.from(table).insert(row).select().single());
  },

  async years() { return unwrap(await supabase.from(T.years).select('*').order('start_date', { ascending: false })); },
  async saveYear(row) { return unwrap(row.id ? await supabase.from(T.years).update(row).eq('id', row.id).select().single() : await supabase.from(T.years).insert(row).select().single()); },
  async terms(yearId) { let q = supabase.from(T.terms).select('*').order('start_date'); if (yearId) q = q.eq('academic_year_id', yearId); return unwrap(await q); },
  async saveTerm(row) { return unwrap(row.id ? await supabase.from(T.terms).update(row).eq('id', row.id).select().single() : await supabase.from(T.terms).insert(row).select().single()); },
  async currentPeriod() { return unwrap(await supabase.from('v_elimu_current_period').select('*').limit(1).maybeSingle()); },

  async classes() { return unwrap(await supabase.from(T.classes).select('*, elimu_streams(*)').order('level_order')); },
  async saveClass(row) { return unwrap(row.id ? await supabase.from(T.classes).update(row).eq('id', row.id).select().single() : await supabase.from(T.classes).insert(row).select().single()); },
  async saveStream(row) { return unwrap(row.id ? await supabase.from(T.streams).update(row).eq('id', row.id).select().single() : await supabase.from(T.streams).insert(row).select().single()); },
};
