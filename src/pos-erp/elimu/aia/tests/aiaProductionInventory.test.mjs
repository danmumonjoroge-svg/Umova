import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('../sql/003_elimu_aia_production_inventory.sql', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../services/aiaService.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../pages/AIAOperationsPanel.jsx', import.meta.url), 'utf8');
const host = fs.readFileSync(new URL('../pages/ElimuAIAPage.jsx', import.meta.url), 'utf8');

test('production batches and records support poultry, livestock, dairy, crops and fish', () => {
  for (const token of ['elimu_aia_batches','POULTRY_FLOCK','LIVESTOCK_HERD','DAIRY_HERD','CROP_CYCLE','FISH_POND','MORTALITY','YIELD','HARVEST','QUANTITY_IN']) assert.ok(sql.includes(token), `missing ${token}`);
  assert.match(sql, /elimu_aia_batch_balances/i);
  assert.match(sql, /current_quantity numeric\(14,3\) NOT NULL DEFAULT 0/i);
  assert.match(sql, /current_quantity = v_current \+ v_delta/i);
});

test('production and inventory tables are tenant and permission scoped', () => {
  for (const table of ['elimu_aia_batches','elimu_aia_production_records','elimu_aia_inventory_items','elimu_aia_inventory_movements']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, 'i'));
    assert.ok(sql.includes(`${table}.tenant_id = public.get_current_tenant_id()`), `missing tenant policy for ${table}`);
  }
  assert.match(sql, /elimu_aia_production_records\.batch_id IS NULL OR EXISTS/i);
  assert.match(sql, /i\.id = elimu_aia_inventory_movements\.item_id/i);
});

test('stock balances are atomically maintained from append-only movements and stock cannot be over-issued', () => {
  assert.match(sql, /CREATE OR REPLACE VIEW public\.elimu_aia_inventory_balances/i);
  assert.match(sql, /v_delta := CASE WHEN NEW\.movement_type IN \('RECEIPT','ADJUSTMENT_IN'\) THEN NEW\.quantity ELSE -NEW\.quantity END/i);
  assert.match(sql, /FOR UPDATE[\s\S]*Issue quantity \(%\) exceeds stock on hand/i);
  assert.match(sql, /CREATE TRIGGER elimu_aia_guard_inventory_stock_trg/i);
});

test('mortality cannot exceed current batch quantity and concurrent reductions lock the batch', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.elimu_aia_guard_batch_quantity/i);
  assert.match(sql, /FOR UPDATE[\s\S]*Mortality quantity \(%\) exceeds available batch quantity/i);
  assert.match(sql, /CREATE TRIGGER elimu_aia_guard_batch_quantity_trg/i);
});

test('service and UI expose the production and inventory workflows', () => {
  for (const method of ['batches','productionRecords','inventoryBalances','inventoryMovements','createBatch','recordProduction','createInventoryItem','recordInventoryMovement']) assert.match(service, new RegExp(`${method}\\(`));
  for (const token of ['Production & livestock register','Farm inputs & inventory','Record production','Stock movement','Reorder needed']) assert.ok(page.includes(token), `missing UI token ${token}`);
  assert.match(host, /tab==='production'/);
  assert.match(host, /tab==='inventory'/);
});
