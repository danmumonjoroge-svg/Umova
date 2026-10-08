// src/pos-erp/services/folioService.js
//
// Customer / Guest Folios (phase19_folios.sql). ONE customer, ONE running
// bill. A folio is generic: a hotel guest's stay, a regular customer's
// monthly account, a salon client's tab. It collects charges from the
// existing POS (saleService.create with folio_id) and, in later phases,
// from rooms, services and packages.
//
// All writes go through SECURITY DEFINER functions (open_folio,
// post_folio_line, settle_folio ...) -- the tables are read-only to the
// client. The invoice and receipt are RENDERED from the folio; nothing
// else is stored.
//
// OFFLINE: reads fall back to the last cached list of open folios so the
// cashier can still pick one. Opening, settling and manual charges need
// the server, and say so. A folio-charged SALE can be queued offline
// (see offlineSaleService) and is only "Saved locally" until it syncs.

import { posSupabase as supabase } from './posSupabaseClient';
import { db } from '../offline/db';
import { auditService } from './auditService';

const KINDS = { PRODUCT: 'Items', SERVICE: 'Services', ACTIVITY: 'Activities', ROOM: 'Room', PACKAGE: 'Packages', OTHER: 'Other', ADJUSTMENT: 'Adjustments' };
export const FOLIO_LINE_LABEL = KINDS;

async function cacheOpenFolios(rows) {
  try {
    await db.folios_cache.clear();
    await db.folios_cache.bulkPut(rows.map((r) => ({ id: r.id, customer_id: r.customer_id, folio_number: r.folio_number, title: r.title, customer_name: r.customer_name, balance_due: r.balance_due })));
  } catch (err) { console.error('[folioService] cache write failed:', err); }
}

export const folioService = {
  /** Open folios with customer name + running balance. Falls back to the device cache when offline. */
  async listOpen() {
    try {
      const { data, error } = await supabase
        .from('lb_folio_summary')
        .select('id, customer_id, folio_number, title, stay_id, opened_at, total_charges, total_paid, balance_due, customer:lb_customers(name, phone)')
        .eq('status', 'OPEN')
        .order('opened_at', { ascending: false });
      if (error) throw error;
      const rows = (data || []).map((r) => ({ ...r, customer_name: r.customer?.name || '' }));
      cacheOpenFolios(rows);
      return { rows, fromCache: false };
    } catch (err) {
      if (err?.name === 'TypeError') {
        const rows = await db.folios_cache.toArray();
        return { rows, fromCache: true };
      }
      throw err;
    }
  },

  async listSettled({ limit = 50 } = {}) {
    const { data, error } = await supabase
      .from('lb_folio_summary')
      .select('id, customer_id, folio_number, title, settled_at, total_charges, total_paid, invoice_number, customer:lb_customers(name)')
      .eq('status', 'SETTLED').order('settled_at', { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  },

  async getOpenForCustomer(customerId) {
    if (!customerId) return null;
    const { rows } = await this.listOpen();
    return rows.find((r) => r.customer_id === customerId) || null;
  },

  async listForCustomer(customerId) {
    const { data, error } = await supabase
      .from('lb_folio_summary').select('*').eq('customer_id', customerId).order('opened_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getById(id) {
    const { data: folio, error } = await supabase
      .from('lb_folio_summary')
      .select('*, customer:lb_customers(id, name, phone, email), business:lb_businesses(name, phone, email, address, logo_url)')
      .eq('id', id).single();
    if (error) throw error;
    const [{ data: lines, error: lErr }, { data: payments, error: pErr }] = await Promise.all([
      supabase.from('lb_folio_lines').select('*').eq('folio_id', id).eq('status', 'POSTED').order('created_at', { ascending: true }),
      supabase.from('lb_folio_payments').select('*').eq('folio_id', id).order('created_at', { ascending: true }),
    ]);
    if (lErr) throw lErr; if (pErr) throw pErr;
    // The guest's room stay(s), for the heading of the invoice/receipt. Optional: a business without rooms
    // (or a database without phase20) simply has none, and the bill reads the same without the heading.
    let stays = [];
    try {
      const { data: st, error: sErr } = await supabase.from('lb_stay_summary')
        .select('id, room_number, room_type_name, check_in_date, expected_check_out, nights_charged, nights_booked, status').eq('folio_id', id).neq('status', 'CANCELLED').order('check_in_date');
      if (!sErr) stays = st || [];
    } catch (e) { /* no stays: fine */ }
    return { ...folio, lines: lines || [], payments: payments || [], stays };
  },

  /** Opens a folio, or returns the customer's existing open one. Returns the folio id. */
  async open({ businessId, customerId, title = null, stayId = null, createdBy = null }) {
    if (!businessId || !customerId) throw new Error('folioService.open: businessId and customerId are required.');
    const { data, error } = await supabase.rpc('open_folio', {
      p_business_id: businessId, p_customer_id: customerId, p_title: title, p_stay_id: stayId, p_created_by: createdBy,
    });
    if (error) throw error;
    return data;
  },

  async addCharge({ folioId, lineType = 'OTHER', description, quantity = 1, unitPrice, category = null, createdBy = null, clientReference = null }) {
    const { data, error } = await supabase.rpc('post_folio_line', {
      p_folio_id: folioId, p_line_type: lineType, p_description: description, p_quantity: quantity, p_unit_price: unitPrice,
      p_category: category, p_client_reference: clientReference, p_created_by: createdBy,
    });
    if (error) throw error;
    return data;
  },

  /** A discount or correction. Pass a positive amount; it always reduces the bill. */
  addAdjustment({ folioId, description, amount, createdBy = null }) {
    return this.addCharge({ folioId, lineType: 'ADJUSTMENT', description, quantity: 1, unitPrice: Math.abs(Number(amount)), createdBy });
  },

  async voidLine(lineId, reason) {
    const { error } = await supabase.rpc('void_folio_line', { p_line_id: lineId, p_reason: reason });
    if (error) throw error;
  },

  /** Used by saleService after a folio-marked sale is written. Idempotent. */
  async postSale(folioId, saleId, createdBy = null) {
    const { data, error } = await supabase.rpc('post_sale_to_folio', { p_folio_id: folioId, p_sale_id: saleId, p_created_by: createdBy });
    if (error) throw error;
    return data;
  },

  /** payments: [{ payment_method, amount, reference_no? }] -- must add up to the balance exactly. */
  async settle({ folioId, payments, settledBy = null, shiftId = null, tenantId = null }) {
    const { data, error } = await supabase.rpc('settle_folio', {
      p_folio_id: folioId, p_payments: payments, p_settled_by: settledBy, p_shift_id: shiftId,
    });
    if (error) throw error;
    // Same rule as saleService: the money is already recorded, so a failed audit write is logged, never surfaced as a failed settlement.
    if (tenantId) {
      try {
        await auditService.log({
          tenantId, actorId: settledBy, action: 'FOLIO_SETTLED', entityType: 'lb_folios', entityId: folioId,
          metadata: { total: data?.total, invoice_number: data?.invoice_number, receipt_number: data?.receipt_number, payment_methods: payments.map((p) => p.payment_method) },
        });
      } catch (auditErr) { console.error('[folioService.settle] audit log failed (settlement itself succeeded):', auditErr); }
    }
    return data;
  },

  async cancelEmpty(folioId) {
    const { error } = await supabase.rpc('void_folio', { p_folio_id: folioId });
    if (error) throw error;
  },

  /**
   * Groups lines the way the guest reads the bill: Room, Items, Services...
   * Same shape for the on-screen folio and the printed invoice/receipt.
   */
  groupLines(lines) {
    const order = ['ROOM', 'PRODUCT', 'SERVICE', 'ACTIVITY', 'PACKAGE', 'OTHER', 'ADJUSTMENT'];
    const groups = new Map();
    for (const l of lines) {
      if (!groups.has(l.line_type)) groups.set(l.line_type, { type: l.line_type, label: KINDS[l.line_type] || l.line_type, lines: [], subtotal: 0 });
      const g = groups.get(l.line_type);
      g.lines.push(l); g.subtotal += Number(l.amount);
    }
    return order.filter((t) => groups.has(t)).map((t) => groups.get(t));
  },

  /**
   * The bill the way a guest reads it (phase 8): Room, Food, Drinks, Items, Services, Activities,
   * then each package as ONE block, then other charges and discounts. Food and Drinks come from the
   * line's real category (the product category for till sales); a line with no category keeps its
   * line-type group (Items/Services), exactly as before. Same result for screen, invoice and receipt.
   */
  sections(lines) {
    const FOOD = /food|meal|kitchen|restaurant|breakfast|lunch|dinner|snack/i;
    const DRINK = /drink|beverage|bar\b|soda|juice|beer|wine|spirit|water|tea|coffee/i;
    const map = new Map();
    const add = (key, label, rank, line, shown) => {
      if (!map.has(key)) map.set(key, { key, label, rank, lines: [], subtotal: 0, isPackage: false });
      const g = map.get(key);
      g.lines.push({ ...line, shown }); g.subtotal += Number(line.amount);
      return g;
    };
    for (const l of lines || []) {
      if (l.package_charge_id) {
        const qty = Number(l.package_qty) > 1 ? ` × ${l.package_qty}` : '';
        const g = add(`pkg:${l.package_charge_id}`, `${l.package_name || 'Package'}${qty}`, 70, l, String(l.description).replace(`${l.package_name} · `, ''));
        g.isPackage = true; continue;
      }
      const t = l.line_type; const cat = l.category || '';
      if (t === 'ROOM') add('room', 'Room', 10, l, l.description);
      else if (t === 'ACTIVITY') add('activity', 'Activities', 60, l, l.description);
      else if (t === 'ADJUSTMENT') add('adj', 'Discounts & adjustments', 90, l, l.description);
      else if (t === 'PRODUCT' || t === 'SERVICE' || t === 'OTHER') {
        if (FOOD.test(cat)) add('food', 'Food', 20, l, l.description);
        else if (DRINK.test(cat)) add('drinks', 'Drinks', 30, l, l.description);
        else if (t === 'PRODUCT') add('items', 'Items', 40, l, l.description);
        else if (t === 'SERVICE') add('services', 'Services', 50, l, l.description);
        else add('other', 'Other charges', 80, l, l.description);
      } else add('other', 'Other charges', 80, l, l.description);
    }
    // packages keep the order they were sold in; everything else by rank
    return [...map.values()].sort((a, b) => a.rank - b.rank);
  },
};
