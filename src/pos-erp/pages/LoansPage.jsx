// src/pos-erp/pages/LoansPage.jsx
//
// My Loans (bank, SACCO, M-Pesa or any other loan). Brief: a loan module joined to My Spending and to reminders.
//
// What the owner is promised, and what is really happening underneath:
//   * Each instalment is split in two. The part that pays back the money you borrowed is NOT spending. Only the
//     interest and fees go to My Spending (category "Loan Interest & Charges"), so My Profit stays right.
//   * Auto-pay loans (standing order, salary or SACCO deduction) post by themselves on the due date. The rest get a reminder
//     and a one-tap "Mark as paid". Reminders appear in the bell from 7 days before, on the day, and every day after until paid.
//   * Only the business OWNER can add or change a loan. Anyone who may record expenses can mark an instalment paid.
//     (The screen only decides what to SHOW; the database refuses everything else.)
//   * A payment can be ANY amount: less than the instalment, exactly it, or more. The database splits every payment the same way:
//     interest first, then the loan itself, oldest instalment first, and anything extra is paid ahead. Principal can never be
//     paid before the interest is cleared. The loan card says whether you are in arrears, on schedule, or paid in advance.
//   * The schedule is worked out by ONE database function (loan_preview_schedule), so the preview here is exactly what is saved.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Coins, Plus, Info, X, Check, RotateCcw, Pencil } from 'lucide-react';
import { useLoans } from '../hooks/useLoans';
import { usePermissions } from '../navigation/PermissionsContext';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { loanService } from '../services/loanService';
import {
  LENDER_TYPES, METHODS, METHOD_HINT, PAY_FROM, money, prettyDate, localISODate, dueState, dueWords,
  installmentTotal, installmentCost, installmentBalance, installmentPaid, isPartPaid, paidOf, paymentSplitWords, loanSummary, mapLoanError, validateLoanForm,
} from '../utils/loanHelpers';
import { FitPage, AddButton, MiniStats, FilterChips, CardGrid, DataCard, IconTile, TextBtn, Notice, LoadingBlock, EmptyBlock, formCard, inputCls, saveBtnCls } from '../components/CardKit';
import { singleFlight } from '../utils/singleFlight';

const run = (key, fn) => singleFlight(key, fn)();

function addMonthsISO(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

const emptyForm = () => {
  const today = localISODate();
  return {
    lender_type: 'BANK', lender_name: '', reference_no: '', principal: '', disbursed_on: today,
    interest_method: 'REDUCING', rate: '', rate_period: 'YEAR', term_count: '12', frequency: 'MONTHLY', first_due: addMonthsISO(today, 1),
    fee_per_installment: '', upfront_fees: '', auto_pay: false, payment_method: 'BANK',
    received_before_app: false, paid_before_count: '', notes: '',
  };
};

const STATE_PILL = {
  OVERDUE: { tone: 'bad', label: 'In arrears' }, AHEAD: { tone: 'good', label: 'Paid ahead' }, DUE_SOON: { tone: 'warn', label: 'Due soon' }, ON_TRACK: { tone: 'good', label: 'On track' },
  CLEARED: { tone: 'good', label: 'Paid off' }, CLOSED: { tone: 'neutral', label: 'Closed' }, CANCELLED: { tone: 'neutral', label: 'Cancelled' },
};

export default function LoansPage() {
  const { tenant } = usePosErpAuth();
  const { can, isOwner } = usePermissions();
  const { loans, totals, loading, error, refetch } = useLoans();
  const canRecord = can('expenses.record');
  const today = localISODate();

  const [filter, setFilter] = useState('active');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState({ rows: null, loading: false, error: '' });
  const [openId, setOpenId] = useState(null);
  const [actionError, setActionError] = useState('');
  const [busyId, setBusyId] = useState(null);
  const refMemo = useRef({ sig: '', ref: '' });

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  // Live schedule preview: the database works it out, so what you see is what will be saved.
  useEffect(() => {
    if (!showForm) return undefined;
    const ready = Number(form.principal) > 0 && parseInt(form.term_count, 10) >= 1 && form.first_due && (form.interest_method === 'NONE' || Number(form.rate) > 0);
    if (!ready) { setPreview({ rows: null, loading: false, error: '' }); return undefined; }
    let live = true;
    setPreview((p) => ({ ...p, loading: true, error: '' }));
    const t = setTimeout(async () => {
      try {
        const rows = await loanService.preview(form);
        if (live) setPreview({ rows: rows || [], loading: false, error: '' });
      } catch (err) {
        if (live) setPreview({ rows: null, loading: false, error: mapLoanError(err) });
      }
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [showForm, form.principal, form.interest_method, form.rate, form.rate_period, form.term_count, form.frequency, form.first_due, form.fee_per_installment]); // eslint-disable-line react-hooks/exhaustive-deps

  const previewTotals = useMemo(() => {
    const rows = preview.rows || [];
    const sum = (k) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
    return { principal: sum('principal_due'), interest: sum('interest_due'), fees: sum('fees_due'), first: rows[0] || null, n: rows.length };
  }, [preview.rows]);

  const openCreate = () => { setForm(emptyForm()); setFormError(''); setPreview({ rows: null, loading: false, error: '' }); setShowForm(true); };

  const submit = (e) => run('LoansPage.create', async () => {
    e?.preventDefault?.();
    setFormError('');
    const problem = validateLoanForm(form);
    if (problem) { setFormError(problem); return; }
    // the same form sent twice (double tap, or a retry after a dropped reply) reuses one reference, so it can only ever save once
    const sig = JSON.stringify(form);
    if (refMemo.current.sig !== sig) refMemo.current = { sig, ref: loanService.newReference() };
    setSaving(true);
    try {
      await loanService.create(tenant.business_id, form, refMemo.current.ref);
      setShowForm(false);
      setForm(emptyForm());
      await refetch();
    } catch (err) {
      setFormError(mapLoanError(err));
    } finally {
      setSaving(false);
    }
  });

  const act = (id, fn) => run(`loan-act-${id}`, async () => {
    setActionError('');
    setBusyId(id);
    try { await fn(); await refetch(); } catch (err) { setActionError(mapLoanError(err)); } finally { setBusyId(null); }
  });

  const rows = useMemo(() => loans.map((l) => ({ loan: l, sum: loanSummary(l, today) })), [loans, today]);
  const shown = rows.filter(({ loan }) => (filter === 'all' ? loan.status !== 'CANCELLED' : filter === 'active' ? loan.status === 'ACTIVE' : loan.status === 'CLEARED' || loan.status === 'CLOSED'));

  const active = rows.filter(({ loan }) => loan.status === 'ACTIVE');
  const soonest = active.map(({ sum }) => sum.next).filter(Boolean).sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))[0];
  const lateCount = active.reduce((s, { sum }) => s + sum.overdueCount, 0);
  const openRow = rows.find(({ loan }) => loan.id === openId);

  return (
    <FitPage
      title="My Loans"
      icon={Coins}
      subtitle="Money you borrowed from a bank, SACCO, M-Pesa or anyone else."
      action={isOwner ? <AddButton onClick={() => (showForm ? setShowForm(false) : openCreate())} open={showForm} label="Loan" icon={Plus} /> : null}
      summary={(
        <MiniStats items={[
          { label: 'I still owe', value: money(totals.outstandingPrincipal), tone: totals.outstandingPrincipal > 0 ? 'gold' : undefined },
          { label: 'Next payment', value: soonest ? `${money(installmentBalance(soonest))}` : '—' },
          { label: 'Late instalments', value: lateCount ? `${lateCount}` : '0', tone: lateCount ? 'bad' : 'good' },
        ]} />
      )}
      toolbar={<FilterChips value={filter} onChange={setFilter} options={[{ key: 'active', label: 'Still paying' }, { key: 'done', label: 'Paid off' }, { key: 'all', label: 'All' }]} />}
    >
      <Notice tone="gold">
        <span className="flex items-start gap-2"><Info size={14} className="mt-0.5 shrink-0" />
          <span>Pay any amount you like. Every payment is split: <b>interest first</b>, then the loan itself. Only the interest and fees go to My Spending, so your profit stays right.</span>
        </span>
      </Notice>
      {!isOwner && <p className="text-[11.5px] text-[#8B8766] mb-2">Only the business owner can add or change a loan.</p>}
      {actionError && !openRow && <Notice tone="bad">{actionError}</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}

      {showForm && (
        <form onSubmit={submit} className={`${formCard} grid grid-cols-1 md:grid-cols-3 gap-2.5`}>
          {formError && <div className="md:col-span-3 bg-red-50 text-red-700 text-sm rounded px-3 py-2">{formError}</div>}

          <Field label="Who lent you the money?">
            <select value={form.lender_type} onChange={(e) => set({ lender_type: e.target.value })} className={inputCls}>
              {Object.entries(LENDER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Name (e.g. Equity Bank, Kenya Police SACCO)">
            <input required value={form.lender_name} onChange={(e) => set({ lender_name: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Loan number (optional)">
            <input value={form.reference_no} onChange={(e) => set({ reference_no: e.target.value })} className={inputCls} />
          </Field>

          <Field label="Amount you borrowed (KES)">
            <input required type="number" inputMode="decimal" min="1" step="0.01" value={form.principal} onChange={(e) => set({ principal: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Date you got the money">
            <input type="date" max={today} value={form.disbursed_on} onChange={(e) => set({ disbursed_on: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Interest">
            <select value={form.interest_method} onChange={(e) => set({ interest_method: e.target.value })} className={inputCls}>
              {Object.entries(METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <p className="md:col-span-3 text-[11.5px] text-[#6F7461] -mt-1">{METHOD_HINT[form.interest_method]}</p>

          {form.interest_method !== 'NONE' && (
            <>
              <Field label="Interest rate (%)">
                <input type="number" inputMode="decimal" min="0" step="0.01" value={form.rate} onChange={(e) => set({ rate: e.target.value })} className={inputCls} />
              </Field>
              <Field label="That rate is…">
                <select value={form.rate_period} onChange={(e) => set({ rate_period: e.target.value })} className={inputCls}>
                  <option value="YEAR">per year (e.g. 14% a year)</option>
                  <option value="MONTH">per month (e.g. 1% a month)</option>
                </select>
              </Field>
              <span className="hidden md:block" />
            </>
          )}

          <Field label="How many instalments?">
            <input required type="number" inputMode="numeric" min="1" max="360" value={form.term_count} onChange={(e) => set({ term_count: e.target.value })} className={inputCls} />
          </Field>
          <Field label="You pay…">
            <select value={form.frequency} onChange={(e) => set({ frequency: e.target.value })} className={inputCls}>
              <option value="MONTHLY">every month</option>
              <option value="WEEKLY">every week</option>
            </select>
          </Field>
          <Field label="First instalment date">
            <input required type="date" value={form.first_due} onChange={(e) => set({ first_due: e.target.value })} className={inputCls} />
          </Field>

          <Field label="Fee added to each instalment (optional, KES)">
            <input type="number" inputMode="decimal" min="0" step="0.01" value={form.fee_per_installment} onChange={(e) => set({ fee_per_installment: e.target.value })} className={inputCls} />
          </Field>
          <Field label="One-off processing fee paid now (optional, KES)">
            <input type="number" inputMode="decimal" min="0" step="0.01" value={form.upfront_fees} onChange={(e) => set({ upfront_fees: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Paid from">
            <select value={form.payment_method} onChange={(e) => set({ payment_method: e.target.value })} className={inputCls}>
              {Object.entries(PAY_FROM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>

          <label className="md:col-span-3 flex items-start gap-2 text-sm text-[#3D4A3F]">
            <input type="checkbox" className="mt-1" checked={form.auto_pay} onChange={(e) => set({ auto_pay: e.target.checked })} />
            <span><b>The lender takes it automatically</b> (standing order, salary or SACCO deduction). I will not be reminded, and it will go into My Spending on the due date by itself.</span>
          </label>

          <div className="md:col-span-3 border-t border-[#F0EACF] pt-2 grid grid-cols-1 md:grid-cols-3 gap-2.5">
            <label className="md:col-span-3 flex items-start gap-2 text-sm text-[#3D4A3F]">
              <input type="checkbox" className="mt-1" checked={form.received_before_app} onChange={(e) => set({ received_before_app: e.target.checked })} />
              <span>I got this money <b>before</b> I started using My Business (it should not be added to My Money now).</span>
            </label>
            <Field label="Instalments I already paid before using the app">
              <input type="number" inputMode="numeric" min="0" value={form.paid_before_count} onChange={(e) => set({ paid_before_count: e.target.value })} className={inputCls} />
            </Field>
          </div>

          {/* The schedule, exactly as the database will save it. */}
          <div className="md:col-span-3 bg-[#FFFDF4] border border-[#EBD98A] rounded-xl p-2.5">
            {preview.error && <div className="text-sm text-red-700">{preview.error}</div>}
            {!preview.error && !preview.rows && <div className="text-[12.5px] text-[#8B8766]">{preview.loading ? 'Working it out…' : 'Fill in the amount, rate and instalments to see your schedule.'}</div>}
            {preview.rows && previewTotals.first && (
              <div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <Mini label="First instalment" value={money(Number(previewTotals.first.principal_due) + Number(previewTotals.first.interest_due) + Number(previewTotals.first.fees_due))} />
                  <Mini label="Interest + fees in total" value={money(previewTotals.interest + previewTotals.fees + (Number(form.upfront_fees) || 0))} tone="gold" />
                  <Mini label="You will pay back" value={money(previewTotals.principal + previewTotals.interest + previewTotals.fees)} />
                </div>
                <div className="mt-2 max-h-40 overflow-y-auto text-[12px] divide-y divide-[#F0EACF]">
                  {preview.rows.map((r) => (
                    <div key={r.seq} className="flex items-center justify-between py-1">
                      <span className="text-[#6F7461]">{r.seq}. {prettyDate(r.due_date)}</span>
                      <span className="font-semibold text-[#23382B]">{money(Number(r.principal_due) + Number(r.interest_due) + Number(r.fees_due))}</span>
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-[#8B8766] mt-1.5">If your lender's statement shows slightly different figures, save the loan and then edit that instalment to match.</p>
              </div>
            )}
          </div>

          <div className="md:col-span-3 flex gap-2">
            <button type="submit" disabled={saving} className={`${saveBtnCls} px-5`}>{saving ? 'Saving…' : 'Save loan'}</button>
            <button type="button" onClick={() => setShowForm(false)} className="px-4 min-h-[42px] rounded-lg border border-[#E3DBB8] text-sm text-[#5E6350]">Cancel</button>
          </div>
        </form>
      )}

      {loading && !loans.length ? <LoadingBlock text="Loading your loans…" /> : shown.length === 0 ? (
        <EmptyBlock>{filter === 'active' ? (isOwner ? 'No loans yet. Press “+ Loan” to add one.' : 'No loans yet.') : 'Nothing here.'}</EmptyBlock>
      ) : (
        <CardGrid>
          {shown.map(({ loan, sum }) => {
            const pill = STATE_PILL[sum.state] || STATE_PILL.ON_TRACK;
            const next = sum.next;
            return (
              <DataCard
                key={loan.id}
                onClick={() => { setActionError(''); setOpenId(loan.id); }}
                thumb={<IconTile icon={Coins} tone="gold" />}
                title={loan.lender_name}
                subtitle={`${LENDER_TYPES[loan.lender_type]?.split(' ')[0] || ''} · ${sum.paidCount}/${sum.total} paid${loan.auto_pay ? ' · auto' : ''}`}
                pill={pill}
                alert={sum.state === 'OVERDUE'}
                dim={loan.status !== 'ACTIVE'}
                big={next && loan.status === 'ACTIVE' ? { value: money(sum.nextBalance), label: `${dueWords(next.due_date, today)}${isPartPaid(next) ? ' · part paid' : ''}`, tone: sum.state === 'OVERDUE' ? 'bad' : undefined } : undefined}
                metrics={[{ label: 'Still owe', value: money(sum.owed) }, standingMetric(sum.standing)]}
              />
            );
          })}
        </CardGrid>
      )}

      {openRow && (
        <LoanSheet
          row={openRow} today={today} isOwner={isOwner} canRecord={canRecord} busyId={busyId} error={actionError}
          onClose={() => { setOpenId(null); setActionError(''); }}
          act={act}
        />
      )}
    </FitPage>
  );
}

/** The one-line standing shown on a loan card: how far behind or ahead of the schedule. */
function standingMetric(st) {
  if (!st) return { label: 'Interest paid', value: '—' };
  if (st.kind === 'ARREARS') return { label: 'Behind by', value: money(st.arrears) };
  if (st.kind === 'ADVANCE') return { label: 'Ahead by', value: money(st.advance) };
  return { label: 'Schedule', value: 'On schedule' };
}

const STANDING_BOX = {
  ARREARS: 'bg-[#FBE4E0] border-[#F0C2BB] text-[#8F2E24]',
  ADVANCE: 'bg-[#EEF5E8] border-[#CFE0C3] text-[#1B5138]',
  ON_SCHEDULE: 'bg-white border-[#E3DBB8] text-[#3D4A3F]',
};

// ── one loan: the schedule and what can be done to it ──────────────────────────────────────────────────────────
function LoanSheet({ row, today, isOwner, canRecord, busyId, error, onClose, act }) {
  const { loan, sum } = row;
  const insts = (loan.installments || []).filter((i) => i.status !== 'CANCELLED').sort((a, b) => a.seq - b.seq);
  const [paying, setPaying] = useState(null);       // installment id being confirmed
  const [payDate, setPayDate] = useState(today);
  const [editing, setEditing] = useState(null);     // { id, dueDate, principal, interest, fees }
  const [confirmClose, setConfirmClose] = useState(null);
  const live = loan.status === 'ACTIVE';
  const [payOpen, setPayOpen] = useState(false);
  const [pay, setPay] = useState({ amount: '', paidOn: today, method: loan.payment_method || 'BANK', note: '' });
  const [payDone, setPayDone] = useState(null);
  const payRef = useRef({ sig: '', ref: '' });
  const st = sum.standing;
  const history = (loan.payments || []).filter((p) => p.status === 'ACTIVE').sort((a, b) => Number(b.n) - Number(a.n));
  const dueNow = st?.kind === 'ARREARS' ? st.arrears : sum.nextBalance;

  // One tap = one payment. The same form sent twice (double tap, or a retry after a dropped reply) reuses one reference.
  const submitPay = () => act(loan.id, async () => {
    const amt = Number(pay.amount);
    const bad = (m) => Object.assign(new Error(m), { code: '22023' });
    if (!(amt > 0)) throw bad('Enter the amount you paid.');
    if (Math.abs(amt * 100 - Math.round(amt * 100)) > 1e-6) throw bad('Amounts can have at most 2 decimal places.');
    if (!(loan.installments || []).some((i) => i.accrues) && amt > sum.remainingToPay + 0.001) throw bad(`That is more than the ${money(sum.remainingToPay)} still to pay on this loan.`);
    const sig = JSON.stringify([loan.id, pay]);
    if (payRef.current.sig !== sig) payRef.current = { sig, ref: loanService.newPaymentReference() };
    const r = await loanService.recordPayment(loan.id, pay, payRef.current.ref);
    setPayDone(r);
    setPay({ amount: '', paidOn: today, method: loan.payment_method || 'BANK', note: '' });
    setPayOpen(false);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-[#FAF7EA] w-full sm:max-w-xl max-h-[92dvh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[#E3DBB8] p-3.5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h2 className="font-bold text-[#23382B] text-base truncate">{loan.lender_name}</h2>
            <p className="text-[11.5px] text-[#6F7461]">
              {money(loan.principal)} · {METHODS[loan.interest_method]}{loan.interest_method !== 'NONE' ? ` ${Number(loan.rate)}% per ${loan.rate_period === 'MONTH' ? 'month' : 'year'}` : ''}
              {loan.reference_no ? ` · No. ${loan.reference_no}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-2 -mr-1 text-[#6F7461]" aria-label="Close"><X size={18} /></button>
        </div>

        <div className="grid grid-cols-3 gap-2 mt-2.5">
          <Mini label="Still owe" value={money(sum.owed)} tone={sum.owed > 0 ? 'gold' : undefined} />
          <Mini label="Still to pay (all)" value={money(sum.remainingToPay)} />
          <Mini label="Interest paid" value={money(sum.interestPaid)} />
        </div>

        {error && <div className="mt-2 bg-[#FBE4E0] border border-[#F0C2BB] text-[#8F2E24] text-sm rounded-xl px-3 py-2">{error}</div>}
        {sum.principalGap !== 0 && (
          <Notice tone="gold">The instalments add up to {money(Math.abs(sum.principalGap))} {sum.principalGap > 0 ? 'more' : 'less'} than you borrowed. That is fine if it matches your lender's statement.</Notice>
        )}
        {loan.status !== 'ACTIVE' && <p className="mt-2 text-[12px] text-[#8B8766]">This loan is {STATE_PILL[sum.state]?.label.toLowerCase()}.</p>}

        {st && (
          <div className={`mt-2 border rounded-xl px-3 py-2 text-[12.5px] ${STANDING_BOX[st.kind]}`}>
            <b>{st.label}.</b> {st.detail}.
          </div>
        )}

        {payDone && (
          <div className="mt-2 bg-[#EEF5E8] border border-[#CFE0C3] text-[#1B5138] text-[12.5px] rounded-xl px-3 py-2">
            <b>{money(payDone.amount)} recorded.</b> {paymentSplitWords({ interest_paid: payDone.interest, fees_paid: payDone.fees, principal_paid: payDone.principal })}.
            {payDone.cleared ? ' The loan is now fully paid.' : ''}
          </div>
        )}

        {live && canRecord && (
          <div className="mt-2">
            {!payOpen ? (
              <button onClick={() => { setPayOpen(true); setPayDone(null); }} className={`${saveBtnCls} px-4 w-full`}>Record a payment</button>
            ) : (
              <div className="bg-white border border-[#E3DBB8] rounded-xl p-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Amount you paid (KES)">
                    <input autoFocus type="number" inputMode="decimal" min="0" step="0.01" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} className={inputCls} placeholder="e.g. 7000" />
                  </Field>
                  <Field label="Paid on"><input type="date" max={today} value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} className={inputCls} /></Field>
                  <Field label="Paid from">
                    <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} className={inputCls}>
                      {Object.entries(PAY_FROM).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </Field>
                  <Field label="Note (optional)"><input value={pay.note} onChange={(e) => setPay({ ...pay, note: e.target.value })} className={inputCls} /></Field>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {dueNow > 0 && <Chip onClick={() => setPay({ ...pay, amount: String(dueNow) })}>{st?.kind === 'ARREARS' ? 'Arrears' : 'Next instalment'} {money(dueNow)}</Chip>}
                  {st?.kind === 'ARREARS' && sum.next && <Chip onClick={() => setPay({ ...pay, amount: String(sum.nextBalance) })}>Oldest instalment {money(sum.nextBalance)}</Chip>}
                  <Chip onClick={() => setPay({ ...pay, amount: String(sum.remainingToPay) })}>Pay everything {money(sum.remainingToPay)}</Chip>
                </div>
                <p className="mt-1.5 text-[11px] text-[#6F7461]">
                  Less, equal or more than the instalment is fine. Your payment clears <b>interest first</b>, then the loan itself, oldest instalment first. Anything extra is paid towards the next instalments.
                </p>
                <div className="mt-2 flex gap-2">
                  <button disabled={busyId === loan.id} onClick={submitPay} className={`${saveBtnCls} px-4`}>{busyId === loan.id ? 'Saving…' : 'Save payment'}</button>
                  <button onClick={() => setPayOpen(false)} className="text-[12px] text-[#5E6350] px-2">Cancel</button>
                </div>
              </div>
            )}
          </div>
        )}

        {isOwner && live && (
          <label className="mt-2.5 flex items-start gap-2 text-[13px] text-[#3D4A3F]">
            <input type="checkbox" className="mt-0.5" checked={!!loan.auto_pay} disabled={busyId === loan.id}
              onChange={(e) => act(loan.id, () => loanService.setAutoPay(loan.id, e.target.checked))} />
            <span>The lender takes it automatically. It goes into My Spending on the due date by itself, and I am not reminded.</span>
          </label>
        )}

        <div className="mt-3 divide-y divide-[#F0EACF] bg-white border border-[#E3DBB8] rounded-xl">
          {insts.map((i) => {
            const dst = dueState(i.due_date, today);
            const late = i.status === 'PENDING' && dueState(i.due_date, today).kind === 'overdue';
            const part = isPartPaid(i);
            const costLeft = installmentCost(i) - paidOf(i, 'interest') - paidOf(i, 'fees');
            const loanLeft = Number(i.principal_due) - paidOf(i, 'principal');
            const isEditing = editing?.id === i.id;
            return (
              <div key={i.id} className="px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-[#23382B]">{i.seq}. {prettyDate(i.due_date)} <span className="font-semibold text-[#3D4A3F]">· {money(installmentTotal(i))}</span></div>
                    <div className="text-[11px] text-[#8B8766]">
                      Repays loan {money(i.principal_due)} · {i.accrues && !i.interest_accrued ? 'interest worked out at month end on what you still owe' : `interest ${money(i.interest_due)}`}{Number(i.fees_due) > 0 ? ` · fees ${money(i.fees_due)}` : ''}{i.edited ? ' · edited' : ''}
                    </div>
                    {part && <div className="text-[11.5px] font-semibold text-[#8A6A12]">Part paid: {money(installmentPaid(i))} paid · {money(installmentBalance(i))} to go</div>}
                  </div>
                  <div className="shrink-0 text-right">
                    {part && <div className="text-[10px] font-bold uppercase tracking-wide text-[#8A6A12]">Part paid</div>}
                    {i.status === 'PAID'
                      ? <span className="text-[11px] font-bold text-[#1B5138]">Paid{i.pre_app ? ' (before app)' : i.paid_on ? ` ${prettyDate(i.paid_on)}` : ''}</span>
                      : <span className={`text-[11px] font-bold ${late ? 'text-[#B23A2E]' : dst.kind === 'later' ? 'text-[#8B8766]' : 'text-[#8A6A12]'}`}>{dueWords(i.due_date, today)}</span>}
                  </div>
                </div>

                {i.status === 'PENDING' && live && !isEditing && paying !== i.id && (
                  <div className="mt-1 flex gap-3">
                    {canRecord && <TextBtn disabled={busyId === i.id} onClick={() => { setPaying(i.id); setPayDate(today); }}><Check size={12} className="inline -mt-0.5" /> {part ? `Pay the balance (${money(installmentBalance(i))})` : 'Mark as paid'}</TextBtn>}
                    {isOwner && <TextBtn tone="gold" onClick={() => setEditing({ id: i.id, dueDate: i.due_date, principal: String(i.principal_due), interest: String(i.interest_due), fees: String(i.fees_due) })}><Pencil size={11} className="inline -mt-0.5" /> Edit</TextBtn>}
                  </div>
                )}
                {paying === i.id && (
                  <div className="mt-2 bg-[#EEF5E8] border border-[#CFE0C3] rounded-lg p-2 text-[12px] text-[#1B5138]">
                    {costLeft > 0
                      ? <>This puts <b>{money(costLeft)}</b> (interest and fees) into My Spending.{loanLeft > 0 ? <> The <b>{money(loanLeft)}</b> that repays the loan is not counted as spending.</> : null}</>
                      : <>Nothing more goes into My Spending: only <b>{money(loanLeft)}</b> that repays the loan is left on this instalment.</>}
                    <div className="mt-1.5 flex items-center gap-2">
                      <label className="text-[11px]">Paid on <input type="date" max={today} value={payDate} onChange={(e) => setPayDate(e.target.value)} className="border border-[#CFE0C3] rounded px-1.5 py-1 text-[12px] ml-1" /></label>
                      <button disabled={busyId === i.id} onClick={() => act(i.id, async () => { await loanService.markPaid(i.id, payDate); setPaying(null); })} className="bg-[#1F6B45] text-white font-semibold rounded-lg px-3 min-h-[32px] text-[12px] disabled:opacity-60">{busyId === i.id ? 'Saving…' : 'Confirm'}</button>
                      <button onClick={() => setPaying(null)} className="text-[12px] text-[#5E6350] px-2">Back</button>
                    </div>
                  </div>
                )}

                {isEditing && (
                  <div className="mt-2 bg-[#FFFDF4] border border-[#EBD98A] rounded-lg p-2 grid grid-cols-2 gap-2">
                    <Field label="Date"><input type="date" value={editing.dueDate} onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })} className={inputCls} /></Field>
                    <Field label="Repays the loan (KES)"><input type="number" inputMode="decimal" min="0" step="0.01" value={editing.principal} onChange={(e) => setEditing({ ...editing, principal: e.target.value })} className={inputCls} /></Field>
                    <Field label="Interest (KES)"><input type="number" inputMode="decimal" min="0" step="0.01" value={editing.interest} onChange={(e) => setEditing({ ...editing, interest: e.target.value })} className={inputCls} /></Field>
                    <Field label="Fees (KES)"><input type="number" inputMode="decimal" min="0" step="0.01" value={editing.fees} onChange={(e) => setEditing({ ...editing, fees: e.target.value })} className={inputCls} /></Field>
                    <div className="col-span-2 flex gap-2">
                      <button disabled={busyId === i.id} onClick={() => act(i.id, async () => { await loanService.updateInstallment(i.id, editing); setEditing(null); })} className={`${saveBtnCls} px-4 text-[12.5px]`}>Save</button>
                      <button onClick={() => setEditing(null)} className="text-[12px] text-[#5E6350] px-2">Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {history.length > 0 && (
          <div className="mt-3">
            <div className="text-[11px] font-bold uppercase tracking-wide text-[#8B8766] mb-1">Payments recorded</div>
            <div className="divide-y divide-[#F0EACF] bg-white border border-[#E3DBB8] rounded-xl">
              {history.map((p, idx) => (
                <div key={p.id} className="px-3 py-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-bold text-[#23382B]">{money(p.amount)} <span className="font-semibold text-[#6F7461]">· {prettyDate(p.paid_on)}{p.auto ? ' · automatic' : ''}</span></div>
                    <div className="text-[11px] text-[#8B8766]">{paymentSplitWords(p)}{PAY_FROM[p.payment_method] ? ` · ${PAY_FROM[p.payment_method]}` : ''}{p.note ? ` · ${p.note}` : ''}</div>
                  </div>
                  {isOwner && idx === 0 && ['ACTIVE', 'CLEARED'].includes(loan.status) && (
                    <TextBtn tone="danger" disabled={busyId === loan.id} onClick={() => act(loan.id, () => loanService.voidPayment(p.id))}><RotateCcw size={11} className="inline -mt-0.5" /> Undo</TextBtn>
                  )}
                </div>
              ))}
            </div>
            {isOwner && history.length > 1 && <p className="mt-1 text-[11px] text-[#8B8766]">Only the latest payment can be undone. Undo the newest first to go back further.</p>}
          </div>
        )}

        {isOwner && live && (
          <div className="mt-3 pt-2 border-t border-[#F0EACF]">
            {!confirmClose ? (
              <div className="flex flex-wrap gap-x-4">
                <TextBtn onClick={() => setConfirmClose('SETTLED')}>I paid this loan off early</TextBtn>
                <TextBtn tone="danger" onClick={() => setConfirmClose('CANCEL')}>I added this by mistake</TextBtn>
              </div>
            ) : (
              <div className="bg-[#FBF3D5] border border-[#EBD98A] rounded-lg p-2 text-[12px] text-[#6B4F0B]">
                {confirmClose === 'SETTLED'
                  ? 'The unpaid instalments are removed and the loan is closed. Your payments so far stay, and an instalment that was part paid keeps what was paid. (If you paid a settlement amount, record it as a payment first.)'
                  : 'This removes the loan. It only works if no payment has been recorded on it. A processing fee, if you added one, is taken out of My Spending.'}
                <div className="mt-1.5 flex gap-2">
                  <button disabled={busyId === loan.id} onClick={() => act(loan.id, async () => { await loanService.close(loan.id, confirmClose); setConfirmClose(null); onClose(); })} className="bg-[#1F6B45] text-white font-semibold rounded-lg px-3 min-h-[32px] text-[12px] disabled:opacity-60">Yes, do it</button>
                  <button onClick={() => setConfirmClose(null)} className="text-[12px] text-[#5E6350] px-2">Back</button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label className="text-xs text-[#6F7461]">{label}</label>
      {children}
    </div>
  );
}

function Chip({ onClick, children }) {
  return <button type="button" onClick={onClick} className="px-2.5 min-h-[30px] rounded-full border border-[#E3DBB8] bg-[#FAF7EA] text-[11.5px] font-semibold text-[#3D4A3F]">{children}</button>;
}

function Mini({ label, value, tone }) {
  return (
    <div className="bg-white border border-[#E3DBB8] rounded-lg px-2 py-1.5 min-w-0">
      <div className="text-[9px] font-bold uppercase tracking-wide text-[#8B8766] truncate">{label}</div>
      <div className={`text-[13px] font-bold truncate ${tone === 'gold' ? 'text-[#8A6A12]' : 'text-[#23382B]'}`}>{value}</div>
    </div>
  );
}
