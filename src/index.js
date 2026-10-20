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
import { ChamaProvider } from "./chama-erp-advanced/ChamaContext";
import "./index.css";
import { registerServiceWorker } from "./offline/registerServiceWorker";

const root = ReactDOM.createRoot(document.getElementById("root"));

root.render(
  <BrowserRouter>
    <AuthProvider>
      {/* ChamaProvider now wraps the whole app, not just /chama — the
          unified login screen (UnifiedLogin.js, at /login) needs
          useChama() for its phone-number login path. */}
      <ChamaProvider>
        <App />
      </ChamaProvider>
    </AuthProvider>
  </BrowserRouter>
);

// Offline mode: lets the app open with no internet (see src/offline/registerServiceWorker.js and public/service-worker.js).
registerServiceWorker();
