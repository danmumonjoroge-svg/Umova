// Permissive stand-ins for browser/native packages the real host files import (smoke test only; nothing here is shipped).
const deep = () => new Proxy(function () {}, { get: (_, k) => (k === 'then' ? undefined : deep()), apply: () => deep(), construct: () => deep() });
export default class Dexie { constructor() { return deep(); } }
export const createClient = () => deep();
export const jsPDF = function () { return deep(); };
export const Capacitor = { isNativePlatform: () => false, getPlatform: () => 'web' };
export const Filesystem = deep(), Directory = { Documents: 'DOCUMENTS', Cache: 'CACHE' }, Share = deep();
