// src/pos-erp/POSPreview.js
//
// TEMPORARY, DEV-ONLY. Mounts the POS pages directly with hardcoded IDs —
// no auth, no guard, no login. Purely so you can look at the UI while the
// auth-system decision (my users/branches version vs. the RPC/tenant
// POSAuthContext.js) is still open. Delete this file and its route once
// that's settled — it has zero access control and must never ship.

import React, { useState } from "react";
import POSPage from "./pages/POSPage";
import ProductsPage from "./pages/ProductsPage";
import GoodsReceivingPage from "./pages/GoodsReceivingPage";

// Swap these for any real IDs you have rows for — these are the ones
// from the seed_test_pos_user.sql script earlier in this conversation.
const PREVIEW_BUSINESS_ID = "35ee4d25-6189-4670-b9a8-32b5ef36fae4";
const PREVIEW_BRANCH_ID = "1cada3b3-be37-4a3c-97ed-2d8c009cd604";

const TABS = {
  pos: { label: "POS / Till", Component: POSPage },
  products: { label: "Products", Component: ProductsPage },
  goods: { label: "Goods Receiving", Component: GoodsReceivingPage },
};

export default function POSPreview() {
  const [tab, setTab] = useState("pos");
  const { Component } = TABS[tab];

  return (
    <div>
      <div style={{
        display: "flex", gap: 8, padding: 12,
        background: "#111827", position: "sticky", top: 0, zIndex: 10,
      }}>
        <span style={{ color: "#f87171", fontWeight: 700, fontSize: 12, alignSelf: "center", marginRight: 12 }}>
          ⚠ PREVIEW MODE — NO AUTH
        </span>
        {Object.entries(TABS).map(([key, { label }]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              padding: "8px 14px", borderRadius: 10, border: "none", cursor: "pointer",
              fontWeight: 600, fontSize: 13,
              background: tab === key ? "#059669" : "#1f2937",
              color: "#fff",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <Component businessId={PREVIEW_BUSINESS_ID} branchId={PREVIEW_BRANCH_ID} />
    </div>
  );
}
