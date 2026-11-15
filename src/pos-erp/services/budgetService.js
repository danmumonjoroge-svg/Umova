// src/pos-erp/services/budgetService.js
// Budget / target screen data (phase44). The database works out the ACTUALS (pos_budget_vs_actual); this file only
// reads and saves, and turns the result into a printable report spec.
import { posSupabase as supabase } from './posSupabaseClient';
import { kes, pct, niceDate } from '../utils/reportPdf';

const n = (v) => Number(v || 0);
const iso = (d) => d.toISOString().slice(0, 10);

/** First and last day of the month containing `dateIso`, plus optional month shift. */
export function monthRange(dateIso, shift = 0) {
  const [y, m] = dateIso.slice(0, 7).split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1 + shift, 1)), end = new Date(Date.UTC(y, m + shift, 0));
  return { from: iso(start), to: iso(end), label: start.toLocaleDateString('en-KE', { month: 'long', year: 'numeric', timeZone: 'UTC' }) };
}

/** How far through the period are we (0..1)? Used for the "on pace" hint. */
export function elapsedShare(from, to, today) {
  const a = new Date(`${from}T00:00:00Z`).getTime(), b = new Date(`${to}T00:00:00Z`).getTime(), t = new Date(`${today}T00:00:00Z`).getTime();
  if (t <= a) return 0; if (t >= b) return 1;
  return (t - a) / (b - a + 86400000);
}

/**
 * Splits the database rows into sales / spending and adds the totals the screen shows.
 * variance is already "positive = good" (see phase44): sales above target, spending under budget.
 */
export function summarise(rows) {
  const sales = rows.filter((r) => r.line_type === 'REVENUE'), spend = rows.filter((r) => r.line_type === 'EXPENSE');
  const sum = (l, k) => l.reduce((s, r) => s + n(r[k]), 0);
  const t = {
    salesBudget: sum(sales, 'budget'), salesActual: sum(sales, 'actual'),
    spendBudget: sum(spend, 'budget'), spendActual: sum(spend, 'actual'),
  };
  t.profitBudget = t.salesBudget - t.spendBudget;
  t.profitActual = t.salesActual - t.spendActual;
  t.profitVariance = t.profitActual - t.profitBudget;
  t.salesVariance = t.salesActual - t.salesBudget;
  t.spendVariance = t.spendBudget - t.spendActual;
  return { sales, spend, totals: t };
}

/** Traffic-light for one line: 'good' | 'warn' | 'bad' | 'none'. Spending over budget is bad; sales far behind pace is warn. */
export function lineTone(row, share = 1) {
  const bud = n(row.budget), act = n(row.actual);
  if (row.line_type === 'EXPENSE') {
    if (bud === 0) return act > 0 ? 'bad' : 'none';
    if (act > bud) return 'bad';
    return act > bud * 0.9 ? 'warn' : 'good';
  }
  if (bud === 0) return 'none';
  if (act >= bud) return 'good';
  return act >= bud * share * 0.9 ? 'good' : act >= bud * share * 0.6 ? 'warn' : 'bad';
}

export const budgetService = {
  async list(businessId) {
    const { data, error } = await supabase.from('lb_budgets').select('*').eq('business_id', businessId).order('period_start', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async findForPeriod(businessId, from, to) {
    const { data, error } = await supabase.from('lb_budgets').select('*').eq('business_id', businessId).eq('period_start', from).eq('period_end', to).maybeSingle();
    if (error) throw error;
    return data;
  },
  async lines(budgetId) {
    const { data, error } = await supabase.from('lb_budget_lines').select('*').eq('budget_id', budgetId);
    if (error) throw error;
    return data || [];
  },
  async vsActual(budgetId) {
    const { data, error } = await supabase.rpc('pos_budget_vs_actual', { p_budget_id: budgetId });
    if (error) throw error;
    return data || [];
  },
  /** lines: [{ line_type, class_id?, expense_category_id?, amount }] -- replaces the whole set. */
  async save({ businessId, from, to, name, periodType = 'MONTH', lines, notes = null, by = null }) {
    const { data, error } = await supabase.rpc('pos_save_budget', {
      p_business_id: businessId, p_period_start: from, p_period_end: to, p_name: name, p_period_type: periodType,
      p_lines: lines.map((l) => ({ line_type: l.line_type, class_id: l.class_id || null, expense_category_id: l.expense_category_id || null, amount: n(l.amount) })),
      p_notes: notes, p_by: by,
    });
    if (error) throw error;
    return data;
  },
  async remove(budgetId) {
    const { error } = await supabase.rpc('pos_delete_budget', { p_budget_id: budgetId });
    if (error) throw error;
  },
  async expenseCategories() {
    const { data, error } = await supabase.from('lb_expense_categories').select('id,name,is_active').order('name');
    if (error) throw error;
    return (data || []).filter((c) => c.is_active !== false);
  },
  async classes(businessId) {
    const { data, error } = await supabase.from('lb_product_classes').select('id,name,kind,sort_order,is_active').eq('business_id', businessId).order('sort_order').order('name');
    if (error) throw error;
    return (data || []).filter((c) => c.is_active);
  },

  /** Printable "Budget vs actual" (feeds utils/reportPdf.js). */
  reportSpec({ budget, rows }) {
    const { sales, spend, totals: t } = summarise(rows);
    const money = (v) => kes(v);
    const mk = (r) => ({ label: r.label, bud: n(r.budget) ? money(r.budget) : '-', act: money(r.actual), var: `${n(r.variance) > 0 ? '+' : ''}${money(r.variance)}`, pct: r.pct_used == null ? 'no budget' : pct(r.pct_used), _bad: n(r.variance) < 0 ? ['var'] : undefined });
    const cols = (first) => [{ key: 'label', label: first, w: 3.4 }, { key: 'bud', label: 'Budget', align: 'right', w: 1.5 }, { key: 'act', label: 'Actual', align: 'right', w: 1.5 }, { key: 'var', label: 'Variance', align: 'right', w: 1.5 }, { key: 'pct', label: '% of budget', align: 'right', w: 1.1 }];
    const tot = (label, b, a, v) => ({ _kind: 'total', label, bud: money(b), act: money(a), var: `${v > 0 ? '+' : ''}${money(v)}`, pct: b > 0 ? pct((a / b) * 100) : '-', _bad: v < 0 ? ['var'] : undefined });
    return {
      title: `Budget vs actual: ${budget.name}`, subtitle: 'Variance is shown so that a minus sign always means behind target or overspent',
      period: `${niceDate(budget.period_start)} to ${niceDate(budget.period_end)}`, fileBase: `budget-${budget.name}`, periodKey: `${budget.period_start}_to_${budget.period_end}`,
      summary: [
        { label: 'Sales: actual vs target', value: `${money(t.salesActual)} / ${money(t.salesBudget)}`, bad: t.salesVariance < 0 },
        { label: 'Spending: actual vs budget', value: `${money(t.spendActual)} / ${money(t.spendBudget)}`, bad: t.spendVariance < 0 },
        { label: 'Profit: actual', value: money(t.profitActual), bad: t.profitActual < 0 },
        { label: 'Profit vs plan', value: `${t.profitVariance > 0 ? '+' : ''}${money(t.profitVariance)}`, bad: t.profitVariance < 0 },
      ],
      sections: [
        { heading: 'Sales targets', columns: cols('Class'), rows: sales.map(mk).concat([tot('TOTAL SALES', t.salesBudget, t.salesActual, t.salesVariance)]), emptyText: 'No sales targets set.' },
        { heading: 'Spending budget', columns: cols('Category'), rows: spend.map(mk).concat([tot('TOTAL SPENDING', t.spendBudget, t.spendActual, t.spendVariance)]), emptyText: 'No spending budget set.' },
        { heading: 'Profit', columns: cols(''), rows: [tot('SALES minus SPENDING', t.profitBudget, t.profitActual, t.profitVariance)] },
      ],
      footnote: 'Actual sales use the same rule as the daily closing (completed sales, Nairobi days). Actual spending is paid expenses only. Lines marked "no budget" had money moving where nothing was planned.',
    };
  },
};
