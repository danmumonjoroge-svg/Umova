// src/App.js

import React from "react";
import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { useAuth } from "./Context/AuthContext";
import { ChamaProvider } from "./modules/chama/ChamaContext";

import AuthPage      from "./components/Auth/AuthPage";
import AdminLogin    from "./components/Auth/AdminLogin";
import SetPassword   from "./components/Auth/SetPassword";
import PublicSite    from "./Public/PublicSite";

import DashboardMain from "./components/Dashboard/DashboardMain";
import DashboardHome from "./components/Dashboard/DashboardHome";
import Profile       from "./components/Dashboard/Profile";
import Savings       from "./components/Dashboard/Savings";
import ShareCapital  from "./components/Dashboard/ShareCapital";
import Loans         from "./components/Dashboard/Loans";
import Statements    from "./components/Dashboard/Statements";
import ChamaRouter   from "./modules/chama/ChamaRouter";

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

const STAFF_ROLES = ["staff", "admin", "manager", "superadmin", "auditor", "teller"];

// ─────────────────────────────────────────────
// LOADER
// ─────────────────────────────────────────────
function Loader() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-xl p-10 w-[420px] text-center border border-slate-100">
        <div className="w-16 h-16 border-4 border-green-800 border-t-transparent rounded-full animate-spin mx-auto mb-6" />
        <h2 className="text-2xl font-black text-slate-800 tracking-tight">UMOVA ERP SYSTEM</h2>
        <p className="text-slate-500 text-sm mt-2 font-medium">Verifying session...</p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// UNASSIGNED ONBOARDING
// ─────────────────────────────────────────────
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
// MEMBER GUARD
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

  if (loading) return <Loader />;
  if (!user) return <Navigate to="/admin-login" replace />;
  if (!role) return <Loader />;
  if (role === "unassigned") return <Navigate to="/unassigned-onboarding" replace />;
  if (!STAFF_ROLES.includes(role)) return <Navigate to="/member/dashboard" replace />;

  return <Outlet />;
}

// ─────────────────────────────────────────────
// POST LOGIN
// ─────────────────────────────────────────────
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
// LOGIN ROUTES
// ─────────────────────────────────────────────
function AdminLoginRoute() {
  const { user, loading, role } = useAuth();

  if (loading) return <Loader />;
  if (user && role && STAFF_ROLES.includes(role)) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return <AdminLogin />;
}

function MemberLoginRoute() {
  const { user, loading, role } = useAuth();

  if (loading) return <Loader />;
  if (user && role === "member") {
    return <Navigate to="/member/dashboard" replace />;
  }

  return <AuthPage />;
}

// ─────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────
function App() {
  return (
    <ChamaProvider>
      <Routes>

        {/* PUBLIC */}
        <Route path="/" element={<PublicSite />} />
        <Route path="/unassigned-onboarding" element={<UnassignedOnboarding />} />
        <Route path="/set-password" element={<SetPassword />} />

        {/* AUTH */}
        <Route path="/login" element={<MemberLoginRoute />} />
        <Route path="/admin-login" element={<AdminLoginRoute />} />

        {/* CHAMA MODULE (SAFE - NO DOUBLE WRAP ANYMORE) */}
        <Route path="/chama/*" element={<ChamaRouter />} />

        {/* REDIRECT */}
        <Route path="/redirect" element={<PostLoginRedirect />} />

        {/* MEMBER */}
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

        {/* ADMIN */}
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

        {/* FALLBACK */}
        <Route path="*" element={<Navigate to="/" replace />} />

      </Routes>
    </ChamaProvider>
  );
}

export default App;