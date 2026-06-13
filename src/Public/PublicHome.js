import React from "react";

const PublicHome = () => {
  return (
    <div>

      {/* HERO */}
      <div style={hero}>
        <h1>Build Your Financial Future With Us</h1>
        <p>
          Save. Borrow. Grow. A member-driven SACCO designed to empower
          your financial journey.
        </p>
      </div>

      {/* FEATURES */}
      <div style={grid}>
        <div style={card}>
          <h3>💰 Savings</h3>
          <p>Grow your wealth through disciplined savings.</p>
        </div>

        <div style={card}>
          <h3>🏦 Loans</h3>
          <p>Affordable credit for personal and business needs.</p>
        </div>

        <div style={card}>
          <h3>📊 Shares</h3>
          <p>Own part of the SACCO and earn dividends.</p>
        </div>
      </div>

      {/* FOOTER */}
      <div style={footer}>
        © {new Date().getFullYear()} SACCO. All rights reserved.
      </div>

    </div>
  );
};

const hero = {
  textAlign: "center",
  padding: "90px 20px",
  background: "linear-gradient(135deg,#0f172a,#1e3a8a)",
  color: "white",
};

const grid = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit,minmax(250px,1fr))",
  gap: 20,
  padding: 30,
};

const card = {
  background: "white",
  padding: 20,
  borderRadius: 12,
  boxShadow: "0 4px 10px rgba(0,0,0,0.08)",
};

const footer = {
  textAlign: "center",
  padding: 20,
  background: "#0f172a",
  color: "white",
};

export default PublicHome;