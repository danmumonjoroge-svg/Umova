// src/pos-erp/hooks/useExpenses.js

import { useState, useEffect, useCallback } from 'react';
import { expensesService } from '../services/expensesService';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { readThrough } from '../offline/readThrough';

export function useExpenses() {
  const { staffId, tenant } = usePosErpAuth();
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({ count: 0, page: 1, limit: 50 });
  const [copyInfo, setCopyInfo] = useState({ fromCache: false, savedAt: null, complete: true }); // saved copy from this phone?

  const fetch = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const rt = await readThrough('expenses', () => expensesService.getAll({ businessId: tenant?.business_id, ...params }), { tenantId: tenant?.id, params });
      const result = rt.result;
      setCopyInfo({ fromCache: rt.fromCache, savedAt: rt.savedAt, complete: rt.complete });
      setExpenses(result.data || []);
      setPagination({ count: result.count || 0, page: result.page || 1, limit: result.limit || 50 });
    } catch (err) {
      console.error('[useExpenses] fetch failed:', err);
      setError(err.message || 'Failed to load expenses.');
      setExpenses([]);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  const fetchCategories = useCallback(async () => {
    try {
      const rt = await readThrough('expense_categories', () => expensesService.getCategories(), { tenantId: tenant?.id, shape: 'list' });
      setCategories(rt.result);
    } catch (err) {
      console.error('[useExpenses] category fetch failed:', err);
    }
  }, [tenant?.id]);

  useEffect(() => { fetch(); }, [fetch]);
  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  const create = useCallback(async (data) => {
    await expensesService.create({
      ...data,
      businessId: tenant?.business_id,
      createdBy: staffId,
    });
    await fetch(); // re-read from the DB rather than guess the row record_expense() actually inserted (it returns only the new id)
  }, [staffId, tenant, fetch]);

  return { expenses, categories, loading, error, pagination, copyInfo, fetch, create };
}
