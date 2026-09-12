// src/pos-erp/hooks/usePurchases.js
//
// REBUILT alongside purchaseService.js's rewrite. Dropped
// usePurchaseRequests entirely — there is no lb_purchase_requests table
// in this database, and there's no requisition step anywhere else in the
// app (confirmed in conversation). If anything else still imports
// { usePurchaseRequests }, it will fail at build time now — intentional,
// so it surfaces immediately instead of hitting a service method that
// throws at runtime.
//
// createQuick -> createQuickReceipt (renamed in goodsReceivedService to
// match what it actually does — "quick" was ambiguous with "quick
// create product").

import { useState, useEffect, useCallback } from 'react';
import { purchaseOrderService, goodsReceivedService, supplierReturnService } from '../services/purchaseService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

export function usePurchaseOrders(options = {}) {
  const { staffId, tenant } = usePosErpAuth();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const result = await purchaseOrderService.getAll({ ...options, ...params });
      setOrders(result.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [options]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (data) => {
    const result = await purchaseOrderService.create({
      ...data,
      tenant_id: tenant?.id,
      business_id: tenant?.business_id ?? null,
      created_by: staffId,
    });
    setOrders(prev => [result, ...prev]);
    return result;
  }, [staffId, tenant]);

  return { orders, loading, error, fetch, create };
}

export function useGoodsReceived(options = {}) {
  const { staffId, tenant } = usePosErpAuth();

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const result = await goodsReceivedService.getAll({ ...options, ...params });
      setRecords(result.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [options]);

  useEffect(() => { fetch(); }, [fetch]);

  const createFromPO = useCallback(async (poId, data) => {
    const result = await goodsReceivedService.createFromPO(poId, {
      ...data,
      tenant_id: tenant?.id,
      business_id: tenant?.business_id ?? null,
      received_by: staffId,
    });
    setRecords(prev => [result, ...prev]);
    return result;
  }, [staffId, tenant]);

  const createQuickReceipt = useCallback(async (data) => {
    const result = await goodsReceivedService.createQuickReceipt({
      ...data,
      tenant_id: tenant?.id,
      business_id: tenant?.business_id ?? null,
      received_by: staffId,
    });
    setRecords(prev => [result, ...prev]);
    return result;
  }, [staffId, tenant]);

  return { records, loading, error, fetch, createFromPO, createQuickReceipt };
}

export function useSupplierReturns(options = {}) {
  const { staffId, tenant } = usePosErpAuth();

  const [returns, setReturns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetch = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const result = await supplierReturnService.getAll({ ...options, ...params });
      setReturns(result.data || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [options]);

  useEffect(() => { fetch(); }, [fetch]);

  const create = useCallback(async (data) => {
    const result = await supplierReturnService.create({
      ...data,
      tenant_id: tenant?.id,
      business_id: tenant?.business_id ?? null,
      created_by: staffId,
    });
    setReturns(prev => [result, ...prev]);
    return result;
  }, [staffId, tenant]);

  return { returns, loading, error, fetch, create };
}
