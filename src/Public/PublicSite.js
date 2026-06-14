import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import "./PublicSite.css";

import logo from "../asset/logo/umovalogo.png";

export default function PublicSite() {
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
  const [submitting, setSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState(null); // "success" | "error" | null

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const submitApplication = async () => {
    if (!form.name || !form.phone) {
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
    } catch (err) {
      setSubmitStatus("error");
    } finally {
      setSubmitting(false);
    }
  };

  // ================= STORIES =================
  const [stories, setStories] = useState([]);
  const [activeStory, setActiveStory] = useState(null);

  useEffect(() => {
    const fetchStories = async () => {
      const { data: storyData } = await supabase
        .from("member_stories")
        .select("*")
        .order("created_at", { ascending: false });

      setStories(storyData || []);
    };

    fetchStories();
  }, []);

  // ================= PRODUCT DATA =================
  const products = {
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
  };

  const [product, setProduct] = useState(null);

  // ================= PREVENT BACKGROUND SCROLL =================
  useEffect(() => {
    document.body.style.overflow =
      product || activeStory || menuOpen ? "hidden" : "auto";
  }, [product, activeStory, menuOpen]);

  // ================= SCROLL SPY FOR NAV STYLE =================
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="public-root">

      {/* ================= NAV ================= */}
      <nav className={`nav-bar ${scrolled ? "nav-bar--scrolled" : ""}`}>
        <div className="nav-inner">
          <div className="brand" onClick={() => navigate("/")}>
            <img src={logo} className="logo" alt="Umova investment ltd" />
            <h5>Umova investment ltd</h5>
          </div>

          {/* Desktop links */}
          <div className="nav-links">
            <a href="#products">Products</a>
            <a href="#stories">Stories</a>
            <a href="#apply">Join</a>
            <button className="nav-btn nav-btn--chama" onClick={() => navigate("/chama")}>
              Chama
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
            onClick={() => { closeMenu(); navigate("/chama"); }}
          >
            Chama
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
          <span className="hero-eyebrow">Umova investment ltd</span>
          <h1>Smart Savings. Secure Loans. Real Growth.</h1>
          <p>A trusted financial system for individuals and communities to save, lend, and grow together with confidence.</p>

          <div className="hero-actions">
            <a href="#apply" className="btn btn-primary">Become a Member</a>
            <a href="#products" className="btn btn-secondary">Explore Products</a>
          </div>
        </div>
      </header>

      {/* ================= PRODUCTS ================= */}
      <section id="products" className="section">
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
      <section id="apply" className="apply-section">
        <div className="apply-inner">
          <div className="apply-copy">
            <span className="section-eyebrow section-eyebrow--light">Get Started</span>
            <h2>Become a member today</h2>
            <p>
              Fill in your details below and our team will review your application.
              Membership gives you access to savings, loans, and investment products.
            </p>
          </div>

          <div className="form-box">
            {submitStatus === "success" && (
              <div className="form-alert form-alert--success">
                Application submitted successfully. We'll be in touch soon.
              </div>
            )}
            {submitStatus === "error" && (
              <div className="form-alert form-alert--error">
                Please fill in at least your full name and phone number.
              </div>
            )}

            <label className="form-field">
              <span>Full Name</span>
              <input name="name" placeholder="e.g. Jane Wanjiru" value={form.name} onChange={handleChange} />
            </label>
            <label className="form-field">
              <span>National ID</span>
              <input name="national_id" placeholder="e.g. 12345678" value={form.national_id} onChange={handleChange} />
            </label>
            <label className="form-field">
              <span>Phone Number</span>
              <input name="phone" placeholder="e.g. 0712 345 678" value={form.phone} onChange={handleChange} />
            </label>
            <label className="form-field">
              <span>Email Address</span>
              <input name="email" type="email" placeholder="e.g. jane@example.com" value={form.email} onChange={handleChange} />
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
      {stories.length > 0 && (
        <section id="stories" className="section">
          <div className="section-head">
            <span className="section-eyebrow">Real Members, Real Results</span>
            <h2 className="section-title">Member Stories</h2>
          </div>

          <div className="story-scroll">
            {stories.map((s) => (
              <div
                key={s.id}
                className="story-card"
                onClick={() => setActiveStory(s)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter") setActiveStory(s); }}
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
            <img src={logo} className="logo" alt="Umova investment ltd" />
            <h5>Umova investment ltd</h5>
          </div>
          <p>© {new Date().getFullYear()} Umova investment ltd. All rights reserved.</p>
        </div>
      </footer>

      {/* ================= PRODUCT MODAL ================= */}
      {product && (
        <div className="modal-overlay" onClick={() => setProduct(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setProduct(null)} aria-label="Close">✕</button>
            <div className="modal-image">
              <img src={product.image} alt={product.title} />
            </div>
            <div className="modal-content">
              <span className="modal-tag">{product.tag}</span>
              <h3>{product.title}</h3>
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
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setActiveStory(null)} aria-label="Close">✕</button>
            <div className="modal-image">
              <img src={activeStory.image_url || "https://images.unsplash.com/photo-1507679799987-c73779587ccf"} alt={activeStory.name} />
            </div>
            <div className="modal-content">
              <h3>{activeStory.name}</h3>
              {activeStory.title && <span className="modal-tag">{activeStory.title}</span>}
              <p className="modal-story-text">{activeStory.story}</p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}