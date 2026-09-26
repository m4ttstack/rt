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
      // A rejected predicate can throw anything, not just an Error (a raw
      // string, a provider SDK's own error object, ...); falling back to
      // String() instead of dropping non-Error values keeps the timeout
      // message from silently discarding the one piece of evidence that
      // explains why the poll never succeeded.
      const because =
        lastError === undefined
          ? ''
          : `, last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`;
      throw new Error(`pollUntil("${label}") timed out after ${timeoutMs}ms${because}`);
    }
    await Bun.sleep(intervalMs);
  }
}
