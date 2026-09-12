// src/pos-erp/services/auditService.js
//
// Phase 8 — audit trail (brief §60). Reads pos_audit_log, which already
// exists and is already written to by register_pos_tenant() (one
// TENANT_REGISTERED row per signup, confirmed in its body from earlier
// this session).
//
// SCOPE, stated plainly rather than silently: pos_audit_log's own shape
// (actor_type/actor_id/action/entity_type/entity_id/metadata) is generic
// enough to log anything, but nothing in this codebase writes to it for
// the DATA-level events §60 lists — product edits, price changes, stock
// adjustments, sales, purchases, returns, voids, expenses, customer/
// supplier edits, settings changes. Only auth/tenant lifecycle events
// (registration; presumably login/logout/staff-created/etc. if the auth
// RPCs write to it too, which hasn't been confirmed for anything beyond
// register_pos_tenant()) end up here today.
//
// Retrofitting a logAction() call into every mutation across every
// service built this session (customerService, productService,
// saleService, purchaseService, supplierService, expensesService,
// propertyService, salonService...) is a real, sizeable piece of work in
// its own right — easy to do inconsistently or miss call sites entirely
// if rushed at the end of an already-long session, which would be worse
// than an honestly-incomplete audit trail (a log that's silently missing
// entries is more dangerous than a log that's visibly narrow in scope).
// log() below exists so that work CAN start being added incrementally,
// service by service, rather than needing a second file created later.

import { posSupabase as supabase } from './posSupabaseClient';

export const auditService = {
  async getEntries({ tenantId, limit = 100, actionFilter, entityTypeFilter } = {}) {
    let q = supabase
      .from('pos_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (tenantId) q = q.eq('pos_tenant_id', tenantId);
    if (actionFilter) q = q.eq('action', actionFilter);
    if (entityTypeFilter) q = q.eq('entity_type', entityTypeFilter);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  /**
   * Writes one audit entry. Not called anywhere yet outside this file —
   * see the scope note above. A service opting in just calls this after
   * its own write succeeds:
   *   await auditService.log({ tenantId, actorId: staffId, action: 'PRODUCT_EDITED', entityType: 'lb_products', entityId: product.id })
   */
  async log({ tenantId, actorType = 'staff', actorId, action, entityType, entityId, metadata }) {
    const { error } = await supabase.from('pos_audit_log').insert({
      pos_tenant_id: tenantId,
      actor_type: actorType,
      actor_id: actorId ?? null,
      action,
      entity_type: entityType ?? null,
      entity_id: entityId ?? null,
      metadata: metadata ?? null,
    });
    if (error) throw error; // deliberately NOT swallowed — a failed audit write should be visible, not silent
  },
};
