// src/Public/PublicSite.js
//
// Umova homepage. This is the platform-level overview: it introduces
// Umova as one brand with three products (Financial, Chama, POS) and
// sends visitors into whichever one they want. It does NOT contain the
// membership application, stats, or member stories anymore — those are
// specific to the financial product and now live in
// UmovaFinancialPage.js (route: /financial).

import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import "./PublicSite.css";

import logo from "../asset/logo/umovalogo.png";

// ================= SCROLL REVEAL HOOK =================
function useReveal() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, visible];
}

export default function PublicSite() {
  const navigate = useNavigate();

  // ================= PRODUCT DATA =================
  // Order matters here: this is the visual order of the pillar cards, and
  // also the order of the quick-login buttons in the nav.
  const products = [
    {
      key: "financial",
      tag: "Financial services",
      title: "Umova Financial",
      description: "Savings, loans, and investment plans for individuals and SACCOs.",
      image: "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e",
      route: "/financial",
      loginRoute: "/login",
      navLabel: "Financial",
    },
    {
      key: "chama",
      tag: "Group savings",
      title: "Umova Chama",
      description: "Table banking and group savings management for chamas and welfare groups.",
      image: "https://images.unsplash.com/photo-1521791136064-7986c2920216",
      route: "/chama",
      loginRoute: "/chama",
      navLabel: "Chama",
    },
    {
      key: "pos",
      tag: "Point of sale",
      title: "Umova POS",
      description: "Point of sale, inventory, and supplier management for growing businesses.",
      image: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d",
      route: "/pos",
      loginRoute: "/pos",
      navLabel: "POS",
    },
  ];

  // ================= SCROLL SPY FOR NAV STYLE =================
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const [productsRef, productsVisible] = useReveal();

  return (
    <div className="public-root">

      {/* ================= NAV =================
          No hamburger here on purpose: most visitors are business owners
          opening this on a phone to log in, often daily. Putting all three
          logins directly in the sticky header — visible with zero taps,
          at every screen width — beats a menu they'd otherwise have to
          open every time. */}
      <nav className={`nav-bar ${scrolled ? "nav-bar--scrolled" : ""}`}>
        <div className="nav-inner nav-inner--quick">
          <div className="brand" onClick={() => navigate("/")}>
            <img src={logo} className="logo" alt="Umova" />
            <h5>Umova</h5>
          </div>

          <div className="quick-access">
            {products.map((p) => (
              <button
                key={p.key}
                className="quick-btn"
                onClick={() => navigate(p.loginRoute)}
              >
                {p.navLabel}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* ================= HERO ================= */}
      <header className="hero">
        <div className="hero-glow" />
        <div className="hero-content">
          <span className="hero-eyebrow">Rooted in how Kenya already saves</span>
          <h1>The way we already save, organize, and trade — now digital.</h1>
          <p>
            Umova brings your sacco, your chama, and your shop together in one trusted
            home, built around the systems communities have always relied on.
          </p>

          <div className="hero-actions">
            <a href="#products" className="btn btn-primary">Explore products</a>
          </div>
        </div>
      </header>

      {/* ================= MISSION ================= */}
      <section className="mission-section">
        <div className="mission-inner">
          <span className="section-eyebrow">Why Umova</span>
          <p className="mission-statement">
            Every sacco has a ledger. Every chama has a table. Every shop has a till book.
            Umova doesn't replace how you already work — it just makes it easier to keep
            track of, grow, and trust.
          </p>

          <div className="mission-features">
            <div className="mission-feature">
              <span className="mission-feature-icon" aria-hidden="true">✓</span>
              <h6>Familiar, not foreign</h6>
              <p>Same ledgers, same table banking, same till — just digitized.</p>
            </div>
            <div className="mission-feature">
              <span className="mission-feature-icon" aria-hidden="true">⟳</span>
              <h6>One login, three homes</h6>
              <p>Move between Financial, Chama, and POS without losing your place.</p>
            </div>
            <div className="mission-feature">
              <span className="mission-feature-icon" aria-hidden="true">◆</span>
              <h6>Built on trust</h6>
              <p>Secure records, transparent tracking, real accountability.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ================= PRODUCTS (PILLARS) ================= */}
      <section
        id="products"
        className={`section reveal ${productsVisible ? "reveal--visible" : ""}`}
        ref={productsRef}
      >
        <div className="section-head">
          <span className="section-eyebrow">Whichever door you walk through</span>
          <h2 className="section-title">One family, three homes</h2>
          <p className="section-sub">
            Pick the one that fits what you're doing today.
          </p>
        </div>

        <div className="pillar-grid">
          {products.map((p) => (
            <div
              className="pillar-card"
              key={p.key}
              onClick={() => navigate(p.route)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") navigate(p.route); }}
            >
              <div className="pillar-card-image">
                <img src={p.image} alt={p.title} loading="lazy" />
                <span className="pillar-card-tag">{p.tag}</span>
              </div>
              <div className="pillar-card-body">
                <h5>{p.title}</h5>
                <p>{p.description}</p>
                <span className="pillar-card-cta">
                  Explore {p.title.replace("Umova ", "")} <span aria-hidden="true">→</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="footer">
        <div className="footer-inner">
          <div className="brand brand--footer">
            <img src={logo} className="logo" alt="Umova" />
            <h5>Umova</h5>
          </div>
          <p>© {new Date().getFullYear()} Umova. All rights reserved.</p>
        </div>
      </footer>

    </div>
  );
}
