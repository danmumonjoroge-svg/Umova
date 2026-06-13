import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import "bootstrap/dist/css/bootstrap.min.css";
import "./PublicHome.css";

import logo from "../asset/logo/umovalogo.png";

export default function PublicSite() {
  const navigate = useNavigate();

  // ================= FORM =================
  const [form, setForm] = useState({
    name: "",
    national_id: "",
    phone: "",
    email: "",
  });

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const submitApplication = async () => {
    const { error } = await supabase
      .from("membership_applications")
      .insert([form]);

    if (error) {
      alert(error.message);
    } else {
      alert("Application submitted successfully");
      setForm({ name: "", national_id: "", phone: "", email: "" });
    }
  };

  // ================= STORIES =================
  const [stories, setStories] = useState([]);
  const [activeStory, setActiveStory] = useState(null);

  // ================= KPI DATA =================
  const [kpi, setKpi] = useState({
    members: 0,
    savings: 0,
    loans: 0,
    investments: 0,
  });

  useEffect(() => {
    const fetchData = async () => {
      // STORIES
      const { data: storyData } = await supabase
        .from("member_stories")
        .select("*")
        .order("created_at", { ascending: false });

      setStories(storyData || []);

      // MEMBERS
      const { count: members } = await supabase
        .from("members")
        .select("*", { count: "exact", head: true });

      // LEDGER (optional aggregation logic)
      const { data: ledger } = await supabase
        .from("general_ledger")
        .select("amount, credit_account_id, debit_account_id");

      let savings = 0;
      let loans = 0;
      let investments = 0;

      (ledger || []).forEach((t) => {
        const amt = Number(t.amount || 0);

        if (t.credit_account_id === 1018) savings += amt;
        if (t.debit_account_id === 1018) savings -= amt;

        if (t.debit_account_id === 1011) loans += amt;
        if (t.credit_account_id === 1011) loans -= amt;

        if (t.credit_account_id === 1020) investments += amt;
        if (t.debit_account_id === 1020) investments -= amt;
      });

      setKpi({
        members: members || 0,
        savings,
        loans,
        investments,
      });
    };

    fetchData();
  }, []);

  // ================= PRODUCT DATA =================
  const products = {
    savings: {
      title: "Savings Plan",
      image:
        "https://images.unsplash.com/photo-1601597111158-2fceff292cdc",
      content: `
✔ Start saving from low amounts  
✔ Build loan qualification score  
✔ Emergency access savings  
✔ Interest eligibility over time  
      `,
    },

    loans: {
      title: "Loan Products",
      image:
        "https://images.unsplash.com/photo-1600880292089-90a7e086ee0c",
      content: `
✔ Development Loans  
✔ Emergency Loans  
✔ Business Loans  

QUALIFICATION:
- Active savings account  
- Good repayment history  
- Minimum contribution period  
      `,
    },

    investment: {
      title: "Investment Plan",
      image:
        "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e",
      content: `
✔ Long-term capital growth  
✔ Dividend returns  
✔ SACCO profit sharing  
      `,
    },
  };

  const [product, setProduct] = useState(null);

  // ================= PREVENT BACKGROUND SCROLL =================
  useEffect(() => {
    document.body.style.overflow =
      product || activeStory ? "hidden" : "auto";
  }, [product, activeStory]);

  return (
    <div className="public-root">

      {/* ================= NAV ================= */}
      <nav className="nav-bar">
        <div className="brand">
          <img src={logo} className="logo" />
          <h5>UMOVA SACCO</h5>
        </div>

        <div className="nav-links">
          <a href="#products">Products</a>
          <a href="#stories">Stories</a>
          <a href="#apply">Join</a>
          <button
  onClick={() => navigate("/chama")}
  style={{
    marginRight: "10px",
    background: "#198754",
    color: "white",
    border: "none",
    padding: "6px 12px",
    borderRadius: "6px",
    fontWeight: "600"
  }}
>
  Chama
</button>

          <button onClick={() => navigate("/login")}>
            Login
          </button>
        </div>
      </nav>

      {/* ================= KPI DASHBOARD ================= */}
      <section className="kpi-section">
        <div className="kpi-card">👥 Members: {kpi.members}</div>
        <div className="kpi-card">💰 Savings: {kpi.savings.toLocaleString()}</div>
        <div className="kpi-card">🏦 Loans: {kpi.loans.toLocaleString()}</div>
        <div className="kpi-card">📈 Investments: {kpi.investments.toLocaleString()}</div>
      </section>

      {/* ================= HERO ================= */}
      <header className="hero">
        <h1>Smart Savings. Secure Loans. Real Growth.</h1>
        <p>M-Pesa inspired financial ecosystem</p>

        <button className="btn btn-success">
          Become a Member
        </button>
      </header>

      {/* ================= PRODUCTS ================= */}
      <section id="products" className="container py-5">
        <h2 className="section-title">Financial Products</h2>

        <div className="row g-4">

          {Object.keys(products).map((key) => (
            <div className="col-md-4" key={key}>
              <div
                className="card product-card"
                onClick={() => setProduct(products[key])}
              >
                <img src={products[key].image} />
                <div className="card-body">
                  <h5>{products[key].title}</h5>
                  <p>Click to view full details</p>
                </div>
              </div>
            </div>
          ))}

        </div>
      </section>

      {/* ================= APPLICATION ================= */}
      <section id="apply" className="apply-section">
        <h2>Membership Application</h2>

        <div className="form-box">
          <input name="name" placeholder="Full Name" onChange={handleChange} />
          <input name="national_id" placeholder="National ID" onChange={handleChange} />
          <input name="phone" placeholder="Phone" onChange={handleChange} />
          <input name="email" placeholder="Email" onChange={handleChange} />

          <button className="btn btn-success w-100" onClick={submitApplication}>
            Submit Application
          </button>
        </div>
      </section>

      {/* ================= STORIES ================= */}
      <section id="stories" className="container py-5">
        <h2 className="section-title">Member Stories</h2>

        <div className="story-scroll">
          {stories.map((s) => (
            <div
              key={s.id}
              className="story-card"
              onClick={() => setActiveStory(s)}
            >
              <img src={s.image_url || "https://images.unsplash.com/photo-1507679799987-c73779587ccf"} />
              <h6>{s.name}</h6>
              <small>{s.title}</small>
            </div>
          ))}
        </div>
      </section>

      {/* ================= PRODUCT MODAL ================= */}
      {product && (
        <div className="modal-overlay">
          <div className="modal-box scrollable">
            <h3>{product.title}</h3>
            <img src={product.image} />
            <pre>{product.content}</pre>

            <button onClick={() => setProduct(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {/* ================= STORY MODAL ================= */}
      {activeStory && (
        <div className="modal-overlay">
          <div className="modal-box scrollable">
            <h3>{activeStory.name}</h3>
            <img src={activeStory.image_url} />
            <p>{activeStory.story}</p>

            <button onClick={() => setActiveStory(null)}>
              Close
            </button>
          </div>
        </div>
      )}

    </div>
  );
}