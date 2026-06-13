// ============================================================================
// FILE: src/index.js
// ENTERPRISE SACCO PRODUCTION ENTRY POINT
// STRICT MODE REMOVED TO PREVENT AUTH COLLISION ON REAL-TIME LIFECYCLES
// ============================================================================

import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";
import { AuthProvider } from "./Context/AuthContext";
import "./index.css";

const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <BrowserRouter>
    <AuthProvider>
      <App />
    </AuthProvider>
  </BrowserRouter>
);