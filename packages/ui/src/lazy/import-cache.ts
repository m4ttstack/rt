/**
 * A plain module-level Map that dedupes in-flight/settled `loader()` calls
 * by `key`, so multiple call sites asking for the same dynamic import (or
 * any other async load) share one underlying promise instead of each
 * kicking off their own fetch.
 *
 * A rejected load is evicted from the cache (the `.catch` below removes its
 * entry before rethrowing) so the *next* call with that key re-invokes
 * `loader` instead of replaying the same rejection forever -- important for
 * a flaky chunk load (network blip) that should be retryable on the next
 * mount, unlike a successful load, which stays cached indefinitely.
 *
 * Replaces the kind of dedup a data-fetching library's cache hook provides
 * (e.g. a `queryKey`/`queryFn`-shaped query cache) with this dependency-free
 * equivalent.
 */
const cache = new Map<string, Promise<unknown>>();

export function loadOnce<T>(key: string, loader: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) {
    cache.set(
      key,
      loader().catch(err => {
        cache.delete(key);
        throw err;
      })
    );
  }
  return cache.get(key) as Promise<T>;
}
