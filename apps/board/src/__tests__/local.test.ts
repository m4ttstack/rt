import { describe, expect, test } from 'bun:test';

import { isJsonMediaType } from '../local.ts';

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
