import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../supabaseClient";
import { chamaPasskeys } from "./auth/chamaPasskeys";

// =============================================================================
// ChamaContext — now auth-aware
// =============================================================================
// Implements:
//   Phone + Password -> authenticate_user()
//     -> 1 membership  -> check license -> open dashboard
//     -> 2+ memberships -> show chama list -> user picks -> check license -> open
//
// Every component already delivered (loans/, contributions/, welfare/) reads
// `chama`, `member`, `hasRole()` from useChama() exactly as before — this file
// is a drop-in replacement, not a new API surface. What's new is everything
// upstream of `chama`/`member` being set: authStage, user, memberships,
// loginWithPhone(), chooseMembership(), logout().
// =============================================================================

export const ChamaContext = createContext(null);

const SESSION_KEY = "chama_session_v2";
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 hours — after this, force re-login even if localStorage still has the blob

function isLicenseValid(m) {
  if (!m) return false;
  if (m.license_status !== "active" && m.license_status !== "trial") return false;
  if (m.license_expiry && new Date(m.license_expiry) < new Date(new Date().toDateString())) return false;
  return true;
}

export function ChamaProvider({ children }) {
  // ---- auth/session state ----
  const [authStage, setAuthStage] = useState("checking"); // checking | phone | select_chama | blocked | authenticated
  const [user, setUser] = useState(null);           // { id, full_name, phone_number }
  const [memberships, setMemberships] = useState([]); // rows from get_user_memberships
  const [licenseError, setLicenseError] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);

  // ---- active chama/member (unchanged shape for every existing consumer) ----
  const [chama, setChama] = useState(null);
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(false);

  // ---- restore a previous session on load ----
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) { setAuthStage("phone"); return; }
      const saved = JSON.parse(raw);

      const age = Date.now() - (saved?.createdAt || 0);
      if (!saved?.createdAt || age > SESSION_MAX_AGE_MS) {
        // Session too old — treat exactly like a logout, don't silently restore it.
        localStorage.removeItem(SESSION_KEY);
        setAuthStage("phone");
        return;
      }

      if (saved?.user && saved?.chama && saved?.member) {
        setUser(saved.user);
        setChama(saved.chama);
        setMember(saved.member);
        setAuthStage("authenticated");
        // Re-validate the license quietly in the background — licenses can
        // lapse between sessions even if nothing else changed.
        supabase.rpc("is_chama_licensed", { p_chama_id: saved.chama.id }).then(({ data }) => {
          if (data === false) {
            setAuthStage("blocked");
            setLicenseError("This chama's license is no longer active. Contact your administrator.");
          }
        });
      } else {
        setAuthStage("phone");
      }
    } catch {
      setAuthStage("phone");
    }
  }, []);

  const persistSession = (nextUser, nextChama, nextMember) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ user: nextUser, chama: nextChama, member: nextMember, createdAt: Date.now() }));
  };

  // Everything that happens AFTER the person has proved who they are — by password (authenticate_user)
  // or by fingerprint (webauthn-auth-verify returns the same { user_id, full_name, phone_number } shape).
  const finishLogin = async (authedUser) => {
      const { data: memberRows, error: memErr } = await supabase.rpc("get_user_memberships", {
        p_user_id: authedUser.user_id,
      });
      if (memErr) throw memErr;

      const list = memberRows || [];
      setUser(authedUser);

      if (list.length === 0) {
        setAuthError("No chama membership is linked to this phone number yet. Ask your secretary to add you.");
        setAuthStage("phone");
        return;
      }

      if (list.length === 1) {
        await chooseMembershipInternal(authedUser, list[0]);
      } else {
        setMemberships(list);
        setAuthStage("select_chama");
      }
  };

  // ---- Step 1: phone + password ----
  const loginWithPhone = useCallback(async (phone, password) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const { data: authRows, error: authErr } = await supabase.rpc("authenticate_user", {
        p_phone: phone.trim(),
        p_password: password,
      });
      if (authErr) throw authErr;
      const authedUser = Array.isArray(authRows) ? authRows[0] : authRows;
      if (!authedUser) throw new Error("Incorrect phone number or password");

      await finishLogin(authedUser);
    } catch (err) {
      setAuthError(err.message || "Login failed");
      setAuthStage("phone");
    } finally {
      setAuthBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Step 1 (alternative): fingerprint ----
  const loginWithPasskey = useCallback(async () => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const r = await chamaPasskeys.loginWithPasskey();
      if (!r.usedPasskey) {
        if (!r.cancelled) setAuthError("No fingerprint is set up on this device yet. Log in with your password once, then turn it on under More.");
        return;
      }
      await finishLogin(r.user);
    } catch (err) {
      setAuthError(err.message || "Fingerprint sign-in failed. Use your password instead.");
      setAuthStage("phone");
    } finally {
      setAuthBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Step 2: pick a chama (only shown when there are 2+) ----
  const chooseMembershipInternal = async (activeUser, membership) => {
    if (!isLicenseValid(membership)) {
      setLicenseError(
        membership.license_status === "expired"
          ? `${membership.chama_name}'s license expired on ${membership.license_expiry}. Contact your administrator to renew.`
          : `${membership.chama_name}'s license is ${membership.license_status}. Contact your administrator.`
      );
      setAuthStage("blocked");
      return;
    }

    setLoading(true);
    const [{ data: chamaRow }, { data: memberRow }] = await Promise.all([
      supabase.from("chamas").select("*").eq("id", membership.chama_id).single(),
      supabase.from("chama_members").select("*").eq("id", membership.chama_member_id).single(),
    ]);
    setLoading(false);

    setChama(chamaRow);
    setMember(memberRow);
    setLicenseError(null);
    setAuthStage("authenticated");
    persistSession(activeUser, chamaRow, memberRow);
  };

  const chooseMembership = useCallback(async (membership) => {
    if (!user) return;
    await chooseMembershipInternal(user, membership);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const backToChamaList = () => {
    setChama(null);
    setMember(null);
    setLicenseError(null);
    setAuthStage(memberships.length > 1 ? "select_chama" : "phone");
  };

  const logout = useCallback(() => {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem("auth_token"); // legacy key some older screens still check
    sessionStorage.removeItem("platform_admin_unlocked");
    // Hard reload, not just a React state reset — clearing localStorage
    // alone leaves the door open for the browser's back/forward cache to
    // restore the previous in-memory dashboard state without a fresh
    // authenticate_user() call. A real navigation closes that off entirely
    // and guarantees the next thing rendered is the login screen.
    window.location.href = "/chama";
  }, []);

  // ---- Registration (first-time phone+password setup) ----
  const registerUser = useCallback(async (phone, password, fullName, linkChamaMemberId = null) => {
    setAuthBusy(true);
    setAuthError(null);
    try {
      const { data, error } = await supabase.rpc("register_user", {
        p_phone: phone.trim(),
        p_password: password,
        p_full_name: fullName,
        p_link_chama_member_id: linkChamaMemberId,
      });
      if (error) throw error;
      const created = Array.isArray(data) ? data[0] : data;
      // Fall straight into the normal login flow so licensing etc is checked identically.
      await loginWithPhone(phone, password);
      return created;
    } catch (err) {
      setAuthError(err.message || "Registration failed");
      throw err;
    } finally {
      setAuthBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loginWithPhone]);

  // ---- Authorization (unchanged from the original ChamaContext) ----
  const hasRole = (roles) => {
    if (!member?.role) return false;
    const r = member.role.toLowerCase();
    if (r === "chairperson" || r === "chairman" || r === "admin") return true;
    if (Array.isArray(roles)) return roles.map((x) => x.toLowerCase()).includes(r);
    return r === String(roles).toLowerCase();
  };

  // ---- Legacy REST API helper ----
  // Nothing in this package uses this — it existed only for old screens
  // (ChamaMeetings.js, ChamaNotifications.js) that aren't part of this
  // self-contained rebuild. Left as a no-op-safe stub in case something
  // outside this folder still imports `api` off useChama() — remove once
  // you've confirmed nothing does.
  const api = useMemo(
    () => ({
      request: async () => {
        throw new Error("api.request() is a legacy stub — this package's modules all call supabase directly.");
      },
    }),
    []
  );

  const value = {
    // auth flow
    authStage, user, memberships, authError, licenseError, authBusy,
    loginWithPhone, loginWithPasskey, chooseMembership, backToChamaList, logout, registerUser,
    // active session
    chama, member, loading, setLoading,
    hasRole, api,
    setChama, setMember,
  };

  return <ChamaContext.Provider value={value}>{children}</ChamaContext.Provider>;
}

export function useChama() {
  const context = useContext(ChamaContext);
  if (!context) throw new Error("useChama must be used inside ChamaProvider");
  return context;
}

export default ChamaContext;
