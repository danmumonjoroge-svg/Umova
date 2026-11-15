// Guardians: many-to-many with students, contacts (phone/email), per-channel consent. A guardian is NEVER a login (no duplicate users);
// if the guardian is already an Umova customer, customer_id links to that record instead of copying it.
import { supabase, unwrap } from './platform.js';
import { validateGuardian, validateContact } from '../utils/validation.js';

const PAGE = 50;
const G = 'elimu_guardians';

export const guardianService = {
  async list({ search = '', page = 0 } = {}) {
    let q = supabase.from(G).select('*, elimu_guardian_contacts(*), elimu_student_guardians(student_id, relationship, ended_on)', { count: 'exact' })
      .is('archived_at', null).order('last_name').order('first_name').range(page * PAGE, page * PAGE + PAGE - 1);
    const term = search.trim().replace(/[%,()]/g, ' ');
    if (term) q = q.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%`);
    const { data, error, count } = await q; if (error) throw new Error(error.message);
    return { rows: data || [], total: count ?? 0, pageSize: PAGE };
  },

  /** Guardian + contacts + consent + linked students, in the shape the communication layer needs. */
  async get(id) {
    const g = unwrap(await supabase.from(G).select('*').eq('id', id).single());
    const [contacts, consent, links] = await Promise.all([
      supabase.from('elimu_guardian_contacts').select('*').eq('guardian_id', id).order('is_primary', { ascending: false }),
      supabase.from('elimu_guardian_channel_consent').select('*').eq('guardian_id', id),
      supabase.from('elimu_student_guardians').select('*, elimu_students(id, first_name, last_name, preferred_name, admission_no)').eq('guardian_id', id).is('ended_on', null),
    ]);
    return { ...g, contacts: unwrap(contacts) || [], consent: unwrap(consent) || [], students: unwrap(links) || [] };
  },

  /** Guardians of one student, primary first, each with contacts + consent — what ElimuContactActions needs. */
  async forStudent(studentId) {
    const links = unwrap(await supabase.from('elimu_student_guardians').select('*').eq('student_id', studentId).is('ended_on', null).order('guardian_rank'));
    return Promise.all((links || []).map(async (l) => ({ link: l, ...(await this.get(l.guardian_id)) })));
  },

  async create(input) {
    const v = validateGuardian(input); if (!v.ok) throw Object.assign(new Error(Object.values(v.errors)[0]), { fields: v.errors });
    const { contacts = [], ...g } = input;
    const row = unwrap(await supabase.from(G).insert(g).select().single());
    for (const c of contacts) await this.addContact(row.id, c);
    return row;
  },
  async update(id, patch) { return unwrap(await supabase.from(G).update(patch).eq('id', id).select().single()); },
  async archive(id) { return unwrap(await supabase.from(G).update({ archived_at: new Date().toISOString() }).eq('id', id).select().single()); },

  async addContact(guardianId, c) {
    const v = validateContact(c); if (!v.ok) throw new Error(v.errors.value);
    // value_normalized is computed by the database; the placeholder only satisfies NOT NULL until the trigger overwrites it.
    return unwrap(await supabase.from('elimu_guardian_contacts').insert({ guardian_id: guardianId, kind: c.kind, value: c.value, value_normalized: 'x', label: c.label || null, is_primary: !!c.is_primary, is_whatsapp: !!c.is_whatsapp }).select().single());
  },
  async updateContact(id, patch) { return unwrap(await supabase.from('elimu_guardian_contacts').update(patch).eq('id', id).select().single()); },
  async removeContact(id) { return unwrap(await supabase.from('elimu_guardian_contacts').delete().eq('id', id)); },

  async link(studentId, guardianId, { relationship = 'GUARDIAN', is_emergency_contact = false, can_pick_up = false } = {}) {
    return unwrap(await supabase.from('elimu_student_guardians').insert({ student_id: studentId, guardian_id: guardianId, relationship, is_emergency_contact, can_pick_up }).select().single());
  },
  /** Ends the link (keeps history) instead of deleting it. */
  async unlink(linkId) { return unwrap(await supabase.from('elimu_student_guardians').update({ ended_on: new Date().toISOString().slice(0, 10) }).eq('id', linkId).select().single()); },
  async setPrimary(studentId, guardianId) { return unwrap(await supabase.rpc('elimu_set_primary_guardian', { p_student: studentId, p_guardian: guardianId })); },

  /** Consent: ALLOWED / OPTED_OUT / NOT_ASKED per channel (SMS, EMAIL, WHATSAPP, PHONE), with where the answer came from. */
  async setConsent(guardianId, channel, status, { source = 'SCHOOL_RECORD', note = null } = {}) {
    return unwrap(await supabase.from('elimu_guardian_channel_consent').upsert({ guardian_id: guardianId, channel, status, source, note, decided_at: new Date().toISOString() }, { onConflict: 'tenant_id,guardian_id,channel' }).select().single());
  },

  async findMatches({ first_name, last_name, phone, email }) {
    return unwrap(await supabase.rpc('elimu_find_guardian_matches', { p_first: first_name || null, p_last: last_name || null, p_phone: phone || null, p_email: email || null, p_exclude: null })) || [];
  },
};
