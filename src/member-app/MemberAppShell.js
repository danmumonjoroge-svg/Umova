import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Bell } from "lucide-react";
import { useAuth } from "../Context/AuthContext";
import { supabase } from "../supabaseClient";
import { useMemberLedger } from "../hooks/useMemberLedger";
import { MemberSidebar, MemberMobileNav, Brand } from "./MemberNav";
import NotificationCenter from "./NotificationCenter";
import AppLock from "../security/AppLock";
import "./member-app.css";

const SEEN_KEY = "umova-notif-last-seen";

// The one member shell. Data is loaded once here and handed to every
// workspace through Outlet context (same shape the legacy pages already read:
// memberNo, ledgerMetrics, notifications, unreadNotifications, markNotificationsSeen).
export default function MemberAppShell() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const memberNo = profile?.member_no || profile?.memberNo;

  const { ledger, rows, loading: ledgerLoading, error: ledgerError, reload: reloadLedger } = useMemberLedger(memberNo);

  // Full members row (phone, KYC, photo…) — AuthContext's profile only carries a few columns.
  const [member, setMember] = useState(null);
  useEffect(() => {
    if (!memberNo) return;
    supabase.from("members").select("*").eq("member_no", memberNo).maybeSingle()
      .then(({ data }) => setMember(data || null));
  }, [memberNo]);

  useEffect(() => {
    if (!memberNo) return;
    const ch = supabase.channel(`member-app-${memberNo}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "general_ledger", filter: `member_no=eq.${memberNo}` }, () => reloadLedger())
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, [memberNo, reloadLedger]);

  // Notifications — same source and realtime feed as before.
  const [notifications, setNotifications] = useState([]);
  const [lastSeen, setLastSeen] = useState(() => { try { return localStorage.getItem(SEEN_KEY); } catch { return null; } });
  const [panel, setPanel] = useState(false);

  useEffect(() => {
    supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(30)
      .then(({ data, error }) => { if (!error) setNotifications(data || []); });
    const ch = supabase.channel("member-app-notifications")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" },
        (p) => setNotifications((prev) => [p.new, ...prev].slice(0, 30)))
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const unread = useMemo(() => lastSeen
    ? notifications.filter((n) => new Date(n.created_at) > new Date(lastSeen)).length
    : notifications.length, [notifications, lastSeen]);

  const markSeen = useCallback(() => {
    const now = new Date().toISOString();
    setLastSeen(now);
    try { localStorage.setItem(SEEN_KEY, now); } catch { /* badge just won't persist */ }
  }, []);

  const ledgerMetrics = useMemo(() => ({
    savings: Math.max(0, ledger.savings.balance),
    loans: Math.max(0, ledger.loans.balance),
    shares: Math.max(0, ledger.shares.balance),
    interest: Math.max(0, ledger.totalRepayments),
  }), [ledger]);

  const handleLogout = async () => { try { await logout(); } catch (e) { console.error(e); } };

  // AppLock sits INSIDE MemberGuard (App.js), so the user is already authenticated and their role resolved.
  // It only adds the phone lock screen + "Enable fingerprint login?" prompt; on web it renders children untouched.
  return (
    <AppLock service="finance" client={supabase} onSignOut={handleLogout}>
    <div className="uma">
      <MemberSidebar onLogout={handleLogout} />
      <div className="uma-main">
        <header className="uma-top">
          <Brand />
          <button className="uma-icon-btn" aria-label="Notifications" aria-expanded={panel}
            onClick={() => { setPanel((v) => !v); if (!panel) markSeen(); }}>
            <Bell size={20} />
            {unread > 0 && <span className="uma-badge">{unread > 9 ? "9+" : unread}</span>}
          </button>
        </header>
        {panel && (
          <NotificationCenter notifications={notifications} onClose={() => setPanel(false)}
            onSeeAll={() => { setPanel(false); navigate("/member/notifications"); }} />
        )}
        <main className="uma-content">
          <Outlet context={{
            memberNo, profile, member, ledger, rows, ledgerLoading, ledgerError, reloadLedger,
            ledgerMetrics, notifications, unreadNotifications: unread, markNotificationsSeen: markSeen,
            logout: handleLogout,
          }} />
        </main>
      </div>
      <MemberMobileNav />
    </div>
    </AppLock>
  );
}
