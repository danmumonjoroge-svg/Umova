import { useEffect, useState, useCallback } from "react";
import { supabase } from "../../supabaseClient";
import { registerPasskey, passkeysSupported } from "./webauthnHelpers";
import { Fingerprint, Trash2, Loader2 } from "lucide-react";

/**
 * Enrolling and managing Face ID / Fingerprint sign-in.
 *
 * This is what was missing: webauthnHelpers.registerPasskey() existed and
 * worked, but nothing in the app ever called it, so no account could ever
 * have a passkey — which meant the "Use Face ID / Fingerprint" button on
 * the login screen could only ever report that none was set up.
 *
 * Drop into any signed-in settings/profile screen.
 */
export default function PasskeySettings() {
  const [credentials, setCredentials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const supported = passkeysSupported();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setCredentials([]); return; }

      // RLS should scope this to the signed-in user; the explicit filter
      // is belt-and-braces so a misconfigured policy can't leak other
      // people's device list into this view.
      const { data, error: qErr } = await supabase
        .from("webauthn_credentials")
        .select("id, nickname, created_at, last_used_at")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });

      if (qErr) throw qErr;
      setCredentials(data || []);
    } catch (err) {
      console.error("PasskeySettings:", err);
      setError("Couldn't load your saved devices.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addPasskey = async () => {
    setError("");
    setSuccess("");
    setBusy(true);
    try {
      // Defaults to the device name the person is most likely to
      // recognise later, since they'll be picking from this list when
      // revoking one.
      const suggested = guessDeviceName();
      const nickname = window.prompt("Name this device so you can recognise it later:", suggested);
      if (nickname === null) return; // cancelled

      await registerPasskey(nickname.trim() || suggested);
      setSuccess("This device can now sign you in with Face ID / Fingerprint.");
      load();
    } catch (err) {
      if (err?.name === "NotAllowedError" || err?.name === "AbortError") {
        return; // prompt dismissed — not an error
      }
      console.error(err);
      setError(err.message || "Couldn't set up Face ID / Fingerprint on this device.");
    } finally {
      setBusy(false);
    }
  };

  const removePasskey = async (cred) => {
    const label = cred.nickname || "this device";
    if (!window.confirm(`Remove ${label}? It will no longer be able to sign in without a password.`)) return;

    setError("");
    setSuccess("");
    try {
      const { error: delErr } = await supabase
        .from("webauthn_credentials")
        .delete()
        .eq("id", cred.id);
      if (delErr) throw delErr;
      setSuccess(`${label} removed.`);
      load();
    } catch (err) {
      console.error(err);
      setError("Couldn't remove that device.");
    }
  };

  if (!supported) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-6">
        <h3 className="font-bold text-slate-800">Face ID / Fingerprint sign-in</h3>
        <p className="mt-2 text-sm text-slate-500">
          This browser doesn't support fingerprint sign-in. Try Chrome, Safari, or Edge
          on a device with a fingerprint reader or face unlock.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-bold text-slate-800">Face ID / Fingerprint sign-in</h3>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Set this up once and you can sign in with just your fingerprint — no member
            number, no password.
          </p>
        </div>
        <button
          onClick={addPasskey}
          disabled={busy}
          className="flex items-center gap-2 rounded-xl bg-green-700 px-5 py-2.5 font-semibold text-white hover:bg-green-800 disabled:opacity-60"
        >
          {busy ? <Loader2 size={18} className="animate-spin" /> : <Fingerprint size={18} />}
          {busy ? "Setting up…" : "Set up on this device"}
        </button>
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {success && <p className="mt-4 rounded-lg bg-green-50 px-4 py-3 text-sm text-green-800">{success}</p>}

      <div className="mt-5">
        {loading ? (
          <p className="text-sm text-slate-400">Loading your devices…</p>
        ) : credentials.length === 0 ? (
          <p className="rounded-xl bg-slate-50 px-4 py-5 text-sm text-slate-500">
            No devices set up yet. Once you add one, you can sign in from it with just
            your fingerprint.
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {credentials.map((cred) => (
              <li key={cred.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="font-semibold text-slate-800">{cred.nickname || "Unnamed device"}</p>
                  <p className="text-xs text-slate-400">
                    Added {formatDate(cred.created_at)}
                    {cred.last_used_at ? ` · last used ${formatDate(cred.last_used_at)}` : " · never used"}
                  </p>
                </div>
                <button
                  onClick={() => removePasskey(cred)}
                  aria-label={`Remove ${cred.nickname || "device"}`}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                >
                  <Trash2 size={16} /> Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function formatDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android phone";
  if (/Macintosh/.test(ua)) return "Mac";
  if (/Windows/.test(ua)) return "Windows PC";
  return "This device";
}
