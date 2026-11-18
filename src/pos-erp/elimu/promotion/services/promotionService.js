// elimu/promotion/services/promotionService.js -- wrappers over elimu_1007_promotion.sql.
import { rpc } from '../../shared/services/elimuDb';
export const promotionService = {
  preview: (fromYear, toYear) => rpc('elimu_promotion_preview', { p_from_year: fromYear, p_to_year: toYear }),
  apply: (fromYear, toYear, decisions) => rpc('elimu_promotion_apply', { p_from_year: fromYear, p_to_year: toYear, p_decisions: decisions }),
};

/** Starting decisions for a preview: PROMOTE to the suggested next class, or GRADUATE when the class has no class above it. Already-placed students are left out. */
export function defaultDecisions(preview) {
  const d = {};
  for (const c of preview.classes || []) for (const s of c.students || []) {
    if (s.placed) continue;
    d[s.student_id] = c.next_class_id ? { action: 'PROMOTE', class_id: c.next_class_id } : { action: 'GRADUATE', class_id: null };
  }
  return d;
}
/** The list sent to the database: one entry per decided student; HOLD entries are dropped (nothing to change). */
export function decisionList(decisions) {
  return Object.entries(decisions).filter(([, v]) => v.action !== 'HOLD').map(([student_id, v]) => ({ student_id, action: v.action, ...(v.class_id && v.action === 'PROMOTE' ? { class_id: v.class_id } : {}) }));
}
export function tally(decisions) {
  const t = { PROMOTE: 0, REPEAT: 0, GRADUATE: 0, HOLD: 0 };
  for (const v of Object.values(decisions)) t[v.action] = (t[v.action] || 0) + 1;
  return t;
}
