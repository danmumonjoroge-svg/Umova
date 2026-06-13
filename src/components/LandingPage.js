import React from "react";
import { Link } from "react-router-dom";
import logo from "../asset/logo/umovalogo.png";
import "./LandingPage.css";

function LandingPage() {
  return (
    <div className="landing-container">

      {/* ================= NAVBAR ================= */}
      <header className="landing-header">

        <div className="brand">
          <img src={logo} alt="logo" className="logo" />
          <div>
            <h1>UMOVA SACCO</h1>
            <p>Smart Banking for Members</p>
          </div>
        </div>

        <div className="nav-actions">
          <Link to="/login">
            <button className="btn login-btn">Login</button>
          </Link>

          <Link to="/signup">
            <button className="btn signup-btn">Join Now</button>
          </Link>
        </div>

      </header>

      {/* ================= HERO ================= */}
      <section className="hero-section">
        <div className="hero-content">
          <h2>Secure. Smart. Member First Banking.</h2>

          <p>
            Manage savings, loans, and investments with a modern core banking system
            built for financial growth.
          </p>

          <div className="hero-buttons">
            <Link to="/login">
              <button className="btn primary">Access Account</button>
            </Link>

            <Link to="/signup">
              <button className="btn secondary">Become a Member</button>
            </Link>
          </div>
        </div>
      </section>

      {/* ================= STATS ================= */}
      <section className="sacco-info">

        <div className="card">
          <h3>Total Members</h3>
          <p>1,250+</p>
        </div>

        <div className="card">
          <h3>Total Assets</h3>
          <p>KES 120M+</p>
        </div>

        <div className="card">
          <h3>Loan Limit</h3>
          <p>3x Savings</p>
        </div>

        <div className="card">
          <h3>Active Savings</h3>
          <p>KES 80M+</p>
        </div>

      </section>

      {/* ================= ABOUT ================= */}
      <section className="about-section">
        <h2>About UMOVA SACCO</h2>

        <p>
          We are a member-driven financial institution offering secure savings,
          affordable credit, and long-term wealth-building opportunities.
          Our system is built with modern core banking architecture.
        </p>
      </section>

      {/* ================= FEATURES ================= */}
      <section className="features">

        <div className="feature-card">
          <h3>💰 Savings</h3>
          <p>Grow your wealth securely with structured savings plans.</p>
        </div>

        <div className="feature-card">
          <h3>🏦 Loans</h3>
          <p>Fast, affordable loans based on your savings history.</p>
        </div>

        <div className="feature-card">
          <h3>📊 Statements</h3>
          <p>Real-time financial statements and audit-ready reports.</p>
        </div>

        <div className="feature-card">
          <h3>🔐 Secure Banking</h3>
          <p>Enterprise-grade security and member data protection.</p>
        </div>

      </section>

      {/* ================= CTA ================= */}
      <section className="cta-section">
        <h2>Start Your Financial Journey Today</h2>

        <div className="cta-buttons">
          <Link to="/login">
            <button className="btn primary">Login</button>
          </Link>

          <Link to="/signup">
            <button className="btn signup-btn">Create Account</button>
          </Link>
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="footer">
        <p>© {new Date().getFullYear()} UMOVA SACCO. All rights reserved.</p>
        <p>Empowering members through financial freedom.</p>
      </footer>

    </div>
  );
}

export default LandingPage;