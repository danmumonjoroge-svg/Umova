/** Pure AIA reporting helpers. Amounts are rounded to two decimal places. */
export function transactionTotal(quantity, unitPrice) {
  const q = Number(quantity); const p = Number(unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p < 0) throw new Error('Quantity must be positive and unit price cannot be negative.');
  return Math.round((q * p + Number.EPSILON) * 100) / 100;
}
export function summarizeAia(transactions = [], remittances = []) {
  const income = transactions.filter(x => x.transaction_type === 'INCOME').reduce((s,x) => s + Number(x.total_amount || 0), 0);
  const expenses = transactions.filter(x => x.transaction_type === 'EXPENSE').reduce((s,x) => s + Number(x.total_amount || 0), 0);
  const remitted = remittances.filter(x => x.status === 'PAID').reduce((s,x) => s + Number(x.amount || 0), 0);
  return { income: cents(income), expenses: cents(expenses), surplus: cents(income - expenses), remitted: cents(remitted), pending: remittances.filter(x => x.status === 'PENDING').length };
}
function cents(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
