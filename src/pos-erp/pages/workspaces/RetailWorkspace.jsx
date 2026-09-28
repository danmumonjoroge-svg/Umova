// src/pos-erp/pages/workspaces/RetailWorkspace.jsx
//
// Full-screen Retail landing page (brief section 6). Replaces the old
// expandable "Retail" sidebar group. Every number comes from a service
// that already owns it -- nothing recomputed here:
//   items / suppliers   productService.getAll / supplierService.getAll  (their own `count`)
//   stock alerts        useLowStock()                                    (same hook Home uses)
//   stock value, owed   financialReportsService.getBalanceSheet()        (same as Home)
//   purchase orders     purchaseOrderService.getAll()
// Each stat loads independently; a failed one shows "—", never a made-up number.

import React from 'react';
import { Package, Boxes, ClipboardList, Truck, Users, Wallet } from 'lucide-react';
import { usePosErpAuth } from '../../auth/usePosErpAuth';
import { useLowStock } from '../../hooks/useLowStock';
import { productService } from '../../services/productService';
import { supplierService } from '../../services/supplierService';
import { purchaseOrderService } from '../../services/purchaseService';
import { financialReportsService } from '../../services/financialReportsService';
import { WorkspacePage, CardGrid, ActionCard, ActivityList, Stat, useStat, kes } from '../../components/workspace/WorkspaceKit';

const OPEN_PO = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PARTIALLY_RECEIVED'];
const AWAITING_DELIVERY = ['APPROVED', 'PARTIALLY_RECEIVED'];
const PO_LABEL = {
  DRAFT: 'Draft', PENDING_APPROVAL: 'Waiting approval', APPROVED: 'Approved',
  PARTIALLY_RECEIVED: 'Partly received', RECEIVED: 'Received', CANCELLED: 'Cancelled',
};

export default function RetailWorkspace() {
  const { tenant } = usePosErpAuth();
  const { lowStock, outOfStock, loading: stockLoading, error: stockError } = useLowStock();

  const items = useStat(async () => (await productService.getAll({ limit: 1 })).count ?? 0, []);
  const suppliers = useStat(async () => (await supplierService.getAll({ limit: 1 })).count ?? 0, []);
  const owedSuppliers = useStat(async () => (await supplierService.getWithOutstandingBalances()).length, []);
  const balances = useStat(() => financialReportsService.getBalanceSheet({ tenantId: tenant.id }), [tenant?.id]);
  const pos = useStat(async () => (await purchaseOrderService.getAll({ limit: 100 })).data || [], []);

  const alertCount = lowStock.length + outOfStock.length;
  const openPOs = pos.value ? pos.value.filter((p) => OPEN_PO.includes(p.status)) : null;
  const awaiting = pos.value ? pos.value.filter((p) => AWAITING_DELIVERY.includes(p.status)).length : null;
  const owed = balances.value?.liabilities?.accountsPayable ?? null;

  const recent = (pos.value || []).slice(0, 4).map((p) => ({
    key: p.id,
    primary: `${p.po_number || 'Purchase order'}${p.supplier?.name ? ` · ${p.supplier.name}` : ''}`,
    secondary: PO_LABEL[p.status] || p.status,
    right: p.order_date ? new Date(p.order_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '',
  }));

  return (
    <WorkspacePage title="Retail" subtitle="Everything about what you sell and what you buy.">
      <CardGrid>
        <ActionCard
          variant="feature" span2
          to="/pos/inventory" icon={Boxes} title="My Stock"
          stat={stockLoading ? '…' : stockError ? '—' : alertCount > 0 ? `${alertCount} need attention` : 'All stocked up'}
          description={<>Stock value: <Stat state={balances} format={(b) => kes(b.assets.inventoryValue)} /></>}
          action="View Stock"
        />
        <ActionCard
          to="/pos/products" icon={Package} title="My Items"
          stat={<Stat state={items} />} statLabel="items"
          description="What your business sells: prices, photos, barcodes."
          action="View Items"
        />
        <ActionCard
          to="/pos/purchase-orders" icon={ClipboardList} title="Purchase Orders"
          stat={<Stat state={{ ...pos, value: openPOs ? openPOs.length : null }} />} statLabel="open"
          description="Orders you have placed with suppliers."
          action="View Orders"
        />
        <ActionCard
          to="/pos/goods-receiving" icon={Truck} title="Receive Stock"
          stat={awaiting == null ? '—' : awaiting > 0 ? `${awaiting} waiting` : 'Nothing waiting'}
          description="Record a delivery and add it to your stock."
          action="Receive Stock"
        />
        <ActionCard
          to="/pos/suppliers" icon={Users} title="Suppliers"
          stat={<Stat state={suppliers} />} statLabel="suppliers"
          description="Who you buy from."
          action="View Suppliers"
        />
        <ActionCard
          variant={owed > 0 ? 'alert' : 'default'}
          to="/pos/payables" icon={Wallet} title="People I Owe"
          stat={<Stat state={balances} format={(b) => kes(b.liabilities.accountsPayable)} />}
          statLabel={owedSuppliers.value ? `to ${owedSuppliers.value} supplier${owedSuppliers.value === 1 ? '' : 's'}` : undefined}
          description="Supplier balances you still need to pay."
          action="View Balances"
        />
      </CardGrid>

      <ActivityList
        title="Recent purchase orders" rows={recent}
        emptyText={pos.loading ? 'Loading…' : 'No purchase orders yet.'}
        viewAllTo="/pos/purchase-orders" viewAllLabel="All orders"
      />
    </WorkspacePage>
  );
}
