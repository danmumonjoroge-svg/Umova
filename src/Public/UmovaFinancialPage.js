// src/Public/UmovaFinancialPage.js
//
// Umova Financial — the savings/loans/investment product page.
// This is almost entirely the old PublicSite.js content (before Umova
// became a 3-product umbrella): hero, trust stats, product cards +
// modal, membership application form, and member stories. It now
// lives at /financial instead of "/", and its nav points back up to
// the Umova homepage instead of carrying Chama/POS links itself.

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import "./PublicSite.css";

import logo from "../asset/logo/umovalogo.png";

// ================= VALIDATION HELPERS =================
const PHONE_RE = /^(?:\+254|0)?7\d{8}$/; // Kenyan mobile numbers, with or without country code
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateField(name, value) {
  switch (name) {
    case "name":
      if (!value.trim()) return "Full name is required.";
      if (value.trim().length < 3) return "Enter your full name.";
      return "";
    case "phone":
      if (!value.trim()) return "Phone number is required.";
      if (!PHONE_RE.test(value.replace(/\s+/g, ""))) return "Enter a valid phone number, e.g. 0712 345 678.";
      return "";
    case "national_id":
      if (value && !/^\d{6,10}$/.test(value.trim())) return "National ID should be 6–10 digits.";
      return "";
    case "email":
      if (value && !EMAIL_RE.test(value.trim())) return "Enter a valid email address.";
      return "";
    default:
      return "";
  }
}

// ================= COUNT-UP HOOK =================
function useCountUp(target, active, duration = 1400) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, target, duration]);
  return value;
}

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

function StatItem({ label, target, suffix = "", active }) {
  const value = useCountUp(target, active);
  return (
    <div className="stat-item">
      <span className="stat-number">{value.toLocaleString()}{suffix}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

export default function UmovaFinancialPage() {
  const navigate = useNavigate();

  // ================= MOBILE NAV =================
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  // ================= FORM =================
  const [form, setForm] = useState({
    name: "",
    national_id: "",
    phone: "",
    email: "",
  });
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null); // "success" | "error" | null

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    if (touched[name]) {
      setErrors((er) => ({ ...er, [name]: validateField(name, value) }));
    }
  };

  const handleBlur = (e) => {
    const { name, value } = e.target;
    setTouched((t) => ({ ...t, [name]: true }));
    setErrors((er) => ({ ...er, [name]: validateField(name, value) }));
  };

  const submitApplication = async () => {
    const nextErrors = {
      name: validateField("name", form.name),
      phone: validateField("phone", form.phone),
      national_id: validateField("national_id", form.national_id),
      email: validateField("email", form.email),
    };
    setErrors(nextErrors);
    setTouched({ name: true, phone: true, national_id: true, email: true });

    const hasError = Object.values(nextErrors).some(Boolean);
    if (hasError) {
      setSubmitStatus("error");
      return;
    }

    setSubmitting(true);
    setSubmitStatus(null);
    try {
      const { error } = await supabase
        .from("membership_applications")
        .insert([form]);

      if (error) throw error;
      setSubmitStatus("success");
      setForm({ name: "", national_id: "", phone: "", email: "" });
      setTouched({});
      setErrors({});
    } catch (err) {
      setSubmitStatus("error");
    } finally {
      setSubmitting(false);
    }
  };

  // Auto-dismiss success banner
  useEffect(() => {
    if (submitStatus === "success") {
      const t = setTimeout(() => setSubmitStatus(null), 6000);
      return () => clearTimeout(t);
    }
  }, [submitStatus]);

  // ================= STORIES =================
  const [stories, setStories] = useState([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [activeStory, setActiveStory] = useState(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(-1);

  useEffect(() => {
    const fetchStories = async () => {
      setStoriesLoading(true);
      const { data: storyData } = await supabase
        .from("member_stories")
        .select("*")
        .order("created_at", { ascending: false });

      setStories(storyData || []);
      setStoriesLoading(false);
    };

    fetchStories();
  }, []);

  const openStory = (story, index) => {
    setActiveStory(story);
    setActiveStoryIndex(index);
  };

  const stepStory = useCallback(
    (delta) => {
      if (!stories.length) return;
      const nextIndex = (activeStoryIndex + delta + stories.length) % stories.length;
      setActiveStory(stories[nextIndex]);
      setActiveStoryIndex(nextIndex);
    },
    [stories, activeStoryIndex]
  );

  // ================= MEMBERSHIP STATS =================
  const [stats, setStats] = useState({ members: 1240, loans: 3800000, satisfaction: 96 });
  const [statsActive, setStatsActive] = useState(false);
  const statsRef = useRef(null);

  useEffect(() => {
    const fetchStats = async () => {
      const { count } = await supabase
        .from("membership_applications")
        .select("*", { count: "exact", head: true });
      if (typeof count === "number" && count > 0) {
        setStats((s) => ({ ...s, members: count }));
      }
    };
    fetchStats();
  }, []);

  useEffect(() => {
    const el = statsRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStatsActive(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // ================= PRODUCT DATA =================
  const products = useMemo(
    () => ({
      savings: {
        title: "Savings Plan",
        tag: "Build your foundation",
        image: "https://images.unsplash.com/photo-1601597111158-2fceff292cdc",
        points: [
          "Start saving from low, flexible amounts",
          "Build a strong loan qualification score",
          "Emergency access to your savings",
          "Interest eligibility over time",
        ],
      },
      loans: {
        title: "Loan Products",
        tag: "Funding when you need it",
        image: "https://images.unsplash.com/photo-1600880292089-90a7e086ee0c",
        points: [
          "Development loans for long-term goals",
          "Emergency loans for urgent needs",
          "Business loans to grow your income",
          "Qualification based on an active savings account",
          "Favourable terms for good repayment history",
        ],
      },
      investment: {
        title: "Investment Plan",
        tag: "Grow your wealth",
        image: "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e",
        points: [
          "Long-term capital growth opportunities",
          "Periodic dividend returns",
          "Share in SACCO profit distributions",
        ],
      },
    }),
    []
  );

  const [product, setProduct] = useState(null);

  // ================= PREVENT BACKGROUND SCROLL =================
  useEffect(() => {
    document.body.style.overflow =
      product || activeStory || menuOpen ? "hidden" : "auto";
  }, [product, activeStory, menuOpen]);

  // ================= ESCAPE KEY CLOSES OVERLAYS =================
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key !== "Escape") {
        if (activeStory && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
          stepStory(e.key === "ArrowRight" ? 1 : -1);
        }
        return;
      }
      if (product) setProduct(null);
      else if (activeStory) setActiveStory(null);
      else if (menuOpen) setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [product, activeStory, menuOpen, stepStory]);

  // ================= SCROLL SPY FOR NAV STYLE + ACTIVE LINK =================
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState("");
  const [showBackToTop, setShowBackToTop] = useState(false);

  useEffect(() => {
    const sectionIds = ["products", "stories", "apply"];
    const onScroll = () => {
      setScrolled(window.scrollY > 12);
      setShowBackToTop(window.scrollY > 800);

      let current = "";
      for (const id of sectionIds) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= 140) current = id;
      }
      setActiveSection(current);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // ================= REVEAL-ON-SCROLL SECTIONS =================
  const [productsRef, productsVisible] = useReveal();
  const [applyRef, applyVisible] = useReveal();
  const [storiesRef, storiesVisible] = useReveal();

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <div className="public-root">

      {/* ================= NAV ================= */}
      <nav className={`nav-bar ${scrolled ? "nav-bar--scrolled" : ""}`}>
        <div className="nav-inner">
          <div className="brand" onClick={() => navigate("/financial")}>
            <img src={logo} className="logo" alt="Umova Financial" />
            <h5>Umova Financial</h5>
          </div>

          {/* Desktop links */}
          <div className="nav-links">
            <a href="#products" className={activeSection === "products" ? "active" : ""}>Products</a>
            <a href="#stories" className={activeSection === "stories" ? "active" : ""}>Stories</a>
            <a href="#apply" className={activeSection === "apply" ? "active" : ""}>Join</a>
            <button className="nav-btn nav-btn--chama" onClick={() => navigate("/")}>
              Umova home
            </button>
            <button className="nav-btn nav-btn--login" onClick={() => navigate("/login")}>
              Login
            </button>
          </div>

          {/* Mobile hamburger — always visible, never hides the login path */}
          <button
            className={`nav-toggle ${menuOpen ? "nav-toggle--open" : ""}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Toggle navigation menu"
            aria-expanded={menuOpen}
          >
            <span></span>
            <span></span>
            <span></span>
          </button>
        </div>

        {/* Mobile dropdown menu */}
        <div className={`nav-mobile ${menuOpen ? "nav-mobile--open" : ""}`}>
          <a href="#products" onClick={closeMenu}>Products</a>
          <a href="#stories" onClick={closeMenu}>Stories</a>
          <a href="#apply" onClick={closeMenu}>Join</a>
          <button
            className="nav-btn nav-btn--chama nav-btn--full"
            onClick={() => { closeMenu(); navigate("/"); }}
          >
            Umova home
          </button>
          <button
            className="nav-btn nav-btn--login nav-btn--full"
            onClick={() => { closeMenu(); navigate("/login"); }}
          >
            Login
          </button>
        </div>
      </nav>

      {/* Backdrop for mobile menu */}
      {menuOpen && <div className="nav-backdrop" onClick={closeMenu} />}

      {/* ================= HERO ================= */}
      <header className="hero">
        <div className="hero-glow" />
        <div className="hero-content">
          <span className="hero-eyebrow">Umova Financial</span>
          <h1>Smart Savings. Secure Loans. Real Growth.</h1>
          <p>A trusted financial system for individuals and communities to save, lend, and grow together with confidence.</p>

          <div className="hero-actions">
            <a href="#apply" className="btn btn-primary">Become a Member</a>
            <a href="#products" className="btn btn-secondary">Explore Products</a>
          </div>
        </div>
      </header>

      {/* ================= TRUST STATS ================= */}
      <section className="stats-section" ref={statsRef}>
        <StatItem label="Active members" target={stats.members} suffix="+" active={statsActive} />
        <StatItem label="Disbursed in loans (KES)" target={stats.loans} suffix="+" active={statsActive} />
        <StatItem label="Member satisfaction" target={stats.satisfaction} suffix="%" active={statsActive} />
      </section>

      {/* ================= PRODUCTS ================= */}
      <section
        id="products"
        className={`section reveal ${productsVisible ? "reveal--visible" : ""}`}
        ref={productsRef}
      >
        <div className="section-head">
          <span className="section-eyebrow">What We Offer</span>
          <h2 className="section-title">Financial Products</h2>
          <p className="section-sub">
            Tools designed to help you save consistently, borrow responsibly, and grow your wealth over time.
          </p>
        </div>

        <div className="product-grid">
          {Object.keys(products).map((key) => (
            <div
              className="product-card"
              key={key}
              onClick={() => setProduct(products[key])}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter") setProduct(products[key]); }}
            >
              <div className="product-card-image">
                <img src={products[key].image} alt={products[key].title} loading="lazy" />
                <span className="product-card-tag">{products[key].tag}</span>
              </div>
              <div className="product-card-body">
                <h5>{products[key].title}</h5>
                <p>View full details</p>
                <span className="product-card-arrow" aria-hidden="true">→</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ================= APPLICATION ================= */}
      <section
        id="apply"
        className={`apply-section reveal ${applyVisible ? "reveal--visible" : ""}`}
        ref={applyRef}
      >
        <div className="apply-inner">
          <div className="apply-copy">
            <span className="section-eyebrow section-eyebrow--light">Get Started</span>
            <h2>Become a member today</h2>
            <p>
              Fill in your details below and our team will review your application.
              Membership gives you access to savings, loans, and investment products.
            </p>
          </div>

          <div className="form-box" role="form" aria-label="Membership application">
            {submitStatus === "success" && (
              <div className="form-alert form-alert--success" role="status">
                Application submitted successfully. We'll be in touch soon.
              </div>
            )}
            {submitStatus === "error" && (
              <div className="form-alert form-alert--error" role="alert">
                Please fix the highlighted fields before submitting.
              </div>
            )}

            <label className="form-field">
              <span>Full Name</span>
              <input
                name="name"
                placeholder="e.g. Jane Wanjiru"
                value={form.name}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={!!errors.name}
              />
              {touched.name && errors.name && <small className="field-error">{errors.name}</small>}
            </label>
            <label className="form-field">
              <span>National ID</span>
              <input
                name="national_id"
                placeholder="e.g. 12345678"
                value={form.national_id}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={!!errors.national_id}
              />
              {touched.national_id && errors.national_id && <small className="field-error">{errors.national_id}</small>}
            </label>
            <label className="form-field">
              <span>Phone Number</span>
              <input
                name="phone"
                placeholder="e.g. 0712 345 678"
                value={form.phone}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={!!errors.phone}
              />
              {touched.phone && errors.phone && <small className="field-error">{errors.phone}</small>}
            </label>
            <label className="form-field">
              <span>Email Address</span>
              <input
                name="email"
                type="email"
                placeholder="e.g. jane@example.com"
                value={form.email}
                onChange={handleChange}
                onBlur={handleBlur}
                aria-invalid={!!errors.email}
              />
              {touched.email && errors.email && <small className="field-error">{errors.email}</small>}
            </label>

            <button
              className="btn btn-primary btn--full"
              onClick={submitApplication}
              disabled={submitting}
            >
              {submitting ? "Submitting…" : "Submit Application"}
            </button>
          </div>
        </div>
      </section>

      {/* ================= STORIES ================= */}
      {(storiesLoading || stories.length > 0) && (
        <section
          id="stories"
          className={`section reveal ${storiesVisible ? "reveal--visible" : ""}`}
          ref={storiesRef}
        >
          <div className="section-head">
            <span className="section-eyebrow">Real Members, Real Results</span>
            <h2 className="section-title">Member Stories</h2>
          </div>

          <div className="story-scroll">
            {storiesLoading &&
              Array.from({ length: 3 }).map((_, i) => (
                <div className="story-card story-card--skeleton" key={`skeleton-${i}`}>
                  <div className="story-card-image skeleton-block" />
                  <div className="skeleton-line" style={{ width: "70%" }} />
                  <div className="skeleton-line" style={{ width: "45%" }} />
                </div>
              ))}

            {!storiesLoading &&
              stories.map((s, i) => (
                <div
                  key={s.id}
                  className="story-card"
                  onClick={() => openStory(s, i)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter") openStory(s, i); }}
                >
                  <div className="story-card-image">
                    <img
                      src={s.image_url || "https://images.unsplash.com/photo-1507679799987-c73779587ccf"}
                      alt={s.name}
                      loading="lazy"
                    />
                  </div>
                  <h6>{s.name}</h6>
                  <small>{s.title}</small>
                </div>
              ))}
          </div>
        </section>
      )}

      {/* ================= FOOTER ================= */}
      <footer className="footer">
        <div className="footer-inner">
          <div className="brand brand--footer">
            <img src={logo} className="logo" alt="Umova Financial" />
            <h5>Umova Financial</h5>
          </div>
          <p>© {new Date().getFullYear()} Umova Financial. All rights reserved.</p>
        </div>
      </footer>

      {/* ================= BACK TO TOP ================= */}
      <button
        className={`back-to-top ${showBackToTop ? "back-to-top--visible" : ""}`}
        onClick={scrollToTop}
        aria-label="Back to top"
      >
        ↑
      </button>

      {/* ================= PRODUCT MODAL ================= */}
      {product && (
        <div className="modal-overlay" onClick={() => setProduct(null)}>
          <div
            className="modal-box"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setProduct(null)} aria-label="Close">✕</button>
            <div className="modal-image">
              <img src={product.image} alt={product.title} />
            </div>
            <div className="modal-content">
              <span className="modal-tag">{product.tag}</span>
              <h3 id="product-modal-title">{product.title}</h3>
              <ul className="modal-points">
                {product.points.map((point, i) => (
                  <li key={i}>{point}</li>
                ))}
              </ul>
              <a href="#apply" className="btn btn-primary" onClick={() => setProduct(null)}>
                Apply for Membership
              </a>
            </div>
          </div>
        </div>
      )}

      {/* ================= STORY MODAL ================= */}
      {activeStory && (
        <div className="modal-overlay" onClick={() => setActiveStory(null)}>
          <div
            className="modal-box"
            role="dialog"
            aria-modal="true"
            aria-labelledby="story-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="modal-close" onClick={() => setActiveStory(null)} aria-label="Close">✕</button>
            {stories.length > 1 && (
              <>
                <button className="modal-nav modal-nav--prev" onClick={() => stepStory(-1)} aria-label="Previous story">‹</button>
                <button className="modal-nav modal-nav--next" onClick={() => stepStory(1)} aria-label="Next story">›</button>
              </>
            )}
            <div className="modal-image">
              <img src={activeStory.image_url || "https://images.unsplash.com/photo-1507679799987-c73779587ccf"} alt={activeStory.name} />
            </div>
            <div className="modal-content">
              <h3 id="story-modal-title">{activeStory.name}</h3>
              {activeStory.title && <span className="modal-tag">{activeStory.title}</span>}
              <p className="modal-story-text">{activeStory.story}</p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
