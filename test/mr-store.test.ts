import { describe, expect, it } from "vitest";

import { getCachedMrKeys, mrKey, putMrDetails } from "../server/cache/mr-store.js";
import { refreshFromList } from "../server/gitlab/map.js";
import { mr } from "./fixtures.js";
import type { NormMr } from "../server/pipeline/model.js";

describe("getCachedMrKeys", () => {
  it("reuses only merged MRs from cache; non-terminal ones must be re-fetched", async () => {
    // A merged MR is immutable ... safe to serve from the store. An open MR still
    // changes (title, state, diff, mergedAt), so a cached copy goes stale the moment
    // it merges. Treating it as cached freezes that stale draft forever (the ACME-2229 bug).
    const merged = mr({ iid: 1, authorUsername: "alice", title: "shipped", state: "merged", projectPath: "org/app" });
    const draft = mr({ iid: 2, authorUsername: "alice", title: "Draft: wip", state: "opened", projectPath: "org/app" });
    await putMrDetails([merged, draft]);

    const keys = await getCachedMrKeys([
      { projectPath: "org/app", iid: 1 },
      { projectPath: "org/app", iid: 2 },
    ]);

    expect(keys.has(mrKey("org/app", 1))).toBe(true);
    expect(keys.has(mrKey("org/app", 2))).toBe(false);
  });
});

describe("refreshFromList", () => {
  // Store records are permanent; the list node is re-fetched every scan. updatedAt keeps
  // moving on merged MRs (comments, labels), and records written before the field existed
  // lack it entirely -- Date.parse(undefined) is NaN, so sliceOutcome drops the MR and every
  // Linear ticket linked through it (the 80-to-3 issuesCompleted regression).
  it("overlays the fresh list node's updatedAt onto a store-hydrated record", () => {
    const stored = mr({ iid: 1, authorUsername: "alice", title: "shipped", updatedAt: "2026-05-01T00:00:00.000Z" });
    const fresh = mr({ iid: 1, authorUsername: "alice", title: "shipped", updatedAt: "2026-06-15T12:00:00.000Z" });

    const hydrated = refreshFromList(stored, fresh);

    expect(hydrated.updatedAt).toBe("2026-06-15T12:00:00.000Z");
    // Detail fields stay from the store -- that is the whole point of the store.
    expect(hydrated.notes).toBe(stored.notes);
  });

  it("repairs a legacy store record that predates the updatedAt field", () => {
    const legacy = { ...mr({ iid: 2, authorUsername: "alice", title: "old" }) } as Partial<NormMr>;
    delete legacy.updatedAt;
    const fresh = mr({ iid: 2, authorUsername: "alice", title: "old", updatedAt: "2026-06-20T00:00:00.000Z" });

    const hydrated = refreshFromList(legacy as NormMr, fresh);

    expect(hydrated.updatedAt).toBe("2026-06-20T00:00:00.000Z");
  });
});
