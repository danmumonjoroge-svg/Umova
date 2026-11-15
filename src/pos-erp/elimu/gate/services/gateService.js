// elimu/gate/services/gateService.js -- thin wrappers over the gate RPCs. The database decides PRESENT / LATE, refuses weekends and
// submitted registers, and keeps the permanent scan log.
import { rpc, select } from '../../shared/services/elimuDb';

export const gateService = {
  find: (q) => rpc('elimu_gate_find', { p_query: q }),
  /** direction IN|OUT, method FINGERPRINT|CARD|MANUAL. at defaults to now on the server. */
  checkIn: ({ studentId, direction = 'IN', method = 'MANUAL', device = null, at = null }) =>
    rpc('elimu_gate_check_in', { p_student: studentId, p_direction: direction, p_method: method, p_device: device, ...(at ? { p_at: at } : {}) }),
  today: (sinceIso) => select('elimu_gate_events', (q) => q.gte('scanned_at', sinceIso).order('scanned_at', { ascending: false }).limit(60)),
};
