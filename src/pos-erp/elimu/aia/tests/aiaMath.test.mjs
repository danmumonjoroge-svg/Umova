import test from 'node:test';
import assert from 'node:assert/strict';
import { transactionTotal, summarizeAia } from '../utils/aiaMath.js';

test('AIA transaction total handles fractional quantities and rounds to cents', () => {
  assert.equal(transactionTotal('2.5', '18.40'), 46);
});
test('AIA rejects zero/negative quantities and negative prices', () => {
  assert.throws(() => transactionTotal(0, 10));
  assert.throws(() => transactionTotal(1, -1));
});
test('operating surplus excludes remittances to avoid double counting', () => {
  assert.deepEqual(summarizeAia([
    { transaction_type: 'INCOME', total_amount: '1000.00' },
    { transaction_type: 'EXPENSE', total_amount: '250.25' },
  ], [
    { status: 'PAID', amount: '500.00' },
    { status: 'APPROVED', amount: '125.00' },
    { status: 'PENDING', amount: '100.00' },
  ]), { income: 1000, expenses: 250.25, surplus: 749.75, remitted: 500, pending: 1 });
});
