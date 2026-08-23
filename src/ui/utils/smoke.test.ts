import { describe, expect, it } from 'vitest';

import { identity } from '@ui/utils/noop';

// Smoke test: proves the @ui alias resolves and the Vitest runner is wired up.
// Remove or replace once real tests land under src/ui/utils.
describe('identity', () => {
  it('returns the value it was given, resolved through the @ui alias', () => {
    expect(identity('mattstack-console')).toBe('mattstack-console');
    expect(identity(42)).toBe(42);
  });
});
