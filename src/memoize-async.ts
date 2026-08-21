/** Memoizes an async loader with asymmetric caching: a success is pinned
    forever (an env-set token or a daemon secret that answered once doesn't
    change mid-process), but a failure is cached only for `ttlMs` -- daemon
    down, gate-refused, and genuinely-not-configured are indistinguishable at
    this layer, and ALL of them must expire, or a daemon that was down at
    boot (routine: every `rt daemon restart`/upgrade) stays wedged dead for
    the rest of the process instead of picking the token back up once the
    daemon returns. Concurrent calls while a load is in flight share the one
    in-flight promise regardless of the eventual outcome, so a burst of
    callers during a cold daemon round trip never fans out into N separate
    round trips. */
export function memoizeAsync<T>(
  load: () => Promise<T>,
  isFailure: (value: T) => boolean,
  opts: { ttlMs?: number; now?: () => number } = {},
): () => Promise<T> {
  const ttlMs = opts.ttlMs ?? 60_000;
  const now = opts.now ?? Date.now;
  let cached: Promise<T> | undefined;
  let expiresAt = 0;

  return () => {
    const t = now();
    if (cached && t < expiresAt) return cached;
    const pending = load();
    cached = pending;
    // Provisional, so a second call arriving before `pending` settles still
    // hits the cache above and shares this same in-flight promise, instead
    // of racing a second `load()`.
    expiresAt = t + ttlMs;
    pending
      .then((value) => { expiresAt = isFailure(value) ? now() + ttlMs : Infinity; })
      .catch(() => { expiresAt = now() + ttlMs; });
    return pending;
  };
}
