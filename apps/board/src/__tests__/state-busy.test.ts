import { describe, expect, test } from 'bun:test';

import { persistOrWarn, runCriticalWrite } from '../state/busy.ts';

function busyError(): Error {
  const err = new Error('database is locked');
  (err as Error & { code: string }).code = 'SQLITE_BUSY';
  return err;
}

describe('persistOrWarn', () => {
  test('a busy error is swallowed', () => {
    expect(() =>
      persistOrWarn('t', () => {
        throw busyError();
      })
    ).not.toThrow();
  });

  test('a non-busy error rethrows', () => {
    expect(() =>
      persistOrWarn('t', () => {
        throw new Error('constraint failed');
      })
    ).toThrow('constraint failed');
  });

  test('a clean write runs once', () => {
    let calls = 0;
    persistOrWarn('t', () => {
      calls++;
    });
    expect(calls).toBe(1);
  });
});

describe('runCriticalWrite', () => {
  test('retries a busy error and succeeds on a later attempt', () => {
    let calls = 0;
    runCriticalWrite('t', () => {
      calls++;
      if (calls < 3) throw busyError();
    });
    expect(calls).toBe(3);
  });

  test('rethrows the busy error after the final attempt', () => {
    let calls = 0;
    expect(() =>
      runCriticalWrite('t', () => {
        calls++;
        throw busyError();
      })
    ).toThrow('database is locked');
    expect(calls).toBe(3);
  });

  test('a non-busy error rethrows immediately with no retry', () => {
    let calls = 0;
    expect(() =>
      runCriticalWrite('t', () => {
        calls++;
        throw new Error('constraint failed');
      })
    ).toThrow('constraint failed');
    expect(calls).toBe(1);
  });

  test('the SQLITE_BUSY_ prefixed family also retries', () => {
    let calls = 0;
    runCriticalWrite('t', () => {
      calls++;
      if (calls === 1) {
        const err = new Error('snapshot');
        (err as Error & { code: string }).code = 'SQLITE_BUSY_SNAPSHOT';
        throw err;
      }
    });
    expect(calls).toBe(2);
  });
});
