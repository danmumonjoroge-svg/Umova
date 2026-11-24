// src/Public/PublicShared.js
//
// Pieces shared by the Umova homepage (PublicSite.js) and the products page
// (PublicProducts.js): product data, icons, top bar, bottom bar, footers and
// small hooks. Styling lives in PublicHome.css (every class is prefixed "uh-").

import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";

import logo from "../asset/logo/umovalogo.png";

// ================= ICONS =================
// Inline SVG so the pages need no icon package. Stroke follows currentColor.
const ICONS = {
  financial: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V10" />
      <path d="M9.5 21V10" />
      <path d="M14.5 21V10" />
      <path d="M19 21V10" />
      <path d="M12 3 3 8h18z" />
    </>
  ),
  chama: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M17 14c2.5 0 4 2 4 5" />
    </>
  ),
  pos: (
    <>
      <path d="M5 8h14l-1 12H6z" />
      <path d="M9 8a3 3 0 0 1 6 0" />
    </>
  ),
  school: (
    <>
      <path d="M2 9l10-5 10 5-10 5z" />
      <path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  back: (
    <>
      <path d="M19 12H5" />
      <path d="M11 6l-6 6 6 6" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  switch: (
    <>
      <path d="M7 7h12l-3-3" />
      <path d="M17 17H5l3 3" />
    </>
  ),
  shield: <path d="M12 3l7 3v5c0 5-3 8-7 10-4-2-7-5-7-10V6z" />,
};

export function Icon({ name }) {
  return (
    <svg
      className="uh-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

// ================= PRODUCT DATA =================
//  - route:      the product's own page
//  - loginRoute: where "Sign in" goes
// When both are the same path, only one button is shown.
export const PRODUCTS = [
  {
    key: "financial",
    icon: "financial",
    tag: "Financial services",
    title: "Umova Financial",
    short: "Savings and loans",
    description: "Savings, loans, and investment plans for individuals and SACCOs.",
    points: ["Savings accounts", "Loans and repayments", "Member statements"],
    image: "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e",
    route: "/financial",
    loginRoute: "/login",
    navLabel: "Financial",
    exploreLabel: "Explore Financial",
  },
  {
    key: "chama",
    icon: "chama",
    tag: "Group savings",
    title: "Umova Chama",
    short: "Table banking and group savings",
    description: "Table banking and group savings management for chamas and welfare groups.",
    points: ["Contribution tracking", "Table banking loans", "Meeting and welfare records"],
    image: "https://images.unsplash.com/photo-1521791136064-7986c2920216",
    route: "/chama",
    loginRoute: "/chama",
    navLabel: "Chama",
    exploreLabel: "Open Chama",
  },
  {
    key: "pos",
    icon: "pos",
    tag: "Point of sale",
    title: "Umova POS",
    short: "Sales, stock, and suppliers",
    description: "Point of sale, inventory, and supplier management for growing businesses.",
    points: ["Sales and receipts", "Stock levels", "Supplier records"],
    image: "https://images.unsplash.com/photo-1556742049-0cfed4f6a45d",
    route: "/pos",
    loginRoute: "/pos",
    navLabel: "POS",
    exploreLabel: "Open POS",
  },
  {
    key: "school",
    icon: "school",
    tag: "School management",
    title: "Umova Elimu",
    short: "School management",
    description: "Students, attendance, exams, fees and parent updates for schools.",
    points: ["Students and attendance", "Exams and report cards", "Fees and parent updates"],
    image: "https://images.unsplash.com/photo-1503676260728-1c00da094a0b",
    route: "/school",
    loginRoute: "/school",
    navLabel: "School",
    exploreLabel: "Open Elimu",
  },
];

// Unsplash serves resized images; ask for a sensible size instead of the original.
export const img = (url, w) => `${url}?auto=format&fit=crop&w=${w}&q=70`;

// ================= HOOKS =================

// True once the window has scrolled past `threshold` pixels.
export function useScrolled(threshold = 12) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, [threshold]);
  return scrolled;
}

// Some apps lock html/body/#root (height: 100% + overflow: hidden) for their
// dashboards. While a scrolling public page is on screen, make sure the normal
// window scroll works, and put everything back when leaving the page.
export function usePageScroll() {
  useEffect(() => {
    const html = document.documentElement;
    const targets = [html, document.body, document.getElementById("root")].filter(Boolean);
    const props = ["overflow", "height"];

    const saved = targets.map((el) =>
      props.map((p) => [p, el.style.getPropertyValue(p), el.style.getPropertyPriority(p)])
    );

    targets.forEach((el) => {
      el.style.setProperty("overflow", el === html ? "auto" : "visible", "important");
      el.style.setProperty("height", "auto", "important");
    });

    return () => {
      targets.forEach((el, i) => {
        saved[i].forEach(([p, value, priority]) => {
          if (value) el.style.setProperty(p, value, priority);
          else el.style.removeProperty(p);
        });
      });
    };
  }, []);
}

// ================= TOP BAR =================
// Phones: logo only. Tablet, laptop, desktop: logo plus the four product buttons.
export function TopBar() {
  const scrolled = useScrolled();

  return (
    <header className={`uh-nav ${scrolled ? "is-scrolled" : ""}`}>
      <div className="uh-wrap uh-nav-inner">
        <Link to="/" className="uh-brand" aria-label="Umova home">
          <img src={logo} alt="" />
          <span>Umova</span>
        </Link>

        <nav className="uh-nav-links" aria-label="Open a product">
          {PRODUCTS.map((p) => (
            <Link key={p.key} to={p.loginRoute} className="uh-pill">
              <Icon name={p.icon} />
              {p.navLabel}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

// ================= PHONE BOTTOM BAR =================
// The four products as app-style tabs. Shown on phones only (see CSS).
export function BottomBar() {
  return (
    <nav className="uh-tabbar" aria-label="Open a product">
      {PRODUCTS.map((p) => (
        <Link key={p.key} to={p.loginRoute} className="uh-tab">
          <Icon name={p.icon} />
          {p.navLabel}
        </Link>
      ))}
    </nav>
  );
}

// ================= FOOTERS =================

// One slim line for the fixed homepage (hidden on phones, which use the bottom bar).
export function SlimFooter() {
  return (
    <footer className="uh-slimfoot">
      <div className="uh-wrap uh-slimfoot-inner">
        <nav className="uh-slimfoot-links" aria-label="Products">
          {PRODUCTS.map((p) => (
            <Link key={p.key} to={p.route}>
              {p.navLabel}
            </Link>
          ))}
        </nav>
        <p>© {new Date().getFullYear()} Umova. All rights reserved.</p>
      </div>
    </footer>
  );
}

// Full footer for the scrolling products page (hidden on phones).
export function SiteFooter() {
  return (
    <footer className="uh-footer">
      <div className="uh-wrap uh-footer-inner">
        <Link to="/" className="uh-brand" aria-label="Umova home">
          <img src={logo} alt="" />
          <span>Umova</span>
        </Link>
        <nav className="uh-footer-links" aria-label="Products">
          {PRODUCTS.map((p) => (
            <Link key={p.key} to={p.route}>
              {p.title}
            </Link>
          ))}
        </nav>
        <p>© {new Date().getFullYear()} Umova. All rights reserved.</p>
      </div>
    </footer>
  );
}
