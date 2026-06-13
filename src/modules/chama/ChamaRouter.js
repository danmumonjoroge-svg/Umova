import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";

import ChamaPublic from "./ChamaPublic";
import ChamaRegister from "./ChamaRegister";
import ChamaFind from "./ChamaFind";
import ChamaLogin from "./ChamaLogin";
import ChamaDashboard from "./ChamaDashboard";
import { useChama } from "./ChamaContext";

// ─────────────────────────────────────────────
// SAFE PROTECTED ROUTE (FIXED)
// ─────────────────────────────────────────────
function ProtectedRoute({ children }) {
  const { chama, member } = useChama();

  // IMPORTANT: avoid false redirect during hydration
  const isReady = typeof chama !== "undefined" && typeof member !== "undefined";

  if (!isReady) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        Loading chama session...
      </div>
    );
  }

  if (!chama || !member) {
    return <Navigate to="/chama/login" replace />;
  }

  return children;
}

// ─────────────────────────────────────────────
// ROUTER
// ─────────────────────────────────────────────
export default function ChamaRouter() {
  return (
    <Routes>

      {/* PUBLIC */}
      <Route path="/" element={<ChamaPublic />} />
      <Route path="register" element={<ChamaRegister />} />
      <Route path="find" element={<ChamaFind />} />

      {/* LOGIN */}
      <Route path="login" element={<ChamaLogin />} />

      {/* PROTECTED */}
      <Route
        path="home"
        element={
          <ProtectedRoute>
            <ChamaDashboard />
          </ProtectedRoute>
        }
      />

      {/* DEFAULT FALLBACK */}
      <Route path="*" element={<Navigate to="/chama" replace />} />

    </Routes>
  );
}