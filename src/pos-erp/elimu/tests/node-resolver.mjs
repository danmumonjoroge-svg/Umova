// Lets plain Node run files that use the POS's bundler-style extensionless imports, and finds dexie / fake-indexeddb.
// usage: ELIMU_NODE_MODULES=/path/to/node_modules node --experimental-default-type=module --import ./elimu/tests/node-resolver.mjs --test elimu/tests/offline.test.mjs
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
import { existsSync } from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url'; import path from 'node:path';
const NM = process.env.ELIMU_NODE_MODULES || path.resolve('node_modules');
export async function resolve(spec, ctx, next) {
  if (spec === 'dexie') return next(pathToFileURL(path.join(NM, 'dexie/dist/dexie.mjs')).href, ctx);
  if (spec === 'fake-indexeddb/auto') return next(pathToFileURL(path.join(NM, 'fake-indexeddb/auto/index.mjs')).href, ctx);
  if ((spec.startsWith('.') || spec.startsWith('/')) && !path.extname(spec) && ctx.parentURL) {
    const base = path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec);
    for (const e of ['.js', '.jsx']) if (existsSync(base + e)) return next(pathToFileURL(base + e).href, ctx);
    for (const e of ['/index.js', '/index.jsx']) if (existsSync(base + e)) return next(pathToFileURL(base + e).href, ctx);
  }
  return next(spec, ctx);
}`));
