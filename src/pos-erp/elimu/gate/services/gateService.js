// elimu/gate/services/gateService.js -- thin wrappers over the gate RPCs. The database decides PRESENT / LATE, refuses weekends and
// submitted registers, and keeps the permanent scan log.
import { rpc } from '../../shared/services/elimuDb';

export const gateService = {
  find: (q) => rpc('elimu_gate_find', { p_query: q }),
  /** direction IN|OUT, method FINGERPRINT|CARD|MANUAL. at defaults to now on the server. */
  checkIn: ({ studentId, direction = 'IN', method = 'MANUAL', device = null, at = null }) =>
    rpc('elimu_gate_check_in', { p_student: studentId, p_direction: direction, p_method: method, p_device: device, ...(at ? { p_at: at } : {}) }),
  /** { arrived, late, left, problems, scans[], not_arrived[] } for a day (default today). */
  today: (date = null) => rpc('elimu_gate_today', date ? { p_date: date } : {}),
};
