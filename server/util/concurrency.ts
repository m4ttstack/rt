/**
 * Minimal concurrency limiter (no dependency). Runs at most `limit` tasks at once.
 * Used to be polite to GitLab's rate limits when fanning out REST calls.
 */
export function pLimit(limit: number) {
  if (limit < 1) throw new Error("concurrency limit must be >= 1");
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= limit) return;
    const run = queue.shift();
    if (run) {
      active++;
      run();
    }
  };

  return function schedule<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      };
      queue.push(run);
      next();
    });
  };
}

/** Map `items` through `fn` with a concurrency cap, preserving order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const schedule = pLimit(limit);
  return Promise.all(items.map((item, i) => schedule(() => fn(item, i))));
}
