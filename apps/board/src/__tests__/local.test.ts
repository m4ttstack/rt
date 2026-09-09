import { describe, expect, test } from 'bun:test';

import { isJsonMediaType, isLocalRequest } from '../local.ts';

function reqWithHost(host: string | null): Request {
  const headers = new Headers();
  if (host !== null) headers.set('host', host);
  return new Request('http://x/data.json', { headers });
}

describe('isLocalRequest', () => {
  test('localhost host is local', () => {
    expect(isLocalRequest(reqWithHost('localhost:7930'))).toBe(true);
  });
  test('*.localhost host is local', () => {
    expect(isLocalRequest(reqWithHost('board.localhost'))).toBe(true);
  });
  test("*.mattstack host is local — the deck's brand TLD resolves only on this machine", () => {
    expect(isLocalRequest(reqWithHost('board.mattstack'))).toBe(true);
  });
  test('127.0.0.1 host is local', () => {
    expect(isLocalRequest(reqWithHost('127.0.0.1:7930'))).toBe(true);
  });
  test('public tunnel host is NOT local', () => {
    expect(isLocalRequest(reqWithHost('board.example.com'))).toBe(false);
  });
  test('missing host is NOT local', () => {
    expect(isLocalRequest(reqWithHost(null))).toBe(false);
  });
});

describe('isJsonMediaType', () => {
  test('accepts application/json, with or without parameters or casing', () => {
    expect(isJsonMediaType('application/json')).toBe(true);
    expect(isJsonMediaType('application/json; charset=utf-8')).toBe(true);
    expect(isJsonMediaType('Application/JSON')).toBe(true);
  });

  test('rejects a json-mentioning parameter on a simple-request type', () => {
    expect(isJsonMediaType('text/plain;foo=application/json')).toBe(false);
  });

  test('rejects the simple-request types and an absent header', () => {
    expect(isJsonMediaType('text/plain')).toBe(false);
    expect(isJsonMediaType('application/x-www-form-urlencoded')).toBe(false);
    expect(isJsonMediaType(null)).toBe(false);
  });
});
