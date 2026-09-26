import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useConsoleSettings, useKeyExplain } from './useConsoleSettings';

const REPO = 'gitlab.example.com/acme/app';
type Call = { url: string; body?: Record<string, unknown> };
let calls: Call[];

beforeEach(() => {
  calls = [];
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.includes('/defs'))
      return {
        ok: true,
        status: 200,
        json: async () => ({
          defs: [],
          unregistered: [
            {
              key: 'board.rtRepos',
              scope: 'machine',
              file: '/home/user/local/settings.local.jsonc',
            },
          ],
        }),
      };
    if (url.includes('/explain/'))
      return {
        ok: true,
        status: 200,
        json: async () => ({ def: null, rows: [] }),
      };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        rows: [],
        effective: { scope: 'team.repo', file: '/t' },
      }),
    };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('useConsoleSettings', () => {
  it('reads defs for the picked repo and keeps the unregistered list', async () => {
    const { result } = renderHook(() => useConsoleSettings(REPO));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const defsCall = calls.find(
      c => c.url.includes('/defs') && !c.url.includes('console.move-only')
    )!;
    expect(new URL(defsCall.url, 'http://x').searchParams.get('repo')).toBe(
      REPO
    );
    expect(result.current.unregistered).toEqual([
      {
        key: 'board.rtRepos',
        scope: 'machine',
        file: '/home/user/local/settings.local.jsonc',
      },
    ]);
  });

  it('sends repo in a write body only when one is given', async () => {
    const { result } = renderHook(() => useConsoleSettings(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.set('rt.roles', 'team', { dev: {} }, REPO);
      await result.current.set('rt.logLevel', 'machine', 'info');
      await result.current.unset('rt.roles', 'team', REPO);
      await result.current.prune('rt.roles', 'team', 'rt.roles', REPO);
    });
    const writes = calls.filter(c => c.body);
    expect(writes.map(c => [c.url, c.body])).toEqual([
      [
        '/api/settings/set',
        { key: 'rt.roles', scope: 'team', value: { dev: {} }, repo: REPO },
      ],
      [
        '/api/settings/set',
        { key: 'rt.logLevel', scope: 'machine', value: 'info' },
      ],
      ['/api/settings/unset', { key: 'rt.roles', scope: 'team', repo: REPO }],
      [
        '/api/settings/prune',
        {
          key: 'rt.roles',
          scope: 'team',
          storeName: 'rt.roles',
          force: true,
          repo: REPO,
        },
      ],
    ]);
  });

  it('skips the effective patch when a write repo differs from the hook repo for a repo-scoped def', async () => {
    const REPO_DEF = {
      key: 'rt.roles',
      type: 'object',
      scopes: ['team', 'user', 'machine'],
      merge: 'deep',
      secret: false,
      teamLocked: false,
      repoScoped: true,
      writable: true,
      description: 'Roles.',
      hasDefault: false,
      defaultValue: null,
      effective: { scope: 'team', file: '/t', value: { dev: {} } },
      storeVersion: 1,
    };
    // The reread a write triggers must not race this assertion: every /defs
    // call past the first (the mount read) hangs, so the observed defs are
    // exactly what the write's own patch left behind.
    let defsCalls = 0;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body });
      if (url.includes('/defs') && !url.includes('console.move-only')) {
        defsCalls += 1;
        if (defsCalls > 1) return new Promise<never>(() => {});
        return {
          ok: true,
          status: 200,
          json: async () => ({ defs: [REPO_DEF] }),
        };
      }
      if (url.includes('/defs'))
        return { ok: true, status: 200, json: async () => ({ defs: [] }) };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          rows: [],
          effective: {
            scope: 'team.repo',
            file: '/t-repo',
            value: { dev: { fixedPort: 3000 } },
          },
        }),
      };
    });
    const { result } = renderHook(() => useConsoleSettings(null));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.set('rt.roles', 'team', { dev: {} }, REPO);
    });
    expect(
      result.current.defs.find(d => d.key === 'rt.roles')!.effective
    ).toEqual(REPO_DEF.effective);
  });

  it('re-reads defs after a write without raising loading', async () => {
    const seen: boolean[] = [];
    const { result } = renderHook(() => {
      const store = useConsoleSettings(null);
      seen.push(store.loading);
      return store;
    });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const ours = () =>
      calls.filter(
        c =>
          c.url.startsWith('/api/settings/defs') &&
          !c.url.includes('console.move-only')
      ).length;
    const before = ours();
    const settled = seen.length;
    await act(async () => {
      await result.current.set('rt.logLevel', 'machine', 'info');
    });
    await waitFor(() => expect(ours()).toBe(before + 1));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(seen.slice(settled)).not.toContain(true);
  });
});

describe('useKeyExplain', () => {
  it('asks for the picked repo', async () => {
    const { result } = renderHook(() => useKeyExplain('rt.roles', REPO));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(calls.at(-1)!.url).toBe(
      `/api/settings/explain/rt.roles?repo=${encodeURIComponent(REPO)}`
    );
  });
});
