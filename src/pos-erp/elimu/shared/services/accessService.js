// elimu/shared/services/accessService.js -- who the signed-in person is in Elimu (roles) and role/allocation management.
import { rpc, select, write } from './elimuDb';

export const accessService = {
  /** { ok, is_owner, roles:[], actions:[] } -- what to SHOW; the database decides every action. */
  my: () => rpc('elimu_my_access'),
  listRoles: () => select('elimu_staff_roles', (q) => q.order('created_at')),
  grantRole: ({ tenantId, businessId, staffId, role, userId }) => write('elimu_staff_roles', 'insert', { tenant_id: tenantId, business_id: businessId, staff_id: staffId, role, granted_by: userId ?? null }),
  revokeRole: (id) => write('elimu_staff_roles', 'delete', null, (q) => q.eq('id', id)),
  listAllocations: () => select('elimu_teacher_allocations', (q) => q.eq('is_active', true).order('created_at')),
  allocate: ({ tenantId, businessId, staffId, type, classId, streamId, subjectId, yearId, userId }) => write('elimu_teacher_allocations', 'insert',
    { tenant_id: tenantId, business_id: businessId, staff_id: staffId, allocation_type: type, class_id: classId, stream_id: streamId || null, subject_id: subjectId || null, academic_year_id: yearId || null, created_by: userId ?? null }),
  deallocate: (id) => write('elimu_teacher_allocations', 'update', { is_active: false }, (q) => q.eq('id', id)),
};
