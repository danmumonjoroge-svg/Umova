// src/pos-erp/hooks/useSalon.js
//
// Phase 6 — thin hooks over salonService.js + productService.js (for
// creating the underlying lb_products row a service is).

import { useState, useEffect, useCallback } from 'react';
import { serviceDetailsService, appointmentService } from '../services/salonService';
import { productService } from '../services/productService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

export function useServices() {
  const { staffId, tenant } = usePosErpAuth();
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setServices(await serviceDetailsService.listServices({ businessId: tenant?.business_id }));
    } catch (err) {
      console.error('[useServices] fetch failed:', err);
      setError(err.message || 'Failed to load services.');
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { fetch(); }, [fetch]);

  /**
   * Creates the lb_products row (track_inventory=false, so it never
   * touches stock) AND its lb_service_details row together, since a
   * "service" only makes sense as both at once from this page's
   * perspective. sku is auto-generated — services have no real SKU/
   * barcode use case, but lb_products.sku is NOT NULL.
   */
  const create = useCallback(async ({ name, selling_price, duration_minutes, default_staff_id, commission_rate }) => {
    const product = await productService.create({
      tenant_id: tenant?.id,
      business_id: tenant?.business_id ?? null,
      sku: `SVC-${Date.now().toString(36).toUpperCase()}`,
      name,
      selling_price: Number(selling_price) || 0,
      track_inventory: false,
      selling_mode: 'PER_UNIT',
      created_by: staffId,
    });
    const details = await serviceDetailsService.upsert({
      tenantId: tenant?.id,
      businessId: tenant?.business_id,
      productId: product.id,
      durationMinutes: duration_minutes ? Number(duration_minutes) : null,
      defaultStaffId: default_staff_id || null,
      commissionRate: commission_rate ? Number(commission_rate) : 0,
    });
    const result = { ...product, service_details: details };
    setServices(prev => [...prev, result]);
    return result;
  }, [staffId, tenant]);

  return { services, loading, error, fetch, create };
}

export function useAppointments(filters = {}) {
  const { staffId, tenant } = usePosErpAuth();
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAppointments(await appointmentService.getAll({ businessId: tenant?.business_id, ...filters }));
    } catch (err) {
      console.error('[useAppointments] fetch failed:', err);
      setError(err.message || 'Failed to load appointments.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, filters.from, filters.to]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (data) => {
    const result = await appointmentService.create({ ...data, tenant_id: tenant?.id, business_id: tenant?.business_id ?? null, created_by: staffId });
    setAppointments(prev => [...prev, result].sort((a, b) => (a.appointment_date + a.appointment_time).localeCompare(b.appointment_date + b.appointment_time)));
    return result;
  }, [staffId, tenant]);

  const setStatus = useCallback(async (id, status) => {
    const result = await appointmentService.setStatus(id, status);
    setAppointments(prev => prev.map(a => a.id === id ? { ...a, ...result } : a));
    return result;
  }, []);

  const completeAndSell = useCallback(async (appointment, { shiftId, unitPrice, paymentMethod }) => {
    const { appointment: updated } = await appointmentService.completeAndSell({
      appointment: { ...appointment, tenant_id: tenant?.id, business_id: tenant?.business_id },
      shiftId, unitPrice, paymentMethod, createdBy: staffId,
    });
    setAppointments(prev => prev.map(a => a.id === appointment.id ? { ...a, ...updated } : a));
    return updated;
  }, [staffId, tenant]);

  return { appointments, loading, error, fetch, create, setStatus, completeAndSell };
}
