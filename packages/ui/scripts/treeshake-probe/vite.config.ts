import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Minimal-consumer probe for scripts/treeshake-check.sh: an app that
// imports ONLY Button + the theme through the kit barrels. The check
// builds it and asserts unused kit modules tree-shake out.
export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  optimizeDeps: { exclude: ['@mattstack/app-kit'] },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    sourcemap: true,
  },
  logLevel: 'warn',
});
