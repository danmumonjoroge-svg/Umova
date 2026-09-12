// src/pos-erp/hooks/useProperty.js
//
// Phase 5 — thin hooks over propertyService.js, same tenant_id/
// business_id/staffId stamping pattern as useCustomers.js/useProducts.js.

import { useState, useEffect, useCallback } from 'react';
import { unitService, recurringChargeService, chargeInvoiceService, meterService } from '../services/propertyService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

export function useUnits() {
  const { staffId, tenant } = usePosErpAuth();
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUnits(await unitService.getAll({ businessId: tenant?.business_id }));
    } catch (err) {
      console.error('[useUnits] fetch failed:', err);
      setError(err.message || 'Failed to load units.');
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (data) => {
    const result = await unitService.create({ ...data, tenant_id: tenant?.id, business_id: tenant?.business_id ?? null, created_by: staffId });
    setUnits(prev => [...prev, result].sort((a, b) => a.unit_number.localeCompare(b.unit_number)));
    return result;
  }, [staffId, tenant]);

  const assignCustomer = useCallback(async (unitId, customerId) => {
    const result = await unitService.assignCustomer(unitId, customerId);
    setUnits(prev => prev.map(u => u.id === unitId ? result : u));
    return result;
  }, []);

  const update = useCallback(async (id, updates) => {
    const result = await unitService.update(id, updates);
    setUnits(prev => prev.map(u => u.id === id ? result : u));
    return result;
  }, []);

  return { units, loading, error, fetch, create, assignCustomer, update };
}

export function useRecurringCharges() {
  const { staffId, tenant } = usePosErpAuth();
  const [charges, setCharges] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCharges(await recurringChargeService.getAll({ businessId: tenant?.business_id }));
    } catch (err) {
      console.error('[useRecurringCharges] fetch failed:', err);
      setError(err.message || 'Failed to load recurring charges.');
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (data) => {
    const result = await recurringChargeService.create({ ...data, tenant_id: tenant?.id, business_id: tenant?.business_id ?? null, created_by: staffId });
    setCharges(prev => [result, ...prev]);
    return result;
  }, [staffId, tenant]);

  const setStatus = useCallback(async (id, status) => {
    const result = await recurringChargeService.setStatus(id, status);
    setCharges(prev => prev.map(c => c.id === id ? { ...c, ...result } : c));
    return result;
  }, []);

  const generateInvoice = useCallback(async (recurringChargeId, period) => {
    return recurringChargeService.generateInvoice({ recurringChargeId, period, createdBy: staffId });
  }, [staffId]);

  return { charges, loading, error, fetch, create, setStatus, generateInvoice };
}

export function useChargeInvoices(filters = {}) {
  const { staffId, tenant } = usePosErpAuth();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInvoices(await chargeInvoiceService.getAll({ businessId: tenant?.business_id, ...filters }));
    } catch (err) {
      console.error('[useChargeInvoices] fetch failed:', err);
      setError(err.message || 'Failed to load charge invoices.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, filters.customerId, filters.status]);

  useEffect(() => { fetch(); }, [fetch]);

  const recordPayment = useCallback(async (invoiceId, { amount, paymentMethod, referenceNo, notes }) => {
    await chargeInvoiceService.recordPayment({ invoiceId, amount, paymentMethod, referenceNo, notes, createdBy: staffId });
    await fetch(); // re-read status/paid_amount from the DB rather than recompute it client-side
  }, [staffId, fetch]);

  const waive = useCallback(async (id) => {
    const result = await chargeInvoiceService.waive(id);
    setInvoices(prev => prev.map(i => i.id === id ? { ...i, ...result } : i));
    return result;
  }, []);

  return { invoices, loading, error, fetch, recordPayment, waive };
}

export function useMeters() {
  const { staffId, tenant } = usePosErpAuth();
  const [meters, setMeters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setMeters(await meterService.getAll({ businessId: tenant?.business_id }));
    } catch (err) {
      console.error('[useMeters] fetch failed:', err);
      setError(err.message || 'Failed to load meters.');
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (data) => {
    const result = await meterService.create({ ...data, tenant_id: tenant?.id, business_id: tenant?.business_id ?? null, created_by: staffId });
    setMeters(prev => [...prev, result]);
    return result;
  }, [staffId, tenant]);

  const recordReadingAndBill = useCallback(async (meter, { previousReading, currentReading, readingDate }) => {
    return meterService.recordReadingAndBill({
      meterId: meter.id,
      tenantId: tenant?.id,
      businessId: tenant?.business_id,
      unitId: meter.unit_id,
      customerId: meter.customer_id,
      previousReading,
      currentReading,
      rate: meter.rate,
      readingDate,
      meterType: meter.meter_type,
      createdBy: staffId,
    });
  }, [staffId, tenant]);

  return { meters, loading, error, fetch, create, recordReadingAndBill };
}
