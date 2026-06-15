import React, { useState, useRef } from "react";
import { supabase } from "../../supabaseClient";
import "./ChamasendContributions.css";

import { Send, Calendar, Wallet } from "lucide-react";

const ChamaSendContribution = ({ chamaId, user }) => {
  const [form, setForm] = useState({
    amount: "",
    type: "savings",
    date: "",
    comment: "",
  });

  const [loading, setLoading] = useState(false);

  const dateRef = useRef(null);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const openCalendar = () => {
    dateRef.current?.showPicker?.();
    dateRef.current?.focus();
  };

  const submit = async () => {
    setLoading(true);

    const { error } = await supabase
      .from("chama_contribution_requests")
      .insert([
        {
          chama_id: chamaId,
          user_id: user?.id,
          name: user?.name,
          amount: Number(form.amount),
          type: form.type,
          date: form.date,
          comment: form.comment,
          status: "PENDING",
        },
      ]);

    setLoading(false);

    if (!error) {
      alert("Contribution sent for approval!");
      setForm({
        amount: "",
        type: "savings",
        date: "",
        comment: "",
      });
    } else {
      alert("Failed to send contribution");
    }
  };

  return (
    <div className="send-container">

      <h2>Send Contribution</h2>

      {/* AMOUNT */}
      <div className="field">
        <Wallet size={18} />
        <input
          name="amount"
          value={form.amount}
          onChange={handleChange}
          placeholder="Enter amount (KES)"
          type="number"
        />
      </div>

      {/* TYPE */}
      <div className="field">
        <select name="type" value={form.type} onChange={handleChange}>
          <option value="savings">Savings</option>
          <option value="fines">Fines</option>
          <option value="loans">Loans</option>
          <option value="welfare">Welfare</option>
          <option value="merry_go_round">Merry Go Round</option>
        </select>
      </div>

      {/* ===== CLEAN CALENDAR FIELD ===== */}
      <div className="calendar-card" onClick={openCalendar}>

        <div className="calendar-icon">
          <Calendar size={20} />
        </div>

        <div className="calendar-text">
          <span className="label">Contribution Date</span>
          <span className="value">
            {form.date || "Select date"}
          </span>
        </div>

        <div className="calendar-action">
          Click
        </div>

        <input
          ref={dateRef}
          type="date"
          name="date"
          value={form.date}
          onChange={handleChange}
          className="hidden-date"
        />

      </div>

      {/* COMMENT */}
      <textarea
        name="comment"
        value={form.comment}
        onChange={handleChange}
        placeholder="Comment (e.g June 2026 savings)"
      />

      {/* SUBMIT */}
      <button onClick={submit} disabled={loading} className="send-btn">
        <Send size={18} />
        {loading ? "Sending..." : "Send for Approval"}
      </button>

    </div>
  );
};

export default ChamaSendContribution;