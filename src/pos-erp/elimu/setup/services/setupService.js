// elimu/setup/services/setupService.js -- the "setup check" (elimu_1022): a read-only walk along the student journey.
import { rpc } from '../../shared/services/elimuDb';

/** One short sentence for the top of the page. checks = [{ok}]. */
export const summaryLine = (checks = []) => {
  const open = checks.filter((c) => !c.ok).length;
  return open === 0 ? 'Everything along the student journey is in place.' : `${open} of ${checks.length} steps need attention.`;
};
/** Plain sentences for the result of filling the demo, one per stage. */
export const demoReport = (res) => Object.entries(res?.stages || {}).map(([k, v]) => ({ key: k, status: v.status, detail: v.detail }));
export const setupService = {
  health: () => rpc('elimu_setup_health'),
  isDemo: () => rpc('elimu_is_demo').catch(() => false),   // an older database without elimu_1024 simply never shows the demo button
  fillDemo: () => rpc('elimu_demo_journey'),
  fillFamily: () => rpc('elimu_demo_family'),   // needs elimu_1028: teachers, principal, optional subject, a demo parent with two children, published results
};
