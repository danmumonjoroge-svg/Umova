// Staff of the school. Accounts are the shared staff accounts (owner-only RPCs, every rule enforced in the database);
// what a person may DO in Elimu comes from Elimu roles (elimu_set_role). Everyone is created with the least-privileged
// account type ("cashier") and gets their access through the school role chosen here.
import { supabase, staffService, generateTempPassword, unwrap } from './platform.js';

export { generateTempPassword };
const SHOP_TEMPLATE = 'cashier';

export const staffAdmin = {
  /** Every staff member with their school roles: [{ id, name, username, phone, status, is_self, role, roles: [..] }] */
  async list() {
    const [people, roles] = await Promise.all([staffService.list(), supabase.from('elimu_staff_roles').select('staff_id, role').then(unwrap)]);
    const by = {}; for (const r of roles || []) (by[r.staff_id] ||= []).push(r.role);
    return people.map((p) => ({ ...p, roles: (by[p.id] || []).sort() }));
  },
  async setRole(staffId, role, granted) { return unwrap(await supabase.rpc('elimu_set_role', { p_staff: staffId, p_role: role, p_granted: granted })); },
  /** Creates the account, then gives the school role. If the role step fails the account still exists and the error says so. */
  async create({ name, username, phone, role, tempPassword }) {
    const r = await staffService.create({ username, name, phone, email: '', template: SHOP_TEMPLATE, tempPassword });
    try { await this.setRole(r.staff_id, role, true); }
    catch (e) { const err = new Error(`${name} was added, but the role could not be given: ${e.message} Open their card and add the role again.`); err.partial = true; throw err; }
    return r;
  },
  setStatus: (id, status) => staffService.setStatus(id, status),
  resetPassword: (id, tempPassword) => staffService.resetPassword(id, tempPassword),
};
