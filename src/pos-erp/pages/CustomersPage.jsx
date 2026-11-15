// src/pos-erp/pages/CustomersPage.jsx
//
// Phase 2 — customers, standalone payments, receivables, statements
// (brief §21-26). Sales/payments-at-sale-time/receipts already existed
// (saleService.js); this page is what was actually missing: customer
// records, and a way to record a payment against an existing balance
// outside of a new sale.
//
// customer_type options and payment_method options are the REAL enum
// values (confirmed against the live DB), not the brief's wording.
// CREDIT is deliberately excluded from the payment-method choices here —
// it's a sale payment method, not something you'd record as how a
// standalone payment was paid.
//
// Phase 8 adds §7's "Remind John" — a one-press WhatsApp payment
// reminder for anyone with a balance. It reuses the WhatsApp machinery
// in communicationService.js rather than building a second message path,
// and it inherits that machinery's honesty rules: the reminder is
// logged Prepared → Opened in WhatsApp → Sent by you, never "Delivered",
// because the owner is the one who presses Send inside WhatsApp.

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { folioService } from '../services/folioService';
import { settingsService } from '../services/settingsService';
import { businessHeaderHtml } from '../utils/businessHeader';
import { useCustomers } from '../hooks/useCustomers';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { paymentService } from '../services/paymentService';
import { receivablesService } from '../services/receivablesService';
import ContactActions from '../components/ContactActions';
// Phase 16: proper statement — printable, with the customer's own
// contact details and a purchased/paid/balance summary, not just a bare
// transaction list. Shares the same print utility the sale receipt uses
// (utils/printDocument.js) rather than a second print implementation.
import { printDocument, escapeHtml } from '../utils/printDocument';
import { Printer, UserRound, Plus, Pencil, Power } from 'lucide-react';
import { FitPage, AddButton, SearchBox, FilterChips, MiniStats, DataCard, IconTile, IconBtn, TextBtn, Notice, LoadingBlock, EmptyBlock, formCard, inputCls, saveBtnCls } from '../components/CardKit';
import Sheet from '../components/workspace/Sheet';
import { singleFlight } from '../utils/singleFlight';

const CUSTOMER_TYPES = ['WALK_IN', 'REGISTERED', 'BUSINESS', 'CREDIT'];
const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'CARD', 'BANK', 'VOUCHER', 'OTHER'];

const EMPTY_FORM = { name: '', phone: '', email: '', address: '', customer_type: 'WALK_IN', credit_limit: '0' };
const EMPTY_PAYMENT = { amount: '', payment_method: 'CASH', reference_no: '', notes: '' };

function fmt(n) {
  return (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function CustomersPage() {
  const { staffId, tenant } = usePosErpAuth();
  const { customers, loading, error, create, update, deactivate, reactivate, fetch } = useCustomers();

  const [showForm, setShowForm] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all'); // all | owing | inactive

  const [payingCustomer, setPayingCustomer] = useState(null);
  const [paymentForm, setPaymentForm] = useState(EMPTY_PAYMENT);
  const [paymentError, setPaymentError] = useState('');
  const [payingBusy, setPayingBusy] = useState(false);

  // Reminders now go through the shared MessageComposer (ContactActions): the wording is chosen from today's date and
  // the customer's real balance, shown for review and editing, and recorded honestly in Messages.

  const [statementCustomer, setStatementCustomer] = useState(null);
  const [statementRows, setStatementRows] = useState([]);
  const [statementLoading, setStatementLoading] = useState(false);
  const [statementFolios, setStatementFolios] = useState([]); // guest bills (folios), when the business uses them

  const openCreateForm = () => {
    setEditingCustomer(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowForm(true);
  };

  const openEditForm = (customer) => {
    setEditingCustomer(customer);
    setForm({
      name: customer.name || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      customer_type: customer.customer_type || 'WALK_IN',
      credit_limit: String(customer.credit_limit ?? 0),
    });
    setFormError('');
    setShowForm(true);
  };

  const handleSubmit = singleFlight('CustomersPage.handleSubmit', async (e) => {
    e.preventDefault();
    setFormError('');
    setSaving(true);
    try {
      const payload = { ...form, credit_limit: parseFloat(form.credit_limit) || 0 };
      if (editingCustomer) {
        await update(editingCustomer.id, payload);
      } else {
        await create(payload);
      }
      setShowForm(false);
      setEditingCustomer(null);
      setForm(EMPTY_FORM);
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  });

  const openPaymentModal = (customer) => {
    setPayingCustomer(customer);
    setPaymentForm(EMPTY_PAYMENT);
    setPaymentError('');
  };

  const submitPayment = singleFlight('CustomersPage.submitPayment', async (e) => {
    e.preventDefault();
    setPaymentError('');
    if (!tenant?.business_id) {
      setPaymentError('No business is linked to this account yet — cannot record a payment.');
      return;
    }
    setPayingBusy(true);
    try {
      await paymentService.recordCustomerPayment({
        businessId: tenant.business_id,
        customerId: payingCustomer.id,
        amount: parseFloat(paymentForm.amount),
        paymentMethod: paymentForm.payment_method,
        referenceNo: paymentForm.reference_no,
        notes: paymentForm.notes,
        createdBy: staffId,
      });
      setPayingCustomer(null);
      fetch(); // refresh outstanding_balance from the DB rather than guessing the new value client-side
    } catch (err) {
      setPaymentError(err.message);
    } finally {
      setPayingBusy(false);
    }
  });

  const openStatement = async (customer) => {
    setStatementCustomer(customer);
    setStatementFolios([]);
    folioService.listForCustomer(customer.id).then((rows) => setStatementFolios(rows.filter((f) => f.status !== 'CANCELLED'))).catch(() => setStatementFolios([])); // no folios (or not set up): nothing to show
    setStatementLoading(true);
    try {
      const rows = await receivablesService.getStatement(customer.id);
      setStatementRows(rows);
    } catch (err) {
      setStatementRows([]);
    } finally {
      setStatementLoading(false);
    }
  };

  // Phase 16: purchased/paid totals, derived from the same signed
  // amounts the row list already colour-codes (negative = reduces
  // balance = a payment; positive = a charge) rather than trusting a
  // free-text transaction_type string that could read differently
  // across older rows.
  const statementTotals = statementRows.reduce((acc, r) => {
    const amt = Number(r.amount) || 0;
    if (amt > 0) acc.purchased += amt; else acc.paid += Math.abs(amt);
    return acc;
  }, { purchased: 0, paid: 0 });

  const printStatement = async () => {
    const c = statementCustomer;
    // the statement is FROM the active business: its own logo, name and contact details (nothing if they cannot be loaded, e.g. offline)
    const biz = await settingsService.getBusinessProfile(tenant?.business_id).catch(() => null);
    const rowsHtml = statementRows.map(r => `
      <tr>
        <td>${new Date(r.created_at).toLocaleDateString()}</td>
        <td>${escapeHtml(r.transaction_type)}${r.notes ? ` — ${escapeHtml(r.notes)}` : ''}</td>
        <td class="right">${fmt(r.amount)}</td>
        <td class="right bold">${fmt(r.balance_after)}</td>
      </tr>`).join('');
    printDocument(`Statement — ${c.name}`, `
      ${businessHeaderHtml(biz)}
      <div class="divider"></div>
      <div class="center bold" style="font-size:14px;">Account Statement</div>
      <div class="center muted">${new Date().toLocaleDateString()}</div>
      <div style="margin-top:6px;">Customer:<br/><span class="bold">${escapeHtml(c.name)}</span></div>
      <div class="muted">${c.phone ? escapeHtml(c.phone) : ''}${c.phone && c.email ? ' · ' : ''}${c.email ? escapeHtml(c.email) : ''}</div>
      <div class="divider"></div>
      <table>
        <tr><td>Total Purchases</td><td class="right">${fmt(statementTotals.purchased)}</td></tr>
        <tr><td>Total Paid</td><td class="right">${fmt(statementTotals.paid)}</td></tr>
        <tr class="bold"><td>Balance Owed</td><td class="right">${fmt(c.outstanding_balance)}</td></tr>
      </table>
      <div class="divider"></div>
      <table>
        <thead><tr><th>Date</th><th>Type</th><th class="right">Amount</th><th class="right">Balance</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="4" class="center muted">No transactions yet</td></tr>'}</tbody>
      </table>
    `, `table { font-size: 12px; } th { text-align: left; border-bottom: 1px solid #ccc; }`);
  };


  const owingList = customers.filter(c => Number(c.outstanding_balance) > 0);
  const totalOwed = owingList.reduce((n, c) => n + Number(c.outstanding_balance || 0), 0);
  const inactiveCount = customers.filter(c => !c.is_active).length;

  const q = search.trim().toLowerCase();
  const visibleCustomers = customers.filter(c => {
    const okFilter = filter === 'all' || (filter === 'owing' && Number(c.outstanding_balance) > 0) || (filter === 'inactive' && !c.is_active);
    const okSearch = !q || (c.name || '').toLowerCase().includes(q) || (c.phone || '').toLowerCase().includes(q);
    return okFilter && okSearch;
  });

  return (
    <FitPage
      title="Customers"
      icon={UserRound}
      subtitle="The people you sell to, and who still owes you."
      action={<AddButton onClick={() => (showForm ? setShowForm(false) : openCreateForm())} open={showForm} label="Customer" icon={Plus} />}
      summary={!loading && !error && (
        <MiniStats items={[
          { label: 'Customers', value: customers.length },
          { label: 'Owing', value: owingList.length, tone: owingList.length ? 'gold' : undefined },
          { label: 'Total owed', value: fmt(totalOwed), tone: totalOwed > 0 ? 'gold' : undefined },
        ]} />
      )}
      toolbar={(
        <div className="space-y-2">
          <SearchBox value={search} onChange={setSearch} placeholder="Search name or phone…" />
          <FilterChips
            value={filter} onChange={setFilter}
            options={[
              { key: 'all', label: 'All', count: customers.length },
              { key: 'owing', label: 'Owing', count: owingList.length },
              ...(inactiveCount > 0 ? [{ key: 'inactive', label: 'Inactive', count: inactiveCount }] : []),
            ]}
          />
        </div>
      )}
    >

      {/* We know WhatsApp opened. We do not know the owner pressed Send. */}

      {showForm && (
        <form onSubmit={handleSubmit} className={`${formCard} grid grid-cols-1 md:grid-cols-3 gap-2.5`}>
          <div className="md:col-span-3 text-[13px] font-bold text-[#23382B]">{editingCustomer ? `Edit ${editingCustomer.name}` : 'New customer'}</div>
          {formError && <div className="md:col-span-3"><Notice tone="bad">{formError}</Notice></div>}
          <input required placeholder="Customer name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} className={inputCls} />
          <input placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className={inputCls} />
          <input placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} className={inputCls} />
          <input placeholder="Address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className={`${inputCls} md:col-span-3`} />
          <select value={form.customer_type} onChange={e => setForm({ ...form, customer_type: e.target.value })} className={inputCls}>
            {CUSTOMER_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
          </select>
          <div className="md:col-span-2">
            <input type="number" min="0" placeholder="Credit limit" aria-label="Credit limit" value={form.credit_limit} onChange={e => setForm({ ...form, credit_limit: e.target.value })} className={inputCls} />
          </div>
          <button type="submit" disabled={saving} className={`${saveBtnCls} md:col-span-3`}>
            {saving ? 'Saving…' : editingCustomer ? 'Save changes' : 'Save customer'}
          </button>
        </form>
      )}

      {loading ? (
        <LoadingBlock text="Loading customers…" />
      ) : error ? (
        <Notice tone="bad">Couldn't load customers: {error}</Notice>
      ) : visibleCustomers.length === 0 ? (
        <EmptyBlock>{customers.length === 0 ? 'No customers yet. Add your first one.' : 'No customers match.'}</EmptyBlock>
      ) : (
        // Customer cards carry more than a stock card (balance + five actions), so they run wider: 1 across on a small phone.
        <div className="grid grid-cols-1 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-2">
          {visibleCustomers.map(c => {
            const owes = Number(c.outstanding_balance) > 0;
            const limit = Number(c.credit_limit) || 0;
            return (
              <DataCard
                key={c.id}
                alert={owes}
                dim={!c.is_active}
                thumb={<IconTile icon={UserRound} tone={owes ? 'gold' : 'green'} />}
                title={c.name}
                subtitle={c.phone || 'No phone number'}
                pill={!c.is_active ? { tone: 'neutral', label: 'Inactive' } : owes ? { tone: 'warn', label: 'Owes' } : { tone: 'info', label: (c.customer_type || '').replace('_', ' ') }}
                big={{ value: fmt(c.outstanding_balance), tone: owes ? 'gold' : 'muted', label: owes ? 'owed to you' : 'no balance' }}
                metrics={[
                  { label: 'Credit limit', value: limit > 0 ? fmt(limit) : 'None' },
                  { label: 'Type', value: (c.customer_type || '—').replace('_', ' ') },
                ]}
                actions={(
                  <>
                    <TextBtn onClick={() => openPaymentModal(c)} tone="gold">Record payment</TextBtn>
                    <TextBtn onClick={() => openStatement(c)}>Statement</TextBtn>
                    <ContactActions size="sm" recipient={{ kind: 'CUSTOMER', id: c.id, name: c.name, phone: c.phone, email: c.email }} purpose={owes ? 'PAYMENT_REMINDER' : 'CUSTOMER_WELCOME'} />
                    <span className="ml-auto flex items-center gap-1.5">
                      <IconBtn title="Edit customer" onClick={() => openEditForm(c)}><Pencil size={14} /></IconBtn>
                      <IconBtn
                        title={c.is_active ? 'Deactivate customer' : 'Reactivate customer'}
                        tone={c.is_active ? 'danger' : undefined}
                        onClick={() => (c.is_active ? deactivate(c.id) : reactivate(c.id))}
                      >
                        <Power size={14} />
                      </IconBtn>
                    </span>
                  </>
                )}
              />
            );
          })}
        </div>
      )}

      {/* Record standalone payment */}
      {payingCustomer && (
        <Sheet title="Record payment" onClose={() => setPayingCustomer(null)}>
          <form onSubmit={submitPayment} className="space-y-3">
            <div className="rounded-xl bg-[#FBF3D5] border border-[#EBD98A] px-3 py-2 text-[13px] text-[#6B4F0B]">
              <span className="font-bold">{payingCustomer.name}</span> owes <span className="font-extrabold">{fmt(payingCustomer.outstanding_balance)}</span>
            </div>
            {paymentError && <Notice tone="bad">{paymentError}</Notice>}
            <input
              required autoFocus type="number" step="0.01" min="0.01" inputMode="decimal" placeholder="Amount"
              value={paymentForm.amount} onChange={e => setPaymentForm({ ...paymentForm, amount: e.target.value })}
              className={`${inputCls} text-lg font-semibold`}
            />
            <select value={paymentForm.payment_method} onChange={e => setPaymentForm({ ...paymentForm, payment_method: e.target.value })} className={inputCls}>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select>
            <input placeholder="Reference no. (optional)" value={paymentForm.reference_no} onChange={e => setPaymentForm({ ...paymentForm, reference_no: e.target.value })} className={inputCls} />
            <input placeholder="Notes (optional)" value={paymentForm.notes} onChange={e => setPaymentForm({ ...paymentForm, notes: e.target.value })} className={inputCls} />
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => setPayingCustomer(null)} className="flex-1 min-h-[42px] rounded-lg bg-[#EEEBDD] text-[#5E6350] font-semibold">Cancel</button>
              <button type="submit" disabled={payingBusy} className={`${saveBtnCls} flex-1`}>{payingBusy ? 'Saving…' : 'Save payment'}</button>
            </div>
          </form>
        </Sheet>
      )}

      {/* Statement */}
      {statementCustomer && (
        <Sheet title={`${statementCustomer.name} — Statement`} onClose={() => setStatementCustomer(null)}>
          {/* Personal info the statement should carry — the phone/email an owner needs to reach this customer about the balance. */}
          {(statementCustomer.phone || statementCustomer.email) && (
            <div className="text-[11.5px] text-[#6F7461] flex flex-wrap gap-x-3 -mt-2 mb-3">
              {statementCustomer.phone && <span>{statementCustomer.phone}</span>}
              {statementCustomer.email && <span>{statementCustomer.email}</span>}
            </div>
          )}

          <MiniStats items={[
            { label: 'Purchased', value: fmt(statementTotals.purchased) },
            { label: 'Paid', value: fmt(statementTotals.paid), tone: 'good' },
            { label: 'Owes', value: fmt(statementCustomer.outstanding_balance), tone: Number(statementCustomer.outstanding_balance) > 0 ? 'gold' : undefined },
          ]} />

          {statementFolios.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] font-bold text-[#8B8766] uppercase tracking-wide mb-1">Bills &amp; stays</div>
              <div className="border border-[#E3DBB8] rounded-xl divide-y divide-[#F0EACF] overflow-hidden">
                {statementFolios.slice(0, 5).map((f) => (
                  <Link key={f.id} to={`/pos/folios?folio=${f.id}`} className="flex justify-between items-center gap-3 px-3 py-2 text-[13px] hover:bg-[#FAF7EA]">
                    <span className="min-w-0 truncate">{f.title || f.folio_number}<span className="text-[11px] text-[#8B8766]"> · {f.status === 'OPEN' ? 'open' : `paid ${f.settled_at ? new Date(f.settled_at).toLocaleDateString() : ''}`}</span></span>
                    <span className={`font-semibold shrink-0 ${f.status === 'OPEN' ? 'text-[#8A6A12]' : 'text-[#3D4A3F]'}`}>{fmt(f.status === 'OPEN' ? f.balance_due : f.total_charges)}</span>
                  </Link>
                ))}
              </div>
              {statementFolios.length > 5 && <div className="text-[11px] text-[#8B8766] mt-1">and {statementFolios.length - 5} older</div>}
            </div>
          )}

          <div className="mt-3">
            {statementLoading ? (
              <LoadingBlock />
            ) : statementRows.length === 0 ? (
              <EmptyBlock>No transactions yet</EmptyBlock>
            ) : (
              <div className="border border-[#E3DBB8] rounded-xl overflow-x-auto">
                <table className="w-full text-left text-[12.5px] min-w-[360px]">
                  <thead className="bg-[#FAF7EA] text-[#8B8766] text-[10px] uppercase tracking-wide">
                    <tr><th className="px-2.5 py-1.5">Date</th><th>Type</th><th className="text-right">Amount</th><th className="text-right pr-2.5">Balance</th></tr>
                  </thead>
                  <tbody>
                    {statementRows.map(r => (
                      <tr key={r.id} className="border-t border-[#F0EACF]">
                        <td className="px-2.5 py-1.5 whitespace-nowrap text-[#6F7461]">{new Date(r.created_at).toLocaleDateString()}</td>
                        <td className="py-1.5">{r.transaction_type}{r.notes ? <span className="text-[#8B8766]"> — {r.notes}</span> : null}</td>
                        <td className={`py-1.5 text-right ${Number(r.amount) < 0 ? 'text-[#1B6B45]' : 'text-[#23382B]'}`}>{fmt(r.amount)}</td>
                        <td className="py-1.5 pr-2.5 text-right font-semibold">{fmt(r.balance_after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <button
            onClick={printStatement}
            className={`${saveBtnCls} mt-3 w-full flex items-center justify-center gap-2 text-sm`}
          >
            <Printer size={15} /> Print statement
          </button>
        </Sheet>
      )}
    </FitPage>
  );
}
