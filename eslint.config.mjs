import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

import noInlineStyles from './eslint-local/no-inline-styles.js';
import requireDataTestid from './eslint-local/require-data-testid.js';

const mantineWall = (pkg, barrel) => ({
  name: pkg,
  message: `Import from '${barrel}' instead. The kit barrel adds fixed defaults and overrides.`,
});

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // The two classic react-hooks rules: rules-of-hooks as an error,
  // exhaustive-deps as a warning -- so hook misuse is caught and
  // `eslint-disable-next-line react-hooks/exhaustive-deps` comments in
  // consumer code resolve instead of erroring with "Definition for rule
  // not found". Deliberately NOT the plugin's full flat.recommended: that
  // enables the React Compiler rule set (refs, set-state-in-effect,
  // purity, ...), which this kit doesn't adopt yet.
  {
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/ui/**'],
    plugins: {
      local: {
        rules: {
          'require-data-testid': requireDataTestid,
          'no-inline-styles': noInlineStyles,
        },
      },
    },
    rules: {
      // Optional rules, off by default. Flip to 'error' per project when ready to enforce.
      'local/require-data-testid': 'off',
      // Bans JSX style=/styles=/sx= in app code in favor of theme extend,
      // token vars, and CSS modules. Same app-code-only scope as the wall
      // below; this template's own app still uses style= freely, so turning
      // it on here would flag existing demo code -- it ships for consumers.
      'local/no-inline-styles': 'off',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            mantineWall('@mantine/core', '@ui/core'),
            mantineWall('@mantine/hooks', '@ui/hooks'),
            mantineWall('@mantine/form', '@ui/forms'),
            mantineWall('@mantine/modals', '@ui/modals'),
            mantineWall('@mantine/notifications', '@ui/notifications'),
            mantineWall('@mantine/spotlight', '@ui/spotlight'),
            mantineWall('@mantine/code-highlight', '@ui/lazy'),
            mantineWall('@mantine/dates', '@ui/core'),
            {
              name: 'lucide-react',
              message:
                "Use the icon registry: import { Icon } from '@ui/icons'.",
            },
          ],
          patterns: [
            {
              group: ['react-icons', 'react-icons/*'],
              message: 'react-icons is banned. Use @ui/icons.',
            },
            {
              group: ['codemirror', '@codemirror/*'],
              message:
                "Import from '@ui/lazy' instead. CodeMirror is only ever imported inside its lazy loader (src/ui/lazy/codemirror), so it stays out of the entry bundle.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/ui/**/*.{ts,tsx}'],
    // The @ui/core barrel's own `export * from '@mantine/core'` is exempt: until
    // the Table/TextInput shadows land (Task 9), the barrel's job is to pass the
    // whole module through, star-exports included. Every other file under
    // src/ui/** stays subject to the rule.
    ignores: ['src/ui/core/index.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@mantine/core',
              importNames: ['Table', 'TextInput', 'CopyButton'],
              message: 'Use the shadowed versions from @ui/core.',
            },
          ],
        },
      ],
    },
  },
  // Must stay last: turns off every core/plugin stylistic rule that conflicts
  // with (or duplicates) Prettier, so formatting is Prettier's job alone.
  // No eslint import-order rule exists in this config to disable in favor of
  // the sort-imports plugin (see .prettierrc) -- no-restricted-imports above
  // is a semantic import wall, not an ordering rule, so it keeps working.
  eslintConfigPrettier
);
