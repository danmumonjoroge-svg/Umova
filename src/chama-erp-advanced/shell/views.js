import React from "react";

// -----------------------------------------------------------------------------
// One registry of every screen reachable from a workspace.
//
// Role arrays below are COPIED unchanged from the old sidebar NAV so nobody
// gains or loses access in the redesign. They are checked with the existing
// hasRole() from ChamaContext — there is no second permission system. Each
// underlying screen also guards itself with hasRole() internally, and the
// database functions remain the place money rules are enforced.
// -----------------------------------------------------------------------------
export const ROLES = {
  ALL: null,
  OFFICIALS: ["secretary", "treasurer", "chairperson", "admin"],
  LOAN_STAFF: ["secretary", "treasurer", "chairperson"],
  TREASURER: ["treasurer"],
  TREASURER_CHAIR: ["treasurer", "chairperson"],
  WELFARE_STAFF: ["welfare_officer", "secretary", "treasurer", "chairperson"],
};

export const canSee = (hasRole, roles) => !roles || hasRole(roles);

const L = (loader) => React.lazy(loader);

export const VIEWS = {
  // ---- Money ----
  "money/contribute":      { title: "Contribute",          roles: ROLES.ALL,           C: L(() => import("../contributions/MemberContributionForm")) },
  "money/repay":           { title: "Repay a loan",        roles: ROLES.ALL,           C: L(() => import("../contributions/MemberContributionForm")), props: { initialType: "loan_repayment" } },
  "money/statement":       { title: "My statement",        roles: ROLES.ALL,           C: L(() => import("../workspaces/MyStatement")) },
  "money/reconciliation":  { title: "Check contributions", roles: ROLES.TREASURER,     C: L(() => import("../contributions/TreasurerReconciliation")) },
  "money/accounts":        { title: "Chama accounts",      roles: ROLES.TREASURER_CHAIR, C: L(() => import("../contributions/ChamaBankAccounts")) },
  "money/finances":        { title: "Chama finances",      roles: ROLES.TREASURER_CHAIR, C: L(() => import("../DashboardOverview")) },
  // ---- Loans ----
  "loans/mine":            { title: "My loans",            roles: ROLES.ALL,           C: L(() => import("../workspaces/MyLoans")) },
  "loans/apply":           { title: "Apply for a loan",    roles: ROLES.ALL,           C: L(() => import("../loans/MemberLoanApplication")), props: { startOpen: true } },
  "loans/applications":    { title: "My applications",     roles: ROLES.ALL,           C: L(() => import("../loans/MemberLoanApplication")) },
  "loans/rules":           { title: "Loan rules",          roles: ROLES.ALL,           C: L(() => import("../workspaces/LoanRulesView")) },
  "loans/approvals":       { title: "Applications & approvals", roles: ROLES.LOAN_STAFF, C: L(() => import("../loans/LoanApprovalQueue")) },
  "loans/rules-edit":      { title: "Set loan rules",      roles: ROLES.LOAN_STAFF,    C: L(() => import("../loans/LoanRulesCard")) },
  "loans/disbursement":    { title: "Disbursement",        roles: ROLES.TREASURER,     C: L(() => import("../loans/LoanDisbursementDesk")) },
  "loans/repayments":      { title: "Loan repayments",     roles: ROLES.TREASURER,     C: L(() => import("../loans/LoanRepaymentDesk")) },
  // ---- Welfare ----
  "welfare/mine":          { title: "My welfare",          roles: ROLES.ALL,           C: L(() => import("../workspaces/MemberWelfare")) },
  "welfare/contribute":    { title: "Give to welfare",     roles: ROLES.ALL,           C: L(() => import("../contributions/MemberContributionForm")), props: { initialType: "welfare" } },
  "welfare/cases":         { title: "Welfare cases",       roles: ROLES.WELFARE_STAFF, C: L(() => import("../welfare/WelfareCaseDesk")) },
  "welfare/events":        { title: "Welfare events",      roles: ROLES.WELFARE_STAFF, C: L(() => import("../welfare/WelfareEventPlanner")) },
  "welfare/insights":      { title: "Welfare insights",    roles: ROLES.WELFARE_STAFF, C: L(() => import("../welfare/WelfareInsightsReport")) },
  // ---- More ----
  "more/updates":          { title: "Updates",             roles: ROLES.ALL,           C: L(() => import("../workspaces/UpdatesWorkspace")) },
};

// Routes are plain strings: "home" | "money" | "money/contribute" | "members/profile/<id>"
// A query string may follow: "money/statement?account=savings".
export function parseRoute(route) {
  const [path, qs] = (route || "home").split("?");
  const [ws, ...rest] = path.split("/");
  const params = Object.fromEntries(new URLSearchParams(qs || ""));
  return { ws, view: rest.join("/") || null, key: rest.length ? `${ws}/${rest.join("/")}` : ws, params, rest };
}
