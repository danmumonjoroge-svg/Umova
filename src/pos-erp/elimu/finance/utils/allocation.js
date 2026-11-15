// Pure mirror of the database allocation policy (E003 _elimu_fin_allocate_student). The DATABASE is authoritative; this exists so the
// cashier screen can PREVIEW "where will this payment go" and so the maths can be unit-tested. It never writes anything.
import { toCents } from './money.js';

export const POLICIES = ['OLDEST_FIRST', 'CURRENT_TERM_FIRST', 'MANUAL_ONLY'];

/**
 * @param {number} amountCents          confirmed money available to allocate
 * @param {Array<{id,due_date,outstanding,period_id,created_at?}>} invoices  open invoices (outstanding may be string or cents-number via asCents)
 * @param {{policy?:string,currentPeriodId?:string}} opts
 * @returns {{allocations:Array<{invoice_id,amount}>, unallocated:number}}  amounts in integer cents
 */
export function planAllocation(amountCents, invoices, { policy = 'OLDEST_FIRST', currentPeriodId = null } = {}) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('Amount must be a positive number of cents.');
  if (!POLICIES.includes(policy)) throw new Error('Unknown allocation policy.');
  if (policy === 'MANUAL_ONLY') return { allocations: [], unallocated: amountCents };
  const open = invoices.map(i => ({ ...i, owed: typeof i.outstanding === 'number' && Number.isInteger(i.outstanding) ? i.outstanding : toCents(i.outstanding) })).filter(i => i.owed > 0);
  open.sort((a, b) => {
    if (policy === 'CURRENT_TERM_FIRST') {
      const ra = a.period_id === currentPeriodId ? 0 : 1, rb = b.period_id === currentPeriodId ? 0 : 1;
      if (ra !== rb) return ra - rb;
    }
    return String(a.due_date).localeCompare(String(b.due_date)) || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || String(a.id).localeCompare(String(b.id));
  });
  let left = amountCents; const allocations = [];
  for (const inv of open) {
    if (left <= 0) break;
    const take = Math.min(left, inv.owed);
    allocations.push({ invoice_id: inv.id, amount: take }); left -= take;
  }
  return { allocations, unallocated: left };
}
