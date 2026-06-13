import React, { useState, useEffect, useRef } from "react";
import { supabase } from "../../supabaseClient";
import { useNavigate } from "react-router-dom";
import { useChama } from "./ChamaContext";
import "./ChamaLogin.css";

export default function ChamaLogin() {
  const navigate = useNavigate();
  const { login } = useChama();

  const inputRef = useRef(null);

  const [step, setStep] = useState(1);
  const [chamaNo, setChamaNo] = useState("");
  const [phone, setPhone] = useState("");
  const [chama, setChama] = useState(null);
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(t);
  }, [step]);

  const clean = (v) => v.replace(/\s/g, "").trim();

  const findChama = async () => {
    if (!chamaNo) return setError("Enter chama code");

    setLoading(true);

    const { data } = await supabase
      .from("chamas")
      .select("*")
      .eq("chama_no", clean(chamaNo))
      .maybeSingle();

    setLoading(false);

    if (!data) return setError("Chama not found");

    setChama(data);
    setStep(2);
  };

  const verifyMember = async () => {
    if (!phone) return setError("Enter phone number");

    setLoading(true);

    const { data } = await supabase
      .from("chama_members")
      .select("*")
      .eq("phone", clean(phone))
      .eq("chama_id", chama.id)
      .maybeSingle();

    setLoading(false);

    if (!data) return setError("Member not found");

    setMember(data);
    setStep(3);
  };

  const handleLogin = () => {
    login({
      chamaData: chama,
      memberData: member,
    });

    navigate("/chama/home");
  };

  return (
    <div className="login-wrapper">

      {step === 1 && (
        <div>
          <h2>Find Chama</h2>

          <input
            ref={inputRef}
            value={chamaNo}
            onChange={(e) => setChamaNo(e.target.value)}
            placeholder="Chama code"
          />

          <button onClick={findChama}>
            {loading ? "Searching..." : "Next"}
          </button>

          <p style={{ color: "red" }}>{error}</p>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2>Verify Member</h2>

          <p>{chama?.name}</p>

          <input
            ref={inputRef}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone number"
          />

          <button onClick={verifyMember}>
            {loading ? "Checking..." : "Verify"}
          </button>

          <button onClick={() => setStep(1)}>Back</button>

          <p style={{ color: "red" }}>{error}</p>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2>Welcome {member?.full_name || member?.phone}</h2>

          <button onClick={handleLogin}>
            Enter Chama
          </button>

          <button onClick={() => setStep(1)}>Reset</button>
        </div>
      )}
    </div>
  );
}