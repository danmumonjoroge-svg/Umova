// src/pos-erp/services/salonService.js
//
// Phase 6 — services & appointments (brief §48-50). See
// schema/phase6_salon.sql for why a service is a lb_products row
// (track_inventory=false) with a lb_service_details extension, not a
// new catalog.

import { posSupabase as supabase } from './posSupabaseClient';
import { saleService } from './saleService';

export const serviceDetailsService = {
  // Services ARE lb_products rows (track_inventory=false) — this reads
  // the product catalog filtered that way, joined with the detail
  // extension table, rather than something productService.js needs to
  // know about (it has no reason to filter by track_inventory itself).
  async listServices({ businessId } = {}) {
    let q = supabase
      .from('lb_products')
      .select('*, service_details:lb_service_details(id, duration_minutes, default_staff_id, commission_rate, staff:pos_staff(id, name))')
      .eq('track_inventory', false)
      .eq('is_active', 'active')
      .order('name');
    if (businessId) q = q.eq('business_id', businessId);
    const { data, error } = await q;
    if (error) throw error;
    // lb_service_details is a 1:1 extension (UNIQUE product_id) but
    // Supabase's embed still returns it as an array — flatten here so
    // callers get service_details as an object or null, not [x] / [].
    return (data || []).map(p => ({ ...p, service_details: p.service_details?.[0] || null }));
  },

  async getByProductId(productId) {
    const { data, error } = await supabase.from('lb_service_details').select('*').eq('product_id', productId).maybeSingle();
    if (error) throw error;
    return data;
  },

  // One row per service product — upsert on the unique product_id rather
  // than separate create/update, since the caller (ServicesPage) doesn't
  // need to know whether details already exist for a given product.
  async upsert({ tenantId, businessId, productId, durationMinutes, defaultStaffId, commissionRate }) {
    const { data, error } = await supabase
      .from('lb_service_details')
      .upsert({
        tenant_id: tenantId,
        business_id: businessId ?? null,
        product_id: productId,
        duration_minutes: durationMinutes || null,
        default_staff_id: defaultStaffId || null,
        commission_rate: commissionRate || 0,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'product_id' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },
};

export const appointmentService = {
  async getAll({ businessId, from, to } = {}) {
    let q = supabase
      .from('lb_appointments')
      .select('*, customer:lb_customers(id, name, phone), service:lb_products(id, name, selling_price), staff:pos_staff(id, name)')
      .order('appointment_date', { ascending: true })
      .order('appointment_time', { ascending: true });
    if (businessId) q = q.eq('business_id', businessId);
    if (from) q = q.gte('appointment_date', from);
    if (to) q = q.lte('appointment_date', to);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async create(appt) {
    if (!appt.tenant_id) throw new Error('appointmentService.create: tenant_id is required.');
    if (!appt.customer_id) throw new Error('appointmentService.create: customer_id is required.');
    if (!appt.product_id) throw new Error('appointmentService.create: product_id (service) is required.');
    const { data, error } = await supabase
      .from('lb_appointments')
      .insert({
        tenant_id: appt.tenant_id,
        business_id: appt.business_id ?? null,
        customer_id: appt.customer_id,
        product_id: appt.product_id,
        staff_id: appt.staff_id || null,
        appointment_date: appt.appointment_date,
        appointment_time: appt.appointment_time,
        duration_minutes: appt.duration_minutes || null,
        notes: appt.notes || null,
        created_by: appt.created_by ?? null,
      })
      .select('*, customer:lb_customers(id, name, phone), service:lb_products(id, name, selling_price), staff:pos_staff(id, name)')
      .single();
    if (error) throw error;
    return data;
  },

  async setStatus(id, status) {
    const { data, error } = await supabase
      .from('lb_appointments')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /**
   * Completes an appointment by selling its linked service through the
   * EXISTING sales engine (saleService.create() — same code the till
   * uses), then stamps this appointment COMPLETED with the resulting
   * sale_id. Deliberately not a new DB function: this is exactly what
   * saleService.create() already does correctly for a
   * track_inventory=false product (skips stock movement, still creates
   * payment + receipt) — wrapping it in a second SECURITY DEFINER
   * function would just be the same insert done twice.
   *
   * Requires an open cashier shift, same as the till itself — completing
   * a service sale outside a shift would create a sale nothing can ever
   * reconcile against in Cash/close-shift.
   */
  async completeAndSell({ appointment, shiftId, unitPrice, paymentMethod, createdBy }) {
    if (!shiftId) throw new Error('appointmentService.completeAndSell: an open cashier shift is required (same as the till).');
    const sale = await saleService.create({
      tenant_id: appointment.tenant_id,
      business_id: appointment.business_id,
      shift_id: shiftId,
      customer_id: appointment.customer_id,
      cashier_id: createdBy,
      items: [{
        product_id: appointment.product_id,
        quantity: 1,
        unit_price: unitPrice,
        cost_price: 0, // services have no cost of goods
        selling_mode: 'PER_UNIT',
      }],
      payments: [{ payment_method: paymentMethod, amount: unitPrice, change_amount: 0 }],
    });

    const { data, error } = await supabase
      .from('lb_appointments')
      .update({ status: 'COMPLETED', sale_id: sale.id, updated_at: new Date().toISOString() })
      .eq('id', appointment.id)
      .select()
      .single();
    if (error) throw error;
    return { appointment: data, sale };
  },
};
