// Offline-safe drafts for the one thing Elimu must never lose or fake: a message someone prepared with no signal.
// Umova's offline database (Dexie "umova_offline") cannot be extended without touching core, so Elimu keeps its own tiny
// IndexedDB ("elimu_offline") with ONE store of drafts. A draft is only ever "pending": nothing here sends, and a draft is never
// shown as sent/delivered. When the phone is online again the person opens the draft and confirms; only then is it recorded.
// Every call is wrapped: private windows / blocked storage degrade to "no drafts", never an error in the UI.

const DB = 'elimu_offline', STORE = 'drafts';

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
const tx = async (mode, fn) => {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode); const s = t.objectStore(STORE); const req = fn(s);
    t.oncomplete = () => { db.close(); resolve(req?.result); }; t.onerror = () => { db.close(); reject(t.error); };
  });
};

export const newDraftId = () => `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export async function saveDraft(d) {
  try { await tx('readwrite', (s) => s.put({ ...d, id: d.id || newDraftId(), state: 'PENDING', saved_at: new Date().toISOString() })); return true; } catch { return false; }
}
export async function listDrafts(tenantId) {
  try { const all = (await tx('readonly', (s) => s.getAll())) || []; return all.filter((d) => !tenantId || d.tenant_id === tenantId).sort((a, b) => (b.saved_at || '').localeCompare(a.saved_at || '')); } catch { return []; }
}
export async function removeDraft(id) { try { await tx('readwrite', (s) => s.delete(id)); return true; } catch { return false; } }
