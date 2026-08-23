/// <reference types="vitest/config" />
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@ui': path.resolve(__dirname, 'src/ui') },
  },
  build: {
    rolldownOptions: {
      output: {
        // Vendor splitting, so no emitted chunk crosses Vite's 500 kB
        // warning threshold. Groups are matched in order; a group chunk is
        // only fetched when a chunk that needs it loads, so the lazily
        // loaded packages (@codemirror/*, @mantine/code-highlight via
        // @ui/lazy) must not share a group with eagerly loaded ones --
        // that's why the mantine group lists its packages explicitly
        // instead of matching all of node_modules/@mantine.
        codeSplitting: {
          groups: [
            {
              name: 'codemirror-lang',
              test: /node_modules\/(?:@codemirror\/lang-|@lezer\/)/,
            },
            {
              name: 'codemirror',
              test: /node_modules\/(?:@codemirror\/|codemirror\/|style-mod|w3c-keyname|crelt)/,
            },
            {
              name: 'react',
              test: /node_modules\/(?:react|react-dom|scheduler)\//,
            },
            {
              name: 'mantine',
              test: /node_modules\/@mantine\/(?:core|dates|hooks|form|modals|notifications|spotlight)\//,
            },
          ],
        },
      },
    },
  },
  preview: {
    // Extra hostnames (comma-separated) allowed to reach `vite preview` when
    // it runs behind a reverse proxy; localhost-style hosts are always allowed.
    allowedHosts: process.env.PREVIEW_ALLOWED_HOSTS?.split(',') ?? [],
  },
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:11011', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:11011', ws: true },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
});
