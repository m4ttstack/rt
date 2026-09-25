import { configure } from '@testing-library/react';
import { vi } from 'vitest';

// CI runs the jsdom suites four-way parallel on a 4 vCPU runner, each with
// its own vitest workers, so a test that takes a second alone can take four.
// The defaults (5s per test, 1s per waitFor) were tuned for an idle machine.
const TEST_TIMEOUT_MS = 30_000;
const ASYNC_UTIL_TIMEOUT_MS = 10_000;

export function installTestTimeBudget() {
  vi.setConfig({ testTimeout: TEST_TIMEOUT_MS, hookTimeout: TEST_TIMEOUT_MS });
  configure({ asyncUtilTimeout: ASYNC_UTIL_TIMEOUT_MS });
}
