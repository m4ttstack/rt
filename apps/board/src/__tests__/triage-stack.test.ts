import { describe, expect, test } from "bun:test";
import { chainOf } from "../triage/stack.ts";
import type { OwnMrFacts } from "../triage/edge.ts";

function mr(over: Partial<OwnMrFacts> = {}): OwnMrFacts {
  return {
    mrUrl: "https://x/mr/1", iid: 1, pipelineId: 1, pipelineState: "passed",
    needsRebase: false, author: "matt",
    sourceBranch: "b1", targetBranch: "master", isStacked: false,
    ...over,
  };
}

describe("chainOf", () => {
  test("an MR that targets the default branch has no ancestors and nothing unresolved", () => {
    const solo = mr();
    expect(chainOf([solo], solo.mrUrl)).toEqual({ ancestors: [], unresolvedParentBranch: null });
  });

  test("links child to parent by targetBranch === parent.sourceBranch", () => {
    const parent = mr({ mrUrl: "https://x/mr/1", iid: 1, sourceBranch: "p" });
    const child = mr({ mrUrl: "https://x/mr/2", iid: 2, sourceBranch: "c", targetBranch: "p", isStacked: true });
    const chain = chainOf([child, parent], child.mrUrl);
    expect(chain.ancestors.map((a) => a.iid)).toEqual([1]);
    expect(chain.unresolvedParentBranch).toBeNull();
  });

  test("walks a three-deep stack nearest-parent-first", () => {
    const a = mr({ mrUrl: "https://x/mr/1", iid: 1, sourceBranch: "a" });
    const b = mr({ mrUrl: "https://x/mr/2", iid: 2, sourceBranch: "b", targetBranch: "a", isStacked: true });
    const c = mr({ mrUrl: "https://x/mr/3", iid: 3, sourceBranch: "c", targetBranch: "b", isStacked: true });
    expect(chainOf([a, b, c], c.mrUrl).ancestors.map((x) => x.iid)).toEqual([2, 1]);
  });

  test("a stacked MR whose parent is outside the board window reports the unresolved branch", () => {
    const orphan = mr({ mrUrl: "https://x/mr/2", iid: 2, sourceBranch: "c", targetBranch: "invisible-parent", isStacked: true });
    expect(chainOf([orphan], orphan.mrUrl)).toEqual({ ancestors: [], unresolvedParentBranch: "invisible-parent" });
  });

  test("a partly visible chain reports the frontier's unresolved parent, not the child's", () => {
    const mid = mr({ mrUrl: "https://x/mr/2", iid: 2, sourceBranch: "b", targetBranch: "invisible-root", isStacked: true });
    const leaf = mr({ mrUrl: "https://x/mr/3", iid: 3, sourceBranch: "c", targetBranch: "b", isStacked: true });
    const chain = chainOf([mid, leaf], leaf.mrUrl);
    expect(chain.ancestors.map((x) => x.iid)).toEqual([2]);
    expect(chain.unresolvedParentBranch).toBe("invisible-root");
  });

  test("a branch cycle terminates instead of hanging the cron", () => {
    const a = mr({ mrUrl: "https://x/mr/1", iid: 1, sourceBranch: "a", targetBranch: "b", isStacked: true });
    const b = mr({ mrUrl: "https://x/mr/2", iid: 2, sourceBranch: "b", targetBranch: "a", isStacked: true });
    expect(chainOf([a, b], a.mrUrl).ancestors.map((x) => x.iid)).toEqual([2]);
  });

  test("an identical branch name in a different project never links a stack", () => {
    const other = mr({ mrUrl: "https://gitlab.com/other/repo/-/merge_requests/1", iid: 1, sourceBranch: "p" });
    const child = mr({ mrUrl: "https://gitlab.example.com/acme/webapp/-/merge_requests/2", iid: 2, sourceBranch: "c", targetBranch: "p", isStacked: true });
    const chain = chainOf([other, child], child.mrUrl);
    expect(chain.ancestors).toEqual([]);
    expect(chain.unresolvedParentBranch).toBe("p");
  });

  test("an unknown mrUrl yields an empty chain", () => {
    expect(chainOf([mr()], "https://x/mr/999")).toEqual({ ancestors: [], unresolvedParentBranch: null });
  });
});
