// elimu/audit/services/activityService.js -- read-only activity log (elimu_1010). Only school management may read it.
import { rpc } from '../../shared/services/elimuDb';

export const ACTION_LABEL = {
  GATE_PASS_CREATED: 'Gate pass written', GATE_PASS_CANCELLED: 'Gate pass cancelled', GATE_PASS_EXIT: 'Student left through the gate',
  IMPORT_COMMITTED: 'Import saved', IMPORT_DISCARDED: 'Import discarded', PROMOTION_APPLIED: 'Promotion applied',
  STUDENT_LEFT: 'Student left school', STUDENT_REINSTATED: 'Student reinstated', ELIMU_ROLE_CHANGED: 'Staff role changed', ELIMU_SIGN_IN: 'Signed in',
};
export const actionLabel = (a) => ACTION_LABEL[a] || String(a || '').toLowerCase().replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const activityService = {
  list: ({ from, to, action, actor } = {}) => rpc('elimu_activity_log', { p_from: from || null, p_to: to || null, p_action: action || null, p_actor: actor || null }),
};
