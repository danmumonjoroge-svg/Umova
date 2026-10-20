// A small in-memory STAND-IN for the Dexie library, used ONLY by offline_js_checks.mjs.
//
// Why it exists: the test machine could not download Dexie (no access to the npm registry), so the offline logic is
// exercised against this stand-in. It implements just the calls the offline code makes, with Dexie's behaviour for each.
// It is NOT a substitute for one run against the real library -- run `node schema/tests/offline_js_checks.mjs --real`
// on a machine that has `npm install dexie fake-indexeddb` to repeat every check on real Dexie + IndexedDB.

class Collection {
  constructor(rows, table) { this.rows = rows; this.table = table; }
  async toArray() { return this.rows.map(r => ({ ...r })); }
  async count() { return this.rows.length; }
  async first() { return this.rows[0] ? { ...this.rows[0] } : undefined; }
  reverse() { return new Collection([...this.rows].reverse(), this.table); }
  filter(fn) { return new Collection(this.rows.filter(fn), this.table); }
  async sortBy(key) { return [...this.rows].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0)).map(r => ({ ...r })); }
  async modify(changes) { for (const r of this.rows) Object.assign(this.table._byKey(r), changes); return this.rows.length; }
  async delete() { for (const r of this.rows) this.table._del(r); return this.rows.length; }
}
class WhereClause {
  constructor(table, index) { this.table = table; this.index = index; }
  equals(v) { return new Collection(this.table._all().filter(r => r[this.index] === v), this.table); }
  anyOf(...vs) { const set = new Set(vs.flat()); return new Collection(this.table._all().filter(r => set.has(r[this.index])), this.table); }
  startsWith(p) { return new Collection(this.table._all().filter(r => String(r[this.index] ?? '').startsWith(p)), this.table); }
}
class Table {
  constructor(name, schema) {
    this.name = name;
    const pk = schema.split(',')[0].trim();
    this.auto = pk.startsWith('++');
    this.pk = pk.replace('++', '');
    this.map = new Map();
    this.seq = 0;
  }
  _all() { return [...this.map.values()]; }
  _byKey(r) { return this.map.get(r[this.pk]); }
  _del(r) { this.map.delete(r[this.pk]); }
  async add(row) {
    const r = { ...row };
    if (this.auto && r[this.pk] == null) r[this.pk] = ++this.seq;
    if (this.map.has(r[this.pk])) throw Object.assign(new Error('ConstraintError'), { name: 'ConstraintError' });
    this.map.set(r[this.pk], r); return r[this.pk];
  }
  async put(row) { const r = { ...row }; if (this.auto && r[this.pk] == null) r[this.pk] = ++this.seq; this.map.set(r[this.pk], r); return r[this.pk]; }
  async bulkPut(rows) { for (const r of rows) await this.put(r); }
  async bulkGet(keys) { return keys.map(k => (this.map.has(k) ? { ...this.map.get(k) } : undefined)); }
  async get(key) { return this.map.has(key) ? { ...this.map.get(key) } : undefined; }
  async update(key, changes) { const r = this.map.get(key); if (!r) return 0; Object.assign(r, changes); return 1; }
  async toArray() { return this._all().map(r => ({ ...r })); }
  async clear() { this.map.clear(); }
  async delete(key) { this.map.delete(key); }
  async count() { return this.map.size; }
  where(index) { return new WhereClause(this, index); }
  orderBy(index) { const rows = this._all().sort((a, b) => (a[index] > b[index] ? 1 : a[index] < b[index] ? -1 : 0)); return new Collection(rows, this); }
}

export default class Dexie {
  constructor(name) { this.name = name; this._tables = {}; }
  version() {
    const self = this;
    return { stores(schemas) { for (const [n, s] of Object.entries(schemas)) { if (!self._tables[n]) { self._tables[n] = new Table(n, s); self[n] = self._tables[n]; } } return this; } };
  }
  // Real Dexie runs read-write transactions on the same tables one after another; model that with a queue so tests of
  // 'two rapid taps' mean something.
  transaction(...args) { const fn = args[args.length - 1]; const run = (this._txq || Promise.resolve()).then(() => fn()); this._txq = run.catch(() => {}); return run; }
}
