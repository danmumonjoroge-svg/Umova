import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const sql = fs.readFileSync(new URL('../sql/002_elimu_aia_accounting_outbox.sql', import.meta.url), 'utf8');

test('AIA accounting outbox is idempotent per business and source event', () => {
  assert.match(sql, /UNIQUE\s*\(business_id,\s*event_key\)/i);
  assert.match(sql, /ON CONFLICT \(business_id, event_key\) DO NOTHING/i);
});

test('AIA accounting proposals are balanced two-line journals and are not auto-posted', () => {
  assert.match(sql, /jsonb_array_length\(journal_lines\) = 2/i);
  assert.match(sql, /'NEEDS_MAPPING'/);
  assert.match(sql, /'READY_FOR_ADAPTER'/);
  assert.match(sql, /'POSTED'/);
  assert.match(sql, /does not post into the GL/i);
});

test('income, expense and paid remittance have explicit provisional account keys', () => {
  for (const key of ['AIA_RECEIVABLE_CLEARING','AIA_INCOME','AIA_OPERATING_EXPENSE','AIA_PAYABLE_CLEARING','SCHOOL_BANK_CLEARING','SCHOOL_MPESA_CLEARING','SCHOOL_CASH_CLEARING']) {
    assert.ok(sql.includes(key), `missing ${key}`);
  }
  assert.match(sql, /NEW\.status = 'PAID' AND OLD\.status IS DISTINCT FROM 'PAID'/i);
});

test('outbox direct writes are revoked and reads remain tenant/permission scoped', () => {
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE ON public\.elimu_aia_accounting_events FROM anon, authenticated/i);
  assert.match(sql, /tenant_id = public\.get_current_tenant_id\(\) AND public\.pos_has_permission\('finance\.view'\)/i);
});
