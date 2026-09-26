import css from '@eslint/css';
import storybook from 'eslint-plugin-storybook';
import tseslint from 'typescript-eslint';

import tokenNamespacesCss from './packages/ui/presets/eslint-local/token-namespaces-css.js';
import { local, mattstackEslint } from './packages/ui/presets/eslint.js';

const SCRIPT_FILES = ['**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}'];

export default tseslint.config(
  // The treeshake gate's build output; a compiled bundle, not source.
  { ignores: ['packages/ui/scripts/treeshake-probe/dist/**'] },
  // tui-kit's TS keeps its own conventions; its CSS is lintable below.
  {
    ignores: [
      'packages/tui-kit/**/*.{ts,tsx,js,mjs}',
      'packages/tui-kit/dist/**',
      'packages/tui-kit/src/generated/**',
    ],
  },
  ...mattstackEslint().map(c =>
    c.files || c.ignores ? c : { ...c, files: SCRIPT_FILES }
  ),
  {
    // The preset's `app` glob is relative to a consuming app's own root, so
    // from the repo root it matches nothing and the kit's own source skips
    // every app-only rule. Only the token rule is re-applied here: the rest
    // of that block is the import wall, which the kit is the far side of.
    files: ['packages/ui/src/**/*.{ts,tsx}'],
    plugins: { local },
    rules: { 'local/token-namespaces': 'error' },
  },
  {
    // Config presets ship as plain JS (see packages/ui/presets/vite.js) and
    // run in Node, unlike the .tsx source that typescript-eslint's ts-file
    // override already exempts from no-undef.
    files: ['packages/ui/presets/*.js'],
    languageOptions: { globals: { process: 'readonly' } },
  },
  {
    files: ['packages/ui/src/**/*.{ts,tsx}'],
    ignores: ['packages/ui/src/core/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@mantine/core',
              importNames: ['Table', 'TextInput', 'CopyButton'],
              message:
                'Use the shadowed versions from @mattstack/app-kit/core.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/gate-kit/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@mattstack/rt-client',
              message:
                "Import from '@mattstack/rt-client/gate' instead. The bare entry pulls Node-side code into gate-kit's browser bundle.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/ui/src/**/*.css', 'stories/**/*.css'],
    plugins: {
      css,
      local: { rules: { 'token-namespaces-css': tokenNamespacesCss } },
    },
    language: 'css/css',
    rules: { 'local/token-namespaces-css': 'error' },
  },
  {
    files: ['packages/tui-kit/src/**/*.css', 'apps/board/src/**/*.css'],
    plugins: {
      css,
      local: { rules: { 'token-namespaces-css': tokenNamespacesCss } },
    },
    language: 'css/css',
    rules: { 'local/token-namespaces-css': 'warn' },
  },
  ...storybook.configs['flat/recommended']
);
