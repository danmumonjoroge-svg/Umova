import fs from 'node:fs'; import { fileURLToPath, pathToFileURL } from 'node:url'; import path from 'node:path';
export async function resolve(specifier, context, next) {
  if ((specifier.startsWith('.') || specifier.startsWith('/')) && context.parentURL) {
    const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    for (const cand of [base, base + '.js', base + '.jsx', base + '.mjs', path.join(base, 'index.js')]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return next(pathToFileURL(cand).href, context);
    }
  }
  return next(specifier, context);
}
