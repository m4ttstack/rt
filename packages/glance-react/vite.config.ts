/// <reference types="vitest" />

import { resolve } from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import dts from 'vite-plugin-dts';

import { version } from './package.json';

export default defineConfig({
  plugins: [
    tailwindcss(),
    react({
      babel: { plugins: ['babel-plugin-react-compiler'] },
    }),
    dts({
      tsconfigPath: resolve(__dirname, 'tsconfig.lib.json'),
    }),
  ],
  define: {
    GLOBALS: { packageVersion: version },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './lib'),
    },
  },
  build: {
    copyPublicDir: false,
    lib: {
      entry: resolve(__dirname, 'lib/main.ts'),
      formats: ['es', 'cjs'],
      fileName: format => (format === 'es' ? 'main.mjs' : 'main.cjs'),
      cssFileName: 'styles',
    },
    rollupOptions: {
      external: [
        'react',
        'react/jsx-runtime',
        'react-dom',
        // FA tree-shaking — consumers provide their own config
        '@fortawesome/fontawesome-svg-core',
      ],
    },
  },
  //@ts-ignore
  test: {
    globals: true,
    environment: 'happy-dom',
    include: ['lib/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
  },
});
