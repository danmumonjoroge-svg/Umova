// src/pos-erp/services/salonService.js
//
// Phase 6 — services & appointments (brief §48-50). See
// schema/phase6_salon.sql for why a service is a lb_products row
// (track_inventory=false) with a lb_service_details extension, not a
// new catalog.
//
// Phase 54: an appointment is NOT paid on this page any more. "Complete" opens the Sell page with the booking
// (see POSPage ?appointment=), so there is one place that takes money. The sale item carries the booking and the
// optional provider; the database then marks the booking COMPLETED and writes the commission (phase54 SQL).

import { posSupabase as supabase } from './posSupabaseClient';

export const serviceDetailsService = {
  // Services ARE lb_products rows (track_inventory=false) — this reads
  // the product catalog filtered that way, joined with the detail
  // extension table, rather than something productService.js needs to
  // know about (it has no reason to filter by track_inventory itself).
  async listServices({ businessId } = {}) {
    let q = supabase
      .from('lb_products')
      .select('*, service_details:lb_service_details(id, kind, duration_minutes, default_staff_id, commission_rate, staff:pos_staff(id, name))')
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
  async upsert({ tenantId, businessId, productId, durationMinutes, defaultStaffId, commissionRate, kind = 'SERVICE' }) {
    const { data, error } = await supabase
      .from('lb_service_details')
      .upsert({
        tenant_id: tenantId,
        business_id: businessId ?? null,
        product_id: productId,
        duration_minutes: durationMinutes || null,
        default_staff_id: defaultStaffId || null,
        commission_rate: commissionRate || 0,
        kind: kind === 'ACTIVITY' ? 'ACTIVITY' : 'SERVICE',
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
      .select('*, customer:lb_customers(id, name, phone, email), service:lb_products(id, name, selling_price), staff:pos_staff(id, name)')
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
        employee_id: appt.employee_id || null,       // phase54: optional provider (an HR employee)
        provider_name: appt.employee_id ? (appt.provider_name || null) : null,
        appointment_date: appt.appointment_date,
        appointment_time: appt.appointment_time,
        duration_minutes: appt.duration_minutes || null,
        notes: appt.notes || null,
        created_by: appt.created_by ?? null,
      })
      .select('*, customer:lb_customers(id, name, phone, email), service:lb_products(id, name, selling_price), staff:pos_staff(id, name)')
      .single();
    if (error) throw error;
    return data;
  },

  /** Phase 50 — move an appointment. The database trigger keeps the ORIGINAL date/time and the previous one. */
  async reschedule(id, { date, time }) {
    if (!date || !time) throw new Error('Choose a date and a time.');
    const { data, error } = await supabase.from('lb_appointments').update({ appointment_date: date, appointment_time: time }).eq('id', id).select('*, customer:lb_customers(id, name, phone, email), service:lb_products(id, name, selling_price), staff:pos_staff(id, name)').single();
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

  async getById(id) {
    const { data, error } = await supabase
      .from('lb_appointments')
      .select('*, customer:lb_customers(id, name, phone, email), service:lb_products(id, name, selling_price), staff:pos_staff(id, name)')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data;
  },
};

// Phase 54 -- who can be given a booking or a service line. These are HR employees (the people payroll pays);
// the function returns names and job titles only.
export const providerService = {
  async list(businessId) {
    if (!businessId) return [];
    const { data, error } = await supabase.rpc('salon_list_providers', { p_business: businessId });
    if (error) {
      // Not deployed yet (phase54 not run) or no HR access: the provider choice is optional, so the screens just hide it.
      if (error.code === 'PGRST202' || error.code === '42883') return [];
      throw error;
    }
    return data || [];
  },
};
