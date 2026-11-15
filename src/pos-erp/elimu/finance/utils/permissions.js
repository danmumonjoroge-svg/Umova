// Finance action -> ELIMU role actions (decision D2, Option A). MIRRORS elimu_fin_can() in schema/elimu_000_core.sql:
// elimu_fin_can(x) == elimu_can('finance.' || x). POS permission keys no longer decide anything inside Elimu.
// This decides what the screen SHOWS. The database re-checks every action, so this is a convenience, never the security.
export const ACTION_PERMS = {
  view: ['finance.view'], collect: ['finance.collect'], bill: ['finance.bill'], approve: ['finance.approve'],
  configure: ['finance.configure'], expense: ['finance.expense'], report: ['finance.report'], audit: ['finance.audit'], reconcile: ['finance.reconcile'],
};
// has(p) answers "does the signed-in person hold Elimu action p?" (from elimu_my_access().actions). Owners hold everything.
export function canWith(has, action, isOwner = false) {
  if (isOwner) return true;
  return (ACTION_PERMS[action] || []).some(p => has(p));
}
