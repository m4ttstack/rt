// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

vi.mock('@mattstack/rt-client', () => ({
  getSetting: vi.fn((key: string) => {
    if (key === 'rt.runsPruneDays') return { value: 45, provenance: [] };
    if (key === 'rt.workspacePrefs')
      return { value: { editors: {}, defaultEditor: 'zed' }, provenance: [] };
    if (key === 'mattstack.integrations')
      return {
        value: { linear: { teamKey: 'CV', workspace: 'acme' } },
        provenance: [],
      };
    throw new Error(`unexpected setting key in test: ${key}`);
  }),
  unsetSetting: vi.fn(),
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

  it('reads the linear workspace slug out of mattstack.integrations', async () => {
    const res = await settings.fetch(
      new Request('http://localhost/api/settings/linear-workspace')
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ workspace: 'acme' });
    expect(rt.getSetting).toHaveBeenCalledWith('mattstack.integrations');
  });

  it('reads the default editor off rt.workspacePrefs', async () => {
    const res = await settings.fetch(
      new Request('http://localhost/api/settings/default-editor')
    );

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ editor: 'zed' });
    expect(rt.getSetting).toHaveBeenCalledWith('rt.workspacePrefs');
  });

  it('answers null for a truthy non-string defaultEditor instead of forwarding it', async () => {
    vi.mocked(rt.getSetting).mockReturnValueOnce({
      value: { defaultEditor: 5 },
      provenance: [],
    } as never);
    const res = await settings.fetch(
      new Request('http://localhost/api/settings/default-editor')
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ editor: null });
  });

  it('answers null, not a 500, when the prefs value is unset or the resolver throws', async () => {
    vi.mocked(rt.getSetting).mockReturnValueOnce({
      value: undefined,
      provenance: [],
    } as never);
    const unset = await settings.fetch(
      new Request('http://localhost/api/settings/default-editor')
    );
    expect(unset.status).toBe(200);
    await expect(unset.json()).resolves.toEqual({ editor: null });

    vi.mocked(rt.getSetting).mockImplementationOnce(() => {
      throw new Error('rt: cannot expand ${repoRoot}');
    });
    const threw = await settings.fetch(
      new Request('http://localhost/api/settings/default-editor')
    );
    expect(threw.status).toBe(200);
    await expect(threw.json()).resolves.toEqual({ editor: null });
  });
});
