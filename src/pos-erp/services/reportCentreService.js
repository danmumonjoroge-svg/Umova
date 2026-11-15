// src/pos-erp/services/reportCentreService.js
//
// The printable reports. Every builder returns a plain report spec (see utils/reportPdf.js) so the same data feeds the
// on-screen preview and the A4 PDF. Figures come from the database functions of phase42 (sales/stock by class) and from
// tables the app already reads. All days are Nairobi days, the same rule as the daily closing and the SQL functions.
//
// Who sees which report is decided in REPORTS[].perms (any one is enough); the database refuses the data regardless.

import { posSupabase as supabase } from './posSupabaseClient';
import { kes, num, pct, niceDate } from '../utils/reportPdf';

const TZ = 'Africa/Nairobi';
const n = (v) => Number(v || 0);

// ---------- dates ----------
export const nairobiToday = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const addDays = (iso, d) => { const t = new Date(`${iso}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
const monthStart = (iso) => `${iso.slice(0, 7)}-01`;
const monthEnd = (iso) => { const t = new Date(`${iso.slice(0, 7)}-01T12:00:00Z`); t.setUTCMonth(t.getUTCMonth() + 1); t.setUTCDate(0); return t.toISOString().slice(0, 10); };

export function periodPresets(today = nairobiToday()) {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();                // 0 = Sunday
  const weekFrom = addDays(today, -((dow + 6) % 7));                      // Monday
  const lastMonthEnd = addDays(monthStart(today), -1);
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: 'yesterday', label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { key: 'week', label: 'This week', from: weekFrom, to: today },
    { key: 'month', label: 'This month', from: monthStart(today), to: today },
    { key: 'lastmonth', label: 'Last month', from: monthStart(lastMonthEnd), to: lastMonthEnd },
    { key: 'custom', label: 'Pick dates', from: monthStart(today), to: today },
  ];
}
export const periodText = (from, to) => (from === to ? niceDate(from) : `${niceDate(from)} to ${niceDate(to)}`);
const startTs = (d) => `${d}T00:00:00+03:00`;
const endTs = (d) => `${d}T23:59:59.999+03:00`;
const dayOf = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ });
const timeOf = (ts) => new Date(ts).toLocaleString('en-KE', { timeZone: TZ, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data || [];
}
/** Reads every page of a query (the API returns at most 1000 rows at a time). */
async function fetchAll(makeQuery) {
  const out = []; const size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await makeQuery().range(from, from + size - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < size) break;
  }
  return out;
}
const chunk = (a, s) => { const o = []; for (let i = 0; i < a.length; i += s) o.push(a.slice(i, i + s)); return o; };

// ---------- the catalogue shown on the Reports screen ----------
export const REPORTS = [
  { key: 'stock', group: 'Stock', title: 'Stock on hand', desc: 'What you hold, what it cost and what it will sell for.', perms: ['inventory.view', 'finance.view'], period: false, options: ['groupBy'] },
  { key: 'lowstock', group: 'Stock', title: 'Low and out of stock', desc: 'What to buy next: items at or below their reorder level.', perms: ['inventory.view', 'finance.view'], period: false },
  { key: 'sales', group: 'Sales', title: 'Sales summary', desc: 'Sales by day, how customers paid, and your best sellers.', perms: ['sales.view', 'finance.view'], period: true },
  { key: 'byclass', group: 'Sales', title: 'Sales by class', desc: 'Restaurant, Bar, Accommodation, Outdoor... each section with its own sales, cost and profit.', perms: ['sales.view', 'finance.view'], period: true, options: ['classId'] },
  { key: 'items', group: 'Sales', title: 'Items sold', desc: 'Every item sold, by category, with units and amount.', perms: ['sales.view', 'finance.view'], period: true },
  { key: 'expenses', group: 'Money', title: 'Spending', desc: 'What you spent, by category.', perms: ['finance.view', 'expenses.record'], period: true },
  { key: 'mpesa', group: 'Money', title: 'M-Pesa received', desc: 'Payments made to your till or paybill, and what they paid for.', perms: ['payments.record', 'finance.view'], period: true },
  { key: 'debtors', group: 'Money', title: 'Who owes me', desc: 'Customers on credit and open bills.', perms: ['balances.view', 'finance.view'], period: false },
];

// ---------- stock ----------
function groupRows(items, keyFn, labelFn, cols, make) {
  const groups = new Map();
  items.forEach((i) => { const k = keyFn(i); if (!groups.has(k)) groups.set(k, { label: labelFn(i), items: [] }); groups.get(k).items.push(i); });
  const rows = [];
  [...groups.values()].forEach((g) => { rows.push(make.group(g)); g.items.forEach((i) => rows.push(make.item(i))); });
  return rows;
}

async function stockReport({ businessId, groupBy = 'class', onlyLow = false, title }) {
  let items = await rpc('pos_stock_report', { p_business_id: businessId });
  if (onlyLow) items = items.filter((i) => i.stock_state !== 'OK');
  const cost = items.reduce((s, i) => s + n(i.value_at_cost), 0), retail = items.reduce((s, i) => s + n(i.value_at_retail), 0);
  const low = items.filter((i) => i.stock_state === 'LOW').length, out = items.filter((i) => i.stock_state === 'OUT').length;
  const state = (s) => (s === 'OUT' ? 'OUT' : s === 'LOW' ? 'LOW' : '');
  const columns = onlyLow
    ? [{ key: 'name', label: 'Item', w: 4 }, { key: 'group', label: groupBy === 'category' ? 'Category' : 'Class', w: 2.4 }, { key: 'qty', label: 'In stock', align: 'right' }, { key: 'reorder', label: 'Reorder at', align: 'right' }, { key: 'short', label: 'Short by', align: 'right' }, { key: 'state', label: 'Status', w: 0.9 }]
    : [{ key: 'name', label: 'Item', w: 4 }, { key: 'sku', label: 'SKU', w: 1.6 }, { key: 'qty', label: 'In stock', align: 'right' }, { key: 'cost', label: 'Cost each', align: 'right', w: 1.3 }, { key: 'vcost', label: 'Value at cost', align: 'right', w: 1.5 }, { key: 'vretail', label: 'Value at price', align: 'right', w: 1.5 }, { key: 'state', label: 'Status', w: 0.9 }];
  const itemRow = (i) => (onlyLow
    ? { name: i.product_name, group: groupBy === 'category' ? i.category_name : i.class_name, qty: num(i.quantity), reorder: num(i.reorder_level), short: num(Math.max(0, n(i.reorder_level) - n(i.quantity))), state: state(i.stock_state), _bad: i.stock_state === 'OUT' ? ['state', 'qty'] : ['state'] }
    : { name: i.product_name, sku: i.sku || '', qty: num(i.quantity), cost: kes(i.cost_price), vcost: kes(i.value_at_cost), vretail: kes(i.value_at_retail), state: state(i.stock_state), _bad: i.stock_state === 'OUT' ? ['state', 'qty'] : i.stock_state === 'LOW' ? ['state'] : undefined });
  let rows;
  if (groupBy === 'none' || onlyLow) rows = items.map(itemRow);
  else {
    const kf = groupBy === 'category' ? (i) => i.category_id || 'none' : (i) => i.class_id || 'none';
    const lf = groupBy === 'category' ? (i) => i.category_name : (i) => i.class_name;
    rows = groupRows(items, kf, lf, columns, {
      group: (g) => ({ _kind: 'group', name: `${g.label}  (${g.items.length} item${g.items.length === 1 ? '' : 's'})`, vcost: kes(g.items.reduce((s, i) => s + n(i.value_at_cost), 0)), vretail: kes(g.items.reduce((s, i) => s + n(i.value_at_retail), 0)) }),
      item: itemRow,
    });
  }
  if (!onlyLow) rows.push({ _kind: 'total', name: 'TOTAL', vcost: kes(cost), vretail: kes(retail) });
  return {
    title: title || (onlyLow ? 'Low and out of stock' : 'Stock on hand'),
    subtitle: onlyLow ? 'Items at or below their reorder level' : `Stock grouped by ${groupBy === 'category' ? 'category' : groupBy === 'none' ? 'item' : 'class'}`,
    period: `As at ${niceDate(nairobiToday())}`, fileBase: onlyLow ? 'low-stock' : 'stock-on-hand', periodKey: nairobiToday(),
    summary: onlyLow
      ? [{ label: 'Items to reorder', value: String(items.length) }, { label: 'Low', value: String(low) }, { label: 'Out of stock', value: String(out), bad: out > 0 }]
      : [{ label: 'Items', value: String(items.length) }, { label: 'Value at cost', value: kes(cost) }, { label: 'Value at price', value: kes(retail) }, { label: 'Low / out', value: `${low} / ${out}`, bad: out > 0 }],
    sections: [{ columns, rows, emptyText: onlyLow ? 'Nothing is low. Every tracked item is above its reorder level.' : 'No stock items.' }],
    footnote: 'Quantities are summed over all warehouses. Value uses average cost when known, otherwise the item cost price.',
  };
}

// ---------- sales ----------
async function salesReport({ businessId, from, to }) {
  const sales = await fetchAll(() => supabase.from('lb_sales').select('id,total_amount,created_at,status').eq('business_id', businessId)
    .in('status', ['COMPLETED', 'PARTIALLY_REFUNDED']).gte('created_at', startTs(from)).lte('created_at', endTs(to)).order('created_at'));
  const byDay = new Map();
  sales.forEach((s) => { const d = dayOf(s.created_at); const r = byDay.get(d) || { count: 0, total: 0 }; r.count += 1; r.total += n(s.total_amount); byDay.set(d, r); });
  const total = sales.reduce((s, r) => s + n(r.total_amount), 0);

  const methods = new Map();
  for (const ids of chunk(sales.map((s) => s.id), 100)) {
    const { data, error } = await supabase.from('lb_payments').select('payment_method,amount,change_amount').in('sale_id', ids).eq('status', 'COMPLETED');
    if (error) throw error;
    (data || []).forEach((p) => methods.set(p.payment_method, (methods.get(p.payment_method) || 0) + n(p.amount) - n(p.change_amount)));
  }
  const label = { CASH: 'Cash', MOBILE_MONEY: 'M-Pesa / mobile money', CARD: 'Card', CREDIT: 'On credit', BANK: 'Bank', VOUCHER: 'Voucher', OTHER: 'Other' };

  const detail = await rpc('pos_sales_by_class_detail', { p_business_id: businessId, p_from: from, p_to: to });
  const prod = new Map();
  detail.forEach((d) => { const k = d.product_id || d.product_name; const r = prod.get(k) || { name: d.product_name, units: 0, revenue: 0 }; r.units += n(d.units); r.revenue += n(d.revenue); prod.set(k, r); });
  const top = [...prod.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 15);
  const best = [...byDay.entries()].sort((a, b) => b[1].total - a[1].total)[0];

  return {
    title: 'Sales summary', subtitle: 'Completed sales (reversed or voided sales are left out)', period: periodText(from, to), fileBase: 'sales-summary', periodKey: `${from}_to_${to}`,
    summary: [{ label: 'Total sales', value: kes(total) }, { label: 'Number of sales', value: String(sales.length) }, { label: 'Average sale', value: kes(sales.length ? total / sales.length : 0) }, { label: 'Best day', value: best ? `${niceDate(best[0])}` : '-' }],
    sections: [
      { heading: 'Sales by day', columns: [{ key: 'day', label: 'Date', w: 3 }, { key: 'count', label: 'Sales', align: 'right' }, { key: 'total', label: 'Amount (KES)', align: 'right', w: 2 }],
        rows: [...byDay.entries()].sort().map(([d, r]) => ({ day: niceDate(d), count: String(r.count), total: kes(r.total) })).concat([{ _kind: 'total', day: 'TOTAL', count: String(sales.length), total: kes(total) }]), emptyText: 'No sales in this period.' },
      { heading: 'How customers paid', note: 'Money received with the sale. Credit sales are paid later.', columns: [{ key: 'm', label: 'Method', w: 3 }, { key: 'a', label: 'Amount (KES)', align: 'right', w: 2 }],
        rows: [...methods.entries()].sort((a, b) => b[1] - a[1]).map(([m, a]) => ({ m: label[m] || m, a: kes(a) })) },
      { heading: 'Best sellers (top 15 by amount)', columns: [{ key: 'name', label: 'Item', w: 4 }, { key: 'units', label: 'Units', align: 'right' }, { key: 'rev', label: 'Amount (KES)', align: 'right', w: 1.6 }],
        rows: top.map((t) => ({ name: t.name, units: num(t.units), rev: kes(t.revenue) })) },
    ],
  };
}

async function itemsReport({ businessId, from, to }) {
  const detail = await rpc('pos_sales_by_class_detail', { p_business_id: businessId, p_from: from, p_to: to });
  const cats = new Map();
  detail.forEach((d) => { const k = d.category_name || 'No category'; if (!cats.has(k)) cats.set(k, new Map()); const m = cats.get(k); const pk = d.product_id || d.product_name; const r = m.get(pk) || { name: d.product_name, units: 0, revenue: 0 }; r.units += n(d.units); r.revenue += n(d.revenue); m.set(pk, r); });
  const rows = []; let tu = 0, tr = 0;
  [...cats.entries()].map(([c, m]) => [c, [...m.values()].sort((a, b) => b.revenue - a.revenue)]).sort((a, b) => b[1].reduce((s, r) => s + r.revenue, 0) - a[1].reduce((s, r) => s + r.revenue, 0)).forEach(([c, list]) => {
    const u = list.reduce((s, r) => s + r.units, 0), r = list.reduce((s, x) => s + x.revenue, 0); tu += u; tr += r;
    rows.push({ _kind: 'group', name: c, units: num(u), rev: kes(r) });
    list.forEach((x) => rows.push({ name: x.name, units: num(x.units), rev: kes(x.revenue) }));
  });
  rows.push({ _kind: 'total', name: 'TOTAL', units: num(tu), rev: kes(tr) });
  return { title: 'Items sold', subtitle: 'By product category', period: periodText(from, to), fileBase: 'items-sold', periodKey: `${from}_to_${to}`,
    summary: [{ label: 'Different items', value: String(new Set(detail.map((d) => d.product_id || d.product_name)).size) }, { label: 'Units sold', value: num(tu) }, { label: 'Amount', value: kes(tr) }],
    sections: [{ columns: [{ key: 'name', label: 'Item', w: 5 }, { key: 'units', label: 'Units', align: 'right' }, { key: 'rev', label: 'Amount (KES)', align: 'right', w: 1.6 }], rows, emptyText: 'Nothing was sold in this period.' }] };
}

async function byClassReport({ businessId, from, to, classId }) {
  const [summary, detail] = await Promise.all([
    rpc('pos_sales_by_class', { p_business_id: businessId, p_from: from, p_to: to }),
    rpc('pos_sales_by_class_detail', { p_business_id: businessId, p_from: from, p_to: to }),
  ]);
  const shown = classId ? summary.filter((c) => (c.class_id || 'none') === classId) : summary;
  const tr = summary.reduce((s, c) => s + n(c.revenue), 0), tc = summary.reduce((s, c) => s + n(c.cost), 0);
  const margin = (r, c) => (n(r) > 0 ? pct(((n(r) - n(c)) / n(r)) * 100) : '-');
  const sections = [{
    heading: 'Class summary', note: 'Cost is what the items cost when they were sold. Hand-posted room charges carry no cost.',
    columns: [{ key: 'c', label: 'Class', w: 3.2 }, { key: 'u', label: 'Units', align: 'right' }, { key: 'r', label: 'Sales', align: 'right', w: 1.5 }, { key: 'k', label: 'Cost', align: 'right', w: 1.5 }, { key: 'g', label: 'Gross profit', align: 'right', w: 1.5 }, { key: 'm', label: 'Margin', align: 'right', w: 0.9 }, { key: 's', label: 'Share', align: 'right', w: 0.9 }],
    rows: summary.map((c) => ({ c: c.class_name, u: num(c.units), r: kes(c.revenue), k: kes(c.cost), g: kes(c.gross_profit), m: margin(c.revenue, c.cost), s: tr > 0 ? pct((n(c.revenue) / tr) * 100) : '-' }))
      .concat([{ _kind: 'total', c: 'TOTAL', r: kes(tr), k: kes(tc), g: kes(tr - tc), m: margin(tr, tc), u: num(summary.reduce((s, c) => s + n(c.units), 0)) }]),
    emptyText: 'No sales in this period.',
  }];
  shown.forEach((c, idx) => {
    const items = detail.filter((d) => (d.class_id || 'none') === (c.class_id || 'none')).sort((a, b) => n(b.revenue) - n(a.revenue));
    sections.push({
      heading: c.class_name, headingRight: `KES ${kes(c.revenue)}`, pageBreakBefore: !classId || idx > 0,
      columns: [{ key: 'i', label: 'Item', w: 4 }, { key: 'cat', label: 'Category', w: 2 }, { key: 'u', label: 'Units', align: 'right' }, { key: 'r', label: 'Sales', align: 'right', w: 1.4 }, { key: 'k', label: 'Cost', align: 'right', w: 1.4 }, { key: 'g', label: 'Profit', align: 'right', w: 1.4 }],
      rows: items.map((d) => ({ i: d.product_name, cat: d.category_name || '', u: num(d.units), r: kes(d.revenue), k: kes(d.cost), g: kes(n(d.revenue) - n(d.cost)) }))
        .concat([{ _kind: 'total', i: `${c.class_name} total`, u: num(c.units), r: kes(c.revenue), k: kes(c.cost), g: kes(c.gross_profit) }]),
    });
  });
  return { title: classId && shown[0] ? `Sales: ${shown[0].class_name}` : 'Sales by class', subtitle: 'Each part of the business on its own', period: periodText(from, to),
    fileBase: classId && shown[0] ? `sales-${shown[0].class_name}` : 'sales-by-class', periodKey: `${from}_to_${to}`,
    summary: [{ label: 'Total sales', value: kes(tr) }, { label: 'Total cost', value: kes(tc) }, { label: 'Gross profit', value: kes(tr - tc), bad: tr - tc < 0 }, { label: 'Classes', value: String(summary.length) }], sections };
}

// ---------- money ----------
async function expensesReport({ businessId, from, to }) {
  const data = await fetchAll(() => supabase.from('lb_expenses').select('id,amount,description,expense_date,category:lb_expense_categories(name)')
    .eq('business_id', businessId).eq('status', 'PAID').gte('expense_date', from).lte('expense_date', to).order('expense_date'));
  const cats = new Map();
  data.forEach((e) => { const k = e.category?.name || 'Uncategorised'; if (!cats.has(k)) cats.set(k, []); cats.get(k).push(e); });
  const rows = []; let total = 0;
  [...cats.entries()].map(([k, l]) => [k, l, l.reduce((s, e) => s + n(e.amount), 0)]).sort((a, b) => b[2] - a[2]).forEach(([k, l, t]) => {
    total += t; rows.push({ _kind: 'group', date: '', what: `${k}  (${l.length})`, amt: kes(t) });
    l.forEach((e) => rows.push({ date: niceDate(e.expense_date), what: e.description || k, amt: kes(e.amount) }));
  });
  rows.push({ _kind: 'total', date: '', what: 'TOTAL SPENT', amt: kes(total) });
  return { title: 'Spending', subtitle: 'Paid expenses by category', period: periodText(from, to), fileBase: 'spending', periodKey: `${from}_to_${to}`,
    summary: [{ label: 'Total spent', value: kes(total), bad: true }, { label: 'Entries', value: String(data.length) }, { label: 'Categories', value: String(cats.size) }],
    sections: [{ columns: [{ key: 'date', label: 'Date', w: 1.6 }, { key: 'what', label: 'Description', w: 5 }, { key: 'amt', label: 'Amount (KES)', align: 'right', w: 1.7 }], rows, emptyText: 'No spending recorded in this period.' }] };
}

async function mpesaReport({ businessId, from, to }) {
  const inbox = await fetchAll(() => supabase.from('lb_mpesa_c2b_payments').select('id,trans_id,trans_time,amount,amount_used,status,payer_name,bill_ref_number,note')
    .eq('business_id', businessId).gte('trans_time', startTs(from)).lte('trans_time', endTs(to)).order('trans_time'));
  const alloc = new Map();
  for (const ids of chunk(inbox.map((i) => i.id), 100)) {
    const { data, error } = await supabase.from('lb_mpesa_c2b_allocations').select('c2b_id,target_type,amount,result').in('c2b_id', ids);
    if (error) throw error;
    (data || []).forEach((a) => { const l = alloc.get(a.c2b_id) || []; l.push(a); alloc.set(a.c2b_id, l); });
  }
  const tname = { FOLIO: 'Customer bill', CUSTOMER: 'Credit account', RENT_INVOICE: 'Rent invoice' };
  const stat = { NEW: 'Waiting', PARTLY_USED: 'Part used', USED: 'Used', IGNORED: 'Set aside' };
  const received = inbox.reduce((s, i) => s + n(i.amount), 0), used = inbox.reduce((s, i) => s + n(i.amount_used), 0);
  const stk = await fetchAll(() => supabase.from('lb_mpesa_transactions').select('mpesa_receipt_number,amount,phone,confirmed_at,sale:lb_sales(sale_number)')
    .eq('business_id', businessId).eq('status', 'PAID').gte('confirmed_at', startTs(from)).lte('confirmed_at', endTs(to)).order('confirmed_at'));
  const stkTotal = stk.reduce((s, t) => s + n(t.amount), 0);
  return { title: 'M-Pesa received', subtitle: 'Payments made to your till or paybill, and payment prompts the till sent', period: periodText(from, to), fileBase: 'mpesa-received', periodKey: `${from}_to_${to}`,
    summary: [{ label: 'Paid to till', value: kes(received) }, { label: 'Cleared to bills', value: kes(used) }, { label: 'Waiting', value: kes(received - used - inbox.filter((i) => i.status === 'IGNORED').reduce((s, i) => s + n(i.amount) - n(i.amount_used), 0)), bad: false }, { label: 'Prompts paid', value: kes(stkTotal) }],
    sections: [
      { heading: 'Payments made to the till', columns: [{ key: 't', label: 'Time', w: 1.7 }, { key: 'c', label: 'M-Pesa code', w: 1.7 }, { key: 'p', label: 'Paid by', w: 2.4 }, { key: 'a', label: 'Amount', align: 'right', w: 1.2 }, { key: 's', label: 'Status', w: 1 }, { key: 'u', label: 'Cleared', w: 2.4 }],
        rows: inbox.map((i) => ({ t: timeOf(i.trans_time), c: i.trans_id, p: i.payer_name || '', a: kes(i.amount), s: stat[i.status] || i.status, u: (alloc.get(i.id) || []).map((a) => `${tname[a.target_type] || a.target_type} ${kes(a.amount)}`).join('; ') || (i.status === 'IGNORED' ? (i.note || '') : (i.note || '')) })), emptyText: 'No payments were made to the till in this period.' },
      { heading: 'Payment prompts (STK) that were paid', columns: [{ key: 't', label: 'Time', w: 1.7 }, { key: 'c', label: 'M-Pesa code', w: 1.7 }, { key: 'p', label: 'Phone', w: 1.8 }, { key: 'a', label: 'Amount', align: 'right', w: 1.2 }, { key: 'sl', label: 'Sale', w: 1.4 }],
        rows: stk.map((s) => ({ t: timeOf(s.confirmed_at), c: s.mpesa_receipt_number || '', p: s.phone || '', a: kes(s.amount), sl: s.sale?.sale_number || '' })), emptyText: 'No paid prompts in this period.' },
    ] };
}

async function debtorsReport({ businessId }) {
  const customers = await fetchAll(() => supabase.from('lb_customers').select('id,name,phone,outstanding_balance').gt('outstanding_balance', 0).order('outstanding_balance', { ascending: false }));
  let folios = [];
  try { folios = await fetchAll(() => supabase.from('lb_folio_summary').select('id,folio_number,title,customer_id,balance_due,opened_at').eq('business_id', businessId).eq('status', 'OPEN').gt('balance_due', 0).order('opened_at')); } catch { folios = []; }
  const names = {};
  const ids = [...new Set(folios.map((f) => f.customer_id))];
  for (const part of chunk(ids, 100)) { const { data } = await supabase.from('lb_customers').select('id,name').in('id', part); (data || []).forEach((c) => { names[c.id] = c.name; }); }
  const credit = customers.reduce((s, c) => s + n(c.outstanding_balance), 0), open = folios.reduce((s, f) => s + n(f.balance_due), 0);
  return { title: 'Who owes me', subtitle: 'Credit balances and open customer bills', period: `As at ${niceDate(nairobiToday())}`, fileBase: 'who-owes-me', periodKey: nairobiToday(),
    summary: [{ label: 'On credit', value: kes(credit) }, { label: 'Open bills', value: kes(open) }, { label: 'Total owed', value: kes(credit + open), bad: true }],
    sections: [
      { heading: 'Customers on credit', columns: [{ key: 'n', label: 'Customer', w: 4 }, { key: 'p', label: 'Phone', w: 2 }, { key: 'b', label: 'Owes (KES)', align: 'right', w: 1.6 }],
        rows: customers.map((c) => ({ n: c.name, p: c.phone || '', b: kes(c.outstanding_balance) })).concat(customers.length ? [{ _kind: 'total', n: 'TOTAL', b: kes(credit) }] : []), emptyText: 'Nobody owes you on credit.' },
      { heading: 'Open customer bills (folios)', columns: [{ key: 'f', label: 'Bill', w: 2.4 }, { key: 'n', label: 'Customer', w: 3 }, { key: 'o', label: 'Opened', w: 1.6 }, { key: 'b', label: 'Balance (KES)', align: 'right', w: 1.6 }],
        rows: folios.map((f) => ({ f: `${f.folio_number}${f.title ? ` · ${f.title}` : ''}`, n: names[f.customer_id] || '', o: niceDate(f.opened_at), b: kes(f.balance_due) })).concat(folios.length ? [{ _kind: 'total', f: 'TOTAL', b: kes(open) }] : []), emptyText: 'No open bills.' },
    ] };
}

const BUILDERS = {
  stock: (c) => stockReport(c), lowstock: (c) => stockReport({ ...c, onlyLow: true }),
  sales: salesReport, items: itemsReport, byclass: byClassReport, expenses: expensesReport, mpesa: mpesaReport, debtors: debtorsReport,
};

export const reportCentreService = {
  REPORTS, periodPresets, periodText,
  /** @param {string} key one of REPORTS[].key  @param {{businessId, from, to, groupBy, classId}} ctx */
  async build(key, ctx) {
    const b = BUILDERS[key];
    if (!b) throw new Error(`Unknown report "${key}".`);
    if (!ctx.businessId) throw new Error('No business selected.');
    return b(ctx);
  },
  async listClasses(businessId) {
    const { data, error } = await supabase.from('lb_product_classes').select('id,name,kind,sort_order,is_active').eq('business_id', businessId).order('sort_order').order('name');
    if (error) throw error;
    return data || [];
  },
};
