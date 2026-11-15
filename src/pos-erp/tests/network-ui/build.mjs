import esbuild from 'esbuild';
const H = '/home/claude/uitest/harness/';
const swap = { name: 'swap', setup(b) {
  b.onResolve({ filter: /posSupabaseClient$/ }, () => ({ path: H + 'supabaseBridge.js' }));
  b.onResolve({ filter: /navigation\/PermissionsContext$/ }, () => ({ path: H + 'permStub.jsx' }));
  b.onResolve({ filter: /services\/productService$/ }, () => ({ path: H + 'productStub.js' }));
} };
await esbuild.build({ entryPoints: [process.argv[2]], outfile: process.argv[3], bundle: true, platform: 'node', format: 'esm', packages: 'external',
  jsx: 'automatic', loader: { '.js': 'jsx' }, plugins: [swap], logLevel: 'error' });
