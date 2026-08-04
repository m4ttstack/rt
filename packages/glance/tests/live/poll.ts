/**
 * Wait for an eventually-consistent read.
 *
 * A rejected predicate is treated as "not yet" rather than fatal: GitHub
 * answers 502 under load often enough that one transient failure must not
 * end a run that has already created branches needing cleanup.
 */
export async function pollUntil<T>(
  label: string,
  fn: () => Promise<T | null>,
  opts: { timeoutMs?: number; intervalMs?: number } = {}
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const intervalMs = opts.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  for (;;) {
    try {
      const value = await fn();
      if (value !== null && value !== undefined) return value;
    } catch (err) {
      lastError = err;
    }
    if (Date.now() >= deadline) {
      const because =
        lastError instanceof Error ? `, last error: ${lastError.message}` : '';
      throw new Error(`pollUntil("${label}") timed out after ${timeoutMs}ms${because}`);
    }
    await Bun.sleep(intervalMs);
  }
}
