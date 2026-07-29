import { describe, expect, test } from "bun:test";
import { SnapshotCache, type FetchResult } from "../cache.ts";

/** Wrap a bare mrs array as the FetchResult shape SnapshotCache expects. */
function fetchResult(mrs: unknown[]): FetchResult {
  return { mrs: mrs as FetchResult["mrs"], dataSyncedAt: null, scopeUncovered: [], scopeWindowDays: null };
}

describe("SnapshotCache forced-refresh failure", () => {
  // The incident: during a daemon-side outage the user mashed refresh. Each
  // forced refresh nulled the snapshot before fetching, so the failure path
  // (which falls back to the previous snapshot) had nothing to fall back to
  // and returned an empty board with a fresh-looking fetchedAt instead of
  // stale-data-plus-banner.
  test("keeps the previous MRs, sets fetchError, and does not fake freshness", async () => {
    let fail = false;
    let t = 1000;
    const cache = new SnapshotCache(
      async () => {
        if (fail) throw new Error("project sync failed: gitlab timeout");
        return fetchResult([{ iid: 1 } as any]);
      },
      () => t,
    );
    await cache.forceRefresh(); // seed a good snapshot at t=1000

    fail = true;
    t = 2000;
    const snap = await cache.forceRefresh(); // failing forced refresh

    expect(snap.mrs).toEqual([{ iid: 1 }] as any); // stale beats empty
    expect(snap.fetchError).toContain("gitlab timeout");
    expect(snap.fetchedAt).toBe(1000); // no fresh-looking timestamp over stale data
  });
});
