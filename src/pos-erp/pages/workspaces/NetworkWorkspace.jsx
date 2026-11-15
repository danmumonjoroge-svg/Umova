// src/pos-erp/pages/workspaces/NetworkWorkspace.jsx
// My Business Network landing page: four cards, only the ones this person may use.
// Each live number comes from the same network functions the screens use; a failed one shows "—", never a made-up figure.
import React from 'react';
import { Search, ClipboardList, Users, Store } from 'lucide-react';
import { usePermissions } from '../../navigation/PermissionsContext';
import { networkService } from '../../services/networkService';
import { WorkspacePage, CardGrid, ActionCard, Stat, useStat } from '../../components/workspace/WorkspaceKit';

export default function NetworkWorkspace() {
  const { canAny } = usePermissions();
  const canFind = canAny(['purchases.create', 'inventory.view']);
  const canBuy = canAny(['purchases.create', 'inventory.receive']);
  const canSell = canAny(['sales.view', 'sales.create']);
  const canPublish = canAny(['products.manage']);   // publishing is the point of this card; viewing stock alone does not need it

  const toAnswer = useStat(async () => (canSell ? (await networkService.myOrders('SALES')).filter((o) => o.status === 'AWAITING_CONFIRMATION').length : null), [canSell]);
  const placed = useStat(async () => (canBuy ? (await networkService.myOrders('PURCHASES')).filter((o) => !['RECEIVED', 'CANCELLED'].includes(o.status)).length : null), [canBuy]);
  const asks = useStat(async () => (await networkService.connections()).filter((c) => c.status === 'PENDING' && c.direction === 'RECEIVED').length, []);
  const live = useStat(async () => (canPublish ? (await networkService.myOffers()).filter((o) => o.status === 'ACTIVE').length : null), [canPublish]);

  return (
    <WorkspacePage title="My Business Network" subtitle="Find products from suppliers, order, and track delivery.">
      <CardGrid>
        {canFind && (
          <ActionCard variant="feature" to="/pos/network/find" icon={Search} title="Find Stock"
            stat="Search suppliers" description="See what other businesses offer, compare, and order." action="Find Stock" />
        )}
        {(canBuy || canSell) && (
          <ActionCard to="/pos/network/orders" icon={ClipboardList} title="My Orders"
            stat={canSell ? <Stat state={toAnswer} /> : <Stat state={placed} />} statLabel={canSell ? 'need your answer' : 'open'}
            description="Track purchases and incoming orders." action="View Orders" />
        )}
        <ActionCard to="/pos/network/suppliers" icon={Users} title="My Suppliers"
          stat={<Stat state={asks} />} statLabel="waiting for you" description="Manage supplier connections." action="View" />
        {canPublish && (
          <ActionCard to="/pos/network/offers" icon={Store} title="My Offers"
            stat={<Stat state={live} />} statLabel="live" description="Publish products for other businesses to find." action="Manage Offers" />
        )}
      </CardGrid>
    </WorkspacePage>
  );
}
