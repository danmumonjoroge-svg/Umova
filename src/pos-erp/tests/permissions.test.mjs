// Run: node --test tests/permissions.test.mjs   (from src/pos-erp)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ALL_PERMISSIONS, ROLE_TEMPLATES, effectivePermissions, routeRule, canAccessPath, can, ROUTE_PERMISSIONS, ASSIGNABLE_TEMPLATES } from '../utils/permissions.js';

const sql = fs.readFileSync(new URL('../schema/phase28_permissions.sql', import.meta.url), 'utf8');
const arr = (txt) => [...txt.matchAll(/'([a-z_.]+)'/g)].map((m) => m[1]);

test('SQL catalogue == JS catalogue (no drift)', () => {
  const body = sql.match(/FUNCTION pos_all_permissions\(\)[\s\S]*?ARRAY\[([\s\S]*?)\]\s*\$\$/)[1];
  assert.deepEqual(arr(body).sort(), [...ALL_PERMISSIONS].sort());
});

test('SQL role defaults == JS role templates (no drift)', () => {
  const fn = sql.match(/FUNCTION pos_role_default_permissions[\s\S]*?\$\$;/)[0];
  for (const t of ['manager', 'cashier', 'storekeeper', 'accountant', 'hr_officer']) {
    const m = fn.match(new RegExp(`WHEN '${t}' THEN ARRAY\\[([\\s\\S]*?)\\]`));
    assert.ok(m, `template ${t} missing in SQL`);
    assert.deepEqual(arr(m[1]).sort(), [...ROLE_TEMPLATES[t]].sort(), t);
  }
});

test('every template only uses catalogue permissions', () => {
  for (const [t, perms] of Object.entries(ROLE_TEMPLATES)) for (const p of perms) assert.ok(ALL_PERMISSIONS.includes(p), `${t}: ${p}`);
});
test('assignable templates never include owner; all exist', () => {
  for (const t of ASSIGNABLE_TEMPLATES) { assert.notEqual(t.key, 'owner'); assert.ok(ROLE_TEMPLATES[t.key]); }
});
test('payroll.access is owner-only by default', () => {
  for (const [t, perms] of Object.entries(ROLE_TEMPLATES)) assert.equal(perms.includes('payroll.access'), t === 'owner', t);
});

test('effectivePermissions applies overrides, ignores unknown keys, owner is fixed', () => {
  assert.ok(effectivePermissions('cashier').includes('sales.create'));
  assert.ok(!effectivePermissions('cashier', { 'sales.create': false }).includes('sales.create'));
  assert.ok(effectivePermissions('hr_officer', { 'payroll.access': true }).includes('payroll.access'));
  assert.ok(!effectivePermissions('cashier', { 'root.all': true }).includes('root.all'));
  assert.equal(effectivePermissions('owner', { 'sales.create': false }).length, ALL_PERMISSIONS.length);
  assert.deepEqual(effectivePermissions('nonsense'), []);
});

test('can() fails CLOSED', () => {
  assert.equal(can(null, 'sales.create'), false);
  assert.equal(can({}, 'sales.create'), false);
  assert.equal(can({ role: 'owner' }, 'sales.create'), false);
  assert.equal(can({ permissions: [] }, 'sales.create'), false);
  assert.equal(can({ permissions: ['sales.create'] }, 'sales.create'), true);
  assert.equal(can({ hasPermission: (k) => k === 'a.b' }, 'a.b'), true);
});

test('route rules: exact till, longest prefix, default, owner-only', () => {
  assert.deepEqual(routeRule('/pos'), ['sales.create']);
  assert.deepEqual(routeRule('/pos/'), ['sales.create']);
  assert.equal(routeRule('/pos/dashboard'), null);
  assert.deepEqual(routeRule('/pos/financials'), ['finance.view']);
  assert.deepEqual(routeRule('/pos/financials/anything'), ['finance.view']);
  assert.deepEqual(routeRule('/pos/rentals'), ['operations.use']);   // unlisted => operations.use
  assert.deepEqual(routeRule('/pos/communication'), ['operations.use']);
  assert.equal(routeRule('/pos/staff'), '@owner');
  // prefix must not match a sibling: /pos/communication must not be caught by /pos/comms-like rules
  assert.deepEqual(routeRule('/pos/payables-x'), ['operations.use']);
});

test('canAccessPath by role', () => {
  const mk = (t) => { const s = new Set(effectivePermissions(t)); return (p) => s.has(p); };
  const cashier = mk('cashier'), acct = mk('accountant'), store = mk('storekeeper'), owner = mk('owner');
  assert.equal(canAccessPath('/pos', cashier, false), true);
  assert.equal(canAccessPath('/pos/financials', cashier, false), false);
  assert.equal(canAccessPath('/pos/audit', cashier, false), false);
  assert.equal(canAccessPath('/pos/staff', cashier, false), false);
  assert.equal(canAccessPath('/pos/staff', owner, true), true);
  assert.equal(canAccessPath('/pos/financials', acct, false), true);
  assert.equal(canAccessPath('/pos', acct, false), false);
  assert.equal(canAccessPath('/pos/goods-receiving', store, false), true);
  assert.equal(canAccessPath('/pos/expenses', store, false), false);
  assert.equal(canAccessPath('/pos/dashboard', acct, false), true);
  assert.equal(canAccessPath('/pos/settings', cashier, false), true);
});

test('every listed route rule only references real permissions', () => {
  for (const [path, rule] of Object.entries(ROUTE_PERMISSIONS)) {
    if (Array.isArray(rule)) for (const p of rule) assert.ok(ALL_PERMISSIONS.includes(p), `${path}: ${p}`);
  }
});
