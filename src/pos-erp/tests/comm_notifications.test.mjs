// Notification centre builder: date-aware, same engine as messages. "now" = 7 Nov 2026 10:00 Nairobi.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCommNotifications } from '../supabase/functions/_shared/comm/notifications.js';

const now = new Date('2026-11-07T07:00:00Z'); const tz = 'Africa/Nairobi';
const base = { now, tz, currency: 'KES', leadDays: 2 };

test('overdue, due today and upcoming balances use real day counts', () => {
  const n = buildCommNotifications({ ...base, receivables: [
    { id: 'a', name: 'Amina', outstanding: 8500, items: [{ due_date: '2026-11-06', amount: 8500 }] },
    { id: 'b', name: 'Brian', outstanding: 3000, items: [{ due_date: '2026-11-07', amount: 3000 }] },
    { id: 'c', name: 'Cate', outstanding: 1000, items: [{ due_date: '2026-11-09', amount: 1000 }] },
    { id: 'd', name: 'Dan', outstanding: 1000, items: [{ due_date: '2026-12-30', amount: 1000 }] },
    { id: 'e', name: 'Eve', outstanding: 0, items: [{ due_date: '2026-11-01', amount: 500 }] },
  ] });
  const m = n.map((x) => x.message);
  assert.ok(m.some((x) => x.includes('Amina owes KES 8,500, 1 day overdue')));
  assert.ok(m.some((x) => x.includes("Brian's payment of KES 3,000 is due today")));
  assert.ok(m.some((x) => x.includes('Cate') && x.includes('in 2 days')));
  assert.ok(!m.some((x) => x.includes('Dan')), 'too far ahead');
  assert.ok(!m.some((x) => x.includes('Eve')), 'cleared debt is never chased');
});

test('late deliveries use the revised date; received/closed orders are ignored', () => {
  const n = buildCommNotifications({ ...base, pos: [
    { id: 'p1', po_number: 'PO-1', status: 'APPROVED', expected_date: '2026-11-01', revised_delivery_date: '2026-11-06', supplier: { name: 'Acme' } },
    { id: 'p2', po_number: 'PO-2', status: 'RECEIVED', expected_date: '2026-11-01', supplier: { name: 'Acme' } },
    { id: 'p3', po_number: 'PO-3', status: 'APPROVED', supplier: { name: 'NoDate' } },
  ] });
  assert.equal(n.length, 1);
  assert.match(n[0].message, /1 day overdue/);
  assert.match(n[0].message, /6 November 2026/);
});

test('appointments: today/tomorrow only, never cancelled or past', () => {
  const n = buildCommNotifications({ ...base, appointments: [
    { id: '1', status: 'SCHEDULED', appointment_date: '2026-11-08', appointment_time: '10:30', customer: { name: 'Zed' }, service: { name: 'Braids' } },
    { id: '2', status: 'CANCELLED', appointment_date: '2026-11-08', appointment_time: '10:30', customer: { name: 'Gone' } },
    { id: '3', status: 'SCHEDULED', appointment_date: '2026-11-07', appointment_time: '09:00', customer: { name: 'Past' } },
    { id: '4', status: 'SCHEDULED', appointment_date: '2026-11-20', appointment_time: '09:00', customer: { name: 'Far' } },
  ] });
  assert.equal(n.length, 1);
  assert.match(n[0].message, /Zed .* tomorrow at 10:30 AM/);
});

test('messages waiting and failed rank first; ordering is by priority', () => {
  const n = buildCommNotifications({ ...base, readyJobs: 2, failedMessages: 1, receivables: [{ id: 'a', name: 'Amina', outstanding: 5, items: [{ due_date: '2026-11-06', amount: 5 }] }] });
  assert.equal(n[0].severity, 'high');
  assert.ok(n.some((x) => x.message.startsWith('2 messages are ready')));
});
