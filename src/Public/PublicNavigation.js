import React from "react";

const PublicNavigation = ({ setPage, current, onLogin }) => {
  return (
    <div style={nav}>
      <div style={{ fontSize: 20, fontWeight: "bold" }}>🏦 SACCO</div>

      <div style={menu}>
        <button style={btn(current === "home")} onClick={() => setPage("home")}>
          Home
        </button>

        <button style={btn(current === "loans")} onClick={() => setPage("loans")}>
          Loans
        </button>

        <button style={btn(current === "savings")} onClick={() => setPage("savings")}>
          Savings
        </button>

        <button
          style={btn(current === "membership")}
          onClick={() => setPage("membership")}
        >
          Membership
        </button>

        {/* 🔥 LOGIN BUTTON */}
        <button style={loginBtn} onClick={onLogin}>
          Login
        </button>
      </div>
    </div>
  );
};

export default PublicNavigation;

/* ================= styles ================= */

const nav = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "15px 25px",
  background: "#0f172a",
  color: "white",
};

const menu = {
  display: "flex",
  gap: 10,
  alignItems: "center",
};

const btn = (active) => ({
  padding: "8px 12px",
  borderRadius: 6,
  border: "none",
  cursor: "pointer",
  background: active ? "#2563eb" : "#1f2937",
  color: "white",
});

const loginBtn = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "none",
  background: "#10b981",
  color: "white",
  cursor: "pointer",
  marginLeft: 10,
};