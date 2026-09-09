function isBusyError(err: unknown): boolean {
  const code = (err as { code?: string } | undefined)?.code;
  return code === 'SQLITE_BUSY' || (typeof code === 'string' && code.startsWith('SQLITE_BUSY_'));
}

export function persistOrWarn(label: string, fn: () => void): void {
  try {
    fn();
  } catch (err) {
    if (isBusyError(err)) {
      console.error(`${label}: write skipped (db busy)`);
      return;
    }
    throw err;
  }
}

const CRITICAL_RETRY_ATTEMPTS = 3;
const CRITICAL_RETRY_SLEEP_MS = 50;

export function runCriticalWrite(label: string, fn: () => void): void {
  for (let attempt = 1; attempt <= CRITICAL_RETRY_ATTEMPTS; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (!isBusyError(err)) throw err;
      if (attempt === CRITICAL_RETRY_ATTEMPTS) {
        console.error(`${label}: write failed after ${CRITICAL_RETRY_ATTEMPTS} attempts`);
        throw err;
      }
      Bun.sleepSync(CRITICAL_RETRY_SLEEP_MS);
    }
  }
}
