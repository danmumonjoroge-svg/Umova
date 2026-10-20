// src/pos-erp/context/POSAuthContext.js
//
// Single frontend authority for POS auth. Owns the state machine
// (checking / logged_out / pending / rejected / suspended /
// must_change_password / authenticated), and is the only place that
// calls posSupabase.auth.* or the pos_* RPCs for login/session
// concerns. Does NOT import ../../AuthContext or useAuth() — POS
// staff status is resolved entirely through get_pos_profile(), never
// through the main app's users/members lookup.
//
// Note on "signup" as a stage: unlike the other six stages, whether
// to show the registration form isn't something the server tells us
// — there's no session yet to ask about. It's local UI navigation
// (see POSAuthGate), not part of this context's derived state.

import React, {
  createContext, useContext, useState, useEffect, useRef, useCallback,
} from "react";
import { posSupabase } from "../services/posSupabaseClient";
import { posPasskeys } from "../auth/posPasskeys";
// Offline mode: lets a phone that already signed in once keep opening the till with no signal. See
// offline/offlineIdentity.js for what is stored and the safety rules.
import { saveOfflineIdentity, loadOfflineIdentity, clearOfflineIdentity, canReachServer } from "../offline/offlineIdentity";
import { isNetworkFailure } from "../offline/netErrors";
import { ensureCacheOwner, clearOfflineCaches } from "../offline/offlineCache";
import { countUnsent } from "../offline/syncEngine";

const POSAuthContext = createContext(null);

// How often to re-check status while sitting on an authenticated-ish
// screen. This is what actually catches "tenant got suspended while
// staff kept working" promptly — RLS itself won't notice until the
// JWT refreshes (~1hr default), but this hits get_pos_profile()
// directly against the table, so it's live regardless of token age.
const REVALIDATE_INTERVAL_MS = 2 * 60 * 1000;

const REASON_TO_STAGE = {
  TENANT_NOT_APPROVED: "pending",
  TENANT_REJECTED: "rejected",
  TENANT_SUSPENDED: "suspended",
};

// Stages where it's worth periodically re-checking. Deliberately
// excludes "logged_out"/"checking" (nothing to revalidate) and
// "must_change_password" (mid-flow — don't yank the rug).
const REVALIDATE_STAGES = new Set(["authenticated", "pending", "suspended"]);

export function POSAuthProvider({ children }) {
  const [authStage, setAuthStage] = useState("checking");
  const [staff, setStaff] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [statusDetail, setStatusDetail] = useState(null); // rejection/suspension free-text reason
  const [logoutNotice, setLogoutNotice] = useState(null); // one-shot message shown on next logged_out render
  // true while the till was opened from the saved sign-in because the server cannot be reached.
  const [offlineSession, setOfflineSession] = useState(false);

  const mounted = useRef(true);
  const validating = useRef(false);
  const stageRef = useRef("checking");
  useEffect(() => { stageRef.current = authStage; }, [authStage]);

  const forceSignOut = useCallback(async (notice) => {
    clearOfflineIdentity(); // a signed-out (or refused) person must not be able to re-enter offline
    clearOfflineCaches();   // and the phone must not keep this business's customers/items for the next person
    setOfflineSession(false);
    try {
      await posSupabase.auth.signOut();
    } catch (err) {
      console.error("[POS AUTH] signOut error:", err);
    }
    if (!mounted.current) return;
    setStaff(null);
    setTenant(null);
    setStatusDetail(null);
    setLogoutNotice(notice ?? null);
    setAuthStage("logged_out");
  }, []);

  // Opens the till from the saved sign-in. Returns true if it did.
  const openFromSavedSignIn = useCallback(async () => {
    const id = loadOfflineIdentity();
    if (!id || !mounted.current) return false;
    await ensureCacheOwner(id.tenant?.id);
    setStaff(id.staff);
    setTenant(id.tenant);
    setStatusDetail(null);
    setOfflineSession(true);
    setAuthStage("authenticated");
    return true;
  }, []);

  const validate = useCallback(async () => {
    if (validating.current) return;
    validating.current = true;
    try {
      const { data: { session }, error: sessionError } = await posSupabase.auth.getSession();
      if (!session) {
        // No usable session. If that is only because the phone cannot reach the server (an expired token cannot be
        // refreshed with no internet) and this phone has a recent saved sign-in, keep working offline.
        if ((sessionError && isNetworkFailure(sessionError)) || (loadOfflineIdentity() && !(await canReachServer()))) {
          if (await openFromSavedSignIn()) return;
        }
        if (sessionError && isNetworkFailure(sessionError) && stageRef.current === "checking") {
          if (mounted.current) {
            setLogoutNotice("No internet. Connect once to sign in on this phone; after that it works offline.");
            setAuthStage("logged_out");
          }
          return;
        }
        clearOfflineIdentity();
        setOfflineSession(false);
        if (mounted.current) setAuthStage("logged_out");
        return;
      }

      const { data: profile, error } = await posSupabase.rpc("get_pos_profile");
      if (error) {
        // Transient network/RPC error: don't tear down a live session
        // over a blip. Leave the current stage as-is and try again
        // on the next interval/focus tick.
        console.error("[POS AUTH] get_pos_profile error:", error);
        if (isNetworkFailure(error)) {
          // No internet. A phone that signed in before may keep working from its saved sign-in; otherwise show the
          // login screen with a plain reason instead of spinning forever.
          if (await openFromSavedSignIn()) return;
          if (stageRef.current === "checking" && mounted.current) {
            setLogoutNotice("No internet. Connect once to sign in on this phone; after that it works offline.");
            setAuthStage("logged_out");
          }
        }
        return;
      }

      if (!profile?.ok) {
        if (profile?.reason === "STAFF_DISABLED") {
          await forceSignOut("Your staff account was disabled. Contact your business owner or manager.");
          return;
        }
        if (profile?.reason === "NOT_POS_SESSION") {
          // Real Supabase session exists but isn't a POS staff account
          // (shouldn't normally happen — defensive only).
          await forceSignOut(null);
          return;
        }
        // pending / rejected / suspended: session stays alive (an owner
        // may get approved without re-registering), just gate the UI.
        if (!mounted.current) return;
        setStaff(null);
        setTenant(profile?.tenant ?? null);
        setStatusDetail(profile?.detail ?? null);
        setAuthStage(REASON_TO_STAGE[profile.reason] || "logged_out");
        return;
      }

      if (!mounted.current) return;
      await ensureCacheOwner(profile.tenant?.id); // a different business on this phone => its saved copy is emptied first
      setStaff(profile.staff);
      setTenant(profile.tenant);
      setStatusDetail(null);
      setOfflineSession(false);
      saveOfflineIdentity({ staff: profile.staff, tenant: profile.tenant }); // proof of a real online check, for the next offline start
      setAuthStage(profile.staff.must_change_password ? "must_change_password" : "authenticated");
    } finally {
      validating.current = false;
    }
  }, [forceSignOut, openFromSavedSignIn]);

  useEffect(() => {
    mounted.current = true;
    validate();

    const { data: { subscription } } = posSupabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearOfflineIdentity();
        clearOfflineCaches();
        setOfflineSession(false);
        if (!mounted.current) return;
        setStaff(null);
        setTenant(null);
        setStatusDetail(null);
        setAuthStage("logged_out");
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        validate();
      }
    });

    const interval = setInterval(() => {
      if (mounted.current && REVALIDATE_STAGES.has(stageRef.current)) validate();
    }, REVALIDATE_INTERVAL_MS);

    const onFocus = () => {
      if (mounted.current && REVALIDATE_STAGES.has(stageRef.current)) validate();
    };
    window.addEventListener("focus", onFocus);
    // The moment the connection returns, re-check the sign-in for real (and clear the "working offline" state).
    const onOnline = () => {
      if (mounted.current && (REVALIDATE_STAGES.has(stageRef.current))) validate();
    };
    window.addEventListener("online", onOnline);

    return () => {
      mounted.current = false;
      subscription.unsubscribe();
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("online", onOnline);
    };
  }, [validate]);

  const login = useCallback(async (businessCode, username, password) => {
    const { data: resolved, error: resolveErr } = await posSupabase.rpc("resolve_pos_login", {
      p_business_code: businessCode,
      p_username: username,
    });
    if (resolveErr || !resolved?.ok) {
      return { ok: false, reason: resolved?.reason || "UNKNOWN", detail: resolved?.detail ?? null };
    }

    const { error: signInErr } = await posSupabase.auth.signInWithPassword({
      email: resolved.email,
      password,
    });
    if (signInErr) {
      return { ok: false, reason: "INVALID_CREDENTIALS" };
    }

    await validate();
    return { ok: true };
  }, [validate]);

  // Fingerprint sign-in. Same gates as a password login: once the session exists, validate() runs get_pos_profile(),
  // which is what rejects pending / rejected / suspended businesses and forces a password change if flagged.
  const loginWithPasskey = useCallback(async () => {
    try {
      const r = await posPasskeys.loginWithPasskey();
      if (!r.usedPasskey) return { ok: false, reason: r.cancelled ? "CANCELLED" : "NO_PASSKEY" };
      await validate();
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: "PASSKEY_ERROR", detail: err.message };
    }
  }, [validate]);

  const signup = useCallback(async (payload) => {
    const { data, error } = await posSupabase.rpc("register_pos_tenant", payload);
    if (error || !data?.ok) {
      return { ok: false, reason: data?.reason || "UNKNOWN" };
    }
    // Deliberately does NOT sign the user in or change authStage — the
    // spec requires registration to never auto-authenticate. The caller
    // (POSTenantSignup) shows a confirmation and sends them back to login.
    return { ok: true, businessCode: data.business_code };
  }, []);

  // Signing out erases the saved sign-in, so with no internet the person could not get back in. If sales are still
  // waiting on this phone, say so first. (They are NOT lost: they stay saved and are sent after the next sign-in.)
  const logout = useCallback(async () => {
    try {
      const waiting = await countUnsent();
      if (waiting > 0 && typeof window !== "undefined" && typeof window.confirm === "function" && !(await canReachServer())) {
        const ok = window.confirm(
          `${waiting} saved item${waiting === 1 ? " is" : "s are"} still waiting to be sent, and there is no internet. ` +
          "If you sign out now you will need internet to sign back in. Your saved items are kept. Sign out anyway?"
        );
        if (!ok) return;
      }
    } catch { /* never block a sign-out on a storage problem */ }
    return forceSignOut(null);
  }, [forceSignOut]);

  const completePasswordChange = useCallback(async (newPassword) => {
    const { error: updateErr } = await posSupabase.auth.updateUser({ password: newPassword });
    if (updateErr) return { ok: false, reason: updateErr.message };

    const { data: cleared, error: rpcErr } = await posSupabase.rpc("clear_must_change_password");
    if (rpcErr || cleared?.ok === false) {
      console.warn("[POS AUTH] clear_must_change_password failed:", rpcErr || cleared);
      // Password IS changed at this point (auth.updateUser succeeded) —
      // don't report failure over a flag that'll just get corrected on
      // next validate(). Fall through.
    }

    await validate();
    return { ok: true };
  }, [validate]);

  const value = {
    authStage,
    staff,
    tenant,
    statusDetail,
    logoutNotice,
    offlineSession,
    loading: authStage === "checking",
    isAuthenticated: authStage === "authenticated",
    isOwner: staff?.role === "owner",
    isManager: staff?.role === "manager",
    isCashier: staff?.role === "cashier",
    login,
    loginWithPasskey,
    signup,
    logout,
    validateSession: validate,
    refreshSession: validate,
    completePasswordChange,
  };

  return <POSAuthContext.Provider value={value}>{children}</POSAuthContext.Provider>;
}

export function usePOSAuth() {
  const ctx = useContext(POSAuthContext);
  if (!ctx) throw new Error("usePOSAuth() must be used within a POSAuthProvider");
  return ctx;
}
