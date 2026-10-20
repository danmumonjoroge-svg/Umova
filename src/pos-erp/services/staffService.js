// src/pos-erp/services/staffService.js
//
// Owner-only staff management. Thin wrappers over the phase28 RPCs; every
// rule (owner-only, no self-changes, no editing owners, tenant isolation) is
// enforced inside those RPCs, not here.

import { posSupabase as supabase } from './posSupabaseClient';

const REASONS = {
  NOT_OWNER: 'Only the business owner can do this.',
  BAD_ROLE: 'Please choose a role.',
  BAD_USERNAME: 'Username must be 3 to 30 letters, numbers, dots, dashes or underscores, with no spaces.',
  BAD_NAME: 'Please enter the person\u2019s name.',
  WEAK_PASSWORD: 'The temporary password must be at least 8 characters.',
  USERNAME_TAKEN: 'That username is already used in your business. Try another.',
  NOT_FOUND: 'That person could not be found.',
  CANNOT_CHANGE_SELF: 'You cannot change your own access.',
  CANNOT_CHANGE_OWNER: 'The owner\u2019s access cannot be changed here.',
  BAD_PERMISSION: 'That permission does not exist.',
  BAD_STATUS: 'Invalid status.',
  LOGIN_RECORD_MISSING: 'This person has no sign-in record. Contact support.',
};

/** True when the phase28 migration has not been applied to this database yet. */
export function isNotDeployed(error) {
  return !!error && (error.code === 'PGRST202' || error.code === '42883'
    || /could not find the function|does not exist/i.test(error.message || ''));
}

async function call(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const e = new Error(isNotDeployed(error) ? 'Staff management is not switched on for this account yet.' : (error.message || 'Something went wrong.'));
    e.notDeployed = isNotDeployed(error);
    throw e;
  }
  if (!data?.ok) {
    const e = new Error(REASONS[data?.reason] || 'Something went wrong. Please try again.');
    e.reason = data?.reason;
    throw e;
  }
  return data;
}

/** Random temporary password without look-alike characters (no 0/O, 1/l/I). */
export function generateTempPassword(length = 10) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

export const staffService = {
  async list() { return (await call('pos_list_staff', {})).staff; },
  create({ username, name, phone, email, template, tempPassword }) {
    return call('pos_create_staff', {
      p_username: username, p_name: name, p_phone: phone || '', p_email: email || '',
      p_template: template, p_temp_password: tempPassword,
    });
  },
  setTemplate(staffId, template, resetOverrides = true) {
    return call('pos_set_staff_template', { p_staff_id: staffId, p_template: template, p_reset_overrides: resetOverrides });
  },
  /** granted: true | false | null (null = back to the role default) */
  setPermission(staffId, permission, granted) {
    return call('pos_set_staff_permission', { p_staff_id: staffId, p_perm: permission, p_granted: granted });
  },
  setStatus(staffId, status) { return call('pos_set_staff_status', { p_staff_id: staffId, p_status: status }); },
  resetPassword(staffId, tempPassword) { return call('pos_reset_staff_password', { p_staff_id: staffId, p_temp_password: tempPassword }); },
};
