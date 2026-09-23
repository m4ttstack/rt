import { describe, expect, test } from 'vitest';

import {
  hasLocalOrigin,
  isLocalRequest,
  type LocalServer,
} from './local-request';

const req = (headers: Record<string, string>) =>
  new Request('http://127.0.0.1:7930/x', { headers });

const peer = (address: string | null): LocalServer => ({
  requestIP: () => (address === null ? null : { address }),
});

describe('host', () => {
  test.each([
    'localhost',
    'localhost:7930',
    '127.0.0.1',
    '127.0.0.1:7930',
    '[::1]:7930',
    '[::1]',
    'board.localhost',
    'board.mattstack',
    'Board.Mattstack:443',
  ])('%s is local', host => {
    expect(isLocalRequest(req({ host }))).toBe(true);
  });

  test.each([
    'board.example.dev',
    'mattstack',
    'evil-localhost',
    'board.mattstack.example.dev',
    '10.0.0.5',
    '127.0.0.2',
  ])('%s is not local', host => {
    expect(isLocalRequest(req({ host }))).toBe(false);
  });

  test('a missing host is not local', () => {
    expect(isLocalRequest(req({}))).toBe(false);
  });

  test('a public x-forwarded-host hop makes a local host non-local', () => {
    expect(
      isLocalRequest(
        req({
          host: 'board.mattstack',
          'x-forwarded-host': 'board.example.dev',
        })
      )
    ).toBe(false);
  });

  test('a local x-forwarded-host list keeps the request local', () => {
    expect(
      isLocalRequest(
        req({
          host: '127.0.0.1:7930',
          'x-forwarded-host': 'board.localhost:443, 127.0.0.1',
        })
      )
    ).toBe(true);
  });

  test('a local x-forwarded-host never rescues a public host', () => {
    expect(
      isLocalRequest(
        req({ host: 'deck.example.dev', 'x-forwarded-host': 'deck.mattstack' })
      )
    ).toBe(false);
  });
});

describe('socket peer', () => {
  test.each(['127.0.0.1', '127.8.9.10', '::1', '::ffff:127.0.0.1'])(
    'a %s peer is local',
    address => {
      expect(isLocalRequest(req({ host: 'localhost' }), peer(address))).toBe(
        true
      );
    }
  );

  test.each(['192.168.1.20', '100.64.0.7', '::ffff:10.0.0.1', 'fe80::1'])(
    'a %s peer is not local',
    address => {
      expect(isLocalRequest(req({ host: 'localhost' }), peer(address))).toBe(
        false
      );
    }
  );

  test('an unknown peer is not local', () => {
    expect(isLocalRequest(req({ host: 'localhost' }), peer(null))).toBe(false);
  });
});

describe('x-forwarded-for', () => {
  test('loopback hops stay local', () => {
    expect(
      isLocalRequest(
        req({ host: 'board.mattstack', 'x-forwarded-for': '127.0.0.1, ::1' })
      )
    ).toBe(true);
  });

  test('any non-loopback hop is not local', () => {
    expect(
      isLocalRequest(
        req({
          host: 'board.localhost',
          'x-forwarded-for': '203.0.113.9, 127.0.0.1',
        })
      )
    ).toBe(false);
  });

  test('a garbage hop is not local', () => {
    expect(
      isLocalRequest(
        req({ host: 'board.localhost', 'x-forwarded-for': 'unknown' })
      )
    ).toBe(false);
  });
});

describe('edge markers', () => {
  test.each([
    ['cf-connecting-ip', '203.0.113.9'],
    ['tailscale-funnel-request', '?1'],
    ['x-mattstack-edge', 'public'],
  ])('a %s header is not local', (name, value) => {
    expect(isLocalRequest(req({ host: 'localhost', [name]: value }))).toBe(
      false
    );
  });
});

describe('hasLocalOrigin', () => {
  test('no Origin header passes: CLI and daemon callers never send one', () => {
    expect(hasLocalOrigin(req({ host: 'localhost' }))).toBe(true);
  });

  test.each([
    ['https://deck.mattstack', 'deck.mattstack'],
    ['HTTPS://DECK.MATTSTACK', 'deck.mattstack'],
    ['https://deck.mattstack:443', 'deck.mattstack'],
    ['https://board.localhost', 'board.localhost:443'],
    ['http://127.0.0.1:11007', '127.0.0.1:11007'],
    ['http://[::1]:7930', '[::1]:7930'],
    ['http://localhost:5173', 'localhost:5173'],
  ])('%s on host %s passes', (origin, host) => {
    expect(hasLocalOrigin(req({ origin, host }))).toBe(true);
  });

  test.each([
    ['https://evil.example.dev', 'deck.mattstack'],
    ['https://deck.mattstack.example.dev', 'deck.mattstack'],
    ['https://evil.localhost', 'deck.mattstack'],
    ['http://localhost:5173', 'deck.mattstack'],
    ['http://deck.mattstack:5173', 'deck.mattstack'],
    ['https://deck.mattstack', 'deck.mattstack:7930'],
    ['http://127.0.0.1:5173', '127.0.0.1:11007'],
    ['https://deck.mattstack.', 'deck.mattstack'],
    ['https://evil.example.dev', 'evil.example.dev'],
    ['null', 'deck.mattstack'],
    ['', 'deck.mattstack'],
    ['file:///tmp/x.html', 'deck.mattstack'],
    ['not a url', 'deck.mattstack'],
  ])('%s on host %s fails', (origin, host) => {
    expect(hasLocalOrigin(req({ origin, host }))).toBe(false);
  });

  test('an Origin with no Host to compare against fails', () => {
    expect(hasLocalOrigin(req({ origin: 'https://deck.mattstack' }))).toBe(
      false
    );
  });
});
