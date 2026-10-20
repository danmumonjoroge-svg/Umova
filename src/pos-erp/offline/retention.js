// src/pos-erp/offline/retention.js
//
// How much HISTORY the phone keeps a saved copy of. One place, not hard-coded across the app.
//
// IMPORTANT DISTINCTION (owner's rule): this only decides what is kept of records that are ALREADY on the server (a saved
// copy for looking at). It NEVER applies to the sync queue (db.outbox): an unsent sale / expense / payment is kept until the
// server has accepted it (or the owner explicitly sets it aside), however old it is. Nothing in this file touches the outbox.

import { getMeta, setMeta } from './db';

export const DEFAULT_RETENTION = Object.freeze({ salesDays: 30, expensesDays: 90 });
const MIN_DAYS = 1;
const MAX_DAYS = 365;
const META_KEY = 'retentionConfig'; // not under "cache:", so signing out does not reset a business decision

function clean(v, fallback) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= MIN_DAYS && n <= MAX_DAYS ? n : fallback;
}

export async function getRetention() {
  try {
    const saved = (await getMeta(META_KEY)) || {};
    return { salesDays: clean(saved.salesDays, DEFAULT_RETENTION.salesDays), expensesDays: clean(saved.expensesDays, DEFAULT_RETENTION.expensesDays) };
  } catch { return { ...DEFAULT_RETENTION }; }
}

/** Partial update; out-of-range or non-numbers are ignored (they keep the current value). */
export async function setRetention(patch = {}) {
  const cur = await getRetention();
  const next = { salesDays: clean(patch.salesDays, cur.salesDays), expensesDays: clean(patch.expensesDays, cur.expensesDays) };
  await setMeta(META_KEY, next);
  return next;
}

/** 'YYYY-MM-DD' for N days ago (local date), for server-side `>=` filters. */
export function sinceDate(days, now = new Date()) {
  const d = new Date(now.getTime() - days * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
