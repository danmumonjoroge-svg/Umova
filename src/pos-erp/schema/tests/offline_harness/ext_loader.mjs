// Lets node load the project's extension-less relative imports ("./db") the way the React build does.
import fs from 'fs'; import { fileURLToPath } from 'url';
export async function resolve(specifier, context, next) {
  if (/^\.{1,2}\//.test(specifier) && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.startsWith('file:')) {
    const base = new URL(specifier, context.parentURL);
    for (const ext of ['.js', '.mjs', '/index.js']) { const u = base.href + ext; if (fs.existsSync(fileURLToPath(u))) return next(u, context); }
  }
  return next(specifier, context);
}
