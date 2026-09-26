import { expect, test } from 'bun:test';

import { localhostRedirect } from './localhost-redirect.ts';

const url = new URL('http://127.0.0.1:7940/api/v1/status?x=1');

test('deck.localhost is sent to deck.mattstack, path and query intact', () => {
  const res = localhostRedirect('deck.localhost', url, 'deck.mattstack');
  expect(res?.status).toBe(302);
  expect(res?.headers.get('location')).toBe(
    'https://deck.mattstack/api/v1/status?x=1'
  );
});

test('a port suffix and a forwarded-host list are stripped before the check', () => {
  const res = localhostRedirect(
    'deck.localhost:443, 127.0.0.1',
    url,
    'deck.mattstack'
  );
  expect(res?.headers.get('location')).toBe(
    'https://deck.mattstack/api/v1/status?x=1'
  );
});

test('the canonical host, a public domain, loopback, and a missing host pass through', () => {
  for (const host of [
    'deck.mattstack',
    'deck.example.dev',
    '127.0.0.1:7940',
    undefined,
  ]) {
    expect(localhostRedirect(host, url, 'deck.mattstack')).toBeNull();
  }
});
