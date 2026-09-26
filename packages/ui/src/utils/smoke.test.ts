import { describe, expect, it } from 'vitest';

import { identity } from '@mattstack/app-kit/utils';

// Smoke test: proves the package subpath import resolves and the Vitest runner is wired up.
// Remove or replace once real tests land under packages/ui/src/utils.
describe('identity', () => {
  it('returns the value it was given, resolved through the package subpath import', () => {
    expect(identity('app-kit')).toBe('app-kit');
    expect(identity(42)).toBe(42);
  });
});
