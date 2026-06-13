import React, {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
} from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import { useChama } from "./ChamaContext";
import "./ChamaFind.css";

const PHONE_REGEX = /^\+?[1-9]\d{1,14}$/;

export default function ChamaFind() {
  const navigate = useNavigate();
  const { selectChama } = useChama();

  // ----------------------------
  // STATE
  // ----------------------------
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [chamas, setChamas] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const [toast, setToast] = useState({
    show: false,
    message: "",
    type: "info",
  });

  const abortRef = useRef(false);
  const debounceRef = useRef(null);

  // fallback dataset (offline mode)
  const featuredFallback = useMemo(
    () => [
      { id: "mock-1", name: "Alpha Investment Capital", chama_no: "CH-8942-X", is_mock: true },
      { id: "mock-2", name: "United Diaspora Sacco", chama_no: "CH-5521-M", is_mock: true },
      { id: "mock-3", name: "Starlight Women Cooperative", chama_no: "CH-1094-A", is_mock: true },
    ],
    []
  );

  const [featured, setFeatured] = useState(featuredFallback);

  // ----------------------------
  // TOAST
  // ----------------------------
  const showToast = useCallback((message, type = "info") => {
    setToast({ show: true, message, type });
    setTimeout(() => setToast({ show: false, message: "", type: "info" }), 3500);
  }, []);

  // ----------------------------
  // LOAD FEATURED
  // ----------------------------
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        if (!supabase) return;

        const { data, error } = await supabase
          .from("chamas")
          .select("id, name, chama_no")
          .limit(3);

        if (error) throw error;

        if (alive && data?.length) setFeatured(data);
      } catch {
        // silent fallback
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  // ----------------------------
  // SEARCH (ADVANCED + DEBOUNCE + RACE SAFE)
  // ----------------------------
  const runSearch = useCallback(
    async (value) => {
      const clean = value.trim();
      if (!clean) return;

      abortRef.current = false;
      setLoading(true);

      try {
        if (!supabase) throw new Error("offline");

        const { data, error } = await supabase
          .from("chamas")
          .select("*")
          .or(`name.ilike.%${clean}%,chama_no.ilike.%${clean}%`);

        if (error) throw error;
        if (abortRef.current) return;

        setChamas(data || []);

        if (!data?.length) {
          showToast("No matching groups found", "info");
        }
      } catch {
        const local = featuredFallback.filter(
          (c) =>
            c.name.toLowerCase().includes(clean.toLowerCase()) ||
            c.chama_no.toLowerCase().includes(clean.toLowerCase())
        );
        setChamas(local);
      } finally {
        setLoading(false);
      }
    },
    [featuredFallback, showToast]
  );

  // debounce input search
  useEffect(() => {
    if (!query) return;

    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      runSearch(query);
    }, 450);

    return () => clearTimeout(debounceRef.current);
  }, [query, runSearch]);

  // ----------------------------
  // JOIN REQUEST
  // ----------------------------
  const submitJoin = async (e) => {
    e.preventDefault();

    const normalized = phone.replace(/\s+/g, "").trim();

    if (!PHONE_REGEX.test(normalized)) {
      showToast("Invalid phone format", "error");
      return;
    }

    setSubmitting(true);

    try {
      if (selected?.is_mock) {
        await new Promise((r) => setTimeout(r, 800));
      } else {
        const { error } = await supabase.from("chama_join_requests").insert([
          {
            chama_id: selected.id,
            user_phone: normalized,
            status: "pending",
          },
        ]);
        if (error) throw error;
      }

      showToast("Join request submitted successfully", "success");
      setShowJoinForm(false);
      setSelected(null);
      setPhone("");
    } catch (err) {
      showToast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  // ----------------------------
  // NAVIGATION
  // ----------------------------
  const enterChama = useCallback(
    (chama) => {
      selectChama?.({ chamaData: chama, memberData: null });
      navigate("/chama");
    },
    [navigate, selectChama]
  );

  // ESC CLOSE MODAL (PRO UX)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        setSelected(null);
        setShowJoinForm(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ----------------------------
  // UI
  // ----------------------------
  return (
    <div className="find-wrapper">

      {toast.show && (
        <div className={`toast-alert toast-${toast.type}`}>
          {toast.message}
        </div>
      )}

      <div className="find-container">

        <header className="find-header">
          <h1>Discover Chamas</h1>
          <p>Search and join verified financial groups in real time.</p>
        </header>

        <form
          className="search-box-wrapper"
          onSubmit={(e) => {
            e.preventDefault();
            runSearch(query);
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chama name or ID..."
          />

          <button disabled={loading}>
            {loading ? "Searching..." : "Search"}
          </button>
        </form>

        {/* FEATURED */}
        <section>
          <h2>Featured Chamas</h2>
          <div className="grid">
            {featured.map((c) => (
              <div key={c.id} className="card" onClick={() => setSelected(c)}>
                <h3>{c.name}</h3>
                <small>{c.chama_no}</small>
              </div>
            ))}
          </div>
        </section>

        {/* RESULTS */}
        {!!chamas.length && (
          <section>
            <h2>Results</h2>
            <div className="grid">
              {chamas.map((c) => (
                <div key={c.id} className="card" onClick={() => setSelected(c)}>
                  <h3>{c.name}</h3>
                  <small>{c.chama_no}</small>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* MODAL */}
        {selected && (
          <div className="modal" onClick={() => setSelected(null)}>
            <div className="modal-inner" onClick={(e) => e.stopPropagation()}>

              <h2>{selected.name}</h2>
              <p>{selected.chama_no}</p>

              {!showJoinForm ? (
                <div className="actions">
                  <button onClick={() => enterChama(selected)}>
                    Enter Dashboard
                  </button>

                  <button onClick={() => setShowJoinForm(true)}>
                    Join Request
                  </button>
                </div>
              ) : (
                <form onSubmit={submitJoin}>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+2547XXXXXXXX"
                  />

                  <button disabled={submitting}>
                    {submitting ? "Sending..." : "Submit"}
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowJoinForm(false)}
                  >
                    Cancel
                  </button>
                </form>
              )}

            </div>
          </div>
        )}

      </div>
    </div>
  );
}