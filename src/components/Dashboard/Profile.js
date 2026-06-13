// src/components/Dashboard/Profile.js

import React, { useEffect, useState, useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "../../supabaseClient";
import { 
  User, ShieldCheck, Mail, Phone, FileText, 
  Users, Camera, CheckCircle, Save, X, RefreshCw 
} from "lucide-react";

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

  if (!profile) {
    return (
      <div className="flex flex-col items-center justify-center p-24 space-y-4">
        <div className="w-10 h-10 border-4 border-green-800 border-t-transparent rounded-full animate-spin" />
        <p className="text-slate-400 font-bold text-[11px] tracking-widest uppercase animate-pulse">Syncing Registry Credentials...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto p-1 main-content-fade">
      
      {/* MASTER USER IDENTITY CARD HEADER */}
      <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-6 relative overflow-hidden">
        <div className="flex flex-col sm:flex-row items-center gap-5 z-10 text-center sm:text-left w-full sm:w-auto">
          <div className="relative group">
            <img
              src={photoPreview || form.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(profile.name)}&background=15803d&color=fff`}
              className="w-20 h-20 rounded-full object-cover border-2 border-slate-100 shadow-md bg-slate-50 transition duration-200"
              alt="User Identification Avatar"
            />
            <div className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition duration-150 pointer-events-none">
              <Camera size={18} className="text-white" />
            </div>
          </div>

          <div className="space-y-1">
            <h2 className="text-xl font-black text-slate-800 tracking-tight">{profile.name}</h2>
            <p className="text-xs font-mono font-bold text-slate-400 uppercase tracking-wider">{memberNo}</p>
            
            <div className="pt-1.5 flex flex-wrap justify-center sm:justify-start gap-2">
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border tracking-wider uppercase ${
                profile.kyc_status === "VERIFIED" 
                  ? "bg-emerald-50 text-emerald-700 border-emerald-200" 
                  : "bg-amber-50 text-amber-700 border-amber-200 animate-pulse"
              }`}>
                KYC: {profile.kyc_status || "PENDING"}
              </span>
              <span className="bg-slate-50 text-slate-500 text-[10px] font-bold border border-slate-200 px-2.5 py-0.5 rounded-full">
                Member Node Node Client
              </span>
            </div>
          </div>
        </div>

        <button
          onClick={() => { setEditMode(!editMode); setPhotoPreview(""); }}
          className={`px-5 py-2.5 rounded-xl font-bold text-xs tracking-tight transition flex items-center gap-2 z-10 w-full sm:w-auto justify-center ${
            editMode 
              ? "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200" 
              : "bg-green-900 text-white hover:bg-green-950 shadow-sm"
          }`}
        >
          {editMode ? <X size={14} /> : <User size={14} />}
          {editMode ? "Cancel Revision" : "Modify Registry Profile"}
        </button>

        <div className="absolute -right-12 -bottom-12 text-slate-500/5 pointer-events-none transform scale-150 rotate-45 font-black text-9xl select-none">KYC</div>
      </div>

      {/* COMPLIANCE COMPLETION REGISTRY COMPASS */}
      <div className="bg-white border border-slate-200 p-5 rounded-3xl shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
            <CheckCircle size={14} className="text-green-700" /> Account Completion Metrics
          </p>
          <span className="text-sm font-black font-mono text-green-900 bg-green-50 px-2.5 py-0.5 border border-green-100 rounded-lg">{kycCompletionPercentage}%</span>
        </div>
        <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden border border-slate-200/40">
          <div
            className="bg-gradient-to-r from-green-700 to-emerald-500 h-full rounded-full transition-all duration-500 ease-out"
            style={{ width: `${kycCompletionPercentage}%` }}
          />
        </div>
      </div>

      {/* CORE DISPLAY HOVER SYSTEM AND DATA SPLIT VIEWPORTS */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* READ-ONLY REGISTRY RECORDS FIELDSET MAP */}
        <div className={`${editMode ? "lg:col-span-1" : "lg:col-span-3"} space-y-5 transition-all duration-300`}>
          
          <ProfileGroupSection title="NATIONAL IDENTITY RECORDS" icon={<ShieldCheck className="text-slate-400" size={16} />}>
            <ProfileRowField label="KRA COMPLIANCE PIN" value={profile.KRA || profile.kra} />
            <ProfileRowField label="NATIONAL IDENTIFICATION NO" value={profile.national_id} />
          </ProfileGroupSection>

          <ProfileGroupSection title="CONTACT COMMUNICATOR CHANNELS" icon={<Mail className="text-slate-400" size={16} />}>
            <ProfileRowField label="VERIFIED EMAIL ADDRESS" value={profile.Email || profile.email} isMono />
            <ProfileRowField label="TELEPHONE SYSTEM REF" value={profile.telephone || profile.phone} />
          </ProfileGroupSection>

          <ProfileGroupSection title="BENEFICIARY TRUSTEE PROFILES" icon={<Users className="text-slate-400" size={16} />}>
            <ProfileRowField label="REGISTERED NEXT OF KIN" value={profile["Next-of-kin"] || profile.next_of_kin} />
            <ProfileRowField label="PORTFOLIO NOMINEE ASSIGNED" value={profile.Nominee || profile.nominee} />
          </ProfileGroupSection>

        </div>

        {/* INTERACTIVE COMPLIANCE MUTATION PANEL */}
        {editMode && (
          <form onSubmit={handleSaveProfile} className="lg:col-span-2 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-5 main-content-fade">
            <div className="border-b border-slate-100 pb-3">
              <h3 className="text-sm font-black text-slate-800 tracking-tight uppercase">Registry Revision Ledger Form</h3>
              <p className="text-xs text-slate-400 font-medium mt-0.5">Updated data undergoes strict verification against structural regulatory systems.</p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ProfileInputBlock label="Email Address" value={form.email} onChange={(v) => setForm({ ...form, email: v })} type="email" />
              <ProfileInputBlock label="Telephone Reference" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} type="tel" />
              <ProfileInputBlock label="KRA PIN Verification" value={form.kra} onChange={(v) => setForm({ ...form, kra: v })} />
              <ProfileInputBlock label="National ID Number" value={form.national_id} onChange={(v) => setForm({ ...form, national_id: v })} />
              <ProfileInputBlock label="Next of Kin Identity" value={form.next_of_kin} onChange={(v) => setForm({ ...form, next_of_kin: v })} />
              <ProfileInputBlock label="Nominee Equity Beneficiary" value={form.nominee} onChange={(v) => setForm({ ...form, nominee: v })} />
            </div>

            {/* AVATAR DOCUMENT FILE CAPTURED STRIP */}
            <div className="space-y-2 pt-1">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Modify Identification Image Asset</label>
              <div className="flex items-center justify-center w-full">
                <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-slate-200 border-dashed rounded-2xl cursor-pointer bg-slate-50 hover:bg-slate-100/70 transition duration-150 px-4">
                  <div className="flex flex-col items-center justify-center pt-2 pb-2 text-center">
                    <Camera size={20} className="text-slate-400 mb-1" />
                    <p className="text-xs text-slate-500 font-medium"><span className="font-bold text-green-800">Click to select file</span> or drag image asset</p>
                    <p className="text-[10px] text-slate-400 font-mono mt-0.5">JPEG, PNG up to 2MB capacity limits</p>
                  </div>
                  <input type="file" accept="image/*" onChange={handlePhotoChange} className="hidden" />
                </label>
              </div>
              {photoFile && (
                <p className="text-[11px] text-emerald-600 font-bold bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-xl inline-block mt-1">
                  ✓ Selected File Stream Asset: <span className="font-mono text-slate-600">{photoFile.name}</span>
                </p>
              )}
            </div>

            {/* SUBMISSION CONTROL SWITCHES */}
            <div className="pt-3 border-t border-slate-100 flex items-center gap-3">
              <button
                type="submit"
                disabled={saving}
                className="flex-1 bg-green-950 hover:bg-green-900 disabled:opacity-60 text-white font-bold text-xs tracking-tight py-3 rounded-xl shadow-sm transition flex items-center justify-center gap-2"
              >
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Save size={14} />}
                {saving ? "Executing Asset Uploads..." : "Commit Registry Revisions (KYC Update)"}
              </button>
            </div>
          </form>
        )}

      </div>
    </div>
  );
}

// ==========================================
// PURE PRESENTATIONAL UI SUBSYSTEMS
// ==========================================
const ProfileGroupSection = ({ title, icon, children }) => (
  <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3.5">
    <div className="flex items-center gap-2 border-b border-slate-100 pb-2.5">
      {icon}
      <h3 className="text-[11px] font-black text-slate-400 tracking-widest uppercase">{title}</h3>
    </div>
    <div className="space-y-3">{children}</div>
  </div>
);

const ProfileRowField = ({ label, value, isMono = false }) => (
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs border-b border-slate-50 pb-2.5 last:border-0 last:pb-0">
    <span className="text-slate-400 font-bold tracking-tight">{label}</span>
    <span className={`font-semibold text-slate-700 ${isMono ? "font-mono text-slate-500" : ""}`}>
      {value || <span className="text-slate-300 font-normal italic">Data Record Deficit</span>}
    </span>
  </div>
);

const ProfileInputBlock = ({ label, value, onChange, type = "text" }) => (
  <div className="space-y-1.5">
    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide block">{label}</label>
    <input
      type={type}
      className="w-full bg-white border border-slate-200 text-slate-700 font-semibold text-xs px-3.5 py-2.5 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-800 focus:border-transparent transition"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);