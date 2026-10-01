// src/pos-erp/pages/InvoicesPage.jsx — My Invoices
// Invoices are built from the existing Rent & Charges lines. Status and balances come from recorded payments only.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Loader2, X, Download, Printer, MessageCircle, Mail, MessageSquare, Smartphone } from 'lucide-react';
import { usePosErpAuth } from '../auth/usePosErpAuth';
import { invoiceService, INVOICE_STATUS_LABEL } from '../services/invoiceService';
import { downloadInvoicePdf, printInvoicePdf, sharePdf, downloadReceiptPdf } from '../services/invoicePdfService';
import { templateService, communicationLogService, whatsappService, renderTemplate } from '../services/communicationService';
import { mpesaService } from '../services/mpesaService';
import { useMpesaPayment } from '../hooks/useMpesaPayment';
import { normalizeMpesaCode, isValidMpesaCode, isWholeShillings } from '../utils/mpesa';

const kes = (n) => `KES ${Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(d).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const thisMonth = () => new Date().toISOString().slice(0, 7);
const PILL = { DRAFT: 'bg-slate-100 text-slate-600', ISSUED: 'bg-blue-50 text-blue-700', PARTIALLY_PAID: 'bg-amber-50 text-amber-700', PAID: 'bg-emerald-50 text-emerald-700', OVERDUE: 'bg-red-50 text-red-700', CANCELLED: 'bg-slate-100 text-slate-400' };
const Pill = ({ s }) => <span className={`text-[11px] font-bold px-2 py-1 rounded-full ${PILL[s] || PILL.DRAFT}`}>{INVOICE_STATUS_LABEL[s] || s}</span>;
const METHODS = [['CASH', 'Cash'], ['BANK', 'Bank'], ['MPESA_MANUAL', 'M-Pesa — Manual (I received a code)'], ['MPESA_PROMPT', 'M-Pesa — Prompt (STK Push)']];

export default function InvoicesPage() {
  const { tenant, staffId } = usePosErpAuth();
  const businessId = tenant?.business_id;
  const [month, setMonth] = useState(thisMonth());
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);      // { kind: 'ok'|'err', text }
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    if (!businessId) return; setLoading(true);
    try { setRows(await invoiceService.getAll({ businessId, period: `${month}-01` })); } catch (e) { setMsg({ kind: 'err', text: e.message }); }
    setLoading(false);
  }, [businessId, month]);
  useEffect(() => { load(); }, [load]);

  const generate = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await invoiceService.generateMonthly({ businessId, period: `${month}-01`, createdBy: staffId });
      setMsg({ kind: 'ok', text: `${r.created} new invoice(s) created, ${r.already_existed} already existed${r.skipped_no_charges ? `, ${r.skipped_no_charges} occupied unit(s) had no charges` : ''}.` });
      await load();
    } catch (e) { setMsg({ kind: 'err', text: e.message }); }
    setBusy(false);
  };

  const live = rows.filter((r) => r.display_status !== 'CANCELLED');
  const totals = useMemo(() => ({
    billed: live.reduce((s, r) => s + Number(r.total_amount), 0),
    paid: live.reduce((s, r) => s + Number(r.paid_amount), 0),
    due: live.reduce((s, r) => s + Number(r.balance_due), 0),
  }), [rows]); // eslint-disable-line

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div><h1 className="text-xl font-bold text-slate-800 flex items-center gap-2"><FileText size={20} /> My Invoices</h1>
          <p className="text-sm text-slate-500">Rent and charges for each tenant, ready to send.</p></div>
        <div className="flex items-center gap-2">
          <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
          <button onClick={generate} disabled={busy} className="bg-emerald-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50">
            {busy ? 'Working…' : 'Generate Monthly Invoices'}</button>
        </div>
      </div>
      {msg && <div className={`mb-4 text-sm rounded-xl p-3 border ${msg.kind === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-700'}`}>{msg.text}</div>}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[['Billed', totals.billed], ['Paid', totals.paid], ['Still owed', totals.due]].map(([k, v]) => (
          <div key={k} className="bg-white border border-slate-200 rounded-2xl p-3"><div className="text-xs text-slate-500">{k}</div><div className="font-bold text-slate-800">{kes(v)}</div></div>))}
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full text-sm"><thead className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wide"><tr>
          <th className="text-left px-4 py-3">Invoice</th><th className="text-left px-4 py-3">Tenant</th><th className="text-left px-4 py-3">Unit</th>
          <th className="text-right px-4 py-3">Total</th><th className="text-right px-4 py-3">Balance</th><th className="text-center px-4 py-3">Status</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {loading && <tr><td colSpan={6} className="text-center py-10 text-slate-400"><Loader2 size={18} className="animate-spin inline mr-2" />Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-slate-400">No invoices for this month yet. Tap “Generate Monthly Invoices”.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} onClick={() => setOpenId(r.id)} className="cursor-pointer hover:bg-slate-50">
                <td className="px-4 py-3 font-semibold text-slate-800">{r.invoice_number}</td><td className="px-4 py-3">{r.customer?.name || '—'}</td>
                <td className="px-4 py-3">{r.unit?.unit_number || '—'}</td><td className="px-4 py-3 text-right">{kes(r.total_amount)}</td>
                <td className="px-4 py-3 text-right font-semibold">{kes(r.balance_due)}</td><td className="px-4 py-3 text-center"><Pill s={r.display_status} /></td></tr>))}
          </tbody></table>
      </div>
      {openId && <InvoiceDetail id={openId} tenant={tenant} staffId={staffId} onClose={() => { setOpenId(null); load(); }} />}
    </div>
  );
}

function InvoiceDetail({ id, tenant, staffId, onClose }) {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [templates, setTemplates] = useState([]);
  const [pay, setPay] = useState({ method: 'CASH', amount: '', code: '', phone: '' });
  const [working, setWorking] = useState(false);
  const mp = useMpesaPayment();

  const reload = useCallback(async () => { try { setD(await invoiceService.getDetail(id)); } catch (e) { setErr(e.message); } }, [id]);
  useEffect(() => { reload(); }, [reload]);
  useEffect(() => { templateService.ensureDefaults({ tenantId: tenant.id, businessId: tenant.business_id, createdBy: staffId }).then(setTemplates).catch(() => {}); }, [tenant, staffId]);
  useEffect(() => { if (mp.phase === 'paid') reload(); }, [mp.phase, reload]);
  useEffect(() => { if (d) setPay((p) => ({ ...p, amount: String(Number(d.invoice.balance_due) || ''), phone: p.phone || d.customer?.phone || '' })); }, [d?.invoice?.balance_due]); // eslint-disable-line

  if (!d) return <Shell onClose={onClose}>{err ? <p className="text-red-600 text-sm">{err}</p> : <Loader2 className="animate-spin" />}</Shell>;
  const { invoice: inv, customer, mpesa } = d;
  const st = inv.display_status;
  const payable = ['ISSUED', 'PARTIALLY_PAID', 'OVERDUE'].includes(st);
  const promptReady = !!(mpesa?.is_active && mpesa.shortcode && mpesa.has_consumer_key && mpesa.has_consumer_secret && mpesa.has_passkey);
  const run = async (fn) => { setWorking(true); setErr(''); setNote(''); try { await fn(); } catch (e) { setErr(e.message || String(e)); } setWorking(false); };

  const payHint = () => {
    const p = d.payInfo || {}, bits = [];
    if (p.paybill) bits.push(`M-Pesa Paybill ${p.paybill}, account ${(p.paybill_account || '').trim() || inv.invoice_number}`);
    if (p.till) bits.push(`Till ${p.till}`);
    if (!p.paybill && !p.till && mpesa?.shortcode) bits.push(`M-Pesa ${mpesa.shortcode}, account ${inv.invoice_number}`);
    if (p.bank_account_number) bits.push(`${p.bank_name || 'Bank'} a/c ${p.bank_account_number}${p.bank_account_name ? ` (${p.bank_account_name})` : ''}`);
    return bits.length ? `Pay via ${bits.join(' or ')}.` : '';
  };
  const vars = () => ({
    customer_name: customer?.name, business_name: d.business?.name, invoice_number: inv.invoice_number,
    period: new Date(inv.period).toLocaleDateString('en-KE', { month: 'long', year: 'numeric' }),
    amount: Number(inv.total_amount).toLocaleString('en-KE'), outstanding: (Number(inv.balance_due) + Number(inv.previous_balance)).toLocaleString('en-KE'),
    due_date: day(inv.due_date), payment_hint: payHint(),
  });
  const tpl = (channel) => templates.find((t) => t.message_type === 'INVOICE' && t.channel === channel);
  const base = { tenantId: tenant.id, businessId: tenant.business_id, customer, variables: null, referenceType: 'rent_invoice', referenceId: inv.id, createdBy: staffId };
  const needSendable = () => { if (!['ISSUED', 'PARTIALLY_PAID', 'OVERDUE', 'PAID'].includes(st)) throw new Error('Issue the invoice before sending it.'); };

  const sendWhatsApp = () => run(async () => {
    needSendable(); const template = tpl('WHATSAPP'); if (!template) throw new Error('WhatsApp invoice template is not set up yet.');
    const { log, url } = await whatsappService.prepare({ ...base, variables: vars(), template });
    const attached = await sharePdf(d, log.rendered_message).catch(() => false);
    if (!attached) { downloadInvoicePdf(d); window.open(url, '_blank'); setNote('PDF downloaded — attach it in the WhatsApp chat that just opened. (This browser cannot attach files automatically.)'); }
    await whatsappService.markOpened(log.id);
  });
  const sendSms = () => run(async () => {
    needSendable(); const template = tpl('SMS'); if (!template) throw new Error('SMS invoice template is not set up yet.');
    await communicationLogService.send({ ...base, variables: vars(), template });
    setNote('SMS saved in Customer Messages as QUEUED. No SMS provider is connected, so it has NOT been sent yet. The SMS carries the invoice number and amount, not the PDF.');
  });
  const sendEmail = () => run(async () => {
    needSendable(); const template = tpl('EMAIL'); if (!template) throw new Error('Email invoice template is not set up yet.');
    if (!customer?.email) throw new Error(`${customer?.name || 'This tenant'} has no email address on file.`);
    const row = await communicationLogService.send({ ...base, variables: vars(), template });
    const subject = renderTemplate(template.subject || 'Invoice {{invoice_number}}', vars());
    const attached = await sharePdf(d, row.rendered_message).catch(() => false);
    if (!attached) { downloadInvoicePdf(d); window.location.href = `mailto:${customer.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(row.rendered_message)}`; setNote('PDF downloaded — attach it to the email that just opened (email links cannot attach files).'); }
  });

  const submitPay = () => run(async () => {
    const amount = Number(pay.amount);
    if (!(amount > 0)) throw new Error('Enter an amount.');
    if (amount > Number(inv.balance_due) + 0.004) throw new Error(`That is more than the balance (${kes(inv.balance_due)}).`);
    if (pay.method === 'MPESA_PROMPT') {
      if (!isWholeShillings(amount)) throw new Error('M-Pesa prompts must be whole shillings.');
      mp.reset(); await mp.send({ phone: pay.phone, amount, rentInvoiceId: inv.id, customerId: inv.customer_id });
      return;
    }
    let referenceNo = null, method = pay.method, source = 'MANUAL';
    if (pay.method === 'MPESA_MANUAL') {
      referenceNo = normalizeMpesaCode(pay.code);
      if (!isValidMpesaCode(referenceNo)) throw new Error('Enter the M-Pesa code exactly as in the SMS (e.g. SGL7K2X9AB).');
      if (await mpesaService.isCodeUsed(tenant.business_id, referenceNo)) throw new Error('That M-Pesa code has already been recorded.');
      method = 'MOBILE_MONEY'; source = 'MPESA_MANUAL';
    }
    await invoiceService.recordPayment({ invoiceId: inv.id, amount, paymentMethod: method, referenceNo, source, createdBy: staffId });
    setPay((p) => ({ ...p, code: '' })); await reload();
  });

  return (
    <Shell onClose={onClose} title={`${inv.invoice_number} · ${customer?.name || ''}`}>
      <div className="flex items-center justify-between mb-3"><Pill s={st} /><span className="text-xs text-slate-500">Due {day(inv.due_date)}</span></div>
      <div className="border border-slate-200 rounded-xl divide-y divide-slate-100 text-sm mb-3">
        {d.lines.map((l) => <div key={l.id} className="flex justify-between px-3 py-2"><span>{l.charge?.charge_name || 'Charge'}</span><span>{kes(l.amount)}</span></div>)}
        {Number(inv.previous_balance) > 0 && <div className="flex justify-between px-3 py-2 text-amber-700"><span>Previous balance</span><span>{kes(inv.previous_balance)}</span></div>}
        {Number(inv.paid_amount) > 0 && <div className="flex justify-between px-3 py-2 text-emerald-700"><span>Paid</span><span>− {kes(inv.paid_amount)}</span></div>}
        <div className="flex justify-between px-3 py-2 font-bold"><span>Amount due</span><span>{kes(inv.balance_due)}</span></div>
      </div>
      {d.payments.length > 0 && <div className="text-xs text-slate-600 mb-3 space-y-1">{d.payments.map((p) => (
        <div key={p.id} className="flex justify-between"><span>{day(p.created_at)} · {p.source === 'MPESA_PROMPT' ? 'M-Pesa (confirmed by Safaricom)' : p.source === 'MPESA_MANUAL' ? 'M-Pesa (entered manually)' : String(p.payment_method).toLowerCase()}{p.reference_no ? ` · ${p.reference_no}` : ''}</span><span>{kes(p.amount)} <button onClick={() => downloadReceiptPdf(d, p)} className="ml-1 underline text-emerald-700">Receipt {p.receipt_number || ''}</button></span></div>))}</div>}

      {err && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl p-3">{err}</div>}
      {note && <div className="mb-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl p-3">{note}</div>}

      <div className="flex flex-wrap gap-2 mb-4">
        {st === 'DRAFT' && <button disabled={working} onClick={() => run(async () => { await invoiceService.issue(inv.id); await reload(); })} className="bg-emerald-700 text-white text-sm font-semibold px-3 py-2 rounded-lg">Issue invoice</button>}
        <Btn icon={Download} onClick={() => downloadInvoicePdf(d)}>Download PDF</Btn>
        <Btn icon={Printer} onClick={() => printInvoicePdf(d)}>Print</Btn>
        <Btn icon={MessageCircle} onClick={sendWhatsApp} disabled={working}>WhatsApp</Btn>
        <Btn icon={MessageSquare} onClick={sendSms} disabled={working}>SMS</Btn>
        <Btn icon={Mail} onClick={sendEmail} disabled={working}>Email</Btn>
        {['DRAFT', 'ISSUED'].includes(st) && d.payments.length === 0 && <button disabled={working} onClick={() => run(async () => { await invoiceService.cancel(inv.id); onClose(); })} className="text-red-600 text-sm px-3 py-2">Cancel invoice</button>}
      </div>

      {payable && (
        <div className="border border-slate-200 rounded-xl p-3 space-y-2">
          <div className="text-sm font-semibold text-slate-700">Record a payment</div>
          <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm">
            {METHODS.map(([v, l]) => <option key={v} value={v} disabled={v === 'MPESA_PROMPT' && !promptReady}>{l}{v === 'MPESA_PROMPT' && !promptReady ? ' — not set up' : ''}</option>)}
          </select>
          {!promptReady && <p className="text-xs text-slate-500">M-Pesa Prompt needs your Daraja details under Settings → M-Pesa. Until then, use “M-Pesa — Manual”: it is recorded as entered by you, not verified by Safaricom.</p>}
          <input type="number" min="1" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Amount (KES)" />
          {pay.method === 'MPESA_MANUAL' && <input value={pay.code} onChange={(e) => setPay({ ...pay, code: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm uppercase" placeholder="M-Pesa code, e.g. SGL7K2X9AB" />}
          {pay.method === 'MPESA_PROMPT' && <input value={pay.phone} onChange={(e) => setPay({ ...pay, phone: e.target.value })} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Tenant phone e.g. 0712345678" />}
          {mp.phase === 'idle' || mp.phase === 'failed' || pay.method !== 'MPESA_PROMPT' ? (
            <button disabled={working || mp.phase === 'sending'} onClick={submitPay} className="w-full bg-emerald-700 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-50">
              {pay.method === 'MPESA_PROMPT' ? 'Send M-Pesa prompt' : 'Record payment'}</button>) : null}
          {pay.method === 'MPESA_PROMPT' && <PromptStatus mp={mp} />}
          {mp.error && <p className="text-xs text-red-600">{mp.error}</p>}
        </div>)}
    </Shell>
  );
}

function PromptStatus({ mp }) {
  const t = mp.transaction;
  if (mp.phase === 'sending') return <p className="text-sm text-slate-600">Sending…</p>;
  if (mp.phase === 'pending') return (<div className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded-lg p-3">
    <Smartphone size={14} className="inline mr-1" />Prompt sent. Waiting for the tenant to enter their M-Pesa PIN. <b>Not paid yet</b> — this only changes to Paid when Safaricom confirms.
    <button onClick={mp.refresh} className="ml-2 underline">Check now</button></div>);
  if (mp.phase === 'paid') return <p className="text-sm bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg p-3">Payment confirmed by Safaricom. Receipt {t?.mpesa_receipt_number}. The invoice has been updated.</p>;
  if (mp.phase === 'failed') return <p className="text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg p-3">
    {t?.status === 'CANCELLED' ? 'The tenant cancelled the prompt.' : t?.status === 'TIMED_OUT' ? 'The prompt timed out with no reply.' : t?.status === 'NEEDS_ATTENTION' ? 'Money was received but could not be applied to the invoice — check My Money → M-Pesa.' : 'The payment failed.'} {t?.result_desc}</p>;
  return null;
}

const Btn = ({ icon: I, children, ...p }) => <button {...p} className="inline-flex items-center gap-1.5 border border-slate-200 text-slate-700 text-sm px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50"><I size={14} />{children}</button>;
function Shell({ title, onClose, children }) {
  return (<div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4">
    <div className="bg-white rounded-t-2xl md:rounded-2xl w-full max-w-lg shadow-xl p-5 max-h-[92vh] overflow-y-auto">
      <div className="flex items-center justify-between mb-3"><h2 className="font-bold text-slate-800">{title || 'Invoice'}</h2><button onClick={onClose}><X size={18} /></button></div>{children}</div></div>);
}
