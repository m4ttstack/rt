import react from '@vitejs/plugin-react';
import type { UserConfig } from 'vite';

export interface MattstackViteOptions {
  /** The Bun/Hono server's port; the dev proxy forwards /api and /ws to it. */
  apiPort: number;
  /** @default true */
  proxy?: boolean;
  /** Additional `codeSplitting.groups`, matched before the kit's. */
  extraGroups?: { name: string; test: RegExp }[];
}

const GROUPS = [
  {
    name: 'codemirror-lang',
    test: /node_modules\/(?:@codemirror\/lang-|@lezer\/)/,
  },
  {
    name: 'codemirror',
    test: /node_modules\/(?:@codemirror\/|codemirror\/|style-mod|w3c-keyname|crelt)/,
  },
  { name: 'react', test: /node_modules\/(?:react|react-dom|scheduler)\// },
  {
    name: 'mantine',
    test: /node_modules\/@mantine\/(?:core|dates|hooks|form|modals|notifications|spotlight)\//,
  },
];

/**
 * The app-kit packages ship TSX and CSS modules as source under
 * node_modules, so they are excluded from dependency pre-bundling and the
 * react plugin is told not to skip them.
 */
export function mattstackVite(opts: MattstackViteOptions): UserConfig {
  const { apiPort, proxy = true, extraGroups = [] } = opts;
  return {
    plugins: [react({ exclude: /\/node_modules\/(?!@mattstack\/)/ })],
    optimizeDeps: {
      exclude: ['@mattstack/app-kit', '@mattstack/mantine-tokyo'],
    },
    build: {
      rolldownOptions: {
        output: { codeSplitting: { groups: [...extraGroups, ...GROUPS] } },
      },
    },
    server: proxy
      ? {
          proxy: {
            '/api': {
              target: `http://127.0.0.1:${apiPort}`,
              changeOrigin: true,
            },
            '/ws': { target: `ws://127.0.0.1:${apiPort}`, ws: true },
          },
        }
      : undefined,
    preview: {
      allowedHosts: process.env.PREVIEW_ALLOWED_HOSTS?.split(',') ?? [],
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
    },
  } as UserConfig;
}
