// The four statements and the party balances, all read from the ledger.
import React, { useState } from 'react';
import { FitPage, LoadingBlock, Notice } from '../../../components/CardKit';
import { useLedger, SetupCard, PeriodBar, Line, Section, useStatement, yearStart, todayIso, M, PARTY_LABEL } from './ledgerKit.jsx';
import { fromDb } from '../utils/money';

function Frame({ title, subtitle, children, L }) {
  const { ctx, accounts, err, load, ready } = L;
  if (!ready) return <LoadingBlock />;
  if (!ctx.can('report')) return <FitPage title={title}><Notice tone="warn">You do not have access to financial statements.</Notice></FitPage>;
  return (<FitPage title={title} subtitle={subtitle}>{err && <Notice tone="bad">{err}</Notice>}
    {accounts === null ? <LoadingBlock /> : !accounts.length ? <SetupCard ctx={ctx} onDone={load} /> : children}</FitPage>);
}
const Body = ({ s, children }) => (s.err ? <Notice tone="bad">{s.err}</Notice> : !s.data ? <LoadingBlock /> : children(s.data));

export function IncomeStatementPage() {
  const L = useLedger(); const [p, setP] = useState({ from: yearStart(), to: todayIso() });
  const s = useStatement(() => (L.accounts?.length ? L.ctx.api.incomeStatement(L.ctx.businessId, p.from, p.to) : Promise.resolve(null)), [L.accounts, p.from, p.to]);
  return (<Frame title="Income statement" subtitle="Income and expenditure for a period" L={L}>
    <PeriodBar from={p.from} to={p.to} onChange={(from, to) => setP({ from, to })} />
    <Body s={s}>{(d) => d && <>
      <Section title="Income">{d.income.length ? d.income.map((r) => <Line key={r.account_id} label={r.name} amount={r.amount} indent />) : <p className="text-sm text-[#6F7461]">None in this period.</p>}<Line label="Total income" amount={d.total_income} bold /></Section>
      <Section title="Expenditure">{d.expenses.length ? d.expenses.map((r) => <Line key={r.account_id} label={r.name} amount={r.amount} indent />) : <p className="text-sm text-[#6F7461]">None in this period.</p>}<Line label="Total expenditure" amount={d.total_expenses} bold /></Section>
      <Section title="Result"><Line label={fromDb(d.surplus) >= 0 ? 'Surplus for the period' : 'Deficit for the period'} amount={d.surplus} bold tone={fromDb(d.surplus) < 0 ? 'bad' : undefined} /></Section></>}</Body></Frame>);
}

export function FinancialPositionPage() {
  const L = useLedger(); const [at, setAt] = useState(todayIso());
  const s = useStatement(() => (L.accounts?.length ? L.ctx.api.financialPosition(L.ctx.businessId, at) : Promise.resolve(null)), [L.accounts, at]);
  const part = (d, secs) => d.lines.filter((r) => secs.includes(r.section));
  return (<Frame title="Statement of financial position" subtitle="What the school owns, owes and holds in funds" L={L}>
    <PeriodBar from="" to={at} single onChange={(_, to) => setAt(to)} />
    <Body s={s}>{(d) => d && <>
      <div className={`rounded-xl p-2.5 text-sm font-semibold mb-3 text-center ${d.balanced ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{d.balanced ? 'Assets equal liabilities plus funds' : 'DOES NOT BALANCE - contact support'}</div>
      <Section title="Assets"><p className="text-[11px] font-semibold text-[#6F7461]">Non-current</p>{part(d, ['NON_CURRENT_ASSET']).map((r) => <Line key={r.account_id} label={r.name} amount={r.amount} indent />)}
        <p className="text-[11px] font-semibold text-[#6F7461] mt-1">Current</p>{part(d, ['CURRENT_ASSET']).map((r) => <Line key={r.account_id} label={r.name} amount={r.amount} indent />)}<Line label="Total assets" amount={d.total_assets} bold /></Section>
      <Section title="Liabilities"><p className="text-[11px] font-semibold text-[#6F7461]">Non-current</p>{part(d, ['NON_CURRENT_LIABILITY']).map((r) => <Line key={r.account_id} label={r.name} amount={r.amount} indent />)}
        <p className="text-[11px] font-semibold text-[#6F7461] mt-1">Current</p>{part(d, ['CURRENT_LIABILITY']).map((r) => <Line key={r.account_id} label={r.name} amount={r.amount} indent />)}<Line label="Total liabilities" amount={d.total_liabilities} bold /></Section>
      <Section title="Funds">{part(d, ['FUND']).map((r) => <Line key={r.account_id} label={r.name} amount={r.amount} indent />)}<Line label="Surplus (deficit) not yet closed to a fund" amount={d.accumulated_surplus} indent /><Line label="Total funds" amount={d.total_funds} bold /></Section></>}</Body></Frame>);
}

export function CashFlowPage() {
  const L = useLedger(); const [p, setP] = useState({ from: yearStart(), to: todayIso() });
  const s = useStatement(() => (L.accounts?.length ? L.ctx.api.cashFlow(L.ctx.businessId, p.from, p.to) : Promise.resolve(null)), [L.accounts, p.from, p.to]);
  return (<Frame title="Cash flow statement" subtitle="Where cash came from and where it went" L={L}>
    <PeriodBar from={p.from} to={p.to} onChange={(from, to) => setP({ from, to })} />
    <Body s={s}>{(d) => d && <>
      {!d.check && <Notice tone="bad">The cash flow does not agree with the cash and bank accounts. Contact support.</Notice>}
      <Section title="Operating activities"><Line label="Surplus (deficit) for the period" amount={d.surplus} indent />{fromDb(d.depreciation) !== 0 && <Line label="Add back: depreciation (not cash)" amount={d.depreciation} indent />}
        {d.working_capital.map((r, i) => <Line key={i} label={r.name} amount={r.amount} indent />)}<Line label="Cash from operating activities" amount={d.operating} bold /></Section>
      <Section title="Investing activities">{d.investing_lines.map((r, i) => <Line key={i} label={r.name} amount={r.amount} indent />)}<Line label="Cash from investing activities" amount={d.investing} bold /></Section>
      <Section title="Financing activities">{d.financing_lines.map((r, i) => <Line key={i} label={r.name} amount={r.amount} indent />)}<Line label="Cash from financing activities" amount={d.financing} bold /></Section>
      <Section title="Cash and bank"><Line label="Opening" amount={d.opening_cash} indent /><Line label="Net change" amount={d.net_change} indent /><Line label="Closing" amount={d.closing_cash} bold /></Section></>}</Body></Frame>);
}

export function PartyBalancesPage({ kind }) {
  const L = useLedger(); const [at, setAt] = useState(todayIso()); const rec = kind === 'RECEIVABLES';
  const s = useStatement(() => (L.accounts?.length ? L.ctx.api.partyBalances(L.ctx.businessId, kind, at) : Promise.resolve(null)), [L.accounts, at, kind]);
  return (<Frame title={rec ? 'Receivables' : 'Payables'} subtitle={rec ? 'Money owed to the school, by who owes it' : 'Money the school owes, by who is owed'} L={L}>
    <PeriodBar from="" to={at} single onChange={(_, to) => setAt(to)} />
    <Body s={s}>{(d) => d && <>
      {d.groups.map((g) => (<Section key={g.party} title={PARTY_LABEL[g.party] || g.party}>{g.accounts.map((a) => <Line key={a.account_id} label={`${a.code} ${a.name}`} amount={a.amount} indent />)}<Line label="Total" amount={g.total} bold /></Section>))}
      <Section title={rec ? 'Total receivables' : 'Total payables'}><Line label={M(d.total)} amount={d.total} bold /></Section>
      <p className="text-xs text-[#6F7461]">From the ledger. {rec ? 'Per-student balances are under Fees > Fee balances.' : 'Move an account to another group by editing it in the chart of accounts.'}</p></>}</Body></Frame>);
}
