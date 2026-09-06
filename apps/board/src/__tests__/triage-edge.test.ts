import { describe, expect, test } from "bun:test";
import { emptyMrMemory, type DispatchMemory } from "../triage/memory.ts";
import { detectEdges, markHandled, observe, type OwnMrFacts } from "../triage/edge.ts";

const DAY = "2026-08-08";
const mr = (over: Partial<OwnMrFacts> = {}): OwnMrFacts => ({
  mrUrl: "https://x/mr/1", iid: 1, pipelineId: 100, pipelineState: "failed", needsRebase: false, author: "matt", sourceBranch: "feat", targetBranch: "master", isStacked: false, ...over,
});
const fresh = (): DispatchMemory => ({ identity: null, mrs: {} });

describe("edge detection", () => {
  test("a failed pipeline with an unhandled id is a pipeline-red edge", () => {
    const mem = fresh();
    observe(mem, [mr()], DAY);
    expect(detectEdges(mem, [mr()])).toEqual([{ mrUrl: "https://x/mr/1", iid: 1, kind: "pipeline-red", pipelineId: 100, author: "matt" }]);
  });

  test("a handled pipeline id does not re-fire; a NEW failed pipeline does", () => {
    const mem = fresh();
    observe(mem, [mr()], DAY);
    markHandled(mem, { mrUrl: "https://x/mr/1", iid: 1, kind: "pipeline-red", pipelineId: 100, author: "matt" });
    expect(detectEdges(mem, [mr()])).toEqual([]);
    expect(detectEdges(mem, [mr({ pipelineId: 101 })])).toHaveLength(1);
  });

  test("needs-rebase fires on the flip, not while it stays true; re-arms when clean", () => {
    const mem = fresh();
    const conflicted = mr({ pipelineState: "passed", needsRebase: true });
    observe(mem, [conflicted], DAY);
    expect(detectEdges(mem, [conflicted])).toEqual([{ mrUrl: "https://x/mr/1", iid: 1, kind: "needs-rebase", pipelineId: 100, author: "matt" }]);
    markHandled(mem, { mrUrl: "https://x/mr/1", iid: 1, kind: "needs-rebase", pipelineId: 100, author: "matt" });
    expect(detectEdges(mem, [conflicted])).toEqual([]);           // handled, still true: quiet
    observe(mem, [mr({ pipelineState: "passed" })], DAY);          // clean observation re-arms
    observe(mem, [conflicted], DAY);
    expect(detectEdges(mem, [conflicted])).toHaveLength(1);        // fresh flip fires again
  });

  test("running/passed/none pipelines and null ids emit nothing", () => {
    const mem = fresh();
    const quiet = [mr({ pipelineState: "running" }), mr({ mrUrl: "https://x/mr/2", iid: 2, pipelineState: "failed", pipelineId: null })];
    observe(mem, quiet, DAY);
    expect(detectEdges(mem, quiet)).toEqual([]);
  });

  test("author carries through from facts onto the edge (MAT-351 gate needs it)", () => {
    const mem = fresh();
    const theirs = mr({ author: "teammate" });
    observe(mem, [theirs], DAY);
    expect(detectEdges(mem, [theirs])[0]!.author).toBe("teammate");
  });
});
