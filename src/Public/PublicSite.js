// src/Public/PublicSite.js
//
// Umova homepage (route: /). One fixed screen, no scrolling: it gets people into
// the product they use, and links to the products page.
//
//   /           this page (fixed to the screen)
//   /products   PublicProducts.js  (scrolling page, opened by "See what each one does")
//   /financial  UmovaFinancialPage.js
//
// Phones: logo bar on top, four-product bottom bar (replaces the footer).
// Laptops / desktops: product buttons in the top bar, slim footer line.
//
// Styling: PublicSite.css (shared tokens, also used by UmovaFinancialPage.js)
// plus PublicHome.css (homepage and products page, every class prefixed "uh-").

import React from "react";
import { Link } from "react-router-dom";
import "./PublicSite.css";
import "./PublicHome.css";

import { Icon, PRODUCTS, TopBar, SlimFooter, BottomBar } from "./PublicShared";

const TRUST = [
  { icon: "check", text: "Familiar, not foreign" },
  { icon: "switch", text: "One login, four homes" },
  { icon: "shield", text: "Built on trust" },
];

export default function PublicSite() {
  return (
    <div className="public-root uh-root uh-home">
      <TopBar />

      <main className="uh-home-main">
        <section className="uh-hero">
          <div className="uh-wrap uh-hero-grid">
            <div className="uh-hero-copy">
              <p className="uh-hero-note">Rooted in how Kenya already saves</p>
              <h1>The way we already save, organize, and trade, now digital.</h1>
              <p className="uh-hero-lead">
                Umova brings your sacco, your chama, your shop, and your school together in one
                trusted home, built around the systems communities have always relied on.
              </p>
            </div>

            {/* Sign-in panel: the fastest way in, no scrolling and no menu. */}
            <div className="uh-launch" aria-labelledby="uh-launch-title">
              <h2 id="uh-launch-title">Open your workspace</h2>
              <ul className="uh-launch-list">
                {PRODUCTS.map((p, i) => (
                  <li key={p.key} style={{ "--i": i }}>
                    <Link to={p.loginRoute} className="uh-door">
                      <span className="uh-door-icon">
                        <Icon name={p.icon} />
                      </span>
                      <span className="uh-door-text">
                        <span className="uh-door-name">{p.title}</span>
                        <span className="uh-door-sub">{p.short}</span>
                      </span>
                      <span className="uh-door-arrow">
                        <Icon name="arrow" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="uh-hero-cta">
              <Link to="/products" className="uh-btn uh-btn--gold">
                See what each one does
              </Link>
              <ul className="uh-trust">
                {TRUST.map((t) => (
                  <li key={t.text}>
                    <span className="uh-trust-icon">
                      <Icon name={t.icon} />
                    </span>
                    {t.text}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      </main>

      <SlimFooter />
      <BottomBar />
    </div>
  );
}
