// Display copy for roles and permissions. The truth lives in the database
// (pos_all_permissions / pos_role_default_permissions); this file is labels only, so a key
// missing here still works, just unlabelled. Keys match the live database exactly.
export const ROLES = [
  { key: 'manager', label: 'Manager', hint: 'Runs the business day to day: sales, stock, money, refunds approval. No settings, staff or payroll by default.' },
  { key: 'cashier', label: 'Cashier', hint: 'Makes sales, takes payments, can ask for a sale to be reversed.' },
  { key: 'storekeeper', label: 'Storekeeper', hint: 'Stock: receiving, adjusting, counting, transfers and purchases.' },
  { key: 'accountant', label: 'Accountant', hint: 'Money, balances, spending records and exports. Cannot approve payments.' },
  { key: 'hr_officer', label: 'HR officer', hint: 'Staff records only. No salaries unless allowed.' },
];
export const ROLE_LABEL = Object.fromEntries([['owner', 'Owner'], ...ROLES.map((r) => [r.key, r.label])]);

export const PERMISSION_GROUPS = [
  { group: 'Selling', items: [['sales.view', 'See past sales'], ['sales.create', 'Make sales'], ['sales.discount', 'Give discounts'],
    ['refunds.request', 'Ask for a sale to be reversed'], ['refunds.approve', 'Approve sale reversals'], ['operations.use', 'Use rooms, services and operations']] },
  { group: 'Stock', items: [['products.manage', 'Add / edit items and prices'], ['inventory.view', 'See stock'], ['inventory.scan', 'Scan items'],
    ['inventory.receive', 'Receive goods'], ['inventory.adjust', 'Adjust stock'], ['inventory.stocktake', 'Stock counts'],
    ['inventory.transfer', 'Move stock'], ['purchases.create', 'Make purchase orders']] },
  { group: 'Money', items: [['finance.view', 'See money, reports and close the day'], ['balances.view', 'See customer and supplier balances'],
    ['expenses.record', 'Record spending'], ['payments.record', 'Record payments'], ['payments.approve', 'Approve payments and sign off the day'],
    ['reports.export', 'Export reports']] },
  { group: 'Business', items: [['employees.manage', 'Staff records (HR)'], ['payroll.access', 'Payroll and salaries'],
    ['settings.manage', 'Change business settings, name and logo'], ['audit.view', 'See the audit trail and control report']] },
];
