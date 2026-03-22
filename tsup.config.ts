import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: ['bin/fbl.ts'],
    format: ['esm'],
    outDir: 'dist/bin',
    banner: { js: '#!/usr/bin/env node' },
    clean: true,
    sourcemap: true,
  },
  {
    entry: ['src/hooks/worker.ts'],
    format: ['esm'],
    outDir: 'dist/hooks',
    sourcemap: true,
  },
]);
