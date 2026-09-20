import { describe, expect, test } from 'bun:test';

import { parseFindingOption } from '../finding-option.ts';

describe('parseFindingOption', () => {
  test('parses tier, title, anchor, fix', () => {
    expect(
      parseFindingOption({
        value: 'f3',
        label: '[Minor] Em dash in the new describe title',
        description:
          'workflow.integration.test.ts:12 · use a hyphen; change both siblings · kind:nitpick',
      })
    ).toEqual({
      id: 'f3',
      tier: 'Minor',
      title: 'Em dash in the new describe title',
      anchor: 'workflow.integration.test.ts:12',
      fix: 'use a hyphen; change both siblings',
      kind: 'nitpick',
    });
  });

  test('description without separator that looks like a path is an anchor', () => {
    const parsed = parseFindingOption({
      value: 'f9',
      label: '[Important] Evidence section is empty',
      description: 'apps/webapp/src/services/api.tsx',
    });
    expect(parsed?.anchor).toBe('apps/webapp/src/services/api.tsx');
    expect(parsed?.fix).toBeUndefined();
  });

  test('a root-level filename with no separator is an anchor, not a fix', () => {
    const parsed = parseFindingOption({
      value: 'f10',
      label: '[Minor] Stale install instructions',
      description: 'README.md',
    });
    expect(parsed?.anchor).toBe('README.md');
    expect(parsed?.fix).toBeUndefined();
    const dotfileish = parseFindingOption({
      value: 'f11',
      label: '[Minor] Redundant config key',
      description: 'package.json',
    });
    expect(dotfileish?.anchor).toBe('package.json');
  });

  test('prose with spaces stays a fix even when it ends like a filename', () => {
    const parsed = parseFindingOption({
      value: 'f12',
      label: '[Minor] Unused import',
      description: 'drop the import in utils.ts',
    });
    expect(parsed?.fix).toBe('drop the import in utils.ts');
    expect(parsed?.anchor).toBeUndefined();
  });

  test('non-finding options give null', () => {
    expect(parseFindingOption('approve')).toBeNull();
    expect(
      parseFindingOption({ value: 'Minor', label: 'Minor (4)' })
    ).toBeNull();
  });
});
