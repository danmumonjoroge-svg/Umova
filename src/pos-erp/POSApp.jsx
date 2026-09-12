// src/pos-erp/POSApp.jsx
//
// UPDATED: added "inventory" route.

import React from "react";
import { Routes, Route } from "react-router-dom";
import { POSAuthProvider } from "./context/POSAuthContext";
import POSAuthGate from "./auth/POSAuthGate";
import POSLayout from "./POSLayout";
import POSDashboard from "./pages/POSDashboard";
import POSPage from "./pages/POSPage";
import ProductsPage from "./pages/ProductsPage";
import CustomersPage from "./pages/CustomersPage";
import PayablesPage from "./pages/PayablesPage";
import ExpensesPage from "./pages/ExpensesPage";
import CashPage from "./pages/CashPage";
import UnitsPage from "./pages/UnitsPage";
import RecurringChargesPage from "./pages/RecurringChargesPage";
import MetersPage from "./pages/MetersPage";
import ServicesPage from "./pages/ServicesPage";
import AppointmentsPage from "./pages/AppointmentsPage";
import GoodsReceivingPage from "./pages/GoodsReceivingPage";
import SuppliersPage from "./pages/SuppliersPage";
import CommunicationPage from "./pages/CommunicationPage";
import CustomerCommunicationPage from "./pages/CustomerCommunicationPage";
import SettingsPage from "./pages/SettingsPage";
import AuditPage from "./pages/AuditPage";
import FinancialReportsPage from "./pages/FinancialReportsPage";
import ReportsPage from "./pages/ReportsPage";
import InventoryPage from "./pages/InventoryPage";

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

const PosRoutes = () => (
  <Routes>
    <Route element={<POSLayout />}>
      <Route index element={<POSPage />} />
      <Route path="dashboard" element={<POSDashboard />} />
      <Route path="products" element={<ProductsPage />} />
      <Route path="customers" element={<CustomersPage />} />
      <Route path="inventory" element={<InventoryPage />} />
      <Route path="goods-receiving" element={<GoodsReceivingPage />} />
      <Route path="suppliers" element={<SuppliersPage />} />
      <Route path="payables" element={<PayablesPage />} />
      <Route path="expenses" element={<ExpensesPage />} />
      <Route path="cash" element={<CashPage />} />
      <Route path="units" element={<UnitsPage />} />
      <Route path="charges" element={<RecurringChargesPage />} />
      <Route path="meters" element={<MetersPage />} />
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
