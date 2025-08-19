// esbuild.mjs
import { build, context } from 'esbuild';

const isWatch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/extension.ts'], // adjust if your entry differs
  outfile: 'out/extension.js',
  bundle: true,
  minify: true,
  sourcemap: true,
  platform: 'node',
  format: 'cjs',
  external: ['vscode'],
  logLevel: 'info',
};

if (isWatch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('✅ esbuild is watching for changes…');
} else {
  await build(options);
  console.log('✅ esbuild build complete');
}
