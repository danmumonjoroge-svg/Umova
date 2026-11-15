// src/pos-erp/pages/BudgetPage.jsx
//
// Targets and budget: for one month, a SALES TARGET per class (Restaurant, Bar, Accommodation...) and a SPENDING BUDGET
// per expense category, shown against what really happened: BUDGET . ACTUAL . VARIANCE.
// Actuals are worked out by the database (phase44 pos_budget_vs_actual); nothing is typed twice.
// Variance reads the same way everywhere: a minus (red) means behind target on sales, or overspent.
// See = finance.view. Set / change = payments.approve or settings.manage (manager and owner). Print/PDF = reports.export.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Target, ChevronLeft, ChevronRight, Pencil, Copy, Printer, Download, Trash2 } from 'lucide-react';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { usePermissions } from '../navigation/PermissionsContext';
import { settingsService } from '../services/settingsService';
import { budgetService, monthRange, summarise, lineTone, elapsedShare } from '../services/budgetService';
import { nairobiToday } from '../services/reportCentreService';
import { buildReportPdf, reportFileName, savePdf, printPdf, loadLogoPng, kes } from '../utils/reportPdf';
import { FitPage, MiniStats, LoadingBlock, EmptyBlock, Notice, formCard, inputCls, saveBtnCls } from '../components/CardKit';
import { singleFlight } from '../utils/singleFlight';

const n = (v) => Number(v || 0);
const TONE_BAR = { good: 'bg-[#2E7D52]', warn: 'bg-[#C9A227]', bad: 'bg-[#B23A2E]', none: 'bg-[#C9C6B0]' };
const signed = (v) => `${n(v) > 0 ? '+' : ''}${kes(v)}`;

function LineCard({ row, share }) {
  const tone = lineTone(row, share);
  const bud = n(row.budget), act = n(row.actual);
  const width = bud > 0 ? Math.min(100, (act / bud) * 100) : act > 0 ? 100 : 0;
  const bad = n(row.variance) < 0;
  return (
    <div className="bg-white border border-[#E3DBB8] rounded-xl px-3 py-2.5 mb-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13.5px] font-bold text-[#23382B] truncate">{row.label}</div>
          {row.unbudgeted && <div className="text-[11px] text-[#8A6A12]">No budget set for this</div>}
        </div>
        <div className={`text-[13px] font-bold tabular-nums shrink-0 ${bad ? 'text-[#B23A2E]' : 'text-[#1B6B45]'}`}>{signed(row.variance)}</div>
      </div>
      <div className="h-2 rounded-full bg-[#EEEBDD] mt-2 overflow-hidden"><div className={`h-full ${TONE_BAR[tone]}`} style={{ width: `${width}%` }} /></div>
      <div className="flex items-center justify-between text-[11.5px] text-[#6F7461] mt-1.5">
        <span>Budget <b className="text-[#23382B] tabular-nums">{bud ? kes(bud) : '-'}</b></span>
        <span>Actual <b className="text-[#23382B] tabular-nums">{kes(act)}</b></span>
        <span className="tabular-nums">{row.pct_used == null ? '' : `${row.pct_used}%`}</span>
      </div>
    </div>
  );
}

export default function BudgetPage() {
  const { tenant, staffId, staffName } = usePosErpAuth();
  const { can } = usePermissions();
  const businessId = tenant?.business_id;
  const canManage = can('payments.approve') || can('settings.manage');
  const canPrint = can('reports.export');
  const today = nairobiToday();

  const [shift, setShift] = useState(0);
  const range = useMemo(() => monthRange(today, shift), [today, shift]);
  const [budget, setBudget] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const [classes, setClasses] = useState([]);
  const [cats, setCats] = useState([]);
  const [draft, setDraft] = useState({});     // key -> amount string. keys: "c:<classId|none>", "e:<categoryId>"
  const [saving, setSaving] = useState(false);
  const [business, setBusiness] = useState(null);

  useEffect(() => {
    if (!businessId) return;
    settingsService.getBusinessProfile(businessId).then(setBusiness).catch(() => {});
    Promise.all([budgetService.classes(businessId), budgetService.expenseCategories()]).then(([c, e]) => { setClasses(c); setCats(e); }).catch(() => {});
  }, [businessId]);

  const load = useCallback(async () => {
    if (!businessId) return;
    setLoading(true); setError(''); setEditing(false);
    try {
      const b = await budgetService.findForPeriod(businessId, range.from, range.to);
      setBudget(b);
      setRows(b ? await budgetService.vsActual(b.id) : []);
    } catch (e) { setError(e?.code === '42501' ? 'You do not have access to budgets.' : (e?.message || 'Could not load the budget.')); setBudget(null); setRows([]); }
    finally { setLoading(false); }
  }, [businessId, range.from, range.to]);
  useEffect(() => { load(); }, [load]);

  const { sales, spend, totals: t } = useMemo(() => summarise(rows), [rows]);
  const share = elapsedShare(range.from, range.to, today);

  const keyOf = (l) => (l.line_type === 'REVENUE' ? `c:${l.class_id || 'none'}` : `e:${l.expense_category_id}`);
  const startEdit = async (copyFromPrevious = false) => {
    setError(''); setNote('');
    try {
      let lines = [];
      if (copyFromPrevious) {
        const p = monthRange(today, shift - 1);
        const pb = await budgetService.findForPeriod(businessId, p.from, p.to);
        if (!pb) { setError(`There is no budget for ${p.label} to copy.`); return; }
        lines = await budgetService.lines(pb.id);
      } else if (budget) lines = await budgetService.lines(budget.id);
      setDraft(Object.fromEntries(lines.map((l) => [keyOf(l), String(n(l.amount))])));
      setEditing(true);
    } catch (e) { setError(e?.message || 'Could not open the budget.'); }
  };

  const save = singleFlight('BudgetPage.save', async (e) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      const lines = Object.entries(draft).filter(([, v]) => n(v) > 0).map(([k, v]) => {
        const [kind, id] = k.split(':');
        return kind === 'c' ? { line_type: 'REVENUE', class_id: id === 'none' ? null : id, amount: n(v) } : { line_type: 'EXPENSE', expense_category_id: id, amount: n(v) };
      });
      await budgetService.save({ businessId, from: range.from, to: range.to, name: `${range.label} budget`, periodType: 'MONTH', lines, by: staffId });
      setNote('Budget saved.'); await load();
    } catch (err) { setError(err?.code === '42501' ? 'Only a manager or the owner can set the budget.' : (err?.message || 'Could not save.')); }
    finally { setSaving(false); }
  });

  const remove = singleFlight('BudgetPage.remove', async () => {
    if (!budget || !window.confirm(`Delete the ${range.label} budget? Your sales and spending records are not touched.`)) return;
    try { await budgetService.remove(budget.id); await load(); } catch (err) { setError(err?.message || 'Could not delete.'); }
  });

  const pdf = async () => buildReportPdf(budgetService.reportSpec({ budget, rows }), { business, logo: await loadLogoPng(business?.logo_url), generatedBy: staffName });
  const onDownload = async () => { try { const d = await pdf(); const how = await savePdf(d, reportFileName({ fileBase: `budget-${range.label}` }), 'Budget'); setNote(how === 'shared' ? 'Choose where to save or send it from the list that opened.' : 'PDF saved to your downloads.'); } catch (e) { setError(e.message); } };
  const onPrint = async () => { try { printPdf(await pdf(), { onError: (e) => setError(e.message), fileName: reportFileName({ fileBase: `budget-${range.label}` }), title: 'Budget' }); } catch (e) { setError(e.message); } };

  const nav = (
    <div className="flex items-center gap-1">
      <button type="button" aria-label="Previous month" onClick={() => setShift((s) => s - 1)} className="w-9 h-9 rounded-lg border border-[#E3DBB8] bg-white flex items-center justify-center"><ChevronLeft size={16} /></button>
      <div className="min-w-[116px] text-center text-sm font-bold text-[#23382B]">{range.label}</div>
      <button type="button" aria-label="Next month" onClick={() => setShift((s) => s + 1)} className="w-9 h-9 rounded-lg border border-[#E3DBB8] bg-white flex items-center justify-center"><ChevronRight size={16} /></button>
    </div>
  );

  return (
    <FitPage
      title="Targets and Budget" subtitle="What you planned against what happened · amounts in KES" icon={Target} action={nav}
      summary={budget && !editing && (
        <MiniStats items={[
          { label: 'Sales vs target', value: `${kes(t.salesActual)}`, tone: t.salesVariance < 0 ? 'bad' : 'good' },
          { label: 'Spent vs budget', value: `${kes(t.spendActual)}`, tone: t.spendVariance < 0 ? 'bad' : 'good' },
          { label: 'Profit', value: kes(t.profitActual), tone: t.profitActual < 0 ? 'bad' : 'good' },
        ]} />
      )}
    >
      {error && <Notice>{error}</Notice>}
      {note && <Notice tone="good">{note}</Notice>}
      {loading && <LoadingBlock />}

      {!loading && editing && (
        <form onSubmit={save} className={formCard}>
          <h2 className="text-sm font-bold text-[#23382B]">Set the {range.label} budget</h2>
          <p className="text-[11.5px] text-[#6F7461] mb-2">Leave a box empty (or 0) for nothing planned. Saving replaces the whole budget for this month.</p>
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-[#8B8766] mt-2 mb-1">Sales target</h3>
          {classes.length === 0 && <p className="text-[11.5px] text-[#8A6A12] mb-1">No product classes yet, so set one target for all sales. Add classes under My Items to target Restaurant, Bar, Accommodation separately.</p>}
          {[...classes.map((c) => ({ key: `c:${c.id}`, label: c.name })), { key: 'c:none', label: classes.length ? 'Sales not in a class' : 'All sales' }].map((f) => (
            <label key={f.key} className="flex items-center justify-between gap-3 py-1">
              <span className="text-sm text-[#23382B] min-w-0 truncate">{f.label}</span>
              <input type="number" min="0" step="any" inputMode="decimal" className={`${inputCls} !w-36 text-right`} value={draft[f.key] ?? ''} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
            </label>
          ))}
          <h3 className="text-[12px] font-bold uppercase tracking-wide text-[#8B8766] mt-3 mb-1">Spending budget</h3>
          {cats.length === 0 && <p className="text-[11.5px] text-[#8A6A12]">No spending categories yet. Add some under My Spending.</p>}
          {cats.map((c) => (
            <label key={c.id} className="flex items-center justify-between gap-3 py-1">
              <span className="text-sm text-[#23382B] min-w-0 truncate">{c.name}</span>
              <input type="number" min="0" step="any" inputMode="decimal" className={`${inputCls} !w-36 text-right`} value={draft[`e:${c.id}`] ?? ''} onChange={(e) => setDraft({ ...draft, [`e:${c.id}`]: e.target.value })} />
            </label>
          ))}
          <div className="flex gap-2 mt-3">
            <button type="submit" disabled={saving} className={`${saveBtnCls} px-5`}>{saving ? 'Saving…' : 'Save budget'}</button>
            <button type="button" onClick={() => setEditing(false)} className="px-4 min-h-[42px] rounded-lg border border-[#E3DBB8] text-sm font-semibold">Cancel</button>
          </div>
        </form>
      )}

      {!loading && !editing && !budget && !error && (
        <div className={formCard}>
          <EmptyBlock>No budget for {range.label} yet.</EmptyBlock>
          {canManage ? (
            <div className="flex flex-wrap gap-2 mt-1">
              <button type="button" onClick={() => startEdit(false)} className={`${saveBtnCls} px-4 inline-flex items-center gap-1.5`}><Pencil size={15} /> Set a budget</button>
              <button type="button" onClick={() => startEdit(true)} className="px-4 min-h-[42px] rounded-lg border border-[#1F6B45] text-[#1F6B45] font-semibold inline-flex items-center gap-1.5"><Copy size={15} /> Copy last month</button>
            </div>
          ) : <p className="text-[12px] text-[#6F7461]">Only a manager or the owner can set the budget.</p>}
        </div>
      )}

      {!loading && !editing && budget && (
        <>
          <div className="flex flex-wrap gap-2 mb-3">
            {canManage && <button type="button" onClick={() => startEdit(false)} className="px-3 min-h-[38px] rounded-lg border border-[#1F6B45] text-[#1F6B45] text-sm font-semibold inline-flex items-center gap-1.5"><Pencil size={14} /> Change</button>}
            {canPrint && <button type="button" onClick={onDownload} className="px-3 min-h-[38px] rounded-lg border border-[#E3DBB8] text-sm font-semibold inline-flex items-center gap-1.5"><Download size={14} /> PDF</button>}
            {canPrint && <button type="button" onClick={onPrint} className="px-3 min-h-[38px] rounded-lg border border-[#E3DBB8] text-sm font-semibold inline-flex items-center gap-1.5"><Printer size={14} /> Print</button>}
            {canManage && <button type="button" onClick={remove} className="px-3 min-h-[38px] rounded-lg border border-[#F0C2BB] text-[#A3352A] text-sm font-semibold inline-flex items-center gap-1.5 ml-auto"><Trash2 size={14} /> Delete</button>}
          </div>

          <h2 className="text-[12px] font-bold uppercase tracking-wide text-[#8B8766] mb-1">Sales · target {kes(t.salesBudget)} · actual {kes(t.salesActual)} · <span className={t.salesVariance < 0 ? 'text-[#B23A2E]' : 'text-[#1B6B45]'}>{signed(t.salesVariance)}</span></h2>
          {sales.length === 0 ? <EmptyBlock>No sales targets and no sales in this month.</EmptyBlock> : sales.map((r) => <LineCard key={`${r.class_id || 'none'}`} row={r} share={share} />)}

          <h2 className="text-[12px] font-bold uppercase tracking-wide text-[#8B8766] mt-4 mb-1">Spending · budget {kes(t.spendBudget)} · actual {kes(t.spendActual)} · <span className={t.spendVariance < 0 ? 'text-[#B23A2E]' : 'text-[#1B6B45]'}>{signed(t.spendVariance)}</span></h2>
          {spend.length === 0 ? <EmptyBlock>No spending budget and nothing spent in this month.</EmptyBlock> : spend.map((r) => <LineCard key={r.expense_category_id || 'x'} row={r} share={share} />)}

          <div className={`${formCard} mt-4`}>
            <div className="flex items-center justify-between"><span className="text-sm font-bold text-[#23382B]">Profit (sales minus spending)</span>
              <span className={`text-sm font-bold tabular-nums ${t.profitVariance < 0 ? 'text-[#B23A2E]' : 'text-[#1B6B45]'}`}>{signed(t.profitVariance)} vs plan</span></div>
            <div className="flex justify-between text-[12px] text-[#6F7461] mt-1"><span>Planned <b className="text-[#23382B]">{kes(t.profitBudget)}</b></span><span>Actual <b className="text-[#23382B]">{kes(t.profitActual)}</b></span></div>
          </div>
          <p className="text-[11px] text-[#8B8766] px-1 mb-3">Minus (red) always means behind target on sales, or overspent. Actual spending counts paid expenses only.</p>
        </>
      )}
    </FitPage>
  );
}
