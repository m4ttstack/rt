// eslint-disable-next-line no-restricted-imports -- test-only: reads the live registry under vitest; never bundled
import { allDefs } from '@mattstack/rt-client';
import { describe, expect, it } from 'vitest';

import { groupOf, GROUPS } from './groups';

describe('GROUPS', () => {
  it('puts every registered key in exactly one group', () => {
    for (const def of allDefs()) {
      const hits = GROUPS.filter(g => g.match(def.key)).map(g => g.id);
      expect(hits, def.key).toHaveLength(1);
    }
  });

  it('leaves no group empty', () => {
    const keys = allDefs().map(d => d.key);
    for (const g of GROUPS) expect(keys.some(g.match), g.id).toBe(true);
  });

  it('files an unknown key under its first segment instead of dropping it', () => {
    expect(groupOf('zeta.newKey')).toMatchObject({
      id: 'zeta',
      label: 'zeta',
      tier: 'apps',
    });
  });
});
