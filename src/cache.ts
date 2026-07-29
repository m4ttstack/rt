import type { Snapshot } from "./data.ts";

const TTL_MS = 60_000;

/** What one fetch produces: everything the snapshot carries except the
    cache's own bookkeeping fields (fetchedAt, fetchError). */
export type FetchResult = Omit<Snapshot, "fetchedAt" | "fetchError">;

/**
 * Single-snapshot stale-while-revalidate cache.
 *
 * Within TTL: serve the snapshot. Past TTL (or once markStale() flags a config
 * change): serve the stale snapshot immediately and kick exactly one background
 * refresh (concurrent visitors share it). A failed refresh keeps the last good
 * data and stamps the error.
 *
 * Only invalidate() ever makes a reader wait, and only because the manual
 * refresh asked to.
 */
export class SnapshotCache {
  private snapshot: Snapshot | null = null;
  private inflight: Promise<Snapshot> | null = null;
  /** Set by markStale(): the snapshot is known-outdated but still worth serving. */
  private stale = false;
  /** Bumped on every markStale(), so a refetch that started before a change can
      be recognised as already-outdated when it lands. */
  private generation = 0;

  constructor(
    private readonly fetchMRs: () => Promise<FetchResult>,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = TTL_MS,
  ) {}

  /**
   * Drop the cached snapshot so the next get() refetches from scratch — and
   * blocks until it lands. For "I'll wait for fresh data" (the manual refresh).
   * To pick up a config change, prefer markStale(): dropping the snapshot leaves
   * readers with nothing to serve, turning a refetch into a stall for everyone.
   */
  invalidate(): void {
    this.snapshot = null;
  }

  /**
   * Manual refresh: drop the snapshot and fetch anew, never sharing a fetch
   * that started before the request — its data predates the user's click.
   * Waits out any in-flight fetch first, so the fresh fetch (and anything it
   * consumes, like the server's force flag) runs strictly after this call.
   */
  async forceRefresh(): Promise<Snapshot> {
    this.snapshot = null;
    if (this.inflight) await this.inflight.catch(() => {});
    return this.refresh();
  }

  /**
   * Force the next get() to revalidate while still serving the current snapshot.
   * Config changed: the data is outdated, but stale data beats making every
   * reader wait out a full refetch.
   */
  markStale(): void {
    this.stale = true;
    this.generation++;
  }

  async get(): Promise<Snapshot> {
    if (!this.stale && this.snapshot && this.now() - this.snapshot.fetchedAt < this.ttlMs) {
      return this.snapshot;
    }
    const refresh = this.refresh();
    if (this.snapshot) {
      // Stale data beats waiting; refresh continues in the background.
      refresh.catch(() => {});
      return this.snapshot;
    }
    return refresh;
  }

  /**
   * Revalidate now and resolve when data lands — the relay-push path (an rt
   * event says the store changed; refetch, then nudge browsers). Shares any
   * in-flight fetch; the generation guard keeps `stale` set if that fetch
   * started before this call, so the next get() finishes the job.
   */
  async refreshNow(): Promise<Snapshot> {
    this.markStale();
    return this.refresh();
  }

  private refresh(): Promise<Snapshot> {
    if (this.inflight) return this.inflight;
    // A markStale() landing mid-fetch means this fetch read the pre-change
    // config, so its result can't clear the flag — the next get() starts a
    // new fetch rather than trusting data that's already outdated.
    const gen = this.generation;
    const settle = (snapshot: Snapshot): Snapshot => {
      this.snapshot = snapshot;
      if (gen === this.generation) this.stale = false;
      return snapshot;
    };
    this.inflight = this.fetchMRs()
      .then((result) => settle({ ...result, fetchedAt: this.now(), fetchError: null }))
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`refresh failed: ${message}`);
        return settle(
          this.snapshot
            ? { ...this.snapshot, fetchError: message }
            : { mrs: [], fetchedAt: this.now(), fetchError: message, dataSyncedAt: null, scopeUncovered: [], scopeWindowDays: null },
        );
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
}
