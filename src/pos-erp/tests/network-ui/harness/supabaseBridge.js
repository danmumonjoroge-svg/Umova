// Test stand-in for posSupabaseClient: sends each rpc() to the REAL phase36 functions on the scratch Postgres,
// as the signed-in test user (globalThis.__who). Errors come back shaped like PostgREST's { code, message, details }.
import pg from 'pg';
const pool = new pg.Pool({ host: '/var/tmp/pgnet', port: 5536, user: 'postgres', database: process.env.UI_DB || 'p36ui', max: 4 });
globalThis.__pool = pool;
globalThis.__rpcLog = [];
async function rpc(name, args) {
  const who = globalThis.__who;
  const c = await pool.connect();
  try {
    await c.query("select set_config('test.tenant',$1,false), set_config('test.perms',$2,false)", [who.tenant, who.perms]);
    const keys = Object.keys(args || {});
    const vals = keys.map((k) => (k === 'p_lines' ? (args[k] == null ? null : JSON.stringify(args[k])) : args[k]));
    const sql = `select ${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`;
    globalThis.__rpcLog.push(name);
    const r = await c.query(sql, vals);
    if (globalThis.__dropResponseOnce) { globalThis.__dropResponseOnce = false; throw new TypeError('Failed to fetch'); }  // the server DID the work; the answer is lost
    return { data: r.rows[0].r, error: null };
  } catch (e) {
    if (e instanceof TypeError) return { data: null, error: { message: 'TypeError: Failed to fetch' } };
    return { data: null, error: { code: e.code, message: e.message, details: e.detail } };
  } finally { c.release(); }
}
export const posSupabase = { rpc };
