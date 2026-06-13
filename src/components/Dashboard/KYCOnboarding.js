import React, { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

export default function KYCOnboarding() {
  const member = JSON.parse(localStorage.getItem("member"));
  const memberNo = member?.member_no;

  const [data, setData] = useState(null);
  const [step, setStep] = useState(1);

  // documents
  const [idFront, setIdFront] = useState(null);
  const [idBack, setIdBack] = useState(null);
  const [passport, setPassport] = useState(null);

  useEffect(() => {
    fetchMember();
  }, []);

  const fetchMember = async () => {
    const { data } = await supabase
      .from("members")
      .select("*")
      .eq("member_no", memberNo)
      .single();

    setData(data);
  };

  // ================= UPLOAD FILE =================
  const uploadFile = async (file, folder) => {
    if (!file) return null;

    const fileName = `${memberNo}-${Date.now()}`;

    const { error } = await supabase.storage
      .from(folder)
      .upload(fileName, file);

    if (error) {
      console.log(error);
      return null;
    }

    const { data } = supabase.storage
      .from(folder)
      .getPublicUrl(fileName);

    return data.publicUrl;
  };

  // ================= SAVE STEP 1 =================
  const saveBasicInfo = async () => {
    await supabase
      .from("members")
      .update({
        kyc_status: "DRAFT",
      })
      .eq("member_no", memberNo);

    setStep(2);
  };

  // ================= UPLOAD DOCS =================
  const uploadDocs = async () => {
    const frontUrl = await uploadFile(idFront, "kyc_docs");
    const backUrl = await uploadFile(idBack, "kyc_docs");
    const passportUrl = await uploadFile(passport, "kyc_docs");

    await supabase
      .from("members")
      .update({
        id_front_url: frontUrl,
        id_back_url: backUrl,
        passport_photo_url: passportUrl,
      })
      .eq("member_no", memberNo);

    setStep(3);
  };

  // ================= SUBMIT FOR APPROVAL =================
  const submitKYC = async () => {
    await supabase
      .from("members")
      .update({
        kyc_status: "SUBMITTED",
        kyc_submitted_at: new Date(),
      })
      .eq("member_no", memberNo);

    alert("KYC submitted for approval");
    fetchMember();
  };

  if (!data) return <div>Loading KYC...</div>;

  return (
    <div style={styles.page}>

      {/* HEADER */}
      <h2>🧾 KYC Onboarding</h2>
      <p>Status: <b>{data.kyc_status}</b></p>

      {/* ================= STEP INDICATOR ================= */}
      <div style={styles.steps}>
        <Step active={step >= 1} label="Basic Info" />
        <Step active={step >= 2} label="Documents" />
        <Step active={step >= 3} label="Submit" />
      </div>

      {/* ================= STEP 1 ================= */}
      {step === 1 && (
        <div style={styles.card}>
          <h3>Basic Information Verified</h3>

          <p>Name: {data.name}</p>
          <p>Member No: {memberNo}</p>

          <button onClick={saveBasicInfo}>
            Continue →
          </button>
        </div>
      )}

      {/* ================= STEP 2 ================= */}
      {step === 2 && (
        <div style={styles.card}>
          <h3>Upload Documents</h3>

          <label>ID Front</label>
          <input type="file" onChange={(e) => setIdFront(e.target.files[0])} />

          <label>ID Back</label>
          <input type="file" onChange={(e) => setIdBack(e.target.files[0])} />

          <label>Passport Photo</label>
          <input type="file" onChange={(e) => setPassport(e.target.files[0])} />

          <button onClick={uploadDocs}>
            Upload & Continue →
          </button>
        </div>
      )}

      {/* ================= STEP 3 ================= */}
      {step === 3 && (
        <div style={styles.card}>
          <h3>Review & Submit</h3>

          <p>✔ ID Front Uploaded</p>
          <p>✔ ID Back Uploaded</p>
          <p>✔ Passport Uploaded</p>

          <button onClick={submitKYC}>
            🚀 Submit for Approval
          </button>
        </div>
      )}

    </div>
  );
}

/* ================= STEP UI ================= */
const Step = ({ active, label }) => (
  <div style={{
    padding: 6,
    borderRadius: 20,
    background: active ? "#16a34a" : "#e5e7eb",
    color: active ? "white" : "#333",
    fontSize: 12
  }}>
    {label}
  </div>
);

/* ================= STYLES ================= */
const styles = {
  page: { padding: 20 },
  steps: { display: "flex", gap: 10, marginBottom: 20 },
  card: {
    background: "#fff",
    padding: 15,
    borderRadius: 10,
    boxShadow: "0 1px 5px rgba(0,0,0,0.1)"
  }
};