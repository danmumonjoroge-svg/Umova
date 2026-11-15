// src/pos-erp/pages/NetworkOrdersPage.jsx
// My Orders: Purchases (orders I placed) and Sales (orders I received), one screen, only the tabs my permissions allow.
// Cards show the few things that matter (reference, other business, date, total, status) and ONE action.
import React, { useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { FitPage, FilterChips, CardGrid, DataCard, MiniStats, Notice, LoadingBlock, EmptyBlock } from '../components/CardKit';
import OrderDetail from '../components/network/OrderDetail';
import { OfflineBanner, smallPrimary, useLoad, useOnline } from '../components/network/networkKit';
import { usePermissions } from '../navigation/PermissionsContext';
import { networkService } from '../services/networkService';
import { mapNetworkError, money, statusLabel, statusTone } from '../utils/networkHelpers';

const GROUPS = {
  all: () => true,
  waiting: (o) => o.status === 'AWAITING_CONFIRMATION',
  progress: (o) => ['CONFIRMED', 'PREPARING', 'DISPATCHED', 'PARTIALLY_RECEIVED'].includes(o.status),
  done: (o) => ['RECEIVED', 'CANCELLED', 'DISPUTED'].includes(o.status),
};

export default function NetworkOrdersPage() {
  const online = useOnline();
  const { canAny } = usePermissions();
  const tabs = [
    canAny(['purchases.create', 'inventory.receive']) && { key: 'PURCHASES', label: 'Purchases' },
    canAny(['sales.view', 'sales.create']) && { key: 'SALES', label: 'Sales' },
  ].filter(Boolean);
  const [tab, setTab] = useState(tabs[0]?.key || 'PURCHASES');
  const [group, setGroup] = useState('all');
  const [openId, setOpenId] = useState(null);
  const list = useLoad(() => networkService.myOrders(tab), [tab]);

  const rows = useMemo(() => list.data || [], [list.data]);
  const shown = useMemo(() => rows.filter(GROUPS[group]), [rows, group]);
  const needs = rows.filter(GROUPS.waiting).length;
  const err = list.error ? mapNetworkError(list.error) : null;

  if (tabs.length === 0) return <FitPage title="My Orders" icon={ClipboardList}><EmptyBlock>You do not have access to orders. Ask the owner.</EmptyBlock></FitPage>;

  return (
    <FitPage
      title="My Orders"
      icon={ClipboardList}
      subtitle="Orders you placed and orders you received."
      summary={!list.loading && !err && <MiniStats items={[{ label: 'Orders', value: rows.length }, { label: tab === 'SALES' ? 'Need your answer' : 'Waiting for supplier', value: needs, tone: needs ? 'gold' : undefined }]} />}
      toolbar={(
        <div className="space-y-2">
          {tabs.length > 1 && <FilterChips options={tabs} value={tab} onChange={(k) => { setTab(k); setGroup('all'); }} />}
          <FilterChips value={group} onChange={setGroup} options={[{ key: 'all', label: 'All' }, { key: 'waiting', label: 'Waiting' }, { key: 'progress', label: 'In progress' }, { key: 'done', label: 'Finished' }]} />
        </div>
      )}
    >
      {!online && <OfflineBanner />}
      {list.loading && !list.data ? <LoadingBlock />
        : err && !list.data ? <Notice>{err.message} <button type="button" className="underline font-semibold ml-1" onClick={list.reload}>Try again</button></Notice>
        : shown.length === 0 ? <EmptyBlock>{rows.length === 0 ? (tab === 'SALES' ? 'No orders received yet.' : 'You have not placed any network orders yet. Try Find Stock.') : 'Nothing in this group.'}</EmptyBlock>
        : (
          <>
            {err && <Notice tone="gold">Could not refresh. Showing what we found earlier. <button type="button" className="underline font-semibold" onClick={list.reload}>Try again</button></Notice>}
            <CardGrid>
              {shown.map((o) => {
                const answer = tab === 'SALES' && o.status === 'AWAITING_CONFIRMATION';
                return (
                  <DataCard
                    key={o.order_id}
                    alert={answer}
                    title={o.order_ref}
                    subtitle={o.other_name}
                    pill={{ tone: statusTone(o.status), label: statusLabel(o.status, tab) }}
                    big={o.total == null ? { value: 'Price to agree', tone: 'gold' } : { value: money(o.total) }}
                    metrics={[{ label: 'Date', value: new Date(o.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) }, { label: 'Items', value: o.line_count }]}
                    actions={<button type="button" className={smallPrimary} onClick={() => setOpenId(o.order_id)}>{answer ? 'Confirm Order' : 'View Order'}</button>}
                  />
                );
              })}
            </CardGrid>
          </>
        )}
      {openId && <OrderDetail orderId={openId} online={online} onChanged={list.reload} onClose={() => setOpenId(null)} />}
    </FitPage>
  );
}
