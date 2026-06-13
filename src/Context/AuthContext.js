// src/Context/AuthContext.js
//
// KEY FIX: fetchProfile now checks the `users` table FIRST.
// If the auth_user_id is found there with a staff/admin role,
// it returns immediately — never falls through to members table.
// This prevents an admin who also appears in `members` from
// being assigned role="member" and bounced to the wrong dashboard.

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { supabase } from "../supabaseClient";

const STAFF_ROLES = ["staff", "admin", "manager", "superadmin", "auditor", "teller"];

const AuthContext = createContext({
  user:         null,
  profile:      null,
  role:         null,
  loading:      true,
  isMember:     false,
  isStaff:      false,
  isAdmin:      false,
  isUnassigned: false,
  logout:       async () => {},
  refreshProfile: async () => {},
});

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [profile, setProfile] = useState(null);
  const [role,    setRole]    = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchedForId  = useRef(null);
  const fetchInFlight = useRef(false);
  const bootstrapped  = useRef(false);
  const mounted       = useRef(true);

  // ─────────────────────────────────────────────
  // RESET
  // ─────────────────────────────────────────────
  const resetState = useCallback(() => {
    setUser(null);
    setProfile(null);
    setRole(null);
    setLoading(false);
    fetchedForId.current  = null;
    fetchInFlight.current = false;
  }, []);

  // ─────────────────────────────────────────────
  // PROFILE FETCH
  //
  // Order of precedence:
  //   1. users table  → if role is a known staff role, return immediately
  //   2. members table → regular member
  //   3. Neither found → "unassigned"
  //
  // This ordering guarantees an admin account is NEVER
  // misidentified as a plain member, even if the same
  // auth_user_id appears in both tables.
  // ─────────────────────────────────────────────
  const fetchProfile = useCallback(async (authUser) => {
    if (!authUser?.id) return null;

    // ── Step 1: Check users (staff/admin) table first ──────────
    const { data: staffRecord, error: staffErr } = await supabase
      .from("users")
      .select("id, member_no, name, email, status, role")
      .eq("auth_user_id", authUser.id)
      .maybeSingle();

    if (staffErr) console.error("[AUTH] users lookup:", staffErr.message);

    if (staffRecord) {
      const resolvedRole = STAFF_ROLES.includes(String(staffRecord.role).toLowerCase())
        ? String(staffRecord.role).toLowerCase()
        : "staff"; // fallback if role field is missing/unknown
      console.log(`[AUTH] Role resolved from users table: ${resolvedRole}`);
      return { profileData: staffRecord, userRole: resolvedRole };
    }

    // ── Step 2: Check members table ────────────────────────────
    const { data: memberRecord, error: memberErr } = await supabase
      .from("members")
      .select("id, member_no, name, email, status, password_set")
      .eq("auth_user_id", authUser.id)
      .maybeSingle();

    if (memberErr) console.error("[AUTH] members lookup:", memberErr.message);

    if (memberRecord) {
      console.log("[AUTH] Role resolved from members table: member");
      return { profileData: memberRecord, userRole: "member" };
    }

    // ── Step 3: Authenticated but no profile record ─────────────
    console.warn("[AUTH] auth_user_id not found in users or members table:", authUser.id);
    return { profileData: null, userRole: "unassigned" };
  }, []);

  // ─────────────────────────────────────────────
  // SYNC PROFILE — deduped, concurrency-safe
  // ─────────────────────────────────────────────
  const syncProfile = useCallback(async (authUser) => {
    if (!authUser?.id) return;

    if (fetchedForId.current === authUser.id) {
      if (mounted.current) setLoading(false);
      return;
    }

    if (fetchInFlight.current) return;

    fetchInFlight.current = true;
    fetchedForId.current  = authUser.id;
    if (mounted.current) setLoading(true);

    try {
      const result = await fetchProfile(authUser);
      if (!mounted.current) return;

      if (result) {
        setProfile(result.profileData);
        setRole(result.userRole);
      } else {
        fetchedForId.current = null;
        setProfile(null);
        setRole(null);
      }
    } catch (err) {
      console.error("[AUTH] syncProfile error:", err);
      if (mounted.current) {
        fetchedForId.current = null;
        setProfile(null);
        setRole(null);
      }
    } finally {
      fetchInFlight.current = false;
      if (mounted.current) setLoading(false);
    }
  }, [fetchProfile]);

  // ─────────────────────────────────────────────
  // BOOT
  // ─────────────────────────────────────────────
  useEffect(() => {
    mounted.current = true;

    const boot = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) console.error("[AUTH] getSession error:", error.message);

        if (!mounted.current) return;

        if (session?.user) {
          setUser(session.user);
          await syncProfile(session.user);
        } else {
          setLoading(false);
        }
      } catch (err) {
        console.error("[AUTH] boot error:", err);
        if (mounted.current) setLoading(false);
      } finally {
        bootstrapped.current = true;
      }
    };

    boot();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted.current) return;
        console.log("[AUTH EVENT]", event);

        switch (event) {

          case "INITIAL_SESSION":
            // Handled by boot() — ignore
            break;

          case "SIGNED_IN":
            if (bootstrapped.current && session?.user) {
              setUser(session.user);
              if (fetchedForId.current !== session.user.id) {
                fetchedForId.current = null;
              }
              await syncProfile(session.user);
            }
            break;

          case "TOKEN_REFRESHED":
            if (session?.user && mounted.current) {
              setUser(session.user);
            }
            break;

          case "USER_UPDATED":
            if (session?.user && mounted.current) {
              setUser(session.user);
              fetchedForId.current = null;
              await syncProfile(session.user);
            }
            break;

          case "PASSWORD_RECOVERY":
            if (mounted.current) setLoading(false);
            break;

          case "SIGNED_OUT":
            if (mounted.current) resetState();
            break;

          default:
            break;
        }
      }
    );

    return () => {
      mounted.current = false;
      subscription.unsubscribe();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────
  // LOGOUT
  // ─────────────────────────────────────────────
  const logout = useCallback(async () => {
    setLoading(true);
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch (err) {
      console.error("[AUTH] logout error:", err);
    } finally {
      if (mounted.current) resetState();
    }
  }, [resetState]);

  // ─────────────────────────────────────────────
  // REFRESH PROFILE (call after profile updates)
  // ─────────────────────────────────────────────
  const refreshProfile = useCallback(async () => {
    if (!user) return;
    fetchedForId.current = null;
    await syncProfile(user);
  }, [user, syncProfile]);

  // ─────────────────────────────────────────────
  // DERIVED BOOLEANS
  // ─────────────────────────────────────────────
  const isMember     = role === "member";
  const isStaff      = STAFF_ROLES.includes(role);
  const isAdmin      = role === "admin" || role === "superadmin";
  const isUnassigned = role === "unassigned";

  return (
    <AuthContext.Provider value={{
      user,
      profile,
      role,
      loading,
      isMember,
      isStaff,
      isAdmin,
      isUnassigned,
      logout,
      refreshProfile,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}