// elimu/dashboard/services/dashboardService.js -- the management dashboard (elimu_1017). Sections the person may not see arrive as null.
import { rpc } from '../../shared/services/elimuDb';

export const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 0 })}`;
export const pct = (part, whole) => (Number(whole) > 0 ? `${Math.round((Number(part) / Number(whole)) * 100)}%` : '-');
/** Plain-language lines that need attention, built only from the sections present. */
export function attentionItems(d) {
  const out = []; if (!d) return out;
  const a = d.attendance; if (a) { const left = Number(a.classes_expected) - Number(a.classes_submitted); if (left > 0) out.push(`${left} class${left === 1 ? '' : 'es'} have not submitted today's attendance.`); }
  const f = d.fees; if (f && Number(f.students_owing) > 0) out.push(`${f.students_owing} students owe ${kes(f.outstanding)} in fees.`);
  const g = d.gate; if (g && Number(g.waiting_parent) > 0) out.push(`${g.waiting_parent} gate pass${Number(g.waiting_parent) === 1 ? '' : 'es'} waiting for a parent's reply.`);
  const s = d.students; if (s && Number(s.pending_admissions) > 0) out.push(`${s.pending_admissions} admission application${Number(s.pending_admissions) === 1 ? '' : 's'} not yet decided.`);
  const u = d.upcoming; if (u && Number(u.overdue_books) > 0) out.push(`${u.overdue_books} library book${Number(u.overdue_books) === 1 ? ' is' : 's are'} overdue.`);
  return out;
}
/** Chart data (elimu_1019). Optional: if that file has not been installed yet this returns null and the charts that need it stay hidden. */
export const dashboardService = {
  get: () => rpc('elimu_mgmt_dashboard'),
  trends: async () => { try { return await rpc('elimu_mgmt_trends'); } catch { return null; } },
};
