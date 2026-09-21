import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe } from 'vitest';

import noDimmedXs from './no-dimmed-xs.js';

const tester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2023,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe('local/no-dimmed-xs', () => {
  tester.run('no-dimmed-xs', noDimmedXs, {
    valid: [
      { code: '<Text size="sm" c="dimmed">a</Text>' },
      { code: '<Text size="xs">a</Text>' },
      { code: '<Text size={size} c="dimmed">a</Text>' },
      { code: '<Title size="sm" c="dimmed">a</Title>' },
      { code: '<Anchor size="sm" c="dimmed">a</Anchor>' },
    ],
    invalid: [
      {
        code: '<Text size="xs" c="dimmed">a</Text>',
        errors: [{ messageId: 'dimmedXs' }],
      },
      {
        code: '<Badge size="xs" c="dimmed">a</Badge>',
        errors: [{ messageId: 'dimmedXs' }],
      },
      {
        code: '<Title size="xs" c="dimmed">a</Title>',
        errors: [{ messageId: 'dimmedXs' }],
      },
      {
        code: '<Anchor size="xs" c="dimmed">a</Anchor>',
        errors: [{ messageId: 'dimmedXs' }],
      },
    ],
  });
});
