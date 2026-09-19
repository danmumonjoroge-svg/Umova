// src/pos-erp/services/financialReportsService.js
//
// Simple, honest financial statements built from data that already
// exists and is already correct — no new tables, no chart of accounts,
// no journal entries. Matches the brief's own §75 instruction: "Do not
// build a completely separate accounting engine inside POS unless the
// existing architecture requires it."
//
// INCOME STATEMENT — a real period report. Revenue and expenses both
// have real dated rows (lb_sales.created_at, lb_expenses.expense_date),
// so "for the month of March" is a question this data can actually
// answer.
//   Revenue      = SUM(lb_sales.total_amount), COMPLETED/PARTIALLY_REFUNDED, in range
//   COGS         = SUM(lb_sale_items.cost_price * quantity) for those sales
//                  (cost_price is stamped on every sale item at sale time —
//                  confirmed in saleService.js, not assumed)
//   Gross Profit = Revenue - COGS
//   Expenses     = SUM(lb_expenses.amount), status = PAID, by category, in range
//   Net Income   = Gross Profit - Expenses
//
// BALANCE SHEET — deliberately "as of today" ONLY, not a historical
// date picker. lb_inventory.quantity, lb_customers.outstanding_balance,
// and lb_suppliers.outstanding_balance are all RUNNING balances with no
// historical snapshot anywhere in this schema — asking "what was
// inventory worth on 1 March" would silently return today's figure
// mislabeled as March's, which is worse than not offering the date at
// all. Only "Cash & Bank" could theoretically be computed for a past
// cutoff (it's built from dated transactions), but showing one correct
// historical line next to three that silently aren't would be
// confusing, not more honest — so the whole statement is "as of now."
//   Cash & Bank (estimated) = all non-CREDIT money received (sale
//     payments + standalone customer payments) minus all non-CREDIT
//     money paid out (expenses + supplier payments), since inception.
//     Labeled "estimated" because this is derived from transaction
//     history, not a reconciled bank/till balance — there is no bank-
//     account ledger anywhere in this schema (see brief §39: "at
//     minimum track balances and payment references", nothing more).
//   Inventory Value = SUM(lb_inventory.quantity * average_cost)
//   Accounts Receivable = SUM(lb_customers.outstanding_balance)
//   Accounts Payable = SUM(lb_suppliers.outstanding_balance)
//   Owner's Equity = Assets - Liabilities (a PLUG, not a tracked figure —
//     there is no capital-contributions/drawings ledger in this schema,
//     so equity can only ever be "whatever balances the sheet", labeled
//     as such rather than presented as something independently verified.

import { posSupabase as supabase } from './posSupabaseClient';
import { assetService } from './assetService';

const NON_CASH_METHODS = new Set(['CREDIT']);

export const financialReportsService = {
  /**
   * @param {string} fromDate - 'YYYY-MM-DD' inclusive
   * @param {string} toDate - 'YYYY-MM-DD' inclusive
   */
  async getIncomeStatement({ tenantId, businessId, fromDate, toDate }) {
    if (!tenantId) throw new Error('financialReportsService.getIncomeStatement: tenantId is required.');

    let salesQuery = supabase
      .from('lb_sales')
      .select('id, total_amount')
      .eq('tenant_id', tenantId)
      .in('status', ['COMPLETED', 'PARTIALLY_REFUNDED'])
      .gte('created_at', `${fromDate}T00:00:00`)
      .lt('created_at', `${toDate}T23:59:59.999`);
    if (businessId) salesQuery = salesQuery.eq('business_id', businessId);
    const { data: sales, error: salesError } = await salesQuery;
    if (salesError) throw salesError;

    const revenue = (sales || []).reduce((sum, s) => sum + Number(s.total_amount), 0);
    const saleIds = (sales || []).map((s) => s.id);

    let cogs = 0;
    if (saleIds.length) {
      const { data: items, error: itemsError } = await supabase
        .from('lb_sale_items')
        .select('cost_price, quantity')
        .in('sale_id', saleIds);
      if (itemsError) throw itemsError;
      cogs = (items || []).reduce((sum, i) => sum + Number(i.cost_price || 0) * Number(i.quantity), 0);
    }

    let expensesQuery = supabase
      .from('lb_expenses')
      .select('amount, category:lb_expense_categories(name)')
      .eq('tenant_id', tenantId)
      .eq('status', 'PAID')
      .gte('expense_date', fromDate)
      .lte('expense_date', toDate);
    if (businessId) expensesQuery = expensesQuery.eq('business_id', businessId);
    const { data: expenseRows, error: expensesError } = await expensesQuery;
    if (expensesError) throw expensesError;

    const expensesByCategory = {};
    let totalExpenses = 0;
    for (const e of expenseRows || []) {
      const label = e.category?.name || 'Uncategorized';
      expensesByCategory[label] = (expensesByCategory[label] || 0) + Number(e.amount);
      totalExpenses += Number(e.amount);
    }

    const grossProfit = revenue - cogs;
    const netIncome = grossProfit - totalExpenses;

    return {
      fromDate, toDate,
      revenue, cogs, grossProfit,
      expensesByCategory: Object.entries(expensesByCategory).map(([category, amount]) => ({ category, amount })),
      totalExpenses, netIncome,
    };
  },

  async getBalanceSheet({ tenantId, businessId }) {
    if (!tenantId) throw new Error('financialReportsService.getBalanceSheet: tenantId is required.');

    // --- Cash & Bank (estimated) ---
    let salePaymentsQuery = supabase.from('lb_payments').select('amount, change_amount, payment_method, sale_id').eq('status', 'COMPLETED');
    // lb_payments has no tenant_id/business_id of its own — scoped via its sale
    let salesForScope = supabase.from('lb_sales').select('id').eq('tenant_id', tenantId);
    if (businessId) salesForScope = salesForScope.eq('business_id', businessId);
    const { data: scopedSales, error: scopedSalesError } = await salesForScope;
    if (scopedSalesError) throw scopedSalesError;
    const scopedSaleIds = (scopedSales || []).map((s) => s.id);

    let cashIn = 0;
    if (scopedSaleIds.length) {
      const { data: payments, error: paymentsError } = await salePaymentsQuery.in('sale_id', scopedSaleIds);
      if (paymentsError) throw paymentsError;
      for (const p of payments || []) {
        if (NON_CASH_METHODS.has(p.payment_method)) continue;
        cashIn += Number(p.amount) - Number(p.change_amount || 0);
      }
    }

    let custPayQuery = supabase.from('lb_customer_payments').select('amount, payment_method').eq('tenant_id', tenantId);
    if (businessId) custPayQuery = custPayQuery.eq('business_id', businessId);
    const { data: custPayments, error: custPayError } = await custPayQuery;
    if (custPayError) throw custPayError;
    for (const p of custPayments || []) {
      if (NON_CASH_METHODS.has(p.payment_method)) continue;
      cashIn += Number(p.amount);
    }

    let expQuery = supabase.from('lb_expenses').select('amount, payment_method').eq('tenant_id', tenantId).eq('status', 'PAID');
    if (businessId) expQuery = expQuery.eq('business_id', businessId);
    const { data: expenseRows, error: expError } = await expQuery;
    if (expError) throw expError;
    let cashOut = 0;
    for (const e of expenseRows || []) {
      if (NON_CASH_METHODS.has(e.payment_method)) continue;
      cashOut += Number(e.amount);
    }

    let supPayQuery = supabase.from('lb_supplier_payments').select('amount, payment_method').eq('tenant_id', tenantId);
    if (businessId) supPayQuery = supPayQuery.eq('business_id', businessId);
    const { data: supPayments, error: supPayError } = await supPayQuery;
    if (supPayError) throw supPayError;
    for (const p of supPayments || []) {
      if (NON_CASH_METHODS.has(p.payment_method)) continue;
      cashOut += Number(p.amount);
    }

    const cashAndBank = cashIn - cashOut;

    // --- Inventory value ---
    let invQuery = supabase.from('lb_inventory').select('quantity, average_cost').eq('tenant_id', tenantId);
    if (businessId) invQuery = invQuery.eq('business_id', businessId);
    const { data: invRows, error: invError } = await invQuery;
    if (invError) throw invError;
    const inventoryValue = (invRows || []).reduce((sum, r) => sum + Number(r.quantity) * Number(r.average_cost || 0), 0);

    // --- Receivables / Payables (already-maintained running balances) ---
    let custQuery = supabase.from('lb_customers').select('outstanding_balance').eq('tenant_id', tenantId).gt('outstanding_balance', 0);
    if (businessId) custQuery = custQuery.eq('business_id', businessId);
    const { data: custRows, error: custError } = await custQuery;
    if (custError) throw custError;
    const accountsReceivable = (custRows || []).reduce((sum, r) => sum + Number(r.outstanding_balance), 0);

    let supQuery = supabase.from('lb_suppliers').select('outstanding_balance').eq('tenant_id', tenantId).gt('outstanding_balance', 0);
    if (businessId) supQuery = supQuery.eq('business_id', businessId);
    const { data: supRows, error: supError } = await supQuery;
    if (supError) throw supError;
    const accountsPayable = (supRows || []).reduce((sum, r) => sum + Number(r.outstanding_balance), 0);

    // --- Fixed assets at net book value (Phase 9) ---
    // Cost less accumulated depreciation, for assets still owned
    // (DISPOSED/WRITTEN_OFF are excluded by assetService.getSummary).
    // Unlike Cash & Bank, this one is NOT an estimate: both figures are
    // stored, and accumulated_depreciation is only ever written by
    // post_asset_depreciation(). A business with no equipment recorded
    // gets zero, which is correct rather than missing.
    const assetSummary = await assetService.getSummary({ businessId });
    const fixedAssets = assetSummary.netBookValue;

    const totalAssets = cashAndBank + inventoryValue + accountsReceivable + fixedAssets;
    const totalLiabilities = accountsPayable;
    const ownersEquity = totalAssets - totalLiabilities; // plug — see header note

    return {
      asOf: new Date().toISOString().slice(0, 10),
      assets: { cashAndBank, inventoryValue, accountsReceivable, fixedAssets, total: totalAssets },
      liabilities: { accountsPayable, total: totalLiabilities },
      equity: { ownersEquity, total: ownersEquity },
    };
  },
};
