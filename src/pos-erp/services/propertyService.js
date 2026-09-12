// src/pos-erp/services/propertyService.js
//
// Phase 5 — property capabilities (brief §43-47). Wraps the new tables/
// RPCs in schema/phase5_property.sql. Run that migration before any of
// this will work — none of these tables exist until it's been applied.
//
// A property "tenant" is just a lb_customers row (see the migration's
// header comment for why — §21 explicitly forbids a separate customer
// system for property). Nothing here creates or reads a different
// customer concept; unitService.assignCustomer() etc. all take a
// customer_id that comes from the same customerService.js/CustomersPage.jsx
// Phase 2 already built.

import { posSupabase as supabase } from './posSupabaseClient';

export const unitService = {
  async getAll({ businessId } = {}) {
    let q = supabase
      .from('lb_units')
      .select('*, customer:lb_customers(id, name, phone)')
      .order('unit_number', { ascending: true });
    if (businessId) q = q.eq('business_id', businessId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async create(unit) {
    if (!unit.tenant_id) throw new Error('unitService.create: tenant_id is required.');
    if (!unit.unit_number?.trim()) throw new Error('unitService.create: unit_number is required.');
    const { data, error } = await supabase
      .from('lb_units')
      .insert({
        tenant_id: unit.tenant_id,
        business_id: unit.business_id ?? null,
        unit_number: unit.unit_number.trim(),
        customer_id: unit.customer_id || null,
        rent_amount: unit.rent_amount || 0,
        status: unit.customer_id ? 'OCCUPIED' : 'VACANT',
        notes: unit.notes || null,
        created_by: unit.created_by ?? null,
      })
      .select('*, customer:lb_customers(id, name, phone)')
      .single();
    if (error) throw error;
    return data;
  },

  // Assigning/clearing an occupant also flips status — kept as one call
  // so the two can never drift out of sync (an OCCUPIED unit with no
  // customer_id, or vice versa).
  async assignCustomer(unitId, customerId) {
    const { data, error } = await supabase
      .from('lb_units')
      .update({ customer_id: customerId || null, status: customerId ? 'OCCUPIED' : 'VACANT', updated_at: new Date().toISOString() })
      .eq('id', unitId)
      .select('*, customer:lb_customers(id, name, phone)')
      .single();
    if (error) throw error;
    return data;
  },

  async update(id, updates) {
    const { data, error } = await supabase
      .from('lb_units')
      .update({
        unit_number: updates.unit_number,
        rent_amount: updates.rent_amount,
        notes: updates.notes || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select('*, customer:lb_customers(id, name, phone)')
      .single();
    if (error) throw error;
    return data;
  },
};

export const recurringChargeService = {
  async getAll({ businessId } = {}) {
    let q = supabase
      .from('lb_recurring_charges')
      .select('*, customer:lb_customers(id, name), unit:lb_units(id, unit_number)')
      .order('created_at', { ascending: false });
    if (businessId) q = q.eq('business_id', businessId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async create(charge) {
    if (!charge.tenant_id) throw new Error('recurringChargeService.create: tenant_id is required.');
    if (!charge.customer_id) throw new Error('recurringChargeService.create: customer_id is required.');
    if (!charge.charge_name?.trim()) throw new Error('recurringChargeService.create: charge_name is required.');
    if (!charge.amount || Number(charge.amount) <= 0) throw new Error('recurringChargeService.create: amount must be greater than zero.');

    const { data, error } = await supabase
      .from('lb_recurring_charges')
      .insert({
        tenant_id: charge.tenant_id,
        business_id: charge.business_id ?? null,
        customer_id: charge.customer_id,
        unit_id: charge.unit_id || null,
        charge_name: charge.charge_name.trim(),
        amount: Number(charge.amount),
        frequency: charge.frequency || 'MONTHLY',
        due_day: charge.due_day || null,
        start_date: charge.start_date || new Date().toISOString().slice(0, 10),
        end_date: charge.end_date || null,
        created_by: charge.created_by ?? null,
      })
      .select('*, customer:lb_customers(id, name), unit:lb_units(id, unit_number)')
      .single();
    if (error) throw error;
    return data;
  },

  async setStatus(id, status) {
    const { data, error } = await supabase
      .from('lb_recurring_charges')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** @returns {Promise<string>} the new lb_recurring_charge_invoices.id */
  async generateInvoice({ recurringChargeId, period, amount, createdBy }) {
    const { data, error } = await supabase.rpc('generate_recurring_charge_invoice', {
      p_recurring_charge_id: recurringChargeId,
      p_period: period,
      p_amount: amount ?? null,
      p_created_by: createdBy ?? null,
    });
    if (error) throw error;
    return data;
  },
};

export const chargeInvoiceService = {
  async getAll({ businessId, customerId, status } = {}) {
    let q = supabase
      .from('lb_recurring_charge_invoices')
      .select('*, customer:lb_customers(id, name), unit:lb_units(id, unit_number), charge:lb_recurring_charges(id, charge_name)')
      .order('due_date', { ascending: false });
    if (businessId) q = q.eq('business_id', businessId);
    if (customerId) q = q.eq('customer_id', customerId);
    if (status) q = q.eq('status', status);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  /** @returns {Promise<string>} the new lb_customer_payments.id */
  async recordPayment({ invoiceId, amount, paymentMethod, referenceNo, notes, createdBy }) {
    if (!invoiceId) throw new Error('chargeInvoiceService.recordPayment: invoiceId is required.');
    if (!amount || Number(amount) <= 0) throw new Error('chargeInvoiceService.recordPayment: amount must be greater than zero.');
    const { data, error } = await supabase.rpc('record_recurring_charge_payment', {
      p_invoice_id: invoiceId,
      p_amount: Number(amount),
      p_payment_method: paymentMethod,
      p_reference_no: referenceNo || null,
      p_notes: notes || null,
      p_created_by: createdBy ?? null,
    });
    if (error) throw error;
    return data;
  },

  async waive(id) {
    const { data, error } = await supabase.from('lb_recurring_charge_invoices').update({ status: 'WAIVED' }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },
};

export const meterService = {
  async getAll({ businessId } = {}) {
    let q = supabase
      .from('lb_meters')
      .select('*, unit:lb_units(id, unit_number), customer:lb_customers(id, name)')
      .eq('is_active', true)
      .order('meter_number', { ascending: true });
    if (businessId) q = q.eq('business_id', businessId);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  async create(meter) {
    if (!meter.tenant_id) throw new Error('meterService.create: tenant_id is required.');
    if (!meter.meter_number?.trim()) throw new Error('meterService.create: meter_number is required.');
    const { data, error } = await supabase
      .from('lb_meters')
      .insert({
        tenant_id: meter.tenant_id,
        business_id: meter.business_id ?? null,
        unit_id: meter.unit_id || null,
        customer_id: meter.customer_id || null,
        meter_number: meter.meter_number.trim(),
        meter_type: meter.meter_type,
        rate: Number(meter.rate) || 0,
        created_by: meter.created_by ?? null,
      })
      .select('*, unit:lb_units(id, unit_number), customer:lb_customers(id, name)')
      .single();
    if (error) throw error;
    return data;
  },

  async getLastReading(meterId) {
    const { data, error } = await supabase
      .from('lb_meter_readings')
      .select('*')
      .eq('meter_id', meterId)
      .order('reading_date', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * Records a reading, then bills it as a one-off recurring-charge
   * occurrence for the meter's customer/unit — §47's "that charge becomes
   * a normal customer charge" requirement. This is the one place a
   * lb_recurring_charges row is auto-created rather than set up by hand:
   * a meter charge has no fixed recurrence definition (consumption
   * varies every period), so each reading gets its own ONE_OFF charge
   * definition + immediate invoice, rather than trying to force it
   * through the amount-fixed MONTHLY/WEEKLY shape recurringChargeService
   * uses for rent.
   */
  async recordReadingAndBill({ meterId, tenantId, businessId, unitId, customerId, previousReading, currentReading, rate, readingDate, meterType, createdBy }) {
    if (Number(currentReading) < Number(previousReading)) {
      throw new Error('Current reading cannot be lower than the previous reading.');
    }
    const { data: reading, error: readingError } = await supabase
      .from('lb_meter_readings')
      .insert({
        tenant_id: tenantId,
        business_id: businessId ?? null,
        meter_id: meterId,
        previous_reading: Number(previousReading),
        current_reading: Number(currentReading),
        rate: Number(rate),
        reading_date: readingDate || new Date().toISOString().slice(0, 10),
        created_by: createdBy ?? null,
      })
      .select()
      .single();
    if (readingError) throw readingError;

    if (!customerId) {
      // No customer on this meter yet (e.g. a vacant unit's meter) — the
      // reading is still recorded for history, just not billed.
      return { reading, invoiceId: null };
    }

    const { data: chargeDef, error: chargeError } = await supabase
      .from('lb_recurring_charges')
      .insert({
        tenant_id: tenantId,
        business_id: businessId ?? null,
        customer_id: customerId,
        unit_id: unitId || null,
        charge_name: `${meterType === 'WATER' ? 'Water' : meterType === 'ELECTRICITY' ? 'Electricity' : 'Meter'} — ${reading.consumption} units`,
        amount: reading.charge_amount,
        frequency: 'ONE_OFF',
        status: 'ACTIVE',
        created_by: createdBy ?? null,
      })
      .select()
      .single();
    if (chargeError) throw chargeError;

    const invoiceId = await recurringChargeService.generateInvoice({
      recurringChargeId: chargeDef.id,
      period: reading.reading_date,
      amount: reading.charge_amount,
      createdBy,
    });

    await supabase.from('lb_meter_readings').update({ recurring_charge_invoice_id: invoiceId }).eq('id', reading.id);

    return { reading, invoiceId };
  },
};
