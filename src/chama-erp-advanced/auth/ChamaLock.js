// src/chama-erp-advanced/auth/ChamaLock.js
//
// Phone-only fingerprint lock for Umova Chama.
//
// Chama has NO Supabase session (its own phone + password via authenticate_user, kept as a JSON blob in
// localStorage), so the Supabase trusted_devices functions used by Finance / My Business cannot apply here.
// Chama has its own server-checked equivalent instead: chama_trusted_devices + chama_device_register /
// chama_device_login / chama_device_revoke (see src/security/chamaDevice.js).
//
//   * Fingerprint is verified by the Android/iOS biometric prompt only; it releases a random device secret held in the
//     Android Keystore behind the fingerprint. The server stores only SHA-256(secret). No biometric data exists anywhere.
//   * Turning fingerprint ON asks for the user's password ONCE (Chama has no token that proves who is asking). The phone
//     number is already known from the signed-in user, so only the password is asked.
//   * Unlocking asks the server whether this phone is still trusted and still belongs to the signed-in Chama user, so a
//     revoked phone or a deactivated account can no longer unlock, and a different user's fingerprint is not honoured.
//   * Fingerprint never changes the user's chama role or grants any permission: hasRole()/licence checks in
//     ChamaContext are untouched. The password always still works.
//
// Usage (App.js):   <AuthGate><ChamaLock><ChamaDashboardAdvanced /></ChamaLock></AuthGate>
// Off-switch:       <ChamaFingerprintToggle />   (render it anywhere inside the Chama dashboard, e.g. its settings/More)
//
// Web: renders children untouched.

import React, { useMemo } from "react";
import { supabase } from "../../supabaseClient";
import { useChama } from "../ChamaContext";
import AppLock from "../../security/AppLock";
import FingerprintToggle from "../../security/FingerprintToggle";
import {
  enableChamaFingerprint,
  unlockChamaFingerprint,
  disableChamaFingerprint,
} from "../../security/chamaDevice";

const SERVICE = "chama";
const CHAMA_SESSION_KEY = "chama_session_v2";   // ChamaContext's own session blob

const userKey = (u) => String(u?.user_id ?? u?.id ?? "");

function makeAdapter(user) {
  const uid = userKey(user);
  const phone = String(user?.phone_number || "").trim();
  return {
    // Tells EnableBiometricPrompt / FingerprintToggle to ask for the password and pass it as enable({ password }).
    requiresPassword: true,

    async enable({ password } = {}) {
      return enableChamaFingerprint({ client: supabase, phone, password });
    },

    async disable() {
      return disableChamaFingerprint({ client: supabase });
    },

    async unlock() {
      return unlockChamaFingerprint({ client: supabase, expectedUserId: uid });
    },

    // Password fallback = the same authenticate_user check the Chama login uses, for the signed-in Chama user.
    async verifyPassword(password) {
      try {
        const { data, error } = await supabase.rpc("authenticate_user", {
          p_phone: String(user?.phone_number || "").trim(),
          p_password: password,
        });
        if (error) return { ok: false, reason: "wrong_password" };
        const row = Array.isArray(data) ? data[0] : data;
        return row && userKey(row) === uid ? { ok: true } : { ok: false, reason: "wrong_password" };
      } catch {
        return { ok: false, reason: "wrong_password" };
      }
    },

    // "Did the user just type their password?" -> ChamaContext stamps createdAt when it saves the session.
    async signedInWithin(ms) {
      try {
        const saved = JSON.parse(localStorage.getItem(CHAMA_SESSION_KEY) || "null");
        return !!saved?.createdAt && Date.now() - saved.createdAt < ms;
      } catch {
        return false;
      }
    },
  };
}

function useChamaAdapter() {
  const { user } = useChama();
  const uid = userKey(user);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => makeAdapter(user), [uid, user?.phone_number]);
}

export default function ChamaLock({ children }) {
  const { logout } = useChama();
  const adapter = useChamaAdapter();
  return (
    <AppLock service={SERVICE} adapter={adapter} onSignOut={logout}>
      {children}
    </AppLock>
  );
}

export function ChamaFingerprintToggle() {
  const adapter = useChamaAdapter();
  return <FingerprintToggle service={SERVICE} adapter={adapter} />;
}
