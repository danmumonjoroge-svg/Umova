// Staff and permissions. These wrappers call the EXISTING database functions (pos_my_permissions,
// pos_list_staff, pos_create_staff, pos_set_staff_template, pos_set_staff_permission,
// pos_set_staff_status, pos_reset_staff_password) plus pos_my_access from phase28.
// The DATABASE decides; these only carry the request. Refusals come back as { ok:false, reason }.
import { posSupabase as supabase } from './posSupabaseClient';

const REASONS = {
  NOT_OWNER: 'Only the business owner can do that.',
  NOT_ALLOWED: 'You do not have permission to do that.',
  CANNOT_CHANGE_SELF: 'You cannot change your own role or permissions.',
  CANNOT_CHANGE_OWNER: 'The owner account cannot be changed here.',
  NOT_FOUND: 'That staff member was not found.',
  BAD_ROLE: 'Pick one of the listed roles.',
  BAD_USERNAME: 'Username must be 3 to 30 letters, numbers, dots, dashes or underscores.',
  BAD_NAME: 'Enter the staff member’s name.',
  WEAK_PASSWORD: 'The temporary password must be at least 8 characters.',
  USERNAME_TAKEN: 'That username is already used in this business.',
  BAD_PERMISSION: 'Unknown permission.',
  BAD_STATUS: 'Unknown status.',
  LOGIN_RECORD_MISSING: 'This person’s login record is missing, so the password was not changed.',
};
export function friendly(code = '') {
  return REASONS[code] || code || 'Something went wrong.';
}

async function call(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data;
}
// Owner-only RPCs answer { ok:false, reason }. Turn that into a thrown, readable error.
async function act(name, args) {
  const r = await call(name, args);
  if (r && r.ok === false) throw new Error(friendly(r.reason));
  return r;
}

export const permissionService = {
  /** { ok, is_owner, role, template, permissions: [] } -- throws if phase28 is not deployed yet. */
  my: () => call('pos_my_access'),
  listStaff: async () => {
    const r = await act('pos_list_staff');
    return r.staff || [];
  },
  create: ({ username, name, phone, email, template, password }) =>
    act('pos_create_staff', { p_username: username, p_name: name, p_phone: phone || null, p_email: email || null, p_template: template, p_temp_password: password }),
  setTemplate: (staffId, template, resetOverrides = true) =>
    act('pos_set_staff_template', { p_staff_id: staffId, p_template: template, p_reset_overrides: resetOverrides }),
  /** granted: true / false = override, null = back to the role's default */
  setPermission: (staffId, permission, granted) =>
    act('pos_set_staff_permission', { p_staff_id: staffId, p_perm: permission, p_granted: granted }),
  setStatus: (staffId, status) => act('pos_set_staff_status', { p_staff_id: staffId, p_status: status }),
  resetPassword: (staffId, password) => act('pos_reset_staff_password', { p_staff_id: staffId, p_temp_password: password }),
};
