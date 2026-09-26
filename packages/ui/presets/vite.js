// Hand-authored JavaScript, not compiled from vite.ts. A Vite config runs
// through Node's config loader before the consumer's own build pipeline, so
// it cannot be type-stripped from node_modules the way the kit's TSX and
// CSS can. Vite's default `bundle` loader externalizes node_modules
// dependencies and fails importing a `.ts` here, and the upcoming `native`
// default breaks the same way, so this preset ships as plain JS (types live
// in vite.d.ts) the same way vitest/config, @nx/vite, and @epic-web/config
// ship their shared configs.
import react from '@vitejs/plugin-react';

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
export function mattstackVite(opts) {
  const { apiPort, proxy = true, extraGroups = [] } = opts;
  return {
    plugins: [react({ exclude: /\/node_modules\/(?!@mattstack\/)/ })],
    optimizeDeps: {
      exclude: ['@mattstack/app-kit', '@mattstack/mantine-tokyo'],
      // Vite scans no excluded importer, so every bare specifier the kit
      // source imports must be listed here or a consumer that reaches it
      // only through the kit gets it served raw. Raw ESM survives that;
      // raw CJS (react-dom/client, dayjs and its plugins, prop-types via
      // @mantine ESM) has no `default` export and blanks the whole app
      // under `vite dev`. So: the kit's peers, its own deps, and the CJS
      // subpaths its source touches. Prebundling something a consumer
      // never mounts costs one optimize pass; missing one blanks the page.
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'dayjs',
        'zod',
        'wouter',
        'lucide-react',
        'react-interval-hook',
        'clsx',
        'mantine-form-zod-resolver',
        '@tanstack/react-virtual',
        'codemirror',
        '@codemirror/commands',
        '@codemirror/lang-javascript',
        '@codemirror/lang-json',
        '@codemirror/state',
        '@codemirror/view',
        '@mantine/core',
        '@mantine/dates',
        '@mantine/hooks',
        '@mantine/form',
        '@mantine/modals',
        '@mantine/notifications',
        '@mantine/spotlight',
        '@mantine/code-highlight',
      ],
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
  };
}
