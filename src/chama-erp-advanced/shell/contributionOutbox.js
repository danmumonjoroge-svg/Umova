import { useCallback, useEffect, useRef, useState } from "react";
import useOnlineStatus from "./useOnlineStatus";

// -----------------------------------------------------------------------------
// contributionOutbox — contributions a member DECLARES while offline.
//
// What is queued is only the member's declaration ("I sent KES 5,000, ref XYZ"). It becomes a normal PENDING request
// when it reaches the server, and nothing counts until the treasurer verifies it against the real account. Nothing that
// moves money is ever queued here, and the app never calls a queued item "sent" or "confirmed" before the server says so.
//
// How it stays safe:
//   * Every declaration gets a random client_request_id (also used for ordinary online submits). The database has a
//     unique index on it (chama_03_contribution_idempotency.sql), so a retry after a dropped connection can never create
//     the same request twice: the duplicate is refused and counted as "already sent".
//   * Items are sent in the order they were saved. A network failure stops the run and keeps everything for the next try.
//   * Anything the server REFUSES (bad loan, missing account, ...) is kept and flagged "not accepted" with the reason,
//     never retried forever and never silently dropped; the member can read it and remove it.
//   * Items are tied to the member who saved them and only sent / shown for that member.
//
// Stored in localStorage under its own key, deliberately NOT under the read-cache prefix, so logging out does not silently
// delete a contribution that has not been sent yet.
// -----------------------------------------------------------------------------

const KEY = "chama_outbox_v1";
const TABLE = "chama_contribution_requests";
const SYNC_EVERY_MS = 30 * 1000;

const listeners = new Set();
const notify = () => listeners.forEach((fn) => { try { fn(); } catch { /* a bad listener must not break the others */ } });

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function write(items) {
  localStorage.setItem(KEY, JSON.stringify(items));   // may throw if storage is full: callers handle it
  notify();
}

export function newClientRequestId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  } catch {
    return `cr-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}${Math.random().toString(16).slice(2)}`;
  }
}

export function isNetworkError(e) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return /failed to fetch|network|load failed|timeout|timed out|offline|abort/i.test(String(e?.message || e || ""));
}

// "Already saved" = the unique index on client_request_id refused it. A duplicate on some OTHER unique rule
// (for example the same M-Pesa code twice) is a real refusal and must NOT be mistaken for success.
function isDuplicateOfThisRequest(e) {
  return String(e?.code) === "23505" && /client_request_id/i.test(`${e?.message || ""} ${e?.details || ""}`);
}

export function listOutbox(memberId) {
  return read().filter((i) => i.memberId === memberId);
}

/** Save a declaration on the phone. -> { ok:true } or { ok:false } if the phone's storage is full. */
export function enqueueContribution({ clientRequestId, memberId, chamaId, row }) {
  try {
    write([...read(), { clientRequestId, memberId, chamaId, row, savedAt: Date.now(), status: "waiting" }]);
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

export function removeOutboxItem(clientRequestId) {
  try { write(read().filter((i) => i.clientRequestId !== clientRequestId)); } catch { /* nothing to remove */ }
}

function markFailed(clientRequestId, reason) {
  try {
    write(read().map((i) => (i.clientRequestId === clientRequestId ? { ...i, status: "failed", reason } : i)));
  } catch { /* keep going */ }
}

let flushing = false;

/**
 * Send this member's waiting items, oldest first.
 * -> { sent, failed, offline, busy }
 */
export async function flushContributionOutbox({ supabase, memberId }) {
  if (!memberId) return { sent: 0, failed: 0, offline: false, busy: false };
  if (flushing) return { sent: 0, failed: 0, offline: false, busy: true };
  flushing = true;
  let sent = 0;
  let failed = 0;
  let offline = false;
  try {
    for (const item of read()) {
      if (item.memberId !== memberId || item.status === "failed") continue;

      let error = null;
      try {
        ({ error } = await supabase.from(TABLE).insert([{ ...item.row, client_request_id: item.clientRequestId }]));
      } catch (e) {
        error = e;
      }

      if (!error || isDuplicateOfThisRequest(error)) {
        removeOutboxItem(item.clientRequestId);
        sent += 1;
        continue;
      }
      if (isNetworkError(error)) { offline = true; break; }        // keep this and everything after it for the next try
      markFailed(item.clientRequestId, error.message || "The server did not accept it.");
      failed += 1;
    }
  } finally {
    flushing = false;
  }
  return { sent, failed, offline, busy: false };
}

/**
 * Items for one member + automatic sending: when the screen opens, the moment the connection returns, and every 30 seconds
 * while something is waiting. `onSent` runs after at least one item reached the server (use it to refresh lists).
 */
export function useContributionOutbox({ supabase, memberId, onSent }) {
  const online = useOnlineStatus();
  const [items, setItems] = useState(() => listOutbox(memberId));
  const [syncing, setSyncing] = useState(false);
  const onSentRef = useRef(onSent);
  onSentRef.current = onSent;

  const refresh = useCallback(() => setItems(listOutbox(memberId)), [memberId]);

  useEffect(() => {
    refresh();
    listeners.add(refresh);
    return () => { listeners.delete(refresh); };
  }, [refresh]);

  const sync = useCallback(async () => {
    if (!memberId) return null;
    setSyncing(true);
    const r = await flushContributionOutbox({ supabase, memberId });
    setSyncing(false);
    refresh();
    if (r.sent > 0) onSentRef.current?.(r);
    return r;
  }, [supabase, memberId, refresh]);

  useEffect(() => { if (online && memberId) sync(); }, [online, memberId, sync]);

  const hasWaiting = items.some((i) => i.status !== "failed");
  useEffect(() => {
    if (!online || !hasWaiting) return undefined;
    const t = setInterval(sync, SYNC_EVERY_MS);
    return () => clearInterval(t);
  }, [online, hasWaiting, sync]);

  const discard = useCallback((id) => removeOutboxItem(id), []);
  return { items, syncing, sync, discard, online, hasWaiting };
}
