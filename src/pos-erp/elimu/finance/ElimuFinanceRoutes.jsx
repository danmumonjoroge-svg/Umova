// Route + navigation manifest for the school finance module. NOT wired into POSApp.jsx / navConfig.js (those are POS files):
// AI 5 (or the POS owner) mounts it with two small edits - see elimu/INTEGRATION.md "Routes / pages".
import React, { lazy } from 'react';
import { Route } from 'react-router-dom';

const Collect = lazy(() => import('./pages/ElimuCollectPage'));
const Account = lazy(() => import('./pages/ElimuStudentAccountPage'));
const Debtors = lazy(() => import('./pages/ElimuDebtorsPage'));
const Approvals = lazy(() => import('./pages/ElimuApprovalsPage'));
const FeeSetup = lazy(() => import('./pages/ElimuFeeSetupPage'));
const Expenses = lazy(() => import('./pages/ElimuExpensesPage'));
const Budgets = lazy(() => import('./pages/ElimuBudgetsPage'));
const LedgerChart = lazy(() => import('./ledger/ElimuChartPage'));
const LedgerJournals = lazy(() => import('./ledger/ElimuJournalsPage'));
const LedgerTrial = lazy(() => import('./ledger/ElimuTrialBalancePage'));
const Income = lazy(() => import('./ledger/ElimuStatementPages').then((m) => ({ default: m.IncomeStatementPage })));
const Position = lazy(() => import('./ledger/ElimuStatementPages').then((m) => ({ default: m.FinancialPositionPage })));
const CashFlow = lazy(() => import('./ledger/ElimuStatementPages').then((m) => ({ default: m.CashFlowPage })));
const Party = lazy(() => import('./ledger/ElimuStatementPages').then((m) => ({ default: m.PartyBalancesPage })));
const Bursaries = lazy(() => import('./pages/ElimuBursariesPage'));
const Recon = lazy(() => import('./pages/ElimuReconciliationPage'));
const Suppliers = lazy(() => import('./pages/ElimuSuppliersPage'));
const Payroll = lazy(() => import('./pages/ElimuPayrollPage'));
const Assets = lazy(() => import('./assets/ElimuAssetsPage'));
const Stores = lazy(() => import('./assets/ElimuStoresPage'));
const Procurement = lazy(() => import('../procurement/pages/ElimuProcurementPage'));
const AIA = lazy(() => import('../aia/pages/ElimuAIAPage'));
const Reports = lazy(() => import('./pages/ElimuReportsPage'));

export { default as FinanceHub } from './hub/FinanceHubPage';   // the Finance > module > submodule drill-down (route finance/*); small, so not lazy

/** Mount inside the POS layout:  {elimuFinanceRoutes()}   -> /pos/school-finance/... */
export const ELIMU_FINANCE_BASE = 'school-finance';
export const elimuFinanceRoutes = () => (
  <Route path={ELIMU_FINANCE_BASE}>
    <Route path="collect" element={<Collect />} />
    <Route path="account/:studentId" element={<Account />} />
    <Route path="debtors" element={<Debtors />} />
    <Route path="approvals" element={<Approvals />} />
    <Route path="fees" element={<FeeSetup />} />
    <Route path="expenses" element={<Expenses />} />
    <Route path="budgets" element={<Budgets />} />
    <Route path="ledger/accounts" element={<LedgerChart />} />
    <Route path="ledger/journals" element={<LedgerJournals />} />
    <Route path="ledger/trial" element={<LedgerTrial />} />
    <Route path="ledger/income" element={<Income />} />
    <Route path="ledger/position" element={<Position />} />
    <Route path="ledger/cashflow" element={<CashFlow />} />
    <Route path="ledger/receivables" element={<Party kind="RECEIVABLES" />} />
    <Route path="ledger/payables" element={<Party kind="PAYABLES" />} />
    <Route path="bursaries" element={<Bursaries />} />
    <Route path="reconciliation" element={<Recon />} />
    <Route path="suppliers" element={<Suppliers />} />
    <Route path="payroll" element={<Payroll />} />
    <Route path="assets" element={<Assets />} />
    <Route path="stores" element={<Stores />} />
    <Route path="procurement" element={<Procurement />} />
    <Route path="aia" element={<AIA />} />
    <Route path="reports" element={<Reports />} />
  </Route>
);
/** For the nav bar: label + the POS permission that shows it (the DB still decides what a click may do). */
export const ELIMU_FINANCE_NAV = [
  { key: 'collect', label: 'Collect fees', to: `${ELIMU_FINANCE_BASE}/collect`, anyOf: ['finance.collect'] },
  { key: 'debtors', label: 'Fee debtors', to: `${ELIMU_FINANCE_BASE}/debtors`, anyOf: ['finance.view'] },
  { key: 'approvals', label: 'Approvals', to: `${ELIMU_FINANCE_BASE}/approvals`, anyOf: ['finance.approve'] },
  { key: 'fees', label: 'Fees & billing', to: `${ELIMU_FINANCE_BASE}/fees`, anyOf: ['finance.bill', 'finance.configure'] },
  { key: 'expenses', label: 'Expenses', to: `${ELIMU_FINANCE_BASE}/expenses`, anyOf: ['finance.view', 'finance.expense'] },
  { key: 'budgets', label: 'Budgets', to: `${ELIMU_FINANCE_BASE}/budgets`, anyOf: ['finance.view'] },
  { key: 'ledger', label: 'Accounting', to: `${ELIMU_FINANCE_BASE}/ledger/journals`, anyOf: ['finance.report'], also: [`${ELIMU_FINANCE_BASE}/ledger`] },
  { key: 'assets', label: 'Assets & stores', to: `${ELIMU_FINANCE_BASE}/assets`, anyOf: ['finance.view'], also: [`${ELIMU_FINANCE_BASE}/stores`] },
  { key: 'reports', label: 'Finance reports', to: `${ELIMU_FINANCE_BASE}/reports`, anyOf: ['finance.view', 'finance.report'] },
];
