import React from "react";
import { Link, useOutletContext } from "react-router-dom";
import { User, Bell, ShieldCheck, Info, LogOut, ChevronRight } from "lucide-react";
import { PageHeader, Card } from "./ui";
import { NotificationList } from "./NotificationCenter";
import PasskeySettings from "../components/Auth/PasskeySettings";
import Profile from "../components/Dashboard/Profile";
import { supabase } from "../supabaseClient";
import FingerprintToggle from "../security/FingerprintToggle";
import { isNativeApp } from "../security/nativeBiometric";

export function MoreWorkspace() {
  const { logout, unreadNotifications } = useOutletContext();
  const items = [
    { to: "/member/profile", label: "My Profile", icon: User },
    { to: "/member/notifications", label: "Notifications", icon: Bell, badge: unreadNotifications },
    { to: "/member/security", label: "Security", icon: ShieldCheck },
    { to: "/financial", label: "About Umova", icon: Info },
  ];
  return (
    <>
      <PageHeader title="More" />
      <section className="uma-card">
        {items.map(({ to, label, icon: Icon, badge }) => (
          <Link key={to} to={to} className="uma-row" style={{ minHeight: 52 }}>
            <span style={{ display: "flex", gap: 12, alignItems: "center" }}><Icon size={20} color="#237A52" />{label}
              {badge > 0 && <span className="uma-pill uma-pill--warn">{badge}</span>}</span>
            <ChevronRight size={18} color="#68756D" />
          </Link>
        ))}
        <button className="uma-row" style={{ width: "100%", background: "none", border: 0, minHeight: 52, color: "#A23B2B" }} onClick={logout}>
          <span style={{ display: "flex", gap: 12, alignItems: "center" }}><LogOut size={20} />Log out</span>
        </button>
      </section>
    </>
  );
}

export function NotificationsWorkspace() {
  const { notifications } = useOutletContext();
  return (
    <>
      <PageHeader title="Notifications" description="Loan updates, contributions and SACCO announcements." />
      <section className="uma-card"><NotificationList notifications={notifications} /></section>
    </>
  );
}

// Phone app: one simple "Fingerprint login" switch for THIS phone (no device naming, no device picking).
// Web: unchanged, still the existing passkey screen. Passkeys are intentionally not offered inside the
// native app, so Android's passkey chooser never appears there.
export function SecurityWorkspace() {
  const native = isNativeApp();
  return (
    <>
      <PageHeader
        title="Security"
        description={native ? "Fingerprint and sign-in settings." : "Passkeys and sign-in settings."}
      />
      <Card>
        {native ? <FingerprintToggle service="finance" client={supabase} /> : <PasskeySettings />}
      </Card>
    </>
  );
}

// Existing Profile screen (photo, phone, email, KYC, edit) inside the new shell.
export function ProfileWorkspace() {
  const { memberNo } = useOutletContext();
  return (
    <>
      <PageHeader title="My Profile" description="Your membership details." />
      <Profile memberNo={memberNo} />
    </>
  );
}
