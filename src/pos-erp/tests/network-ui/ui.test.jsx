// UI integration test: the REAL screens (rendered in jsdom) -> the REAL networkService -> the REAL phase36 functions on scratch Postgres.
// Not covered here (jsdom has no layout engine): visual fit on a phone, touch behaviour, real browser.
import test, { afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import FindStockPage from '/home/claude/proj/pos-erp/pages/FindStockPage.jsx';
import NetworkOrdersPage from '/home/claude/proj/pos-erp/pages/NetworkOrdersPage.jsx';
import MyOffersPage from '/home/claude/proj/pos-erp/pages/MyOffersPage.jsx';
import MySuppliersPage from '/home/claude/proj/pos-erp/pages/MySuppliersPage.jsx';
import NetworkWorkspace from '/home/claude/proj/pos-erp/pages/workspaces/NetworkWorkspace.jsx';

const S = '00000000-0000-0000-0000-0000000000a1', B = '00000000-0000-0000-0000-0000000000a2';
const SUP = 'products.manage,sales.create,sales.view,inventory.view,settings.manage';
const BUY = 'purchases.create,inventory.view,inventory.receive';
const as = (tenant, perms) => { globalThis.__who = { tenant, perms }; };
const q = async (sql, p) => (await globalThis.__pool.query(sql, p)).rows;
const mount = (el) => render(<MemoryRouter>{el}</MemoryRouter>);
const T = { timeout: 4000 };
const cardOf = (text) => screen.getByText(text).closest('.flex-col');
const body = () => document.body.textContent;

afterEach(() => { cleanup(); globalThis.__online = true; });
after(() => globalThis.__pool.end());

test('Find Stock: a buyer sees published offers only, and nothing private', async () => {
  as(B, BUY); mount(<FindStockPage />);
  await screen.findByText('Sugar 50kg', {}, T);
  assert.ok(screen.getByText('Rice 25kg'));
  assert.ok(screen.getByText(/^Flour 2kg with a really long/), 'a very long product name still renders (truncated by CSS)');
  assert.equal(screen.getAllByRole('button', { name: 'View Offer' }).length, 3);
  for (const secret of ['Hidden Item', 'SECRET', '3500', '3000']) assert.ok(!body().includes(secret), `leaked: ${secret}`);
  assert.ok(within(cardOf('Sugar 50kg')).getByText('In stock'));
  assert.ok(within(cardOf('Rice 25kg')).getByText('Ask for price'), 'request-price offer shows no number');
  assert.ok(within(screen.getByText(/^Flour 2kg/).closest('.flex-col')).getByText('Connect first'), 'closed-to-new-buyers offer says so');
});

test('Find Stock: search narrows, and an empty result is a friendly message', async () => {
  as(B, BUY); mount(<FindStockPage />);
  await screen.findByText('Sugar 50kg', {}, T);
  fireEvent.change(screen.getByPlaceholderText(/Search a product/), { target: { value: 'rice' } });
  await waitFor(() => assert.ok(!screen.queryByText('Sugar 50kg') && screen.queryByText('Rice 25kg')), T);
  fireEvent.change(screen.getByPlaceholderText(/Search a product/), { target: { value: 'zzzz' } });
  await screen.findByText(/No offers match/, {}, T);
});

test('No internet: a clear banner, and the order button is disabled', async () => {
  as(B, BUY); mount(<FindStockPage />);
  await screen.findByText('Sugar 50kg', {}, T);
  globalThis.__online = false; window.dispatchEvent(new window.Event('offline'));
  await screen.findByText(/No internet/, {}, T);
  fireEvent.click(within(cardOf('Sugar 50kg')).getByText('View Offer'));
  assert.equal(screen.getByRole('button', { name: 'Order' }).disabled, true);
});

test('Order from a phone: estimate shown, double tap sends ONE order, reference shown, nothing reserved', async () => {
  as(B, BUY); mount(<FindStockPage />);
  await screen.findByText('Sugar 50kg', {}, T);
  fireEvent.click(within(cardOf('Sugar 50kg')).getByText('View Offer'));
  fireEvent.click(await screen.findByRole('button', { name: 'Order' }));
  fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '5' } });
  fireEvent.click(screen.getByText('I will collect'));
  assert.ok(body().includes('KES 500'), 'estimated total 5 x 100 shown');
  const send = screen.getByRole('button', { name: /Send order/ });
  fireEvent.click(send); fireEvent.click(send);                       // double tap
  await screen.findByText('Order sent', {}, T);
  assert.match(body(), /NET-\d{4}-\d{6}/);
  const rows = await q("select status,total,client_reference from network_orders");
  assert.equal(rows.length, 1, 'double tap made exactly one order');
  assert.equal(rows[0].status, 'AWAITING_CONFIRMATION'); assert.equal(Number(rows[0].total), 500);
  assert.equal((await q("select count(*)::int n from network_reservations"))[0].n, 0);
  assert.ok(body().includes('Nothing is reserved'));
});

test('Lost answer: UI admits it is unsure, locks the form, and retrying creates NO duplicate', async () => {
  as(B, BUY); mount(<FindStockPage />);
  await screen.findByText('Sugar 50kg', {}, T);
  fireEvent.click(within(cardOf('Sugar 50kg')).getByText('View Offer'));
  fireEvent.click(await screen.findByRole('button', { name: 'Order' }));
  fireEvent.change(screen.getByDisplayValue('2'), { target: { value: '3' } });
  fireEvent.click(screen.getByText('I will collect'));
  globalThis.__dropResponseOnce = true;                                 // server saves the order; the reply never arrives
  fireEvent.click(screen.getByRole('button', { name: /Send order/ }));
  await screen.findByText(/could not tell if your order was received/, {}, T);
  assert.equal(screen.getByDisplayValue('3').disabled, true, 'form is locked so a different order cannot be sent by accident');
  assert.ok(!body().includes('Order sent'), 'never claims success');
  fireEvent.click(screen.getByRole('button', { name: /Try sending again/ }));
  await screen.findByText('Order sent', {}, T);
  assert.equal((await q("select count(*)::int n from network_orders"))[0].n, 2, 'the retry did not create a third order');
});

test('Price changed after the buyer looked: refused, nothing created, new total shown, second tap succeeds', async () => {
  await q("update network_offers set network_price = 120 where tenant_id = $1 and price_mode = 'SHOW' and product_id = '00000000-0000-0000-0000-0000000000c1'", [S]);
  as(B, BUY); mount(<FindStockPage />);
  await screen.findByText('Sugar 50kg', {}, T);                          // this load already shows 120, so make the page stale first
  await q("update network_offers set network_price = 100 where product_id = '00000000-0000-0000-0000-0000000000c1'");
  cleanup(); mount(<FindStockPage />);
  await screen.findByText('Sugar 50kg', {}, T);                          // page now holds price 100
  fireEvent.click(within(cardOf('Sugar 50kg')).getByText('View Offer'));
  fireEvent.click(await screen.findByRole('button', { name: 'Order' }));
  fireEvent.click(screen.getByText('I will collect'));                   // qty 2 x 100
  await q("update network_offers set network_price = 120 where product_id = '00000000-0000-0000-0000-0000000000c1'");   // supplier raises it meanwhile
  fireEvent.click(screen.getByRole('button', { name: /Send order/ }));
  await screen.findByText(/price has changed/i, {}, T);
  assert.equal((await q("select count(*)::int n from network_orders"))[0].n, 2, 'no order was created at the old price');
  assert.ok(body().includes('KES 240'), 'the new total is shown');
  fireEvent.click(screen.getByRole('button', { name: /Send order/ }));
  await screen.findByText('Order sent', {}, T);
  assert.equal((await q("select total from network_orders order by created_at desc limit 1"))[0].total, '240');
});

test('Supplier: sees the incoming order, confirms, prepares, dispatches; invoice and payment are NOT assumed; stock untouched', async () => {
  as(S, SUP); mount(<NetworkOrdersPage />);
  await screen.findAllByRole('button', { name: 'Confirm Order' }, T);
  assert.ok(!screen.queryByText('Purchases'), 'a supplier-only user has no Purchases tab');
  assert.equal(screen.getAllByRole('button', { name: 'Confirm Order' }).length, 3);
  fireEvent.click(screen.getAllByRole('button', { name: 'Confirm Order' })[0]);   // newest = the 240 order (qty 2)
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm order' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm order' }));
  await waitFor(async () => assert.equal((await q("select count(*)::int n from network_orders where status='CONFIRMED'"))[0].n, 1), T);
  assert.equal(Number((await q("select sum(quantity) s from network_reservations where status='ACTIVE'"))[0].s), 2);
  fireEvent.click(await screen.findByRole('button', { name: /Start preparing/ }, T));
  await waitFor(async () => assert.equal((await q("select count(*)::int n from network_orders where status='PREPARING'"))[0].n, 1), T);
  fireEvent.click(await screen.findByRole('button', { name: 'Mark as sent' }, T));
  fireEvent.click(await screen.findByRole('button', { name: 'Mark as sent' }, T));
  await waitFor(async () => assert.equal((await q("select count(*)::int n from network_orders where status='DISPATCHED'"))[0].n, 1), T);
  await screen.findByText('Not invoiced yet', {}, T); assert.ok(body().includes('Not paid yet'));
  const o = (await q("select invoice_status, payment_status from network_orders where status='DISPATCHED'"))[0];
  assert.deepEqual([o.invoice_status, o.payment_status], ['NOT_INVOICED', 'UNPAID']);
  assert.equal(Number((await q("select quantity from lb_inventory where product_id='00000000-0000-0000-0000-0000000000c1'"))[0].quantity), 100, 'stock only moves through the existing stock workflow (Phase 6)');
});

test('Buyer: sees the order as On the way, cannot see supplier-private data or supplier buttons', async () => {
  as(B, BUY); mount(<NetworkOrdersPage />);
  await screen.findAllByRole('button', { name: 'View Order' }, T);
  assert.ok(!screen.queryByText('Sales'), 'a buyer-only user has no Sales tab');
  const card = screen.getByText('On the way').closest('.flex-col');
  fireEvent.click(within(card).getByRole('button', { name: 'View Order' }));
  await screen.findByRole('button', { name: 'Report a problem' }, T);
  for (const bad of ['SECRET', 'supplier_product_id', 'Confirm order', 'Start preparing']) assert.ok(!body().includes(bad), bad);
  assert.ok(body().includes('coming in the next update'), 'honest about receiving not being wired yet');
});

test('Buyer cancels an unanswered order; supplier must give a reason to reject', async () => {
  as(B, BUY); mount(<NetworkOrdersPage />);
  await screen.findAllByRole('button', { name: 'View Order' }, T);
  const open = screen.getAllByRole('button', { name: 'View Order' }).map((b) => b.closest('.flex-col')).find((c) => within(c).queryByText('Waiting for supplier'));
  fireEvent.click(within(open).getByRole('button', { name: 'View Order' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel order' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Cancel order' }));
  await waitFor(async () => assert.equal((await q("select count(*)::int n from network_orders where status='CANCELLED'"))[0].n, 1), T);
  cleanup();
  as(S, SUP); mount(<NetworkOrdersPage />);
  fireEvent.click((await screen.findAllByRole('button', { name: 'Confirm Order' }, T))[0]);
  fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Reject order' }));
  await screen.findByText('Give the buyer a short reason.', {}, T);
  assert.equal((await q("select count(*)::int n from network_orders where status='AWAITING_CONFIRMATION'"))[0].n, 1, 'still awaiting: nothing changed');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Out of season' } });
  fireEvent.click(screen.getByRole('button', { name: 'Reject order' }));
  await waitFor(async () => assert.equal((await q("select count(*)::int n from network_orders where status='CANCELLED'"))[0].n, 2), T);
});

test('Network home shows only the cards a person may use', async () => {
  as(B, BUY); mount(<NetworkWorkspace />);
  await screen.findByText('Find Stock', {}, T);
  assert.ok(screen.getByText('My Orders') && screen.getByText('My Suppliers'));
  assert.ok(!screen.queryByText('My Offers'), 'a buyer-only user has no My Offers');
  cleanup(); as(S, SUP); mount(<NetworkWorkspace />);
  await screen.findByText('My Offers', {}, T);
});

test('My Offers: pause and resume work; publishing an item from the screen creates one live offer', async () => {
  as(S, SUP); mount(<MyOffersPage />);
  await screen.findByText('Sugar 50kg', {}, T);
  fireEvent.click(within(cardOf('Sugar 50kg')).getByText('Pause'));
  await waitFor(async () => assert.equal((await q("select status from network_offers where product_id='00000000-0000-0000-0000-0000000000c1'"))[0].status, 'PAUSED'), T);
  await within(cardOf('Sugar 50kg')).findByText('Paused', {}, T);
  fireEvent.click(within(cardOf('Sugar 50kg')).getByText('Resume'));
  await waitFor(async () => assert.equal((await q("select status from network_offers where product_id='00000000-0000-0000-0000-0000000000c1'"))[0].status, 'ACTIVE'), T);
  fireEvent.click(screen.getByRole('button', { name: /Publish/ }));
  fireEvent.click(await screen.findByText('Race Item', {}, T));
  const sheet = (await screen.findByText('Publish to Network', {}, T)).closest('.fixed');
  assert.equal(within(sheet).getByDisplayValue('9').tagName, 'INPUT', 'price suggested from the item, editable');
  fireEvent.click(within(sheet).getByRole('button', { name: 'Publish' }));
  await waitFor(async () => assert.equal((await q("select status, network_price from network_offers where product_id='00000000-0000-0000-0000-0000000000c7'"))[0].status, 'ACTIVE'), T);
});

test('Connections: ask from an offer, owner accepts, buyer can then order from a connected-only supplier', async () => {
  as(B, BUY); mount(<FindStockPage />);
  await screen.findByText('Sugar 50kg', {}, T);
  fireEvent.click(within(screen.getByText(/^Flour 2kg/).closest('.flex-col')).getByText('View Offer'));
  fireEvent.click(await screen.findByRole('button', { name: /Ask to connect/ }));
  await screen.findByText(/Request sent/, {}, T);
  cleanup();
  as(S, SUP); mount(<MySuppliersPage />);
  await screen.findByText('Wants to connect', {}, T);
  fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
  await waitFor(async () => assert.equal((await q("select status from network_connections"))[0].status, 'ACCEPTED'), T);
  cleanup();
  as(B, BUY); mount(<FindStockPage />);
  await screen.findByText(/^Flour 2kg/, {}, T);
  assert.ok(!within(screen.getByText(/^Flour 2kg/).closest('.flex-col')).queryByText('Connect first'));
});

test('Compare: two offers side by side, with the reminder not to choose on price alone', async () => {
  as(B, BUY); mount(<FindStockPage />);
  await screen.findByText('Sugar 50kg', {}, T);
  fireEvent.click(within(cardOf('Sugar 50kg')).getByText('Compare'));
  fireEvent.click(within(cardOf('Rice 25kg')).getByText('Compare'));
  fireEvent.click(await screen.findByRole('button', { name: /Compare 2 offers/ }));
  await screen.findByText('Compare offers', {}, T);
  assert.ok(body().includes('not price alone'));
  assert.ok(screen.getAllByLabelText('best').length >= 1);
});
