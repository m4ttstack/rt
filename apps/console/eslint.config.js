import { importWall, mattstackEslint } from '@mattstack/app-kit/eslint';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...mattstackEslint(),
  // The preset's import wall doesn't know about @mattstack/rt-client, so
  // console layers its own value-import ban on top. This block REPLACES the
  // preset's `no-restricted-imports` rule for these files (flat config is
  // last-wins per rule), so it must extend `importWall` rather than list
  // its own patterns, or the two walls drift.
  {
    files: ['src/app/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          ...importWall,
          patterns: [
            ...importWall.patterns,
            {
              regex: '^@mattstack/rt-client$',
              importNamePattern: '.*',
              allowTypeImports: true,
              message:
                'The rt-client barrel evaluates the settings resolver (fs, os.homedir) at module ' +
                'scope and crashes the browser bundle. Value imports in app code come from ' +
                "'@mattstack/rt-client/identity'; everything else is `import type` only.",
            },
            {
              regex: '^@mattstack/gate-kit/server$',
              importNamePattern: '.*',
              allowTypeImports: true,
              message:
                "The gate-kit server entry touches node:fs and must never reach the browser bundle. App code imports '@mattstack/gate-kit' or '@mattstack/gate-kit/react'; only src/server may import the server entry.",
            },
          ],
        },
      ],
    },
  }
);
