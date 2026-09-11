import { expect, test } from 'vitest';

import { canonicalHostRedirect } from './canonical-host';

const req = (headers: Record<string, string>, path = '/x?y=1') =>
  new Request(`http://127.0.0.1:11006${path}`, { headers });

test('a .localhost host is sent to the canonical host, path and query intact', () => {
  const res = canonicalHostRedirect(
    req({ 'x-forwarded-host': 'board.localhost' }),
    'board.mattstack'
  );
  expect(res?.status).toBe(302);
  expect(res?.headers.get('location')).toBe('https://board.mattstack/x?y=1');
});

test('x-forwarded-host wins over the rewritten Host, port and list suffix stripped', () => {
  const res = canonicalHostRedirect(
    req({
      host: '127.0.0.1:11006',
      'x-forwarded-host': 'board.localhost:443, 127.0.0.1',
    }),
    'board.mattstack'
  );
  expect(res?.headers.get('location')).toBe('https://board.mattstack/x?y=1');
});

test('the canonical host, a public domain, and a bare loopback pass through', () => {
  for (const host of [
    'board.mattstack',
    'board.example.dev',
    '127.0.0.1:11006',
  ]) {
    expect(
      canonicalHostRedirect(
        req({ 'x-forwarded-host': host }),
        'board.mattstack'
      )
    ).toBeNull();
  }
});

test('no canonical host configured means no redirect', () => {
  expect(
    canonicalHostRedirect(
      req({ 'x-forwarded-host': 'board.localhost' }),
      undefined
    )
  ).toBeNull();
});

test('websocket upgrades are never redirected', () => {
  expect(
    canonicalHostRedirect(
      req({ 'x-forwarded-host': 'board.localhost', upgrade: 'websocket' }),
      'board.mattstack'
    )
  ).toBeNull();
});
