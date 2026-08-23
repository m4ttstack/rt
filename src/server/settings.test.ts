// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  getSetting: vi.fn((key: string) => {
    if (key === 'rt.runsPruneDays') return { value: 45, provenance: [] };
    throw new Error(`unexpected setting key in test: ${key}`);
  }),
}));

const { settings } = await import('./settings');
const rt = await import('@mattstack/rt-client');

describe('settings api', () => {
  it('resolves rt.runsPruneDays through the registry rather than a hardcoded number', async () => {
    const res = await settings.fetch(
      new Request('http://localhost/api/settings/runs-prune-days')
    );

    expect(res.status).toBe(200);
    // 45, not 30 (the registry default), pins that the route forwards
    // whatever the resolver returns instead of a literal.
    await expect(res.json()).resolves.toEqual({ days: 45 });
    expect(rt.getSetting).toHaveBeenCalledWith('rt.runsPruneDays');
  });
});
