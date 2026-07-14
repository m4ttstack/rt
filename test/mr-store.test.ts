import { describe, expect, it } from "vitest";

import { getCachedMrKeys, mrKey, putMrDetails } from "../server/cache/mr-store.js";
import { mr } from "./fixtures.js";

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
