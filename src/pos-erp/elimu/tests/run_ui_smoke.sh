#!/bin/sh
# Bundles the Elimu UI with stubs of the host app and renders every route + the communication components on the server.
# Needs a node_modules containing esbuild, react, react-dom, react-router-dom, lucide-react:   NM=/path/to/node_modules sh tests/run_ui_smoke.sh
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
[ -n "$NM" ] || { echo "Set NM=/path/to/node_modules"; exit 2; }
ln -sfn "$NM" "$HERE/node_modules"; trap 'rm -f "$HERE/node_modules" "$HERE/.alias.mjs" "$HERE/.build.mjs" "$HERE/.smoke.bundle.mjs"' EXIT
cat > "$HERE/.alias.mjs" <<'JS'
import path from 'node:path'; import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
const stubs = path.resolve(process.argv[2], 'stubs');
export default {
  name: 'host-stubs',
  setup(b) {
    const map = { 'services/posSupabaseClient': 'posSupabaseClient.js', 'navigation/PermissionsContext': 'host.jsx', 'auth/usePosErpAuth': 'host.jsx', 'services/businessIdentity': 'host.jsx', 'components/CardKit': 'host.jsx', 'components/workspace/Sheet': 'host.jsx', 'theme/brand': 'host.jsx', 'context/POSAuthContext': 'host.jsx', 'auth/POSAuthGate': 'host.jsx', 'auth/POSForcePasswordChange': 'forcePassword.jsx', 'security/AppLock': 'host.jsx' };
    b.onResolve({ filter: /^(dexie|@supabase\/supabase-js|jspdf|@capacitor\/.*)$/ }, () => ({ path: path.join(stubs, 'thirdparty.js') }));
    b.onResolve({ filter: /posSupabaseClient$/ }, () => ({ path: path.join(stubs, 'posSupabaseClient.js') }));
    b.onResolve({ filter: /^\.\.\/\.\.\// }, (a) => {
      const k = Object.keys(map).find((m) => a.path.endsWith(m)); if (k) return { path: path.join(stubs, map[k]) };
      // Host files that sit OUTSIDE the elimu folder (e.g. ../../../components/network/networkKit): resolve them against the real host
      // tree when HOST_DIR is set (the Elimu folder is treated as living at HOST_DIR/elimu), as they would in the real repo.
      if (!process.env.HOST_DIR) return undefined;
      const root = path.resolve(process.argv[2], '..'); const abs = path.resolve(path.dirname(a.importer), a.path);
      if (abs.startsWith(root + path.sep)) return undefined;                    // inside elimu: normal resolution
      const rel = path.relative(path.dirname(root), abs); const host = path.join(process.env.HOST_DIR, rel.replace(/^(\.\.\/)+/, ''));
      for (const ext of ['', '.js', '.jsx', '/index.js', '/index.jsx']) { try { if (require('node:fs').statSync(host + ext).isFile()) return { path: host + ext }; } catch {} }
      return undefined;
    });
  },
};
JS
cat > "$HERE/.build.mjs" <<'JS'
import { build } from 'esbuild'; import plugin from './.alias.mjs';
await build({ entryPoints: [process.argv[2] + '/js/ui_smoke.entry.jsx'], bundle: true, platform: 'node', format: 'esm', outfile: process.argv[2] + '/.smoke.bundle.mjs', loader: { '.js': 'jsx' }, plugins: [plugin], logLevel: 'error', external: ['react', 'react-dom', 'react-router-dom', 'lucide-react'] });
JS
node "$HERE/.build.mjs" "$HERE" "$HERE"
node "$HERE/.smoke.bundle.mjs"
