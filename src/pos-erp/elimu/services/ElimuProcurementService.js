// Elimu procurement adapter. Reuses the host's verified POS supplier / PO / GRN
// schema and services; tenant-scoped RLS remains authoritative on every query.
import { supplierService } from '../../services/supplierService.js';
import { purchaseOrderService, goodsReceivedService } from '../../services/purchaseService.js';
import { supabase as posSupabase } from './platform.js';

export const elimuProcurementService = {
  suppliers: (options = {}) => supplierService.getAll({ ...options, limit: options.limit || 200 }),
  createSupplier: (row) => supplierService.create(row),
  updateSupplier: (id, row) => supplierService.update(id, row),
  purchaseOrders: (options = {}) => purchaseOrderService.getAll({ ...options, limit: options.limit || 200 }),
  createPurchaseOrder: (row) => purchaseOrderService.create(row),
  updatePurchaseOrderStatus: (id, status) => purchaseOrderService.updateStatus(id, status),
  goodsReceived: (options = {}) => goodsReceivedService.getAll({ ...options, limit: options.limit || 200 }),
  receiveFromOrder: (orderId, payload) => goodsReceivedService.createFromPO(orderId, payload),
  async products(search = '') {
    let q = posSupabase.from('lb_products').select('id,name,sku,cost_price').eq('is_active', 'active').order('name').limit(300);
    if (search) q = q.ilike('name', `%${search}%`);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },
};
