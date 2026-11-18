// elimu/gate/services/gatePassService.js -- wrappers over the gate pass functions (elimu_1003). The database decides who may write, answer and release.
import { rpc } from '../../shared/services/elimuDb';

export const gatePassService = {
  create: ({ studentId, reason, collectorName, collectorPhone, hours = 6 }) => rpc('elimu_gate_pass_create', { p_student: studentId, p_reason: reason, p_collector_name: collectorName || null, p_collector_phone: collectorPhone || null, p_valid_hours: hours }),
  cancel: (id, reason) => rpc('elimu_gate_pass_cancel', { p_pass: id, p_reason: reason }),
  list: (view) => rpc('elimu_gate_pass_list', { p_view: view }),          // 'mine' | 'cleared' | 'all'
  exitLog: (from, to, search) => rpc('elimu_gate_exit_log', { p_from: from, p_to: to, p_search: search || null }),
  exit: (id, note) => rpc('elimu_gate_pass_exit', { p_pass: id, p_note: note || null }),
};
