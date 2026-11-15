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
import { Wallet, Smartphone, Users, Receipt, TrendingUp, BarChart3, FileBarChart, HardHat, Coins, Printer, Target } from 'lucide-react';
import { usePosErpAuth } from '../../auth/usePosErpAuth';
import { financialReportsService } from '../../services/financialReportsService';
import { mpesaService } from '../../services/mpesaService';
import { WorkspacePage, SectionTitle, CardGrid, ActionCard, StatStrip, MiniGrid, MiniCard, Stat, useStat, kes } from '../../components/workspace/WorkspaceKit';

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
      <StatStrip items={[
        { label: 'Made today', value: <Stat state={income} format={(i) => kes(i.revenue)} /> },
        { label: 'Spent today', value: <Stat state={income} format={(i) => kes(i.totalExpenses)} /> },
        { label: 'Profit today', tone: income.value && income.value.netIncome < 0 ? 'bad' : 'good', value: <Stat state={income} format={(i) => kes(i.netIncome)} /> },
      ]} />

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
          to="/pos/budgets" icon={Target} title="Targets & Budget"
          description="What you planned against what happened, for sales and spending."
          action="Open Budget"
        />
        <ActionCard
          to="/pos/report-centre" icon={Printer} title="Printable Reports"
          description="Stock, sales, each class, M-Pesa and more, as PDF to print or share."
          action="Open Reports"
        />
        <ActionCard
          to="/pos/reports" icon={BarChart3} title="My Reports"
          description="End-of-day closing and daily summaries."
          action="Open Reports"
        />
      </CardGrid>

      <SectionTitle>More money tools</SectionTitle>
      <MiniGrid>
        <MiniCard to="/pos/loans" icon={Coins} title="My Loans" desc="Loans you are repaying, instalments and reminders" />
        <MiniCard to="/pos/financials" icon={FileBarChart} title="Financial Statements" desc="Income statement and balance sheet" />
        <MiniCard to="/pos/equipment" icon={HardHat} title="My Equipment" desc="Tools and machines you own" />
      </MiniGrid>
    </WorkspacePage>
  );
}
