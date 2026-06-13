import React, { useState, useEffect } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import { useChama } from "./ChamaContext";
import "./ChamaFind.css";

export default function ChamaFind() {
  const navigate = useNavigate();
  const { selectChama } = useChama();

  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [chamas, setChamas] = useState([]);
  const [featured, setFeatured] = useState([]);
  const [selected, setSelected] = useState(null);

  // ─────────────────────────────────────────────
  // LOAD FEATURED CHAMAS
  // ─────────────────────────────────────────────
  useEffect(() => {
    const loadFeatured = async () => {
      const { data } = await supabase
        .from("chamas")
        .select("*")
        .limit(3);

      setFeatured(data || []);
    };

    loadFeatured();
  }, []);

  // ─────────────────────────────────────────────
  // SEARCH CHAMAS
  // ─────────────────────────────────────────────
  const searchChama = async () => {
    if (!query) return;

    setLoading(true);

    const { data, error } = await supabase
      .from("chamas")
      .select("*")
      .or(`name.ilike.%${query}%,chama_no.ilike.%${query}%`);

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    setChamas(data || []);
  };

  // ─────────────────────────────────────────────
  // REQUEST JOIN
  // ─────────────────────────────────────────────
  const requestJoin = async (chama) => {
    const phone = prompt("Enter your phone");

    if (!phone) return;

    const { error } = await supabase
      .from("chama_join_requests")
      .insert([
        {
          chama_id: chama.id,
          user_phone: phone,
          status: "pending",
        },
      ]);

    if (error) return alert(error.message);

    alert("Request submitted. Await approval.");
    setSelected(null);
  };

  // ─────────────────────────────────────────────
  // ENTER CHAMA (NEW LOGIC FIX)
  // ─────────────────────────────────────────────
  const enterChama = (chama) => {
    // set active chama in context
    selectChama({
      chamaData: chama,
      memberData: null, // will be resolved later in ChamaRouter or dashboard
    });

    // navigate into chama module
    navigate("/chama");
  };

  return (
    <div className="find-wrapper">

      {/* HEADER */}
      <div className="header">
        <h1>Discover Trusted Chamas</h1>
        <p>Find savings groups, join, and grow your financial future</p>
      </div>

      {/* SEARCH */}
      <div className="search-box">
        <input
          placeholder="Search by name or code..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        <button onClick={searchChama}>
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {/* FEATURED */}
      <div className="section-title">⭐ Featured Chamas</div>

      <div className="grid">
        {featured.map((c) => (
          <div
            key={c.id}
            className="card featured"
            onClick={() => setSelected(c)}
          >
            <h3>{c.name}</h3>
            <p>Code: {c.chama_no}</p>

            <div className="tags">
              <span>Trusted</span>
              <span>Active</span>
            </div>
          </div>
        ))}
      </div>

      {/* SEARCH RESULTS */}
      {chamas.length > 0 && (
        <>
          <div className="section-title">Results</div>

          <div className="grid">
            {chamas.map((c) => (
              <div key={c.id} className="card" onClick={() => setSelected(c)}>
                <h3>{c.name}</h3>
                <p>{c.chama_no}</p>
                <small>Click to view financial profile</small>
              </div>
            ))}
          </div>
        </>
      )}

      {/* MODAL */}
      {selected && (
        <div className="modal">
          <div className="modal-box">

            <h2>{selected.name}</h2>

            <div className="info-box">
              <p><b>Chama Code:</b> {selected.chama_no}</p>
              <p><b>Status:</b> Active Financial Group</p>
              <p><b>Model:</b> Savings • Loans • Welfare • Assets</p>
            </div>

            <div className="insights">

              <div>
                <h4>💰 Savings Pool</h4>
                <p>Tracked monthly contributions</p>
              </div>

              <div>
                <h4>🏦 Loan System</h4>
                <p>Approved based on member history</p>
              </div>

              <div>
                <h4>⚖️ Accountability</h4>
                <p>All transactions require approval</p>
              </div>

            </div>

            <div className="actions">

              <button
                className="primary"
                onClick={() => enterChama(selected)}
              >
                I am a Member
              </button>

              <button
                className="secondary"
                onClick={() => requestJoin(selected)}
              >
                Request to Join
              </button>

              <button
                className="close"
                onClick={() => setSelected(null)}
              >
                Close
              </button>

            </div>

          </div>
        </div>
      )}

    </div>
  );
}