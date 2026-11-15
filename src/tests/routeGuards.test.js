// Every /pos/* route (except the open Home dashboard and the "More" menu) must be wrapped in RequirePermission with a
// ROUTE_PERMISSIONS entry that exists. Run: node tests/routeGuards.test.js
const fs = require('fs'); const path = require('path');
const app = fs.readFileSync(path.join(__dirname, '..', 'POSApp.jsx'), 'utf8');
const nav = fs.readFileSync(path.join(__dirname, '..', 'navigation', 'navConfig.js'), 'utf8');
const block = nav.slice(nav.indexOf('export const ROUTE_PERMISSIONS'));
const keys = new Set([...block.matchAll(/(?:^|[\s,{])'?([a-z\-\/]+)'?:\s*[\[A-Z]/gm)].map((m) => m[1]));
const OPEN = new Set(['dashboard', 'more', 'index']);   // 'index' only redirects to Home
let bad = 0, n = 0;
for (const m of app.matchAll(/<Route\s+(index|path="([^"]+)")[^>]*element=\{(.*)\}\s*\/>/g)) {
  const id = m[2] || 'index'; n++;
  if (OPEN.has(id)) continue;
  const guarded = new RegExp(`RequirePermission perm=\\{ROUTE_PERMISSIONS\\["${id}"\\]\\}`).test(m[0]);
  if (!guarded) { console.log('UNGUARDED', id); bad++; }
  if (!keys.has(id)) { console.log('NO ROUTE_PERMISSIONS ENTRY', id); bad++; }
}
console.log(`${n} routes checked, ${bad} problems`); process.exit(bad ? 1 : 0);
