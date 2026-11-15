// src/components/Dashboard/Profile.js

import React, { useEffect, useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import { ShieldCheck, Mail, Users, Camera, Save, X, RefreshCw, Pencil, Fingerprint } from "lucide-react";
import FingerprintToggle from "../../security/FingerprintToggle";
import { isNativeApp } from "../../security/nativeBiometric";
import { Card, Field, Pill, PageLoading, SubGrid } from "./MemberUI";

export default function Profile({ memberNo: propMemberNo }) {
  // Pull core user authentication metadata straight from the Dashboard routing shell
  const routerContext = useOutletContext() || {};
  
  const [memberNo, setMemberNo] = useState(null);
  const [profile, setProfile] = useState(null);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");

  const [form, setForm] = useState({
    email: "",
    phone: "",
    kra: "",
    next_of_kin: "",
    nominee: "",
    photo_url: "",
    national_id: "",
  });

  // ==========================================
  // RESOLVE USER PARAMETERS PIPELINE
  // ==========================================
  useEffect(() => {
    const resolved = propMemberNo || routerContext.memberNo;
    if (resolved) {
      setMemberNo(resolved);
    } else {
      const stored = localStorage.getItem("member") || localStorage.getItem("user");
      if (stored) {
        const parsed = JSON.parse(stored);
        setMemberNo(parsed?.member_no || parsed?.memberNo || parsed?.profile?.member_no);
      }
    }
  }, [propMemberNo, routerContext.memberNo]);

  // ==========================================
  // DATA FETCHER ENGINE
  // ==========================================
  const fetchProfileData = async () => {
    if (!memberNo) return;
    try {
      const { data, error } = await supabase
        .from("members")
        .select("*")
        .eq("member_no", memberNo)
        .maybeSingle();

      if (error) throw error;
      if (!data) return;

      setProfile(data);
      setForm({
        email: data.Email || data.email || "",
        phone: data.telephone || data.phone || "",
        kra: data.KRA || data.kra || "",
        next_of_kin: data["Next-of-kin"] || data.next_of_kin || "",
        nominee: data.Nominee || data.nominee || "",
        photo_url: data.photo_url || "",
        national_id: data.national_id || "",
      });
    } catch (err) {
      console.error("[PROFILE_FETCH_FAULT]:", err.message);
    }
  };

  useEffect(() => {
    fetchProfileData();
  }, [memberNo]);

  // Handle runtime image preview generations
  const handlePhotoChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  // ==========================================
  // PHOTO BUCKET STORAGE ENGINE
  // ==========================================
  const uploadPhotoToBucket = async () => {
    if (!photoFile) return form.photo_url;
    try {
      const ext = photoFile.name.split(".").pop();
      const fileName = `${memberNo}-${Date.now()}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("profile_photo")
        .upload(fileName, photoFile, { upsert: true });

      if (uploadError) throw uploadError;

      const { data } = supabase.storage
        .from("profile_photo")
        .getPublicUrl(fileName);

      return data.publicUrl;
    } catch (err) {
      console.error("[STORAGE_UPLOAD_FAULT]:", err.message);
      return form.photo_url;
    }
  };

  // ==========================================
  // UPDATE SAVE MUTATOR
  // ==========================================
  const handleSaveProfile = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      const targetPublicUrl = await uploadPhotoToBucket();

      const { error } = await supabase
        .from("members")
        .update({
          Email: form.email,
          telephone: form.phone,
          KRA: form.kra,
          "Next-of-kin": form.next_of_kin,
          Nominee: form.nominee,
          national_id: form.national_id,
          photo_url: targetPublicUrl || form.photo_url,
          kyc_status: "PENDING", // Pushed back to admin queue for audit compliance verification
        })
        .eq("member_no", memberNo);

      if (error) throw error;

      setEditMode(false);
      setPhotoFile(null);
      await fetchProfileData();
    } catch (err) {
      alert(`Mutation Error: ${err.message}`);
    } finally {
      setSaving(false);
    }
  };

  // ==========================================
  // MEMOIZED KYC ACCOUNT WEIGHT SCORE
  // ==========================================
  const kycCompletionPercentage = useMemo(() => {
    const tracks = [
      form.email,
      form.phone,
      form.kra,
      form.next_of_kin,
      form.nominee,
      form.national_id,
    ];
    const filled = tracks.filter(Boolean).length;
    return Math.round((filled / tracks.length) * 100);
  }, [form]);

  if (!profile) return <PageLoading text="Loading your profile…" />;

  const initials = String(profile.name || "M").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const photo = photoPreview || form.photo_url;
  const kycVerified = profile.kyc_status === "VERIFIED";

  return (
    <div className="mu">
      {/* IDENTITY HERO */}
      <section className="mu-hero" aria-label="Your profile">
        <div className="mu-profile-top">
          {photo
            ? <img src={photo} alt="" className="mu-avatar" />
            : <span className="mu-avatar mu-avatar--initials" aria-hidden="true">{initials}</span>}
          <div className="mu-profile-id">
            <h1 className="mu-title">{profile.name}</h1>
            <p className="mu-eyebrow">{memberNo}</p>
            <div className="mu-profile-pills">
              <Pill tone={kycVerified ? "good" : "gold"}>KYC: {profile.kyc_status || "PENDING"}</Pill>
            </div>
          </div>
        </div>

        <div className="mu-glass" style={{ marginTop: 14 }}>
          <span className="mu-glass-label">Profile completeness</span>
          <span className="mu-glass-amt">{kycCompletionPercentage}%</span>
          <div className="mu-progress mu-progress--on-dark"><div className="mu-progress-fill" style={{ width: `${kycCompletionPercentage}%` }} /></div>
        </div>

        <div className="mu-actions" style={{ marginTop: 14 }}>
          <button
            type="button"
            className={`mu-btn ${editMode ? "mu-btn--ghost" : "mu-btn--gold"} mu-btn--block`}
            onClick={() => { setEditMode(!editMode); setPhotoPreview(""); }}
          >
            {editMode ? <X size={16} /> : <Pencil size={16} />}
            {editMode ? "Cancel" : "Edit profile"}
          </button>
        </div>
      </section>

      {!editMode && (
        <div className="mu-grid">
          <Card icon={ShieldCheck} title="Identity">
            <div className="mu-stack">
              <Field label="KRA PIN" value={profile.KRA || profile.kra} />
              <Field label="National ID number" value={profile.national_id} />
            </div>
          </Card>

          <Card icon={Mail} title="Contact">
            <div className="mu-stack">
              <Field label="Email address" value={profile.Email || profile.email} mono />
              <Field label="Telephone" value={profile.telephone || profile.phone} />
            </div>
          </Card>

          <Card icon={Users} title="Next of kin & nominee" span>
            <SubGrid cols={2}>
              <Field label="Next of kin" value={profile["Next-of-kin"] || profile.next_of_kin} />
              <Field label="Nominee" value={profile.Nominee || profile.nominee} />
            </SubGrid>
          </Card>

          {/* Fingerprint sign-in for THIS phone. Renders nothing on the web, so the card is only shown in the app. */}
          {isNativeApp() && (
            <Card icon={Fingerprint} title="Security" hint="Sign in on this phone with your fingerprint" span>
              <FingerprintToggle service="finance" client={supabase} />
            </Card>
          )}
        </div>
      )}

      {/* EDIT FORM (same fields and the same save handler as before) */}
      {editMode && (
        <form onSubmit={handleSaveProfile} className="mu-stack">
          <Card icon={Mail} title="Contact">
            <div className="mu-formgrid">
              <FormField label="Email address" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
              <FormField label="Telephone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} type="tel" />
            </div>
          </Card>

          <Card icon={ShieldCheck} title="Identity">
            <div className="mu-formgrid">
              <FormField label="KRA PIN" value={form.kra} onChange={(v) => setForm({ ...form, kra: v })} />
              <FormField label="National ID number" value={form.national_id} onChange={(v) => setForm({ ...form, national_id: v })} />
            </div>
          </Card>

          <Card icon={Users} title="Next of kin & nominee">
            <div className="mu-formgrid">
              <FormField label="Next of kin" value={form.next_of_kin} onChange={(v) => setForm({ ...form, next_of_kin: v })} />
              <FormField label="Nominee" value={form.nominee} onChange={(v) => setForm({ ...form, nominee: v })} />
            </div>
          </Card>

          <Card icon={Camera} title="Profile photo">
            <label className="mu-drop">
              <Camera size={20} />
              <span><b>Choose a photo</b> from your phone</span>
              <small>JPEG or PNG, up to 2 MB</small>
              <input type="file" accept="image/*" onChange={handlePhotoChange} />
            </label>
            {photoFile && <p className="mu-note" style={{ marginTop: 8 }}>Selected: <b>{photoFile.name}</b></p>}
          </Card>

          <p className="mu-note">Saving sends your details to the SACCO office to be verified again.</p>
          <button type="submit" disabled={saving} className="mu-btn mu-btn--primary">
            {saving ? <RefreshCw size={16} className="mu-spinning" /> : <Save size={16} />}
            {saving ? "Saving…" : "Save changes"}
          </button>
        </form>
      )}
    </div>
  );
}

const FormField = ({ label, value, onChange, type = "text" }) => (
  <label>
    <span className="mu-label">{label}</span>
    <input type={type} className="mu-input" value={value} onChange={(e) => onChange(e.target.value)} />
  </label>
);
