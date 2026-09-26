import { describe, expect, it, vi } from 'vitest';

import { shellHandoff } from './shell-handoff';

const SOCK = '/dev/null'; // exists on every mac/linux box; existence gate passes
const docReq = (
  over: Record<string, string> = {},
  url = 'https://chat.mattstack/room/9?x=1'
) =>
  new Request(url, {
    headers: {
      host: '127.0.0.1:11002',
      'x-forwarded-host': 'chat.mattstack',
      'sec-fetch-dest': 'document',
      'user-agent': 'Mozilla/5.0 Chrome/130',
      ...over,
    },
  });
const deps = (handled: boolean) => {
  const post = vi.fn(async () => handled);
  return { post, sockPath: SOCK };
};

describe('shellHandoff', () => {
  it('hands off a top-level document GET and serves the stub', async () => {
    const d = deps(true);
    const res = await shellHandoff(docReq(), d);
    expect(res?.status).toBe(200);
    expect(await res!.text()).toContain('opened in mattstack');
    expect(d.post).toHaveBeenCalledWith(
      SOCK,
      'https://chat.mattstack/room/9?x=1',
      300
    );
  });
  it('serves normally when the tray declines', async () => {
    expect(await shellHandoff(docReq(), deps(false))).toBeNull();
  });
  it('ignores the shell webview UA', async () => {
    const d = deps(true);
    expect(
      await shellHandoff(
        docReq({ 'user-agent': 'Mozilla/5.0 mattstack-shell/2.7.0' }),
        d
      )
    ).toBeNull();
    expect(d.post).not.toHaveBeenCalled();
  });
  it('ignores non-document fetches (assets, XHR)', async () => {
    expect(
      await shellHandoff(docReq({ 'sec-fetch-dest': 'image' }), deps(true))
    ).toBeNull();
  });
  it('falls back to Accept when Sec-Fetch-Dest is absent', async () => {
    const req = new Request('https://chat.mattstack/', {
      headers: {
        'x-forwarded-host': 'chat.mattstack',
        accept: 'text/html,*/*',
        'user-agent': 'x',
      },
    });
    expect((await shellHandoff(req, deps(true)))?.status).toBe(200);
  });
  it('ignores non-mattstack hosts (tunnel traffic)', async () => {
    expect(
      await shellHandoff(
        docReq({ 'x-forwarded-host': 'chat.m4tthew.dev' }),
        deps(true)
      )
    ).toBeNull();
  });
  it('honors the escape hatches', async () => {
    expect(
      await shellHandoff(
        docReq({}, 'https://chat.mattstack/?browser=1'),
        deps(true)
      )
    ).toBeNull();
    expect(
      await shellHandoff(
        docReq({ cookie: 'a=b; mattstack_browser=1' }),
        deps(true)
      )
    ).toBeNull();
  });
  it('ignores non-GET and upgrades', async () => {
    const post = new Request('https://chat.mattstack/', { method: 'POST' });
    expect(await shellHandoff(post, deps(true))).toBeNull();
    expect(
      await shellHandoff(docReq({ upgrade: 'websocket' }), deps(true))
    ).toBeNull();
  });
  it('serves normally when the socket does not exist', async () => {
    const d = { ...deps(true), sockPath: '/nonexistent/tray.sock' };
    expect(await shellHandoff(docReq(), d)).toBeNull();
    expect(d.post).not.toHaveBeenCalled();
  });
});
