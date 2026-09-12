// src/App.js

import React from "react";
import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth, STAFF_ROLES } from "./Context/AuthContext";

import AuthPage        from "./components/Auth/AuthPage";
import AdminLogin      from "./components/Auth/AdminLogin";
import UnifiedLogin     from "./components/Auth/UnifiedLogin";
import RegisterPOSUser  from "./components/Auth/RegisterPOSUser";
import SetPassword     from "./components/Auth/SetPassword";
import PublicSite      from "./Public/PublicSite";
import UmovaFinancialPage from "./Public/UmovaFinancialPage";

import DashboardMain from "./components/Dashboard/DashboardMain";
import DashboardHome from "./components/Dashboard/DashboardHome";
import Profile       from "./components/Dashboard/Profile";
import Savings       from "./components/Dashboard/Savings";
import ShareCapital  from "./components/Dashboard/ShareCapital";
import Loans         from "./components/Dashboard/Loans";
import Statements    from "./components/Dashboard/Statements";

// ─────────────────────────────────────────────
// CHAMA ERP ADVANCED
// Fully self-contained: its own login (phone + password, multi-chama
// select, license gate) and its own dashboard, built entirely from
// src/chama-erp-advanced/. Nothing from the old chama module
// (ChamaRouter.js, ChamaDashboard.js, chamamembers.js, etc.) is imported
// anywhere in this file anymore — that folder can be deleted from disk.
// ─────────────────────────────────────────────
import { ChamaProvider }        from "./chama-erp-advanced/ChamaContext";
import AuthGate                 from "./chama-erp-advanced/auth/AuthGate";
import ChamaDashboardAdvanced   from "./chama-erp-advanced/ChamaDashboardAdvanced";
import PlatformAdminGate        from "./chama-erp-advanced/platform-admin/PlatformAdminGate";
import LicenseManager           from "./chama-erp-advanced/platform-admin/LicenseManager";

import AdminLayout            from "./Pages/Admin/AdminLayout";
import AdminDashboard         from "./Pages/Admin/Dashboard";
import AdminERPDashboard      from "./Pages/Admin/ERPDashboard";
import AdminMembers           from "./Pages/Admin/Members";
import AdminMemberStatements  from "./Pages/Admin/MemberStatements";
import AdminLoans             from "./Pages/Admin/Loans";
import AdminLoanApplication   from "./Pages/Admin/LoanApplication";
import AdminLoanApproval      from "./Pages/Admin/LoanApproval";
import AdminLoanDisbursement  from "./Pages/Admin/LoanDisbursement";
import AdminLoanRepayments    from "./Pages/Admin/LoanRepayments";
import AdminLoanSchedule      from "./Pages/Admin/LoanSchedule";
import AdminLoanPenalties     from "./Pages/Admin/LoanPenalties";
import AdminInterestDashboard from "./Pages/Admin/InterestDashboard";
import AdminTrialBalance      from "./Pages/Admin/TrialBalance";
import AdminIncomeStatement   from "./Pages/Admin/IncomeStatement";
import AdminBalanceSheet      from "./Pages/Admin/BalanceSheet";
import AdminReports           from "./Pages/Admin/Reports";
import AdminPayments          from "./Pages/Admin/Payments";
import AdminSettings          from "./Pages/Admin/Settings";
import AdminStoryDashboard    from "./Pages/Admin/StoryDashboard";
import POSRegistrationRequests from "./Pages/Admin/POSRegistrationRequests";

// ─────────────────────────────────────────────
// POS / INVENTORY (Universal Scanning Engine)
// No longer staff-only / no longer under StaffGuard — POS is now an
// independent tenant-based ERP with its own auth (POSAuthProvider +
// POSAuthGate, real Supabase Auth session on a SEPARATE client so it
// never collides with a staff member's session in the same browser —
// see src/pos-erp/services/posSupabaseClient.js). POSApp is
// self-contained, mirroring chama-erp-advanced: App.js just mounts it.
// ─────────────────────────────────────────────
import POSApp from "./pos-erp/POSApp";

// Platform-admin control over POS *businesses* (pos_tenants/pos_staff)
// — approve/reject/suspend/reactivate + manually add one. Separate
// from POSRegistrationRequests below, which is a different, older
// mechanism (see the note in POSTenants.js).
import POSTenants from "./Pages/Admin/POSTenants";

// Consolidated POS admin hub — pending counts + links into POSTenants
// and POSRegistrationRequests, so there's one findable landing page
// instead of a single ad-hoc button on the SACCO Dashboard. See the
// note at the bottom of POSTenants.js: this doesn't retire either of
// the two mechanisms below, it just makes both visible in one place.
import POSAdminDashboard from "./Pages/Admin/POSAdminDashboard";

// STAFF_ROLES is imported from AuthContext.js — single source of truth,
// also used by AdminLogin.js so the pre-signin role gate and the post-
// signin routing gate never disagree.

// ─────────────────────────────────────────────
// UI LOADER
// ─────────────────────────────────────────────
function Loader() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl p-10 w-[420px] text-center border border-slate-100">
        <div className="w-16 h-16 border-4 border-emerald-800 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">UMOVA ERP SYSTEM</h2>
        <p className="text-slate-500 text-sm mt-2 font-medium">Verifying workspace integrity...</p>
      </div>
    </div>
  );
}

function UnassignedOnboarding() {
  const { logout } = useAuth();
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl p-10 w-[500px] text-center border border-slate-100">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">Account Profile Missing</h2>
        <p className="text-slate-500 text-sm mt-3 leading-relaxed">
          Your credentials are authenticated but your account UID is not linked
          to an active record in the <span className="font-bold text-slate-700">members</span> or{" "}
          <span className="font-bold text-slate-700">users</span> tables.
        </p>
        <button
          onClick={logout}
          className="mt-6 w-full bg-red-500 hover:bg-red-600 text-white font-bold py-3 px-6 rounded-2xl transition shadow-md"
        >
          Disconnect Session
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// GUARDS
// ─────────────────────────────────────────────
function MemberGuard() {
  const { user, loading, role } = useAuth();

  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!role) return <Loader />;
  if (role === "unassigned") return <Navigate to="/unassigned-onboarding" replace />;
  if (STAFF_ROLES.includes(role)) return <Navigate to="/admin/dashboard" replace />;
  if (role !== "member") return <Navigate to="/login" replace />;

  return <Outlet />;
}

// ─────────────────────────────────────────────
// STAFF GUARD
// ─────────────────────────────────────────────
function StaffGuard() {
  const { user, loading, role } = useAuth();
  const location = useLocation();

  if (loading) return <Loader />;
  if (!user) return <Navigate to="/admin-login" state={{ from: location.pathname }} replace />;
  if (!role) return <Loader />;
  if (role === "unassigned") return <Navigate to="/unassigned-onboarding" replace />;
  if (!STAFF_ROLES.includes(role)) return <Navigate to="/member/dashboard" replace />;

  return <Outlet />;
}

// ─────────────────────────────────────────────
// ADMIN-LEVEL GUARD (for approving POS registration requests, POS
// business approvals, and the POS admin hub — anything that controls
// another staff/business's access, not just the signed-in staffer's
// own work)
// ─────────────────────────────────────────────
function AdminLevelGuard() {
  const { user, loading, role } = useAuth();
  const location = useLocation();
  const APPROVER_ROLES = ["admin", "superadmin", "manager"];

  if (loading) return <Loader />;
  if (!user) return <Navigate to="/admin-login" state={{ from: location.pathname }} replace />;
  if (!role) return <Loader />;
  if (!APPROVER_ROLES.includes(role)) return <Navigate to="/admin/dashboard" replace />;

  return <Outlet />;
}

function PostLoginRedirect() {
  const { user, loading, role } = useAuth();

  if (loading) return <Loader />;
  if (!user) return <Navigate to="/login" replace />;
  if (!role) return <Loader />;

  if (role === "unassigned") return <Navigate to="/unassigned-onboarding" replace />;
  if (role === "member") return <Navigate to="/member/dashboard" replace />;
  if (STAFF_ROLES.includes(role)) return <Navigate to="/admin/dashboard" replace />;

  return <Navigate to="/" replace />;
}

// ─────────────────────────────────────────────
// LOGIN ROUTE WRAPPERS
// Each redirects an already-signed-in user straight past the login
// screen; otherwise renders the screen itself.
// ─────────────────────────────────────────────
function UnifiedLoginRoute() {
  // Primary entry point — handles staff codes and member codes from one
  // screen. POS no longer goes through here at all: it has its own
  // entry point at /pos (see PublicSite.js's "POS Login" button, which
  // now navigates straight to /pos instead of here).
  const { user, loading, role } = useAuth();
  const location = useLocation();
  const from = location.state?.from || "/admin/dashboard";

  if (loading) return <Loader />;

  if (user && role && STAFF_ROLES.includes(role)) {
    return <Navigate to={from} replace />;
  }
  if (user && role === "member") {
    return <Navigate to="/member/dashboard" replace />;
  }

  return <UnifiedLogin />;
}

function AdminLoginRoute() {
  // Kept as a direct-to-staff-only fallback (e.g. bookmarked links) —
  // UnifiedLogin at /login is the primary staff entry point now.
  const { user, loading, role } = useAuth();
  const location = useLocation();
  const from = location.state?.from || "/admin/dashboard";

  if (loading) return <Loader />;

  if (user && role && STAFF_ROLES.includes(role)) {
    return <Navigate to={from} replace />;
  }
  if (user && role === "member") {
    return <Navigate to="/member/dashboard" replace />;
  }

  return <AdminLogin />;
}

function MemberLoginRoute() {
  // First-time setup / password reset flow, now at /member-login.
  // UnifiedLogin's "Set up / reset here" link and its NEEDS_SETUP
  // fallback both navigate here.
  const { user, loading, role } = useAuth();

  if (loading) return <Loader />;

  if (user && role === "member") {
    return <Navigate to="/member/dashboard" replace />;
  }
  if (user && role && STAFF_ROLES.includes(role)) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return <AuthPage />;
}

// ─────────────────────────────────────────────
// ENGINE CORE
// ─────────────────────────────────────────────
function App() {
  return (
    <Routes>
      <Route path="/" element={<PublicSite />} />

      {/* Umova Financial — savings/loans/investment product page. Split out
          of "/" when Umova became a 3-product umbrella (Financial, Chama,
          POS); "/" is now just the overview that links into each. */}
      <Route path="/financial" element={<UmovaFinancialPage />} />

      <Route path="/unassigned-onboarding" element={<UnassignedOnboarding />} />
      <Route path="/set-password" element={<SetPassword />} />

      {/* /login is the primary entry point for members, staff, and POS —
          see UnifiedLoginRoute above. /member-login and /admin-login are
          kept as direct fallbacks for their respective single-purpose
          screens. */}
      <Route path="/login" element={<UnifiedLoginRoute />} />
      <Route path="/member-login" element={<MemberLoginRoute />} />
      <Route path="/admin-login" element={<AdminLoginRoute />} />
      <Route path="/register-pos" element={<RegisterPOSUser />} />

      {/*
        Chama ERP Advanced — self-contained: its own provider, its own
        login gate, its own dashboard. AuthGate handles phone+password
        login, multi-chama selection, and license checking on its own;
        ChamaDashboardAdvanced only ever renders once all three have
        passed. No route matching inside — it's a single-page sidebar
        dashboard, not a sub-router, so "/chama" is enough (no /*).
      */}
      <Route
        path="/chama"
        element={
          <ChamaProvider>
            <AuthGate>
              <ChamaDashboardAdvanced />
            </AuthGate>
          </ChamaProvider>
        }
      />

      {/*
        Platform-level chama licensing. Deliberately outside ChamaProvider/
        AuthGate — this is what turns a chama's license on in the first
        place, so it can't depend on a chama already being logged into.
        Gated by a single shared key (REACT_APP_PLATFORM_ADMIN_KEY), not a
        real login — see PlatformAdminGate.js for why, and what to replace
        it with before more than one person needs access.
      */}
      <Route
        path="/platform-admin"
        element={
          <PlatformAdminGate>
            <LicenseManager />
          </PlatformAdminGate>
        }
      />

      <Route path="/redirect" element={<PostLoginRedirect />} />

      <Route path="/member" element={<MemberGuard />}>
        <Route element={<DashboardMain />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<DashboardHome />} />
          <Route path="profile" element={<Profile />} />
          <Route path="savings" element={<Savings />} />
          <Route path="shares" element={<ShareCapital />} />
          <Route path="loans" element={<Loans />} />
          <Route path="statement" element={<Statements />} />
        </Route>
      </Route>

      <Route path="/admin" element={<StaffGuard />}>
        <Route element={<AdminLayout />}>
          <Route index element={<Navigate to="dashboard" replace />} />
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="erp-dashboard" element={<AdminERPDashboard />} />
          <Route path="members" element={<AdminMembers />} />
          <Route path="member-statements" element={<AdminMemberStatements />} />
          <Route path="loans" element={<AdminLoans />} />
          <Route path="loan-application" element={<AdminLoanApplication />} />
          <Route path="loan-approval" element={<AdminLoanApproval />} />
          <Route path="loan-disbursement" element={<AdminLoanDisbursement />} />
          <Route path="loan-repayments" element={<AdminLoanRepayments />} />
          <Route path="loan-schedule" element={<AdminLoanSchedule />} />
          <Route path="loan-penalties" element={<AdminLoanPenalties />} />
          <Route path="interest-dashboard" element={<AdminInterestDashboard />} />
          <Route path="trial-balance" element={<AdminTrialBalance />} />
          <Route path="income-statement" element={<AdminIncomeStatement />} />
          <Route path="balance-sheet" element={<AdminBalanceSheet />} />
          <Route path="reports" element={<AdminReports />} />
          <Route path="payments" element={<AdminPayments />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="stories" element={<AdminStoryDashboard />} />
        </Route>
      </Route>

      {/* POS is intentionally OUTSIDE StaffGuard/AdminLayout — it has
          its own tenant-scoped auth (see POSApp.jsx). A POS cashier is
          not a StaffGuard-recognized role at all; they never touch
          the main users/members tables. */}
      <Route path="/pos/*" element={<POSApp />} />

      {/* Consolidated POS admin hub — pending-count overview + links
          into POS Businesses and POS Requests below. This is the page
          Dashboard.jsx's "POS Businesses" button now points at, instead
          of jumping straight into POSTenants with no other POS nav
          visible anywhere. */}
      <Route path="/admin/pos" element={<AdminLevelGuard />}>
        <Route element={<AdminLayout />}>
          <Route index element={<POSAdminDashboard />} />
        </Route>
      </Route>

      {/* Platform-admin management of POS tenants (approve/reject/
          suspend/reactivate/create) — gated the same way as the
          POS-requests block below, via the main app's own admin roles,
          since this controls a business's ability to use POS at all,
          not POS's own internals. */}
      <Route path="/admin/pos-tenants" element={<AdminLevelGuard />}>
        <Route element={<AdminLayout />}>
          <Route index element={<POSTenants />} />
        </Route>
      </Route>

      {/* Approving new POS/staff registration requests — restricted to
          admin/superadmin/manager, separate from the general StaffGuard
          block above since ordinary staff shouldn't approve their own
          peers' accounts. */}
      <Route path="/admin/pos-requests" element={<AdminLevelGuard />}>
        <Route element={<AdminLayout />}>
          <Route index element={<POSRegistrationRequests />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
