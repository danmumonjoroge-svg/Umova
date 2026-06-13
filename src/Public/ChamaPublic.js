import React from "react";
import { useNavigate } from "react-router-dom";
import "./ChamaPublic.css";

export default function ChamaPublic() {
  const navigate = useNavigate();

  return (
    <div className="chama-public">

      {/* HERO */}
      <section className="chama-hero">
        <div className="chama-hero-content">

          <h1>Chama Management Portal</h1>

          <p>
            Transparent savings • Controlled contributions • Secure approvals
          </p>

          <div className="chama-hero-buttons">

            <button
              className="btn-primary"
              onClick={() => navigate("/chama/login")}
            >
              Member Login
            </button>

            <button
              className="btn-outline"
              onClick={() => navigate("/chama/apply")}
            >
              Apply for Membership
            </button>

            <button
              className="btn-outline"
              onClick={() => navigate("/chama/home")}
            >
              Dashboard Demo
            </button>

          </div>

          <div className="chama-mini-links">
            <span onClick={() => navigate("/chama/login")}>
              Already a member? Login →
            </span>
          </div>

        </div>
      </section>

      {/* FEATURES */}
      <section className="chama-features">

        <h2>What You Can Do</h2>

        <div className="feature-grid">

          <div className="feature-card">
            <h3>💰 Contributions</h3>
            <p>Submit savings with approval workflow from officials.</p>
          </div>

          <div className="feature-card">
            <h3>🏦 Loans</h3>
            <p>Apply and track loans with structured repayment schedules.</p>
          </div>

          <div className="feature-card">
            <h3>📊 Statements</h3>
            <p>View transparent financial statements anytime.</p>
          </div>

          <div className="feature-card">
            <h3>🔐 Approvals</h3>
            <p>All transactions verified by chama officials before posting.</p>
          </div>

        </div>

      </section>

      {/* TRUST */}
      <section className="chama-trust">

        <div className="trust-box">

          <h2>Built for Kenyan Chamas</h2>

          <p>
            Phone-based system. No email required. Designed for real groups.
          </p>

          <ul>
            <li>✔ Phone number login</li>
            <li>✔ MPESA-ready tracking</li>
            <li>✔ Approval-based accounting</li>
            <li>✔ Multi-chama support</li>
          </ul>

        </div>

      </section>

      {/* CTA */}
      <section className="chama-cta">

        <h2>Start managing your chama today</h2>

        <p>Simple. Transparent. Controlled.</p>

        <button onClick={() => navigate("/chama/login")}>
          Enter Portal
        </button>

      </section>

    </div>
  );
}