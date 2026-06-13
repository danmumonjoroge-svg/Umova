import React, { useState } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import "./ChamaRegister.css";

export default function ChamaRegister() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    name: "",
    phone: "",
    location: "",
  });

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const generateChamano = () => {
    return "CHM-" + Math.floor(100000 + Math.random() * 900000);
  };

  const submit = async () => {
    if (!form.name || !form.phone) {
      alert("Name and phone are required");
      return;
    }

    setLoading(true);

    const chama_no = generateChamano();

    const { error } = await supabase.from("chamas").insert([
      {
        name: form.name,
        phone: form.phone,
        chama_no,
      },
    ]);

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    alert(`Chama created successfully! Your code: ${chama_no}`);

    navigate("/chama/find");
  };

  return (
    <div className="chama-register-container">

      <div className="register-card">

        <h2>Create Your Chama</h2>

        <p className="subtitle">
          Register your group and get a unique Chama Code
        </p>

        <div className="form-group">
          <label>Chama Name</label>
          <input
            name="name"
            placeholder="e.g. Upendo Investment Group"
            onChange={handleChange}
          />
        </div>

        <div className="form-group">
          <label>Phone </label>
          <input
            name="phone"
            placeholder="0712345678"
            onChange={handleChange}
          />
        </div>

        <div className="form-group">
          <label>Location (Optional)</label>
          <input
            name="location"
            placeholder="Nairobi / Village / Town"
            onChange={handleChange}
          />
        </div>

        <button
          className="submit-btn"
          onClick={submit}
          disabled={loading}
        >
          {loading ? "Creating Chama..." : "Create Chama"}
        </button>

        <button
          className="secondary-link"
          onClick={() => navigate("/chama/find")}
        >
          Already have a Chama Code? Join instead
        </button>

      </div>

    </div>
  );
}