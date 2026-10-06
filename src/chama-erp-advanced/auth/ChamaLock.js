// src/chama-erp-advanced/auth/ChamaLock.js
//
// Phone-only fingerprint lock for Umova Chama.
//
// Chama has NO Supabase session (its own phone + password via authenticate_user, kept as a JSON blob in
// localStorage), so the server-checked trusted-device RPCs used by Finance / My Business cannot apply here.
// This is therefore a LOCAL lock: after the Chama login, fingerprint/password only decide whether the saved
// Chama session is shown when the app is reopened. It does NOT create a login, change the user's chama role,
// or grant any permission: hasRole()/license checks in ChamaContext are untouched. There is no server-side
// revocation for Chama (nothing server-side to revoke).
//
// Fingerprint is verified by the Android/iOS biometric prompt only. We store a random local secret in the OS
// secure store purely so a wiped/invalidated credential is detected; no biometric data exists anywhere.
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
import { authenticate, checkBiometry, BioStatus } from "../../security/nativeBiometric";
import { vaultSet, vaultGet, vaultDelete, prefGet, prefSet, prefRemove } from "../../security/secureVault";
import { getDeviceId } from "../../security/deviceTrust";

const SERVICE = "chama";
const TRUST_KEY = "umova.trust.chama";          // same key format deviceTrust.isEnabled() reads
const CHAMA_SESSION_KEY = "chama_session_v2";   // ChamaContext's own session blob

const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const randomSecret = () => hex(crypto.getRandomValues(new Uint8Array(32)));
const userKey = (u) => String(u?.user_id ?? u?.id ?? "");

async function clearLocal() {
  await vaultDelete(SERVICE);
  await prefRemove(TRUST_KEY);
}

function makeAdapter(user) {
  const uid = userKey(user);
  return {
    async enable() {
      const info = await checkBiometry();
      if (!info.biometric) return { ok: false, status: info.status === BioStatus.OK ? BioStatus.UNAVAILABLE : info.status };
      const auth = await authenticate({ reason: "Confirm to turn on fingerprint sign-in" });
      if (!auth.ok) return { ok: false, status: auth.status };
      try {
        const deviceId = await getDeviceId();
        await vaultDelete(SERVICE);
        await vaultSet(SERVICE, deviceId, randomSecret());
        await prefSet(TRUST_KEY, JSON.stringify({ enabled: true, since: Date.now(), userId: uid }));
        return { ok: true };
      } catch {
        return { ok: false, status: "vault_error" };
      }
    },

    async disable() {
      await clearLocal();
    },

    async unlock() {
      const auth = await authenticate({ reason: "Unlock Umova Chama" });
      if (!auth.ok) return { ok: false, status: auth.status };
      const stored = await vaultGet(SERVICE);
      let owner = "";
      try { owner = JSON.parse((await prefGet(TRUST_KEY)) || "{}").userId || ""; } catch { /* ignore */ }
      if (!stored) { await clearLocal(); return { ok: false, status: BioStatus.INVALIDATED }; }
      // Fingerprint was turned on by a different Chama user on this phone -> don't honour it.
      if (owner && uid && owner !== uid) { await clearLocal(); return { ok: false, status: "revoked" }; }
      return { ok: true };
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
