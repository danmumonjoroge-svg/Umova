// src/pos-erp/pages/workspaces/MoneyWorkspace.jsx
//
// "My Money" (brief section 7) -- owner language, no accounting terms on
// the front. Advanced statements and equipment stay reachable one tap
// away under "More money tools" rather than crowding the main cards.
//
// Sources (all existing): financialReportsService (today's income
// statement + balance sheet), mpesaService.getForDate (today's M-Pesa
// requests, same call the M-Pesa page makes).
//
// There is deliberately NO "Bank" card: this app has no bank page or
// bank ledger to open (the balance sheet only estimates "cash & bank"
// as one number). Add the card when a real Bank page exists.

import React from 'react';
import { Wallet, Smartphone, Users, Receipt, TrendingUp, BarChart3, FileBarChart, HardHat } from 'lucide-react';
import { usePosErpAuth } from '../../auth/usePosErpAuth';
import { financialReportsService } from '../../services/financialReportsService';
import { mpesaService } from '../../services/mpesaService';
import { WorkspacePage, SectionTitle, CardGrid, ActionCard, Stat, useStat, kes } from '../../components/workspace/WorkspaceKit';
import { Link } from 'react-router-dom';

const today = () => new Date().toISOString().slice(0, 10);

export default function MoneyWorkspace() {
  const { tenant } = usePosErpAuth();

  const income = useStat(() => financialReportsService.getIncomeStatement({ tenantId: tenant.id, fromDate: today(), toDate: today() }), [tenant?.id]);
  const balances = useStat(() => financialReportsService.getBalanceSheet({ tenantId: tenant.id }), [tenant?.id]);
  const mpesa = useStat(async () => {
    const rows = await mpesaService.getForDate({ businessId: tenant.business_id, date: today() });
    return {
      confirmed: rows.filter((r) => r.status === 'PAID').reduce((s, r) => s + Number(r.amount || 0), 0),
      pending: rows.filter((r) => r.status === 'PENDING').length,
      attention: rows.filter((r) => r.status === 'NEEDS_ATTENTION').length,
    };
  }, [tenant?.business_id]);

  const mpesaNeeds = (mpesa.value?.pending || 0) + (mpesa.value?.attention || 0);

  return (
    <WorkspacePage title="My Money" subtitle="Where your money is, what came in, and what went out.">
      {/* Today strip -- three plain numbers, not three big KPI cards */}
      <div className="bg-white border border-[#DDE3DD] rounded-xl grid grid-cols-3 divide-x divide-[#DDE3DD] mb-2">
        <div className="p-3 sm:p-4 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#68756D]">Made today</div>
          <div className="text-base sm:text-xl font-bold truncate"><Stat state={income} format={(i) => kes(i.revenue)} /></div>
        </div>
        <div className="p-3 sm:p-4 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#68756D]">Spent today</div>
          <div className="text-base sm:text-xl font-bold truncate"><Stat state={income} format={(i) => kes(i.totalExpenses)} /></div>
        </div>
        <div className="p-3 sm:p-4 min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-wide text-[#68756D]">Profit today</div>
          <div className={`text-base sm:text-xl font-bold truncate ${income.value && income.value.netIncome < 0 ? 'text-red-600' : 'text-[#237A52]'}`}>
            <Stat state={income} format={(i) => kes(i.netIncome)} />
          </div>
        </div>
      </div>

      <SectionTitle>Where your money is</SectionTitle>
      <CardGrid>
        <ActionCard
          variant="feature" to="/pos/cash" icon={Wallet} title="Cash"
          stat={<Stat state={balances} format={(b) => kes(b.assets.cashAndBank)} />} statLabel="estimated"
          description="Cash in and out, and closing the day."
          action="Open Cash"
        />
        <ActionCard
          variant={mpesaNeeds > 0 ? 'alert' : 'default'}
          to="/pos/mpesa" icon={Smartphone} title="M-Pesa"
          stat={<Stat state={mpesa} format={(m) => kes(m.confirmed)} />} statLabel="confirmed today"
          badge={mpesaNeeds}
          description="Payments received, waiting or needing a look. Setup is here too."
          action="Open M-Pesa"
        />
        <ActionCard
          to="/pos/customers" icon={Users} title="Credit"
          stat={<Stat state={balances} format={(b) => kes(b.assets.accountsReceivable)} />} statLabel="owed to you"
          description="Customers who bought on credit and still owe you."
          action="See Who Owes Me"
        />
      </CardGrid>

      <SectionTitle>Money going out and how you are doing</SectionTitle>
      <CardGrid>
        <ActionCard
          to="/pos/expenses" icon={Receipt} title="My Spending"
          stat={<Stat state={income} format={(i) => kes(i.totalExpenses)} />} statLabel="today"
          description="Record what you spend on the business."
          action="Open Spending"
        />
        <ActionCard
          to="/pos/financials" icon={TrendingUp} title="My Profit"
          stat={<Stat state={income} format={(i) => kes(i.netIncome)} />} statLabel="today"
          description="What is left after costs and spending."
          action="See Profit"
        />
        <ActionCard
          to="/pos/reports" icon={BarChart3} title="My Reports"
          description="End-of-day closing and daily summaries."
          action="Open Reports"
        />
      </CardGrid>

      <SectionTitle>More money tools</SectionTitle>
      <div className="bg-white border border-[#DDE3DD] rounded-xl divide-y divide-[#DDE3DD]">
        <Link to="/pos/financials" className="flex items-center gap-3 px-4 py-3 min-h-[48px] hover:bg-[#F7F6F0]">
          <FileBarChart size={18} className="text-[#237A52] shrink-0" />
          <div className="min-w-0"><div className="text-sm font-medium">Financial Statements</div><div className="text-xs text-[#68756D]">Income statement and balance sheet (advanced)</div></div>
        </Link>
        <Link to="/pos/equipment" className="flex items-center gap-3 px-4 py-3 min-h-[48px] hover:bg-[#F7F6F0]">
          <HardHat size={18} className="text-[#237A52] shrink-0" />
          <div className="min-w-0"><div className="text-sm font-medium">My Equipment</div><div className="text-xs text-[#68756D]">Tools, machines and other things you own</div></div>
        </Link>
      </div>
    </WorkspacePage>
  );
}
