import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";
import "./ChamaAuth.css";

export default function ChamaApply() {
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    phone: "",
    national_id: ""
  });

  const handleSubmit = async () => {
    const { error } = await supabase
      .from("chama_applications")
      .insert([form]);

    if (error) {
      alert(error.message);
      return;
    }

    alert("Application submitted successfully");
    navigate("/chama");
  };

  return (
    <div className="chama-auth-container">
      <div className="chama-auth-card">

        <h2>Apply for Chama Membership</h2>

        <input
          placeholder="Full Name"
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />

        <input
          placeholder="Phone Number"
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />

        <input
          placeholder="National ID"
          onChange={(e) => setForm({ ...form, national_id: e.target.value })}
        />

        <button onClick={handleSubmit}>
          Submit Application
        </button>

        <p
          style={{ marginTop: 12, cursor: "pointer", color: "#198754" }}
          onClick={() => navigate("/chama")}
        >
          ← Back
        </p>

      </div>
    </div>
  );
}