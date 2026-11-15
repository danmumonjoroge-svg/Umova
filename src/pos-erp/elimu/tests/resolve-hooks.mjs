// Lets node load the app's extensionless imports (Vite style) so the pure modules can be unit tested without a bundler.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
    const base = new URL(specifier, context.parentURL);
    for (const ext of ['.js', '.jsx', '/index.js']) { const u = base.href + ext; if (fs.existsSync(fileURLToPath(u))) return next(u, context); }
  }
  return next(specifier, context);
}
