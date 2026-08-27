import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

import noInlineStyles from './eslint-local/no-inline-styles.js';
import requireDataTestid from './eslint-local/require-data-testid.js';

const KIT = '@mattstack/app-kit';

const wall = (pkg, subpath) => ({
  name: pkg,
  message: `Import from '${KIT}/${subpath}' instead. The kit barrel adds fixed defaults and overrides.`,
});

export const importWall = {
  paths: [
    wall('@mantine/core', 'core'),
    wall('@mantine/hooks', 'hooks'),
    wall('@mantine/form', 'forms'),
    wall('@mantine/modals', 'modals'),
    wall('@mantine/notifications', 'notifications'),
    wall('@mantine/spotlight', 'spotlight'),
    wall('@mantine/code-highlight', 'lazy'),
    wall('@mantine/dates', 'core'),
    {
      name: 'lucide-react',
      message: `Use the icon registry: import { Icon } from '${KIT}/icons'.`,
    },
  ],
  patterns: [
    {
      group: ['react-icons', 'react-icons/*'],
      message: `react-icons is banned. Use ${KIT}/icons.`,
    },
    {
      group: ['codemirror', '@codemirror/*'],
      message: `Import from '${KIT}/lazy' instead.`,
    },
    {
      group: ['@ui/*'],
      message: `The @ui alias is gone; import from '${KIT}/<subpath>'.`,
    },
    {
      group: ['**/server/**'],
      importNamePattern: '.*',
      allowTypeImports: true,
      message:
        'The server runs on Bun and must never reach the browser bundle. Only `import type` from src/server is allowed.',
    },
  ],
};

/**
 * @param {{ app?: string[] }} [opts] globs the app-only rules apply to
 *   (default `['src/**\/*.{ts,tsx}']`). Wrap with `tseslint.config(...)`.
 */
export function mattstackEslint(opts = {}) {
  const app = opts.app ?? ['src/**/*.{ts,tsx}'];
  return [
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      plugins: { 'react-hooks': reactHooks },
      rules: {
        'react-hooks/rules-of-hooks': 'error',
        'react-hooks/exhaustive-deps': 'warn',
      },
    },
    {
      files: app,
      plugins: {
        local: {
          rules: {
            'require-data-testid': requireDataTestid,
            'no-inline-styles': noInlineStyles,
          },
        },
      },
      rules: {
        'local/require-data-testid': 'off',
        'local/no-inline-styles': 'off',
        'no-restricted-imports': ['error', importWall],
      },
    },
    eslintConfigPrettier,
  ];
}

export default mattstackEslint;
