// All Elimu finance database calls. Every one is a SECURITY DEFINER RPC (E001-E010): the DATABASE decides who may do what, so a hidden button
// is never the only protection. Errors are the database's plain-language messages (RAISE EXCEPTION text) and are shown as-is.
// Money in -> integer cents from the UI, converted to "123.45" strings here (never floats). Money out -> strings; convert with fromDb().
import { posSupabase as supabase } from '../../../services/posSupabaseClient';
import { toCents, toDecimalString } from '../utils/money';

const dec = (cents) => toDecimalString(cents);
async function rpc(fn, args = {}) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) { const e = new Error(error.message || 'Something went wrong.'); e.code = error.code; throw e; }
  return data;
}
const money = (v) => (v === null || v === undefined || v === '' ? null : typeof v === 'number' && Number.isInteger(v) ? dec(v) : dec(toCents(v)));
const rows = async (fn, args) => (await rpc(fn, args)) || [];

export const financeApi = {
  myAccess: () => rpc('elimu_my_access'),
  // ---- configuration (admin) ----
  saveConfig: (table, business, row, reason) => rpc('elimu_fin_save_config', { p_table: table, p_business: business, p_row: row, p_reason: reason ?? null }),
  syncStudent: (business, student) => rpc('elimu_fin_sync_student', { p_business: business, p_student: student }),
  async list(table, business, { columns = '*', order, limit = 200, filters = {} } = {}) {
    let q = supabase.from(table).select(columns).eq('business_id', business).limit(Math.min(limit, 500));
    for (const [k, v] of Object.entries(filters)) q = v === null ? q.is(k, null) : q.eq(k, v);
    if (order) q = q.order(order.col, { ascending: order.asc !== false });
    const { data, error } = await q; if (error) throw new Error(error.message); return data || [];
  },
  // ---- billing ----
  matchingStructures: (b, student, period) => rows('elimu_fin_matching_structures', { p_business: b, p_student: student, p_period: period }),
  previewBill: (b, student, period, structureIds = null) => rpc('elimu_fin_preview_bill', { p_business: b, p_student: student, p_period: period, p_structure_ids: structureIds, p_apply_rules: true }),
  billStudent: (b, student, period, { structureIds = null, dueDate = null, extraLines = [], notes = null } = {}) =>
    rpc('elimu_fin_bill_student', { p_business: b, p_student: student, p_period: period, p_structure_ids: structureIds, p_due_date: dueDate,
      p_extra_lines: extraLines.map(l => ({ ...l, amount: money(l.amount) })), p_notes: notes, p_apply_rules: true }),
  billBulk: (b, period, { classId = null, streamId = null, structureIds = null, dueDate = null, dryRun = false } = {}) =>
    rpc('elimu_fin_bill_bulk', { p_business: b, p_period: period, p_class_id: classId, p_stream_id: streamId, p_structure_ids: structureIds, p_due_date: dueDate, p_dry_run: dryRun }),
  addOpeningBalance: (b, student, cents, asOf, description) => rpc('elimu_fin_add_opening_balance', { p_business: b, p_student: student, p_amount: money(cents), p_as_of: asOf, p_description: description ?? undefined }),
  addOpeningCredit: (b, student, cents, reason) => rpc('elimu_fin_add_opening_credit', { p_business: b, p_student: student, p_amount: money(cents), p_reason: reason ?? undefined }),
  amendInvoice: (invoice, lines, reason, dueDate = null) => rpc('elimu_fin_amend_invoice', { p_invoice: invoice, p_lines: lines.map(l => ({ ...l, amount: money(l.amount) })), p_reason: reason, p_due_date: dueDate }),
  cancelInvoice: (invoice, reason) => rpc('elimu_fin_cancel_invoice', { p_invoice: invoice, p_reason: reason }),
  // ---- payments ----
  /** One call for every channel. client_reference makes a retry/replay safe: the same reference never creates a second payment. */
  recordPayment: (b, student, p) => rpc('elimu_fin_record_payment', {
    p_business: b, p_student: student, p_method: p.method, p_amount: money(p.amountCents), p_payment_date: p.date ?? null, p_transaction_ref: p.transactionRef ?? null,
    p_bank_account: p.bankAccount ?? null, p_deposit_slip_ref: p.depositSlipRef ?? null, p_payer_name: p.payerName ?? null, p_payer_phone: p.payerPhone ?? null,
    p_notes: p.notes ?? null, p_client_reference: p.clientReference ?? null, p_c2b_id: p.c2bId ?? null }),
  confirmPayment: (id, basis = 'MANUAL_ATTESTATION', note = null) => rpc('elimu_fin_confirm_payment', { p_payment: id, p_basis: basis, p_note: note }),
  failPayment: (id, reason) => rpc('elimu_fin_fail_payment', { p_payment: id, p_reason: reason }),
  c2bInbox: (b, limit = 50) => rows('elimu_fin_c2b_inbox', { p_business: b, p_limit: limit }),
  allocate: (type, source, invoice, cents) => rpc('elimu_fin_allocate', { p_source_type: type, p_source: source, p_invoice: invoice, p_amount: money(cents) }),
  releaseAllocation: (id, reason) => rpc('elimu_fin_release_allocation', { p_alloc: id, p_reason: reason }),
  receiptData: (paymentId) => rpc('elimu_fin_receipt_data', { p_payment: paymentId }),
  // ---- adjustments / awards / corrections ----
  requestAdjustment: (b, student, a) => rpc('elimu_fin_request_adjustment', { p_business: b, p_student: student, p_kind: a.kind, p_amount: a.percent ? null : money(a.amountCents), p_reason: a.reason,
    p_subtype: a.subtype ?? null, p_percent: a.percent ?? null, p_target_invoice: a.invoiceId ?? null, p_period: a.periodId ?? null, p_sponsor_name: a.sponsorName ?? null,
    p_sponsor_reference: a.sponsorReference ?? null, p_document_url: a.documentUrl ?? null, p_award: a.awardId ?? null }),
  decideAdjustment: (id, approve, note) => rpc('elimu_fin_decide_adjustment', { p_adjustment: id, p_approve: approve, p_note: note ?? null }),
  withdrawAdjustment: (id, reason) => rpc('elimu_fin_cancel_adjustment_request', { p_adjustment: id, p_reason: reason ?? null }),
  createAward: (b, student, a) => rpc('elimu_fin_create_award', { p_business: b, p_student: student, p_type: a.type, p_sponsor_type: a.sponsorType, p_sponsor_name: a.sponsorName ?? null, p_coverage: a.coverage,
    p_value_type: a.valueType, p_value: a.value, p_scope: a.scope, p_academic_year: a.academicYear, p_period: a.periodId ?? null, p_document_url: a.documentUrl ?? null, p_note: a.note ?? null }),
  openingCredit: (b, student, cents, reason) => rpc('elimu_fin_add_opening_credit', { p_business: b, p_student: student, p_amount: dec(cents), p_reason: reason }),
  searchStudents: async (b, text) => { const t = String(text || '').trim().replace(/[%,()]/g, ''); if (t.length < 2) return []; const { data, error } = await supabase.from('elimu_fin_students').select('student_id, admission_no, full_name, class_name').eq('business_id', b).or(`admission_no.ilike.%${t}%,full_name.ilike.%${t}%`).limit(8); if (error) throw new Error(error.message); return data || []; },
  studentsByIds: async (b, ids) => { const { data, error } = await supabase.from('elimu_fin_students').select('student_id, admission_no, full_name').eq('business_id', b).in('student_id', ids); if (error) throw new Error(error.message); return data || []; },
  applyAward: (award, invoice) => rpc('elimu_fin_apply_award', { p_award: award, p_invoice: invoice }),
  creditAvailable: (b, student) => rpc('elimu_fin_credit_available', { p_business: b, p_student: student }),
  requestReversal: (b, kind, originalId, reason) => rpc('elimu_fin_request_correction', { p_business: b, p_kind: kind, p_original_id: originalId, p_reason: reason }),
  requestRefund: (b, student, cents, reason, method, reference, payee) => rpc('elimu_fin_request_correction', { p_business: b, p_kind: 'REFUND', p_original_id: null, p_reason: reason,
    p_student: student, p_amount: money(cents), p_refund_method: method, p_refund_reference: reference ?? null, p_refund_payee: payee ?? null }),
  decideCorrection: (id, approve, note) => rpc('elimu_fin_decide_correction', { p_correction: id, p_approve: approve, p_note: note ?? null }),
  withdrawCorrection: (id) => rpc('elimu_fin_cancel_correction_request', { p_correction: id }),
  // ---- plans & follow-ups ----
  createPlan: (b, student, invoiceIds, installments, reason, name, supersedes) => rpc('elimu_fin_create_plan', { p_business: b, p_student: student, p_invoice_ids: invoiceIds,
    p_installments: installments.map(i => ({ due_date: i.dueDate, amount: money(i.amountCents) })), p_reason: reason, p_name: name ?? 'Payment plan', p_supersedes: supersedes ?? null }),
  decidePlan: (id, approve, note) => rpc('elimu_fin_decide_plan', { p_plan: id, p_approve: approve, p_note: note ?? null }),
  cancelPlan: (id, reason) => rpc('elimu_fin_cancel_plan', { p_plan: id, p_reason: reason }),
  planStatus: (id, asOf = null) => rows('elimu_fin_plan_status', { p_plan: id, p_as_of: asOf }),
  recordFollowup: (b, student, f) => rpc('elimu_fin_record_followup', { p_business: b, p_student: student, p_action: f.action, p_outcome: f.outcome ?? null, p_notes: f.notes ?? null,
    p_invoice: f.invoiceId ?? null, p_promise_date: f.promiseDate ?? null, p_promise_amount: f.promiseCents ? money(f.promiseCents) : null, p_next_action: f.nextActionDate ?? null }),
  // ---- cashier sessions ----
  openSession: (b, floatCents) => rpc('elimu_fin_open_session', { p_business: b, p_opening_float: money(floatCents ?? 0) }),
  closeSession: (id, countedCents, handoverTo, note) => rpc('elimu_fin_close_session', { p_session: id, p_counted_cash: money(countedCents), p_handover_to: handoverTo ?? null, p_note: note ?? null }),
  approveSession: (id, note) => rpc('elimu_fin_approve_session', { p_session: id, p_note: note ?? null }),
  sessionSummary: (id) => rpc('elimu_fin_session_summary', { p_session: id }),
  // ---- expenses, budgets, reconciliation ----
  recordExpense: (b, e) => rpc('elimu_fin_record_expense', { p_business: b, p_category: e.categoryId, p_date: e.date ?? null, p_amount: money(e.amountCents), p_method: e.method, p_description: e.description,
    p_supplier: e.supplier ?? null, p_department: e.department ?? null, p_reference: e.reference ?? null, p_document_url: e.documentUrl ?? null, p_period: e.periodId ?? null, p_status: e.status ?? 'PENDING' }),
  /** Expense categories: the shared system categories plus any the school added (row security returns both). */
  async expenseCategories() { const { data, error } = await supabase.from('lb_expense_categories').select('id, name').eq('is_active', true).order('sort_order'); if (error) throw new Error(error.message); return data || []; },
  /** Expenses of this school with the school extras (supplier, department, reference), newest first. */
  async expenses(b, limit = 300) {
    const [e, m] = await Promise.all([
      supabase.from('lb_expenses').select('id, expense_number, expense_date, amount, payment_method, description, status, category_id').eq('business_id', b).order('expense_date', { ascending: false }).order('created_at', { ascending: false }).limit(limit),
      supabase.from('elimu_fin_expense_meta').select('expense_id, supplier_name, department, reference, approval_note').eq('business_id', b).limit(1000)]);
    if (e.error) throw new Error(e.error.message); if (m.error) throw new Error(m.error.message);
    const meta = Object.fromEntries((m.data || []).map((x) => [x.expense_id, x]));
    return (e.data || []).map((x) => ({ ...x, ...(meta[x.id] || {}) }));
  },
  budgets: (b) => (financeApi.list('elimu_fin_budgets', b, { order: { col: 'created_at', asc: false }, limit: 100 })),
  budgetLines: (budgetId) => supabase.from('elimu_fin_budget_lines').select('department, category_id, amount').eq('budget_id', budgetId).then(({ data, error }) => { if (error) throw new Error(error.message); return data || []; }),
  // ----- general ledger (piece 5) -----
  glAccounts: (b) => supabase.from('elimu_gl_accounts').select('id, code, name, type, section, is_cash, is_active, party').eq('business_id', b).order('code').then(({ data, error }) => { if (error) throw new Error(error.message); return data || []; }),
  glJournals: (b, limit = 200) => supabase.from('elimu_gl_journals').select('id, journal_no, entry_date, source, memo, total, reversed_by, reversal_of').eq('business_id', b).order('entry_date', { ascending: false }).order('journal_no', { ascending: false }).limit(limit).then(({ data, error }) => { if (error) throw new Error(error.message); return data || []; }),
  glJournalLines: (id) => supabase.from('elimu_gl_journal_lines').select('line_no, account_id, debit, credit, memo').eq('journal_id', id).order('line_no').then(({ data, error }) => { if (error) throw new Error(error.message); return data || []; }),
  glWaiting: (b) => supabase.from('elimu_fin_gl_postings').select('id', { count: 'exact', head: true }).eq('business_id', b).in('status', ['READY', 'UNMAPPED']).then(({ count, error }) => { if (error) throw new Error(error.message); return count || 0; }),
  glSetup: (b) => rpc('elimu_gl_setup', { p_business: b }),
  glPostPending: (b) => rpc('elimu_gl_post_pending', { p_business: b }),
  glSaveAccount: (b, account) => rpc('elimu_gl_save_account', { p_business: b, p_account: account }),
  glManualJournal: (b, date, memo, lines) => rpc('elimu_gl_manual_journal', { p_business: b, p_date: date, p_memo: memo, p_lines: lines }),
  glReverse: (id, reason) => rpc('elimu_gl_reverse_journal', { p_journal: id, p_reason: reason }),
  trialBalance: (b, asAt) => rpc('elimu_gl_trial_balance', { p_business: b, p_to: asAt || null }),
  accountLedger: (id, from, to) => rpc('elimu_gl_account_ledger', { p_account: id, p_from: from || null, p_to: to || null }),
  incomeStatement: (b, from, to) => rpc('elimu_gl_income_statement', { p_business: b, p_from: from, p_to: to }),
  financialPosition: (b, asAt) => rpc('elimu_gl_financial_position', { p_business: b, p_as_at: asAt || null }),
  cashFlow: (b, from, to) => rpc('elimu_gl_cash_flow', { p_business: b, p_from: from, p_to: to }),
  partyBalances: (b, kind, asAt) => rpc('elimu_gl_party_balances', { p_business: b, p_kind: kind, p_as_at: asAt || null }),
  setExpenseStatus: (id, status, note) => rpc('elimu_fin_set_expense_status', { p_expense: id, p_status: status, p_note: note ?? null }),
  saveBudget: (b, budget) => rpc('elimu_fin_save_budget', { p_business: b, p_budget: { ...budget, lines: (budget.lines || []).map(l => ({ ...l, amount: money(l.amountCents ?? l.amount) })) } }),
  approveBudget: (id) => rpc('elimu_fin_approve_budget', { p_budget: id }),
  budgetReport: (id) => rpc('elimu_fin_budget_report', { p_budget: id }),
  unreconciled: (b, method, from, to) => rows('elimu_fin_unreconciled', { p_business: b, p_method: method, p_from: from, p_to: to }),
  reconcile: (b, r) => rpc('elimu_fin_reconcile', { p_business: b, p_method: r.method, p_account_label: r.accountLabel ?? null, p_from: r.from, p_to: r.to, p_statement_total: money(r.statementCents), p_payment_ids: r.paymentIds, p_notes: r.notes ?? null }),
  // ---- accounting ----
  seedMappings: (b) => rpc('elimu_fin_seed_default_mappings', { p_business: b }),
  saveMapping: (b, key, code, name) => rpc('elimu_fin_save_mapping', { p_business: b, p_key: key, p_code: code, p_name: name }),
  resolveUnmapped: (b) => rpc('elimu_fin_gl_resolve_unmapped', { p_business: b }),
  markJournalPosted: (id, ref) => rpc('elimu_fin_gl_mark_posted', { p_posting: id, p_external_ref: ref }),
  // ---- reports (all paged server-side) ----
  studentAccount: (b, student) => rpc('elimu_fin_student_account', { p_business: b, p_student: student }),
  statement: (b, student, { from = null, to = null, limit = 100, offset = 0 } = {}) => rows('elimu_fin_statement', { p_business: b, p_student: student, p_from: from, p_to: to, p_limit: limit, p_offset: offset }),
  debtors: (b, f = {}) => rows('elimu_fin_debtors', { p_business: b, p_period: f.periodId ?? null, p_class: f.classId ?? null, p_stream: f.streamId ?? null,
    p_min_outstanding: f.minOutstandingCents ? money(f.minOutstandingCents) : '0.01', p_min_days_overdue: f.minDaysOverdue ?? null, p_as_of: f.asOf ?? null, p_limit: f.limit ?? 50, p_offset: f.offset ?? 0 }),
  aging: (b, f = {}) => rpc('elimu_fin_aging', { p_business: b, p_as_of: f.asOf ?? null, p_class: f.classId ?? null, p_period: f.periodId ?? null }),
  collections: (b, from, to, group = 'DAY') => rows('elimu_fin_collections', { p_business: b, p_from: from, p_to: to, p_group: group }),
  collectionsByPeriod: (b) => rows('elimu_fin_collections_by_period', { p_business: b }),
  feeSummary: (b, period = null) => rpc('elimu_fin_fee_summary', { p_business: b, p_period: period }),
  structureReport: (b, period = null) => rpc('elimu_fin_structure_report', { p_business: b, p_period: period }),
  studentList: (b, kind, classId = null, limit = 50, offset = 0) => rows('elimu_fin_student_list', { p_business: b, p_kind: kind, p_class: classId, p_limit: limit, p_offset: offset }),
  incomeExpenditure: (b, from, to) => rpc('elimu_fin_income_expenditure', { p_business: b, p_from: from, p_to: to }),
  repeatOverdue: (b, minTerms = 2, limit = 50) => rows('elimu_fin_repeat_overdue', { p_business: b, p_min_terms: minTerms, p_limit: limit }),
  approvalQueue: (b) => rpc('elimu_fin_approval_queue', { p_business: b }),
  // ---- fixed assets and stores (each action posts a balanced journal in the database) ----
  assets: (b) => supabase.from('elimu_fa_assets').select('*').eq('business_id', b).order('asset_tag').then(({ data, error }) => { if (error) throw new Error(error.message); return data || []; }),
  assetDepreciation: (asset) => supabase.from('elimu_fa_depreciation').select('period_end, amount').eq('asset_id', asset).order('period_end', { ascending: false }).then(({ data, error }) => { if (error) throw new Error(error.message); return data || []; }),
  addAsset: (b, a) => rpc('elimu_fa_add_asset', { p_business: b, p_asset: { name: a.name, category: a.category, acquisition_date: a.date, cost: dec(a.costCents), residual_value: dec(a.residualCents || 0), life_months: String(a.lifeMonths || 0), funded_from: a.fundedFrom, location: a.location || null, notes: a.notes || null } }),
  runDepreciation: (b, to = null) => rpc('elimu_fa_run_depreciation', { p_business: b, p_to: to }),
  disposeAsset: (id, date, proceedsCents, receivedIn) => rpc('elimu_fa_dispose', { p_asset: id, p_date: date, p_proceeds: dec(proceedsCents || 0), p_received_in: receivedIn }),
  voidAsset: (id, reason) => rpc('elimu_fa_void_asset', { p_asset: id, p_reason: reason }),
  stItems: (b) => supabase.from('elimu_st_items').select('*').eq('business_id', b).order('name').then(({ data, error }) => { if (error) throw new Error(error.message); return data || []; }),
  stMovements: (item, limit = 60) => supabase.from('elimu_st_movements').select('id, kind, qty, amount, move_date, memo, department, created_at').eq('item_id', item).order('created_at', { ascending: false }).limit(limit).then(({ data, error }) => { if (error) throw new Error(error.message); return data || []; }),
  stSaveItem: (b, item) => rpc('elimu_st_save_item', { p_business: b, p_item: item }),
  stReceive: (b, item, qty, totalCents, date, paidFrom, memo) => rpc('elimu_st_receive', { p_business: b, p_item: item, p_qty: String(qty), p_total_cost: dec(totalCents), p_date: date, p_paid_from: paidFrom, p_memo: memo || null }),
  stIssue: (b, item, qty, date, department, memo) => rpc('elimu_st_issue', { p_business: b, p_item: item, p_qty: String(qty), p_date: date, p_department: department || null, p_memo: memo || null }),
  stAdjust: (b, item, delta, date, reason) => rpc('elimu_st_adjust', { p_business: b, p_item: item, p_delta: String(delta), p_date: date, p_reason: reason }),
  stValuation: (b) => rpc('elimu_st_valuation', { p_business: b }),
  // Suppliers, bills and payments (elimu_1000)
  spSummary: (b) => rpc('elimu_sp_summary', { p_business: b }),
  spSaveSupplier: (b, sup) => rpc('elimu_sp_save_supplier', { p_business: b, p_supplier: sup }),
  spAddBill: (b, x) => rpc('elimu_sp_add_bill', { p_business: b, p_bill: { supplier_id: x.supplierId, bill_date: x.date, due_date: x.dueDate || null, amount: dec(x.cents), debit_code: x.code, supplier_ref: x.ref || null, description: x.description || null } }),
  spPayBill: (bill, cents, date, paidFrom, reference) => rpc('elimu_sp_pay_bill', { p_bill: bill, p_amount: dec(cents), p_date: date, p_paid_from: paidFrom, p_reference: reference || null }),
  spVoidBill: (bill, reason) => rpc('elimu_sp_void_bill', { p_bill: bill, p_reason: reason }),
  spVoidPayment: (payment, reason) => rpc('elimu_sp_void_payment', { p_payment: payment, p_reason: reason }),
  // Payroll (elimu_1001)
  prRates: (b, on = null) => rpc('elimu_pr_get_rates', { p_business: b, p_on: on }),
  prSaveEmployee: (b, e) => rpc('elimu_pr_save_employee', { p_business: b, p_emp: { id: e.id || undefined, name: e.name, job_title: e.jobTitle || undefined, kra_pin: e.kraPin || undefined, nssf_no: e.nssfNo || undefined, shif_no: e.shifNo || undefined, phone: e.phone || undefined,
    basic: e.basicCents === undefined ? undefined : dec(e.basicCents), allowances: e.allowanceCents === undefined ? undefined : dec(e.allowanceCents), pays_paye: e.paysPaye, is_active: e.isActive } }),
  prCreateRun: (b, month) => rpc('elimu_pr_create_run', { p_business: b, p_month: month }),
  prApproveRun: (run) => rpc('elimu_pr_approve_run', { p_run: run }),
  prPaySalaries: (run, date, from, ref) => rpc('elimu_pr_pay_salaries', { p_run: run, p_date: date, p_paid_from: from, p_reference: ref || null }),
  prRemit: (run, date, from, ref) => rpc('elimu_pr_remit_statutory', { p_run: run, p_date: date, p_paid_from: from, p_reference: ref || null }),
  prVoidRun: (run, reason) => rpc('elimu_pr_void_run', { p_run: run, p_reason: reason }),
};
