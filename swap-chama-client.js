// Run once from your project root:   node swap-chama-client.js
// Makes every file inside src/chama-erp-advanced use the Chama client (own session) instead of the SACCO one.
const fs = require("fs"), path = require("path");
const root = path.join("src", "chama-erp-advanced");
const re = /import \{ supabase \} from "((?:\.\.\/)+)supabaseClient";/g;
let changed = 0;
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { walk(p); continue; }
    if (!/\.(js|jsx)$/.test(f.name)) continue;
    const s = fs.readFileSync(p, "utf8");
    const out = s.replace(re, 'import { chamaSupabase as supabase } from "$1supabaseClient";');
    if (out !== s) { fs.writeFileSync(p, out); changed++; console.log("updated", p); }
  }
})(root);
console.log(`Done. ${changed} files updated.`);
