// The shape of Finance, as the school sees it:  Finance > module > submodule > page.
// A leaf with `to` opens an existing page; a leaf with `soon: true` is shown greyed (it is planned, not built); any node with `children` opens another list.
// Visibility only: the database still decides what each click may do. `anyOf` = Elimu finance actions (finance.*); a node with children shows when any child shows.
const P = 'school-finance';

export const FINANCE_TREE = {
  key: 'finance', label: 'Finance', children: [
    { key: 'fees', label: 'Fees', icon: 'Wallet', desc: 'Billing, collection, bursaries and fee balances', children: [
      { key: 'collect', label: 'Collect fees', desc: 'Cash, M-Pesa, bank and cheque payments', to: `${P}/collect`, anyOf: ['finance.collect'] },
      { key: 'billing', label: 'Fee structure & billing', desc: 'Fee items, invoices and payment plans', to: `${P}/fees`, anyOf: ['finance.bill', 'finance.configure'] },
      { key: 'bursary', label: 'Bursaries & scholarships', desc: 'Discounts, bursaries, scholarships and write-offs', soon: true, anyOf: ['finance.view'] },
      { key: 'debtors', label: 'Fee balances', desc: 'Who owes what, and follow-ups', to: `${P}/debtors`, anyOf: ['finance.view'] },
      { key: 'approvals', label: 'Approvals', desc: 'Payments and adjustments waiting for approval', to: `${P}/approvals`, anyOf: ['finance.approve'] },
    ] },
    { key: 'receivables', label: 'Receivables', icon: 'HandCoins', desc: 'Money owed to the school', children: [
      { key: 'r-students', label: 'Students (parents)', desc: 'Fee balances by student, class and year', to: `${P}/debtors`, anyOf: ['finance.view'] },
      { key: 'r-government', label: 'Government & capitation', desc: 'Capitation and other government receipts', soon: true, anyOf: ['finance.view'] },
      { key: 'r-other', label: 'Sponsors & other', desc: 'Sponsors, rent, hire of facilities', soon: true, anyOf: ['finance.view'] },
    ] },
    { key: 'payables', label: 'Payables & expenses', icon: 'Receipt', desc: 'Money the school owes and spends', children: [
      { key: 'expenses', label: 'Expenses', desc: 'Record and approve school expenses', to: `${P}/expenses`, anyOf: ['finance.view', 'finance.expense'] },
      { key: 'p-suppliers', label: 'Suppliers', desc: 'Bills and balances owed to suppliers', soon: true, anyOf: ['finance.view'] },
      { key: 'p-staff', label: 'Staff & payroll', desc: 'Salaries, allowances and staff claims', soon: true, anyOf: ['finance.view'] },
      { key: 'budgets', label: 'Budgets', desc: 'Budget against actual', to: `${P}/budgets`, anyOf: ['finance.view'] },
    ] },
    { key: 'bank', label: 'Bank & cash', icon: 'Landmark', desc: 'Bank accounts and reconciliation', children: [
      { key: 'recon', label: 'Reconciliation', desc: 'Match bank and M-Pesa to the books', soon: true, anyOf: ['finance.view'] },
    ] },
    { key: 'assets', label: 'Assets & inventory', icon: 'Boxes', desc: 'Fixed assets and school stores', children: [
      { key: 'fixed', label: 'Fixed assets', desc: 'Buildings, vehicles, equipment, depreciation', soon: true, anyOf: ['finance.view'] },
      { key: 'stores', label: 'Stores & inventory', desc: 'Food, stationery, uniforms, supplies', soon: true, anyOf: ['finance.view'] },
    ] },
    { key: 'reports', label: 'Reports & statements', icon: 'BarChart3', desc: 'Statements and finance reports', children: [
      { key: 'fin-reports', label: 'Finance reports', desc: 'Collections, debtors and summaries', to: `${P}/reports`, anyOf: ['finance.view', 'finance.report'] },
      { key: 'sfp', label: 'Statement of financial position', desc: 'Assets, liabilities and funds', soon: true, anyOf: ['finance.report'] },
      { key: 'income', label: 'Income statement', desc: 'Income and expenditure for a period', soon: true, anyOf: ['finance.report'] },
      { key: 'cashflow', label: 'Cash flow statement', desc: 'Where cash came from and went', soon: true, anyOf: ['finance.report'] },
      { key: 'trial', label: 'Trial balance', desc: 'All account balances', soon: true, anyOf: ['finance.report'] },
    ] },
  ],
};

/** Walk the tree by path segments ('fees' / 'payables' ...). Returns the node, or null. */
export function findNode(segments, tree = FINANCE_TREE) {
  let node = tree;
  for (const seg of segments.filter(Boolean)) { node = (node.children || []).find((c) => c.key === seg); if (!node) return null; }
  return node;
}

/** Children this person may see. A child with children is shown when at least one descendant is allowed. */
export function visibleChildren(node, can) {
  const ok = (n) => (n.children ? n.children.some(ok) : !n.anyOf || n.anyOf.some((a) => can(a)));
  return (node.children || []).filter(ok);
}
