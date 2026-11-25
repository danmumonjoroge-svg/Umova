// elimu/shared/services/accessService.js -- who the signed-in person is in Elimu (roles) and role/allocation management.
import { rpc, select, write } from './elimuDb';

export const accessService = {
  /** { ok, is_owner, roles:[], actions:[] } -- what to SHOW; the database decides every action. */
  my: () => rpc('elimu_my_access'),
  listRoles: () => select('elimu_staff_roles', (q) => q.order('created_at')),
  grantRole: ({ tenantId, businessId, staffId, role, userId }) => write('elimu_staff_roles', 'insert', { tenant_id: tenantId, business_id: businessId, staff_id: staffId, role, granted_by: userId ?? null }),
  revokeRole: (id) => write('elimu_staff_roles', 'delete', null, (q) => q.eq('id', id)),
  // Class-teacher assignments live in elimu_class_teachers (the older elimu_teacher_allocations table no longer exists), changed only through the database functions.
  listAllocations: () => select('elimu_class_teachers', (q) => q.eq('status', 'ACTIVE').order('created_at')),
  allocate: async ({ classId, streamId, staffId, yearId }) => {
    let year = yearId;
    if (!year) { const y = await select('elimu_academic_years', (q) => q.eq('status', 'CURRENT').limit(1)); year = y?.[0]?.id; }
    if (!year) throw new Error('There is no current academic year yet. Set one up under Academics > Years, terms and setup first.');
    return rpc('elimu_set_class_teacher', { p_year: year, p_class: classId, p_stream: streamId || null, p_teacher: staffId });
  },
  deallocate: (id) => rpc('elimu_end_class_teacher', { p_id: id, p_reason: 'Removed from Roles & permissions' }),
};
