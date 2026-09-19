// src/pos-erp/pages/FinancialReportsPage.jsx
//
// Printable Income Statement + Balance Sheet. "Print" just calls
// window.print() — no PDF library, no server-side rendering. The
// sidebar/topbar are hidden via print:hidden classes added to
// POSLayout.jsx, so printing from here prints only the statement.

import React, { useState, useEffect, useCallback } from 'react';
import { FileBarChart, Loader2, Printer } from 'lucide-react';
import { financialReportsService } from '../services/financialReportsService';
import { usePosErpAuth } from '../auth/usePosErpAuth';

function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function firstOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

export default function FinancialReportsPage() {
  const { tenant } = usePosErpAuth();
  const [tab, setTab] = useState('income'); // 'income' | 'balance'
  const [fromDate, setFromDate] = useState(firstOfMonth());
  const [toDate, setToDate] = useState(today());
  const [income, setIncome] = useState(null);
  const [balance, setBalance] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadIncome = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    setError('');
    try {
      setIncome(await financialReportsService.getIncomeStatement({ tenantId: tenant.id, businessId: tenant.business_id, fromDate, toDate }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenant, fromDate, toDate]);

  const loadBalance = useCallback(async () => {
    if (!tenant?.id) return;
    setLoading(true);
    setError('');
    try {
      setBalance(await financialReportsService.getBalanceSheet({ tenantId: tenant.id, businessId: tenant.business_id }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tenant]);

  useEffect(() => { if (tab === 'income') loadIncome(); }, [tab, loadIncome]);
  useEffect(() => { if (tab === 'balance') loadBalance(); }, [tab, loadBalance]);

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <FileBarChart size={22} className="text-amber-600" /> Financial Reports
          </h1>
          <p className="text-slate-500 text-sm">Simple, printable statements built from your actual sales, expenses, and balances.</p>
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-emerald-800 hover:bg-emerald-900 text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-[0_2px_0_0_rgba(251,191,36,0.6)]"
        >
          <Printer size={16} /> Print
        </button>
      </div>

      <div className="flex gap-2 mb-4 print:hidden">
        <button onClick={() => setTab('income')} className={`text-sm font-semibold px-4 py-2 rounded-xl ${tab === 'income' ? 'bg-emerald-800 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>Income Statement</button>
        <button onClick={() => setTab('balance')} className={`text-sm font-semibold px-4 py-2 rounded-xl ${tab === 'balance' ? 'bg-emerald-800 text-white' : 'bg-white border border-slate-200 text-slate-600'}`}>Balance Sheet</button>
      </div>

      {tab === 'income' && (
        <div className="flex items-center gap-2 mb-6 print:hidden">
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-sm" />
          <span className="text-slate-400 text-sm">to</span>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} className="border border-slate-200 rounded-xl px-3 py-2 text-sm" />
        </div>
      )}

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3 mb-4 print:hidden">{error}</div>}
      {loading && <div className="text-center py-10 text-slate-400 print:hidden"><Loader2 size={18} className="animate-spin inline mr-2" /> Loading…</div>}

      {/* Printable area */}
      <div className="bg-white border border-slate-200 rounded-2xl p-8 print:border-0 print:shadow-none print:p-0">
        <div className="text-center mb-6">
          <div className="font-bold text-lg text-slate-800">{tenant?.business_name}</div>
          <div className="text-sm text-slate-500">
            {tab === 'income' ? `Income Statement — ${fromDate} to ${toDate}` : `Balance Sheet — as of ${balance?.asOf || today()}`}
          </div>
        </div>

        {tab === 'income' && income && (
          <table className="w-full text-sm">
            <tbody>
              <StatementRow label="Revenue" value={income.revenue} bold />
              <StatementRow label="Cost of Goods Sold" value={-income.cogs} indent />
              <StatementRow label="Gross Profit" value={income.grossProfit} bold divider />
              {income.expensesByCategory.map(e => (
                <StatementRow key={e.category} label={e.category} value={-e.amount} indent />
              ))}
              <StatementRow label="Total Expenses" value={-income.totalExpenses} bold />
              <StatementRow label="Net Income" value={income.netIncome} bold divider highlight={income.netIncome >= 0 ? 'emerald' : 'red'} />
            </tbody>
          </table>
        )}

        {tab === 'balance' && balance && (
          <div className="space-y-6">
            <table className="w-full text-sm">
              <tbody>
                <tr><td colSpan={2} className="font-bold text-slate-700 pt-2 pb-1">Assets</td></tr>
                <StatementRow label="Cash &amp; Bank (estimated)" value={balance.assets.cashAndBank} indent />
                <StatementRow label="Inventory Value" value={balance.assets.inventoryValue} indent />
                <StatementRow label="Accounts Receivable" value={balance.assets.accountsReceivable} indent />
                <StatementRow label="Fixed Assets (net of depreciation)" value={balance.assets.fixedAssets} indent />
                <StatementRow label="Total Assets" value={balance.assets.total} bold divider />
              </tbody>
            </table>
            <table className="w-full text-sm">
              <tbody>
                <tr><td colSpan={2} className="font-bold text-slate-700 pt-2 pb-1">Liabilities</td></tr>
                <StatementRow label="Accounts Payable" value={balance.liabilities.accountsPayable} indent />
                <StatementRow label="Total Liabilities" value={balance.liabilities.total} bold divider />
              </tbody>
            </table>
            <table className="w-full text-sm">
              <tbody>
                <tr><td colSpan={2} className="font-bold text-slate-700 pt-2 pb-1">Equity</td></tr>
                <StatementRow label="Owner's Equity (calculated)" value={balance.equity.ownersEquity} indent />
                <StatementRow label="Total Liabilities + Equity" value={balance.liabilities.total + balance.equity.total} bold divider />
              </tbody>
            </table>
            <p className="text-xs text-slate-400 italic">
              Cash &amp; Bank is estimated from transaction history, not a reconciled bank/till balance. Owner's Equity is a
              calculated balancing figure (Assets − Liabilities) — this app doesn't track capital contributions or
              drawings separately.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function StatementRow({ label, value, bold, indent, divider, highlight }) {
  const toneClass = highlight === 'red' ? 'text-red-600' : highlight === 'emerald' ? 'text-emerald-700' : 'text-slate-800';
  return (
    <tr className={divider ? 'border-t border-slate-200' : ''}>
      <td className={`py-1.5 ${indent ? 'pl-4 text-slate-500' : ''} ${bold ? 'font-bold text-slate-800' : ''}`}>{label}</td>
      <td className={`py-1.5 text-right ${bold ? `font-bold ${toneClass}` : 'text-slate-600'}`}>
        {value < 0 ? `(${fmt(Math.abs(value))})` : fmt(value)}
      </td>
    </tr>
  );
}
