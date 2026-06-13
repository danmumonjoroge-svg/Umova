import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import "./ChamaAuth.css";

export default function ChamaLogin() {
  const navigate = useNavigate();

  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!phone || !password) {
      alert("Enter phone and password");
      return;
    }

    setLoading(true);

    const { data, error } = await supabase
      .from("chama_profiles")
      .select("*")
      .eq("phone", phone)
      .eq("password", password)
      .single();

    setLoading(false);

    if (error || !data) {
      alert("Invalid login details");
      return;
    }

    // store ONLY chama session
    localStorage.setItem("chama_user", JSON.stringify(data));

    // IMPORTANT: go to chama dashboard ONLY
    navigate("/chama/home");
  };

  return (
    <div className="chama-auth-container">
      <div className="chama-auth-card">

        <h2>Chama Login</h2>
        <p>Access your savings & contributions</p>

        <input
          placeholder="Phone Number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button onClick={handleLogin} disabled={loading}>
          {loading ? "Logging in..." : "Login"}
        </button>

        <p
          style={{ marginTop: 12, cursor: "pointer", color: "#198754" }}
          onClick={() => navigate("/chama")}
        >
          ← Back to Chama Portal
        </p>

      </div>
    </div>
  );
}