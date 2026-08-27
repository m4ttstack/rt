import storybook from 'eslint-plugin-storybook';
import tseslint from 'typescript-eslint';

import { mattstackEslint } from './packages/ui/presets/eslint.js';

export default tseslint.config(
  // The treeshake gate's build output; a compiled bundle, not source.
  { ignores: ['packages/ui/scripts/treeshake-probe/dist/**'] },
  ...mattstackEslint({ app: ['probe/src/**/*.{ts,tsx}'] }),
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
