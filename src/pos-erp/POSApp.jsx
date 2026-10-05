// src/pos-erp/POSApp.jsx
//
// "My Business" routing. Every pre-existing route below is unchanged.
// NEW: one full-screen workspace per module (retail, money, people,
// comms, rentals, salon, more) -- the landing page each sidebar/bottom-
// bar entry opens (see navigation/navConfig.js). Ordinary React Router
// routes, so browser back behaves normally.

import React from "react";
import { Routes, Route } from "react-router-dom";
import { POSAuthProvider } from "./context/POSAuthContext";
import POSAuthGate from "./auth/POSAuthGate";
import { usePosErpAuth } from "./auth/usePosErpAuth";
import { isDemoTenant, seedDemoDataIfEmpty } from "./auth/demoAccount";
import POSLayout from "./POSLayout";
import POSDashboard from "./pages/POSDashboard";
import POSPage from "./pages/POSPage";
import ProductsPage from "./pages/ProductsPage";
import CustomersPage from "./pages/CustomersPage";
import PayablesPage from "./pages/PayablesPage";
import ExpensesPage from "./pages/ExpensesPage";
import AssetsPage from "./pages/AssetsPage";
import MpesaPage from "./pages/MpesaPage";
import CashPage from "./pages/CashPage";
import UnitsPage from "./pages/UnitsPage";
import RecurringChargesPage from "./pages/RecurringChargesPage";
import MetersPage from "./pages/MetersPage";
import InvoicesPage from './pages/InvoicesPage';
import MaintenancePage from './pages/MaintenancePage';
import ServicesPage from "./pages/ServicesPage";
import AppointmentsPage from "./pages/AppointmentsPage";
import GoodsReceivingPage from "./pages/GoodsReceivingPage";
import SuppliersPage from "./pages/SuppliersPage";
import CommunicationPage from "./pages/CommunicationPage";
import CustomerCommunicationPage from "./pages/CustomerCommunicationPage";
import SettingsPage from "./pages/SettingsPage";
import AuditPage from "./pages/AuditPage";
import FinancialReportsPage from "./pages/FinancialReportsPage";
import PurchaseOrdersPage from "./pages/PurchaseOrdersPage";
import ReportsPage from "./pages/ReportsPage";
import InventoryPage from "./pages/InventoryPage";
import RetailWorkspace from "./pages/workspaces/RetailWorkspace";
import MoneyWorkspace from "./pages/workspaces/MoneyWorkspace";
import PeopleWorkspace from "./pages/workspaces/PeopleWorkspace";
import MessagesWorkspace from "./pages/workspaces/MessagesWorkspace";
import RentalsWorkspace from "./pages/workspaces/RentalsWorkspace";
import SalonWorkspace from "./pages/workspaces/SalonWorkspace";
import MoreWorkspace from "./pages/workspaces/MoreWorkspace";

const SKIP_AUTH = process.env.REACT_APP_POS_SKIP_AUTH === "true";

function DevBypassBanner() {
  return (
    <div style={{
      background: "#7f1d1d", color: "#fff", fontWeight: 700, fontSize: 12,
      textAlign: "center", padding: "6px 12px", letterSpacing: 0.3,
    }}>
      ⚠ POS AUTH BYPASSED (REACT_APP_POS_SKIP_AUTH=true) — DEV ONLY, REMOVE BEFORE SHIP
    </div>
  );
}

// Fills the DEMO business with sample data on its first login (no-op for
// every other tenant, and for DEMO once it has products). See auth/demoAccount.js.
function DemoSeeder() {
  const { tenant, staffId } = usePosErpAuth();
  const [seeding, setSeeding] = React.useState(false);
  const started = React.useRef(false);
  React.useEffect(() => {
    if (started.current || !isDemoTenant(tenant) || !staffId) return;
    started.current = true;
    setSeeding(true);
    seedDemoDataIfEmpty({ tenant, staffId }).then((r) => {
      setSeeding(false);
      if (r.seeded) window.location.reload(); // pages loaded before the data existed — refetch
    });
  }, [tenant, staffId]);
  if (!seeding) return null;
  return (
    <div style={{ background: "#78350f", color: "#fff", fontSize: 12, fontWeight: 700, textAlign: "center", padding: "6px 12px" }}>
      Setting up your demo shop with sample stock, customers and sales…
    </div>
  );
}

const PosRoutes = () => (
  <>
    <DemoSeeder />
    <PosRoutesInner />
  </>
);

const PosRoutesInner = () => (
  <Routes>
    <Route element={<POSLayout />}>
      <Route index element={<POSPage />} />
      <Route path="dashboard" element={<POSDashboard />} />

      {/* Workspaces -- one full-screen landing page per module */}
      <Route path="retail" element={<RetailWorkspace />} />
      <Route path="money" element={<MoneyWorkspace />} />
      <Route path="people" element={<PeopleWorkspace />} />
      <Route path="comms" element={<MessagesWorkspace />} />
      <Route path="rentals" element={<RentalsWorkspace />} />
      <Route path="salon" element={<SalonWorkspace />} />
      <Route path="more" element={<MoreWorkspace />} />

      <Route path="products" element={<ProductsPage />} />
      <Route path="customers" element={<CustomersPage />} />
      <Route path="inventory" element={<InventoryPage />} />
      <Route path="purchase-orders" element={<PurchaseOrdersPage />} />
      <Route path="goods-receiving" element={<GoodsReceivingPage />} />
      <Route path="suppliers" element={<SuppliersPage />} />
      <Route path="payables" element={<PayablesPage />} />
      <Route path="expenses" element={<ExpensesPage />} />
      <Route path="equipment" element={<AssetsPage />} />
      <Route path="mpesa" element={<MpesaPage />} />
      <Route path="cash" element={<CashPage />} />
      <Route path="units" element={<UnitsPage />} />
      <Route path="charges" element={<RecurringChargesPage />} />
      <Route path="meters" element={<MetersPage />} />
      <Route path="invoices" element={<InvoicesPage />} />
      <Route path="maintenance" element={<MaintenancePage />} />
      <Route path="services" element={<ServicesPage />} />
      <Route path="appointments" element={<AppointmentsPage />} />
      <Route path="communication" element={<CommunicationPage />} />
      <Route path="messages" element={<CustomerCommunicationPage />} />
      <Route path="settings" element={<SettingsPage />} />
      <Route path="audit" element={<AuditPage />} />
      <Route path="financials" element={<FinancialReportsPage />} />
      <Route path="reports" element={<ReportsPage />} />
    </Route>
  </Routes>
);

export default function POSApp() {
  return (
    <POSAuthProvider>
      {SKIP_AUTH ? (
        <>
          <DevBypassBanner />
          <PosRoutes />
        </>
      ) : (
        <POSAuthGate>
          <PosRoutes />
        </POSAuthGate>
      )}
    </POSAuthProvider>
  );
}
