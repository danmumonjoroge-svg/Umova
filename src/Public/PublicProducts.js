// src/Public/PublicProducts.js
//
// Products page (route: /products). Opens from "See what each one does" on the
// homepage and scrolls normally. Add the route next to your other public routes:
//
//   import PublicProducts from "./Public/PublicProducts";
//   <Route path="/products" element={<PublicProducts />} />
//
// Phones: app-style screen (back button bar, quick-switch chips, rounded cards).
// Laptops / desktops: top bar, 2 x 2 grid of cards, full footer.

import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import "./PublicSite.css";
import "./PublicHome.css";

import {
  Icon,
  PRODUCTS,
  TopBar,
  SiteFooter,
  img,
  usePageScroll,
  useScrolled,
} from "./PublicShared";

const prefersReducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function ProductCard({ p }) {
  const hasSeparateLogin = p.loginRoute !== p.route;
  return (
    <article className="uh-pcard" id={`product-${p.key}`}>
      <div className="uh-pcard-media">
        <img src={img(p.image, 800)} alt="" width="800" height="400" loading="lazy" decoding="async" />
        <span className="uh-pcard-tag">{p.tag}</span>
      </div>
      <div className="uh-pcard-icon">
        <Icon name={p.icon} />
      </div>
      <div className="uh-pcard-body">
        <h2>{p.title}</h2>
        <p className="uh-pcard-desc">{p.description}</p>
        <ul className="uh-tags">
          {p.points.map((pt) => (
            <li key={pt}>{pt}</li>
          ))}
        </ul>
        <div className="uh-actions">
          <Link to={p.route} className="uh-btn uh-btn--primary">
            {p.exploreLabel}
          </Link>
          {hasSeparateLogin && (
            <Link to={p.loginRoute} className="uh-btn uh-btn--ghost">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </article>
  );
}

export default function PublicProducts() {
  usePageScroll();
  const scrolled = useScrolled(4);
  const [active, setActive] = useState(PRODUCTS[0].key);
  const chipsRef = useRef(null);

  // Always open at the top of the page.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Highlight the chip of the product that is currently in view.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const cards = PRODUCTS.map((p) => document.getElementById(`product-${p.key}`)).filter(Boolean);
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setActive(entry.target.id.replace("product-", ""));
        });
      },
      { rootMargin: "-130px 0px -50% 0px", threshold: 0 }
    );
    cards.forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, []);

  // Keep the active chip visible inside the chip row.
  useEffect(() => {
    const row = chipsRef.current;
    if (!row) return;
    const chip = row.querySelector(`[data-key="${active}"]`);
    if (!chip) return;
    row.scrollTo({
      left: chip.offsetLeft - (row.clientWidth - chip.clientWidth) / 2,
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
  }, [active]);

  const jumpTo = (key) => {
    setActive(key);
    const el = document.getElementById(`product-${key}`);
    if (el) el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  };

  return (
    <div className="public-root uh-root uh-pp">
      {/* Laptop / desktop top bar (hidden on phones) */}
      <TopBar />

      {/* Phone app bar (hidden on laptop / desktop) */}
      <header className={`uh-appbar ${scrolled ? "is-scrolled" : ""}`}>
        <Link to="/" className="uh-appbar-back" aria-label="Back to home">
          <Icon name="back" />
        </Link>
        <span className="uh-appbar-title">Products</span>
        <span className="uh-appbar-spacer" aria-hidden="true" />
      </header>

      <main>
        <section className="uh-page-head">
          <div className="uh-wrap">
            <Link to="/" className="uh-back">
              <Icon name="back" />
              Back to home
            </Link>
            <h1>One family, four homes</h1>
            <p>Pick the one that fits what you're doing today.</p>
          </div>
        </section>

        {/* Phone quick-switch chips (hidden on laptop / desktop) */}
        <div className={`uh-chips ${scrolled ? "is-scrolled" : ""}`}>
          <div className="uh-chips-row" ref={chipsRef} role="tablist" aria-label="Jump to a product">
            {PRODUCTS.map((p) => (
              <button
                key={p.key}
                type="button"
                role="tab"
                aria-selected={active === p.key}
                data-key={p.key}
                className={`uh-chip ${active === p.key ? "is-active" : ""}`}
                onClick={() => jumpTo(p.key)}
              >
                {p.navLabel}
              </button>
            ))}
          </div>
        </div>

        <section className="uh-page-body" aria-label="Umova products">
          <div className="uh-wrap uh-pgrid">
            {PRODUCTS.map((p) => (
              <ProductCard key={p.key} p={p} />
            ))}
          </div>
          <p className="uh-quiet">© {new Date().getFullYear()} Umova</p>
        </section>
      </main>

      {/* Full footer on laptop / desktop only (hidden on phones) */}
      <SiteFooter />
    </div>
  );
}
