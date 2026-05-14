import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { 'harness-headless': 'src/index.ts' },
  format: ['esm'],
  outDir: 'dist',
  outExtension: () => ({ js: '.mjs' }),
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: true,
  clean: true,
})
