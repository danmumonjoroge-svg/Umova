import React, { useEffect, useState } from "react";
import { supabase } from "../../supabaseClient";

/* =========================
   ADD PROFILE CSS HERE
========================= */
import "./profile.css";

const Profile = () => {
  const member = JSON.parse(localStorage.getItem("member"));
  const memberNo = member?.member_no;

  const [profile, setProfile] = useState(null);
  const [editMode, setEditMode] = useState(false);

  const [form, setForm] = useState({
    email: "",
    phone: "",
    kra: "",
    next_of_kin: "",
    nominee: "",
    photo_url: "",
    national_id: "",
  });

  const [photoFile, setPhotoFile] = useState(null);

  useEffect(() => {
    if (memberNo) fetchProfile();
  }, [memberNo]);

  // ================= FETCH PROFILE =================
  const fetchProfile = async () => {
    const { data, error } = await supabase
      .from("members")
      .select("*")
      .eq("member_no", memberNo)
      .maybeSingle();

    if (error) {
      console.log("PROFILE ERROR:", error);
      return;
    }

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
  };

  // ================= PHOTO UPLOAD =================
  const uploadPhoto = async () => {
    if (!photoFile) return form.photo_url;

    const ext = photoFile.name.split(".").pop();
    const fileName = `${memberNo}-${Date.now()}.${ext}`;

    const { error } = await supabase.storage
      .from("profile_photo")
      .upload(fileName, photoFile, { upsert: true });

    if (error) return form.photo_url;

    const { data } = supabase.storage
      .from("profile_photo")
      .getPublicUrl(fileName);

    return data.publicUrl;
  };

  // ================= SAVE PROFILE =================
  const saveProfile = async () => {
    const url = await uploadPhoto();

    const { error } = await supabase
      .from("members")
      .update({
        Email: form.email,
        telephone: form.phone,
        KRA: form.kra,
        "Next-of-kin": form.next_of_kin,
        Nominee: form.nominee,
        national_id: form.national_id,
        photo_url: url || form.photo_url,
        kyc_status: "PENDING",
      })
      .eq("member_no", memberNo);

    if (error) {
      alert(error.message);
      return;
    }

    setEditMode(false);
    fetchProfile();
  };

  // ================= KYC SCORE =================
  const kycScore = () => {
    const fields = [
      form.email,
      form.phone,
      form.kra,
      form.next_of_kin,
      form.nominee,
      form.national_id,
    ];

    return Math.round(
      (fields.filter(Boolean).length / fields.length) * 100
    );
  };

  if (!profile)
    return <p className="p-4 text-gray-500">Loading profile...</p>;

  return (
    <div className="bg-gray-100 min-h-screen p-4 space-y-4">

      {/* ================= HEADER ================= */}
      <div className="bg-white rounded-xl shadow p-4 flex items-center gap-4">

        <img
          src={
            form.photo_url ||
            "https://ui-avatars.com/api/?name=" + profile.name
          }
          className="w-16 h-16 rounded-full object-cover border"
          alt="profile"
        />

        <div className="flex-1">
          <h2 className="font-bold">{profile.name}</h2>
          <p className="text-sm text-gray-500">{memberNo}</p>

          <p className="text-xs text-green-600 font-bold">
            KYC: {profile.kyc_status || "PENDING"}
          </p>
        </div>

        <button
          onClick={() => setEditMode(!editMode)}
          className="text-xs bg-green-600 text-white px-3 py-1 rounded"
        >
          {editMode ? "Close" : "Edit"}
        </button>
      </div>

      {/* ================= KYC PROGRESS ================= */}
      <div className="bg-white p-3 rounded-xl shadow">
        <p className="text-xs font-bold mb-2">
          KYC Completion: {kycScore()}%
        </p>

        <div className="w-full bg-gray-200 h-2 rounded-full">
          <div
            className="bg-green-500 h-2 rounded-full"
            style={{ width: `${kycScore()}%` }}
          />
        </div>
      </div>

      {/* ================= SECTIONS ================= */}
      <Section title="IDENTITY">
        <Row label="KRA PIN" value={form.kra} />
        <Row label="ID Number" value={form.national_id} />
      </Section>

      <Section title="CONTACT">
        <Row label="Email" value={form.email} />
        <Row label="Phone" value={form.phone} />
      </Section>

      <Section title="BENEFICIARY">
        <Row label="Next of Kin" value={form.next_of_kin} />
        <Row label="Nominee" value={form.nominee} />
      </Section>

      {/* ================= EDIT MODE ================= */}
      {editMode && (
        <div className="bg-white p-3 rounded-xl shadow space-y-2">

          <Input label="Email" value={form.email}
            onChange={(v) => setForm({ ...form, email: v })}
          />

          <Input label="Phone" value={form.phone}
            onChange={(v) => setForm({ ...form, phone: v })}
          />

          <Input label="KRA PIN" value={form.kra}
            onChange={(v) => setForm({ ...form, kra: v })}
          />

          <Input label="ID Number" value={form.national_id}
            onChange={(v) => setForm({ ...form, national_id: v })}
          />

          <Input label="Next of Kin" value={form.next_of_kin}
            onChange={(v) =>
              setForm({ ...form, next_of_kin: v })
            }
          />

          <Input label="Nominee" value={form.nominee}
            onChange={(v) =>
              setForm({ ...form, nominee: v })
            }
          />

          <input
            type="file"
            onChange={(e) => setPhotoFile(e.target.files[0])}
          />

          <button
            onClick={saveProfile}
            className="w-full bg-blue-600 text-white py-2 rounded"
          >
            Save Profile (KYC Update)
          </button>
        </div>
      )}
    </div>
  );
};

// ================= UI COMPONENTS =================
const Section = ({ title, children }) => (
  <div className="bg-white rounded-xl shadow p-3">
    <h3 className="text-[10px] font-bold text-gray-500 mb-2 border-b pb-1">
      {title}
    </h3>
    <div className="space-y-1">{children}</div>
  </div>
);

const Row = ({ label, value }) => (
  <div className="flex justify-between text-xs">
    <span className="text-gray-500">{label}</span>
    <span className="font-semibold">{value || "-"}</span>
  </div>
);

const Input = ({ label, value, onChange }) => (
  <div>
    <label className="text-[10px] text-gray-500">{label}</label>
    <input
      className="w-full border rounded px-2 py-1 text-xs"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </div>
);

export default Profile;