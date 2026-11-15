// src/pos-erp/services/networkService.js
//
// My Business Network: the ONLY place the app talks to the network_* database functions (schema/phase36_network.sql).
// Every function here is a thin call. All rules (who may do what, stock, prices, retries) are enforced in the database,
// so nothing in this file is trusted for security. Errors are thrown as the raw error; screens turn them into words
// with mapNetworkError (utils/networkHelpers.js).
//
// Why no direct table access: the network_* tables are locked (no policies, no grants). Only these functions work.

import { posSupabase as supabase } from './posSupabaseClient';

async function rpc(name, args) {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw error;
  return data;
}

export const networkService = {
  // Find Stock (buyer)
  search: ({ query = null, category = null, sort = 'relevance', limit = 30, offset = 0 } = {}) =>
    rpc('network_search_offers', { p_query: query || null, p_category: category || null, p_sort: sort, p_limit: limit, p_offset: offset }),
  categories: () => rpc('network_offer_categories'),

  // Publish (supplier)
  myOffers: () => rpc('network_my_offers'),
  publishOffer: (o) => rpc('network_publish_offer', {
    p_product_id: o.productId, p_price_mode: o.priceMode, p_network_price: o.priceMode === 'SHOW' ? Number(o.price) : null,
    p_min_order_qty: Number(o.minQty) || 1, p_show_stock: !!o.showStock, p_accept_new_buyers: !!o.acceptNewBuyers,
    p_delivery_areas: o.areas || [], p_delivery_days: o.days === '' || o.days == null ? null : Number(o.days),
    p_delivery_fee: Number(o.fee) || 0, p_notes: o.notes || null,
  }),
  setOfferStatus: (offerId, status) => rpc('network_set_offer_status', { p_offer_id: offerId, p_status: status }),
  setBuyerPrice: (offerId, buyerTenant, price) => rpc('network_set_buyer_price', { p_offer_id: offerId, p_buyer_tenant: buyerTenant, p_price: price }),

  // Connections
  connections: () => rpc('network_my_connections'),
  requestConnection: (tenantId, message) => rpc('network_request_connection', { p_target_tenant: tenantId, p_message: message || null }),
  respondConnection: (id, accept) => rpc('network_respond_connection', { p_connection_id: id, p_accept: !!accept }),

  // Orders
  submitOrder: ({ clientRef, lines, method, address, note, expectedTotal }) => rpc('network_submit_order', {
    p_client_reference: clientRef, p_lines: lines, p_delivery_method: method, p_delivery_address: address || null,
    p_note: note || null, p_expected_total: expectedTotal ?? null,
  }),
  myOrders: (side, status = null) => rpc('network_my_orders', { p_side: side, p_status: status }),
  getOrder: (id) => rpc('network_get_order', { p_order_id: id }),
  confirm: (orderId, clientRef, lines = null, note = null) => rpc('network_confirm_order', { p_order_id: orderId, p_client_reference: clientRef, p_lines: lines, p_note: note }),
  reject: (orderId, reason) => rpc('network_reject_order', { p_order_id: orderId, p_reason: reason }),
  markPreparing: (orderId) => rpc('network_mark_preparing', { p_order_id: orderId }),
  dispatch: (orderId, clientRef, lines = null, note = null) => rpc('network_dispatch_order', { p_order_id: orderId, p_client_reference: clientRef, p_lines: lines, p_note: note }),
  cancel: (orderId, side, reason = null) => rpc('network_cancel_order', { p_order_id: orderId, p_side: side, p_reason: reason }),
  dispute: (orderId, reason) => rpc('network_dispute_order', { p_order_id: orderId, p_reason: reason }),
};
