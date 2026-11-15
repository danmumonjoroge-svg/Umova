// src/pos-erp/pages/PayablesPage.jsx
//
// Phase 3 — the one real gap found in an otherwise-already-built
// purchasing/inventory layer: supplierService.getWithOutstandingBalances()
// existed but was only ever called by notificationsService.js for alerts,
// never surfaced as a browsable view (brief §36).
//
// NOT built as a per-invoice/per-GRN aging table with a "due date" column,
// even though that's closer to the brief's literal wording — confirmed
// against the live schema that neither lb_goods_received_notes nor
// lb_purchase_orders has a due_date column, and lb_suppliers.payment_terms
// is a plain per-supplier default (e.g. "Net 30"), not a per-invoice due
// date to compute aging from. Building a fabricated due-date/aging column
// with nothing real behind it would be worse than not having one — it
// would look authoritative and be wrong. This is a supplier-level
// outstanding-balance list instead; drilling into a supplier reuses the
// exact same detail drawer SuppliersPage.jsx already has (GRNs, POs,
// payments, returns) for itemized detail.
//
// Phase 10 adds a "Remind" action, the supplier mirror of §7's "Remind
// John" on CustomersPage — same WhatsApp machinery, same Prepared →
// Opened in WhatsApp → Sent by you states, same refusal on an
// unparseable phone number. The SUPPLIER_PAYMENT_DUE template
// deliberately has no due-date wording for the same reason this page's
// own header note gives: nothing in this schema has a real per-invoice
// due date to put there.

import React, { useEffect, useState, useCallback } from 'react';
import { Wallet } from 'lucide-react';
import { FitPage, MiniStats, SearchBox, CardGrid, DataCard, IconTile, TextBtn, Notice, LoadingBlock, EmptyBlock } from '../components/CardKit';
import { supplierService } from '../services/supplierService';
import { SupplierDetailDrawer } from './SuppliersPage';
import ContactActions from '../components/ContactActions';

export default function PayablesPage() {
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [search, setSearch] = useState('');

  // Supplier follow-ups use the shared MessageComposer (ContactActions) so the wording and amounts come from the records.

  const fetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await supplierService.getWithOutstandingBalances();
      setSuppliers(data || []);
    } catch (err) {
      console.error('[PayablesPage] fetch failed:', err);
      setError(err.message || 'Failed to load payables.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const total = suppliers.reduce((s, x) => s + Number(x.outstanding_balance || 0), 0);

  const shown = suppliers.filter((x) => !search || x.name?.toLowerCase().includes(search.toLowerCase()));
  const overLimit = suppliers.filter((x) => Number(x.credit_limit) > 0 && Number(x.outstanding_balance) > Number(x.credit_limit)).length;

  return (
    <FitPage
      title="People I Owe"
      icon={Wallet}
      subtitle="Suppliers you currently owe money to."
      summary={!loading && (
        <MiniStats items={[
          { label: 'Suppliers owed', value: suppliers.length },
          { label: 'Over limit', value: overLimit, tone: overLimit ? 'bad' : undefined },
          { label: 'Total outstanding', value: total.toLocaleString(), tone: total ? 'bad' : 'good' },
        ]} />
      )}
      toolbar={<SearchBox value={search} onChange={setSearch} placeholder="Search suppliers…" />}
    >
      {error && <Notice>{error}</Notice>}

      {loading ? <LoadingBlock text="Loading payables…" /> : shown.length === 0 ? (
        <EmptyBlock>{suppliers.length === 0 ? 'Nothing outstanding — all suppliers are paid up.' : 'No suppliers match.'}</EmptyBlock>
      ) : (
        <CardGrid>
          {shown.map((s) => {
            return (
              <DataCard
                key={s.id}
                alert
                onClick={() => setSelectedSupplier(s)}
                thumb={<IconTile icon={Wallet} tone="gold" />}
                title={s.name}
                subtitle={s.contact_person || s.phone || 'No contact'}
                big={{ value: Number(s.outstanding_balance || 0).toLocaleString(), tone: 'bad', label: 'owed' }}
                metrics={[
                  { label: 'Credit limit', value: Number(s.credit_limit || 0).toLocaleString() },
                  { label: 'Phone', value: s.phone || '—' },
                ]}
                actions={(
                  <>
                    <TextBtn tone="gold" onClick={() => setSelectedSupplier(s)}>View &amp; pay</TextBtn>
<ContactActions size="sm" recipient={{ kind: 'SUPPLIER', id: s.id, name: s.name, phone: s.phone, email: s.email }} purpose="SUPPLIER_BALANCE" />
                  </>
                )}
              />
            );
          })}
        </CardGrid>
      )}

      {selectedSupplier && (
        <SupplierDetailDrawer
          supplier={selectedSupplier}
          onClose={() => setSelectedSupplier(null)}
          onPaymentRecorded={fetch}
        />
      )}
    </FitPage>
  );
}
