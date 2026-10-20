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
import { posSupabase } from "./services/posSupabaseClient";
import AppLock from "../security/AppLock";
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
import StaffPage from "./pages/StaffPage";
import SaleCorrectionsPage from "./pages/SaleCorrectionsPage";
import { RequirePermission } from "./navigation/PermissionsContext";
import { ROUTE_PERMISSIONS } from "./navigation/navConfig";
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
import FoliosPage from "./pages/FoliosPage";
import RoomsWorkspace from "./pages/workspaces/RoomsWorkspace";
import RoomsPage from "./pages/RoomsPage";
import StaysPage from "./pages/StaysPage";
import ProductionWorkspace from "./pages/workspaces/ProductionWorkspace";
import ProductionPage from "./pages/ProductionPage";
import RecipesPage from "./pages/RecipesPage";
import PackagesPage from "./pages/PackagesPage";
import EfficiencyPage from "./pages/EfficiencyPage";
import ReconciliationPage from "./pages/ReconciliationPage";
import HrPage from "./pages/HrPage";
import PayrollPage from "./pages/PayrollPage";
import ControlReportPage from "./pages/ControlReportPage";

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

// Phone-only fingerprint lock for My Business. Sits INSIDE POSAuthGate, so the tenant, staff record and role
// (owner / manager / cashier) are already resolved and unchanged: fingerprint only unlocks the app, it never
// grants extra permissions. Uses the POS Supabase client (separate session) and its own "business" setting.
// On web it renders children untouched.
function PosLock({ children }) {
  const { logout } = usePosErpAuth();
  return (
    <AppLock service="business" client={posSupabase} onSignOut={logout}>
      {children}
    </AppLock>
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
      <Route index element={<RequirePermission perm={["page.sell"]}><POSPage /></RequirePermission>} />
      <Route path="dashboard" element={<POSDashboard />} />

      {/* Workspaces -- one full-screen landing page per module */}
      <Route path="retail" element={<RetailWorkspace />} />
      <Route path="money" element={<MoneyWorkspace />} />
      <Route path="people" element={<PeopleWorkspace />} />
      <Route path="comms" element={<MessagesWorkspace />} />
      <Route path="rentals" element={<RentalsWorkspace />} />
      <Route path="salon" element={<SalonWorkspace />} />
      <Route path="rooms" element={<RoomsWorkspace />} />
      <Route path="production" element={<ProductionWorkspace />} />
      <Route path="more" element={<MoreWorkspace />} />

      <Route path="products" element={<RequirePermission perm={ROUTE_PERMISSIONS["products"]}><ProductsPage /></RequirePermission>} />
      <Route path="customers" element={<RequirePermission perm={ROUTE_PERMISSIONS["customers"]}><CustomersPage /></RequirePermission>} />
      <Route path="folios" element={<RequirePermission perm={ROUTE_PERMISSIONS["folios"]}><FoliosPage /></RequirePermission>} />
      <Route path="room-list" element={<RoomsPage />} />
      <Route path="stays" element={<StaysPage />} />
      <Route path="production-runs" element={<ProductionPage />} />
      <Route path="recipes" element={<RecipesPage />} />
      <Route path="inventory" element={<RequirePermission perm={ROUTE_PERMISSIONS["inventory"]}><InventoryPage /></RequirePermission>} />
      <Route path="purchase-orders" element={<RequirePermission perm={ROUTE_PERMISSIONS["purchase-orders"]}><PurchaseOrdersPage /></RequirePermission>} />
      <Route path="goods-receiving" element={<RequirePermission perm={ROUTE_PERMISSIONS["goods-receiving"]}><GoodsReceivingPage /></RequirePermission>} />
      <Route path="suppliers" element={<RequirePermission perm={ROUTE_PERMISSIONS["suppliers"]}><SuppliersPage /></RequirePermission>} />
      <Route path="payables" element={<RequirePermission perm={ROUTE_PERMISSIONS["payables"]}><PayablesPage /></RequirePermission>} />
      <Route path="expenses" element={<RequirePermission perm={ROUTE_PERMISSIONS["expenses"]}><ExpensesPage /></RequirePermission>} />
      <Route path="equipment" element={<AssetsPage />} />
      <Route path="mpesa" element={<RequirePermission perm={ROUTE_PERMISSIONS["mpesa"]}><MpesaPage /></RequirePermission>} />
      <Route path="cash" element={<RequirePermission perm={ROUTE_PERMISSIONS["cash"]}><CashPage /></RequirePermission>} />
      <Route path="units" element={<UnitsPage />} />
      <Route path="charges" element={<RecurringChargesPage />} />
      <Route path="meters" element={<MetersPage />} />
      <Route path="invoices" element={<InvoicesPage />} />
      <Route path="maintenance" element={<MaintenancePage />} />
      <Route path="services" element={<ServicesPage />} />
      <Route path="activities" element={<ServicesPage />} />
      <Route path="packages" element={<PackagesPage />} />
      <Route path="efficiency" element={<EfficiencyPage />} />
      <Route path="appointments" element={<AppointmentsPage />} />
      <Route path="communication" element={<CommunicationPage />} />
      <Route path="messages" element={<CustomerCommunicationPage />} />
      <Route path="settings" element={<RequirePermission perm={ROUTE_PERMISSIONS["settings"]}><SettingsPage /></RequirePermission>} />
      <Route path="reversals" element={<RequirePermission perm={ROUTE_PERMISSIONS["reversals"]}><SaleCorrectionsPage /></RequirePermission>} />
      <Route path="staff" element={<RequirePermission perm={ROUTE_PERMISSIONS["staff"]}><StaffPage /></RequirePermission>} />
      <Route path="reconcile" element={<RequirePermission perm={ROUTE_PERMISSIONS["reconcile"]}><ReconciliationPage /></RequirePermission>} />
      <Route path="hr" element={<RequirePermission perm={ROUTE_PERMISSIONS["hr"]}><HrPage /></RequirePermission>} />
      <Route path="payroll" element={<RequirePermission perm={ROUTE_PERMISSIONS["payroll"]}><PayrollPage /></RequirePermission>} />
      <Route path="control" element={<RequirePermission perm={ROUTE_PERMISSIONS["control"]}><ControlReportPage /></RequirePermission>} />
      <Route path="audit" element={<RequirePermission perm={ROUTE_PERMISSIONS["audit"]}><AuditPage /></RequirePermission>} />
      <Route path="financials" element={<RequirePermission perm={ROUTE_PERMISSIONS["financials"]}><FinancialReportsPage /></RequirePermission>} />
      <Route path="reports" element={<RequirePermission perm={ROUTE_PERMISSIONS["reports"]}><ReportsPage /></RequirePermission>} />
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
          <PosLock>
            <PosRoutes />
          </PosLock>
        </POSAuthGate>
      )}
    </POSAuthProvider>
  );
}
