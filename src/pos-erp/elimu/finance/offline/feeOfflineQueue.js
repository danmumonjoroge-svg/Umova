// OFFLINE for school fees - built on the EXISTING offline database (offline/db.js `meta` table). No second engine, no second database.
//
// WHAT IS SAFE OFFLINE (and what is deliberately not):
//   * Viewing a student's account/statement from a copy saved on this phone while online  -> yes (readThrough snapshots, labelled "saved copy").
//   * Writing a payment as a DRAFT on the phone                                             -> yes, but a draft is NOT a payment.
//   * Confirming, receipting, allocating, reversing, refunding, billing                     -> NEVER offline. The server decides.
//
// A draft moves through:   DRAFT -> SUBMITTING -> SUBMITTED(server: CONFIRMED | PENDING)   or  FAILED
//   - DRAFT       written on the phone. Nothing is recorded anywhere. No receipt exists. The parent has NOT paid as far as the books go.
//   - SUBMITTING  being sent right now.
//   - SUBMITTED   the server accepted it. `serverStatus` then says CONFIRMED (receipt issued) or PENDING (an approver must confirm).
//   - FAILED      the server refused it (message kept). It is never retried automatically; the cashier fixes or discards it.
//   (REVERSED exists only on the server; a refreshed copy can show it.)
// Drafts are never pushed by the POS sync engine (their kind is unknown to it) - the cashier submits them. Submitting is idempotent: the draft id is
// sent as client_reference, so a retry after a dropped connection can never create a second payment (unique index in E003).
import { getMeta, setMeta, db } from '../../../offline/db';
import { nextLocalId } from '../../../offline/idGenerator';
import { isNetworkFailure } from '../../../offline/netErrors';
import { saveSnapshot, readThrough } from '../../../offline/readThrough';

const KEY = 'elimu:fee_drafts';                               // NOT under cache: - sign-out must not silently drop unsent money records

export const DRAFT_STATES = ['DRAFT', 'SUBMITTING', 'SUBMITTED', 'FAILED'];
export const defaultKv = { get: (k) => getMeta(k), set: (k, v) => setMeta(k, v) };

export function createDraftQueue({ kv = defaultKv, idFn = () => nextLocalId('FEE'), now = () => new Date().toISOString(), tx = (fn) => db.transaction('rw', db.meta, fn) } = {}) {
  const readAll = async () => { const r = await kv.get(KEY); return Array.isArray(r) ? r : (Array.isArray(r?.value) ? r.value : []); };
  const writeAll = (rows) => kv.set(KEY, rows);
  const update = (id, patch) => tx(async () => { const rows = await readAll(); const i = rows.findIndex(r => r.id === id); if (i < 0) throw new Error('Draft not found.'); rows[i] = { ...rows[i], ...patch }; await writeAll(rows); return rows[i]; });

  return {
    async saveDraft({ tenantId, businessId, staffId, studentId, studentLabel, method, amountCents, transactionRef = null, bankAccount = null, depositSlipRef = null, payerName = null, payerPhone = null, notes = null }) {
      if (!tenantId || !businessId || !studentId) throw new Error('Choose the student first.');
      if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Enter an amount above zero.');
      if (!['CASH', 'MPESA', 'BANK', 'CHEQUE', 'OTHER'].includes(method)) throw new Error('Choose how the money was paid.');
      const id = await idFn();
      const draft = { id, tenantId, businessId, staffId, studentId, studentLabel, method, amountCents, transactionRef, bankAccount, depositSlipRef, payerName, payerPhone, notes,
        state: 'DRAFT', createdAt: now(), serverStatus: null, receiptNo: null, paymentId: null, error: null };
      await tx(async () => { const rows = await readAll(); rows.push(draft); await writeAll(rows); });
      return draft;
    },
    async list(tenantId) { return (await readAll()).filter(r => r.tenantId === tenantId); },
    async discard(id) {
      await tx(async () => { const rows = await readAll(); const r = rows.find(x => x.id === id); if (!r) return;
        if (!['DRAFT', 'FAILED'].includes(r.state)) throw new Error('A submitted payment cannot be discarded; ask a supervisor to reverse it.');
        await writeAll(rows.filter(x => x.id !== id)); });
    },
    /** api.recordPayment must accept the financeApi shape. Returns the updated draft. Never throws for a network drop. */
    async submit(id, api) {
      const cur = await tx(async () => { const rows = await readAll(); const r = rows.find(x => x.id === id); if (!r) throw new Error('Draft not found.');
        if (r.state === 'SUBMITTED') return r; if (r.state === 'SUBMITTING') throw new Error('This draft is already being sent.');
        const i = rows.indexOf(r); rows[i] = { ...r, state: 'SUBMITTING', error: null }; await writeAll(rows); return rows[i]; });
      if (cur.state === 'SUBMITTED') return cur;
      try {
        const res = await api.recordPayment(cur.businessId, cur.studentId, { method: cur.method, amountCents: cur.amountCents, transactionRef: cur.transactionRef, bankAccount: cur.bankAccount,
          depositSlipRef: cur.depositSlipRef, payerName: cur.payerName, payerPhone: cur.payerPhone, notes: cur.notes, clientReference: cur.id });
        return update(id, { state: 'SUBMITTED', serverStatus: res.status, receiptNo: res.receipt_no || null, paymentId: res.payment_id, submittedAt: now() });
      } catch (err) {
        if (isNetworkFailure(err)) return update(id, { state: 'DRAFT', error: 'No connection. Still a draft; try again when you are online.' });
        return update(id, { state: 'FAILED', error: err.message || 'The payment was refused.' });
      }
    },
    async submitAll(tenantId, api) { const out = []; for (const d of (await this.list(tenantId)).filter(r => r.state === 'DRAFT')) out.push(await this.submit(d.id, api)); return out; },
    async counts(tenantId) { const l = await this.list(tenantId); return Object.fromEntries(DRAFT_STATES.map(s => [s, l.filter(r => r.state === s).length])); },
  };
}

/** The words the screen must use. A draft is never described as paid/received. */
export function draftLabel(d) {
  if (d.state === 'DRAFT') return { text: 'Draft - not yet recorded', tone: 'warn', recorded: false };
  if (d.state === 'SUBMITTING') return { text: 'Sending...', tone: 'neutral', recorded: false };
  if (d.state === 'FAILED') return { text: `Refused: ${d.error || 'see message'}`, tone: 'bad', recorded: false };
  if (d.serverStatus === 'CONFIRMED') return { text: `Confirmed - receipt ${d.receiptNo}`, tone: 'good', recorded: true };
  if (d.serverStatus === 'PENDING') return { text: 'Submitted - awaiting confirmation (not yet received)', tone: 'warn', recorded: true };
  return { text: 'Submitted', tone: 'neutral', recorded: true };
}
/** Printable stub for a draft. It says in so many words that it is not a receipt. */
export const draftAcknowledgementText = (d, schoolName = '') =>
  [schoolName, 'DRAFT ACKNOWLEDGEMENT - NOT A RECEIPT', `Student: ${d.studentLabel || d.studentId}`, `Amount noted: KES ${(d.amountCents / 100).toFixed(2)} (${d.method})`,
   `Reference: ${d.id}`, 'This payment has NOT been recorded yet. An official receipt is issued only after it is submitted and confirmed.'].filter(Boolean).join('\n');

// ---- read-only copies for offline viewing ----
/** Online: fetch and save a copy. Offline: the saved copy, marked fromCache. Never invents data. */
export async function studentViewWithCopy({ api, tenantId, businessId, studentId, statementLimit = 100 }) {
  const fetcher = async () => {
    const [account, statement] = await Promise.all([api.studentAccount(businessId, studentId), api.statement(businessId, studentId, { limit: statementLimit })]);
    await saveSnapshot(`elimu_student_view:${studentId}`, tenantId, [{ account, statement }], { complete: statement.length < statementLimit });
    return { account, statement };
  };
  const rt = await readThrough(`elimu_student_view:${studentId}`, fetcher, { tenantId, shape: 'list' });
  const v = rt.fromCache ? rt.result[0] : rt.result;
  return { ...v, fromCache: rt.fromCache, savedAt: rt.savedAt, complete: rt.complete };
}
