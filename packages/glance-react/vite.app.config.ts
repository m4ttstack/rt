import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Demo app config — runs in two modes:
 *
 *   bun run dev:app        → imports from lib/ source (local dev)
 *   bun run dev:app:dist   → imports from dist/ (simulates npm consumer)
 *
 * Both use `@mattstack/glance-react` imports in App.tsx — the alias
 * determines where they resolve to.
 */
const testDist = process.env.TEST_DIST === '1';

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: testDist
      ? {
          // ── dist mode: resolve to built artifacts ───────────
          '@mattstack/glance-react/styles.css': resolve(
            __dirname,
            'dist/styles.css'
          ),
          '@mattstack/glance-react/tokens.css': resolve(
            __dirname,
            'dist/tokens.css'
          ),
          '@mattstack/glance-react': resolve(__dirname, 'dist/main.mjs'),
        }
      : {
          // ── source mode: resolve to lib/ source ────────────
          '@mattstack/glance-react/styles.css': resolve(
            __dirname,
            'lib/css/styles.css'
          ),
          '@mattstack/glance-react/tokens.css': resolve(
            __dirname,
            'lib/css/tokens.css'
          ),
          '@mattstack/glance-react': resolve(__dirname, 'lib/main.ts'),
          '@': resolve(__dirname, 'lib'),
        },
  },
  build: {
    outDir: 'app-dist',
  },
});
