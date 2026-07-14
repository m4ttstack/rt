import type { BoardMR, Snapshot } from "./data.ts";

const TTL_MS = 60_000;

/**
 * Single-snapshot stale-while-revalidate cache.
 *
 * Within TTL: serve the snapshot. Past TTL: serve the stale snapshot
 * immediately and kick exactly one background refresh (concurrent visitors
 * share it). A failed refresh keeps the last good data and stamps the error.
 */
export class SnapshotCache {
  private snapshot: Snapshot | null = null;
  private inflight: Promise<Snapshot> | null = null;

  constructor(
    private readonly fetchMRs: () => Promise<BoardMR[]>,
    private readonly now: () => number = Date.now,
    private readonly ttlMs: number = TTL_MS,
  ) {}

  /** Drop the cached snapshot so the next get() refetches from scratch. */
  invalidate(): void {
    this.snapshot = null;
  }

  async get(): Promise<Snapshot> {
    if (this.snapshot && this.now() - this.snapshot.fetchedAt < this.ttlMs) {
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

  private refresh(): Promise<Snapshot> {
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchMRs()
      .then((mrs) => {
        this.snapshot = { mrs, fetchedAt: this.now(), fetchError: null };
        return this.snapshot;
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`refresh failed: ${message}`);
        if (this.snapshot) {
          this.snapshot = { ...this.snapshot, fetchError: message };
          return this.snapshot;
        }
        this.snapshot = { mrs: [], fetchedAt: this.now(), fetchError: message };
        return this.snapshot;
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
}
