import React from "react";
import { useNavigate } from "react-router-dom";
import "./ChamaPublic.css";

export default function ChamaPublic() {
  const navigate = useNavigate();

  return (
    <div className="chama-public">

      {/* HERO SECTION */}
      <div className="chama-hero">
        <div className="hero-overlay">

          <h1>Chama Management System</h1>

          <p>
            Transparent savings • Smart loans • Accountability • Member control
          </p>

          <div className="hero-buttons">

            <button
              className="primary-btn"
              onClick={() => navigate("register")}
            >
              Register New Chama
            </button>

            <button
              className="secondary-btn"
              onClick={() => navigate("find")}
            >
              Join Existing Chama
            </button>

            <button
              className="outline-btn"
              onClick={() => navigate("login")}
            >
              Member Login
            </button>

          </div>

        </div>
      </div>

      {/* INFO SECTION */}
      <div className="info-section">

        <div className="info-card">
          <h3>💰 Savings</h3>
          <p>Track all member contributions transparently with approvals.</p>
        </div>

        <div className="info-card">
          <h3>🏦 Loans</h3>
          <p>Apply, approve, and manage loans with full accountability.</p>
        </div>

        <div className="info-card">
          <h3>⚖️ Fines</h3>
          <p>Automated penalty tracking for meetings and delays.</p>
        </div>

        <div className="info-card">
          <h3>🐄 Assets</h3>
          <p>Manage chama assets like land, cows, vehicles, investments.</p>
        </div>

      </div>

      {/* CTA SECTION */}
      <div className="cta-section">

        <h2>Start managing your chama professionally today</h2>

        <p>
          Built for Kenyan chamas — no email required, phone-based system.
        </p>

        <button
          className="cta-btn"
          onClick={() => navigate("register")}
        >
          Get Started
        </button>

      </div>

    </div>
  );
}