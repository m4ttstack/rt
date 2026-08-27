import { describe, expect, test } from 'vitest';
import { deriveDeckBase } from './deck-discovery';

describe('deriveDeckBase', () => {
  test('maps a *.mattstack origin to deck.mattstack', () => {
    expect(deriveDeckBase('https://chat.mattstack')).toBe(
      'https://deck.mattstack'
    );
  });

  test('maps a *.localhost origin to deck.localhost', () => {
    expect(deriveDeckBase('https://chat.localhost')).toBe(
      'https://deck.localhost'
    );
  });

  test('an override wins and its trailing slash is trimmed', () => {
    expect(deriveDeckBase('https://chat.mattstack', 'http://localhost:11007/')).toBe(
      'http://localhost:11007'
    );
  });

  test('an unrecognized origin with no override is null', () => {
    expect(deriveDeckBase('https://chat.m4tthew.dev')).toBeNull();
  });

  test('a non-URL origin is null, not a throw', () => {
    expect(deriveDeckBase('not a url')).toBeNull();
  });
});
