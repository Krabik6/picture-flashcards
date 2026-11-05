import esbuild from 'esbuild';

const production = process.argv[2] === 'production';
await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'main.js',
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  sourcemap: production ? false : 'inline',
  minify: production,
  logLevel: 'info',
});
