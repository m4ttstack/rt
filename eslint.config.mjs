import storybook from 'eslint-plugin-storybook';
import tseslint from 'typescript-eslint';

import { mattstackEslint } from './packages/ui/presets/eslint.js';

export default tseslint.config(
  // The treeshake gate's build output; a compiled bundle, not source.
  { ignores: ['packages/ui/scripts/treeshake-probe/dist/**'] },
  ...mattstackEslint({ app: ['probe/src/**/*.{ts,tsx}'] }),
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
  ...storybook.configs['flat/recommended']
);
