import { describe, expect, test } from "bun:test";
import { mrReadToolDefs, type MrReadDeps } from "../mr-read-tools.ts";

const pr = (iid: number, state: string, draft = false) => ({ iid, state, draft, sourceBranch: `b${iid}`, title: `t${iid}`, pipeline: { status: "success", id: "gitlab:pipeline:9" } });

function fake(overrides: Partial<MrReadDeps> = {}, data: Record<string, unknown> = {}): { deps: MrReadDeps; calls: string[] } {
  const calls: string[] = [];
  const deps: MrReadDeps = {
    projectMrs: async (repo, maxAgeMs) => {
      calls.push(`mrs:${repo}:${maxAgeMs ?? ""}`);
      return {
        ok: true,
        data: {
          mrs: {
            a: { pr: pr(1, "opened"), fetchedAt: 1 },
            b: { pr: pr(2, "merged"), fetchedAt: 2 },
            c: { pr: pr(3, "opened", true), fetchedAt: 3 },
            d: { pr: pr(4, "closed"), fetchedAt: 4 },
          },
          listSyncedAt: 3,
          source: "poll",
          syncedAt: 3,
          ...data,
        },
      } as any;
    },
    discussions: async (repo, iid) => { calls.push(`disc:${repo}:${iid}`); return { ok: true, data: { discussions: [], fetchedAt: 1 } } as any; },
    byBranch: async (repo, branches) => { calls.push(`branch:${repo}:${branches.join(",")}`); return { ok: true, data: { byBranch: {}, syncedAt: 1 } } as any; },
    command: (async (name: string) => { calls.push(`cmd:${name}`); return { ok: true, data: name === "mr:fetch-job-trace" ? "log text" : { id: 7 } }; }) as any,
    ...overrides,
  };
  return { deps, calls };
}
const tool = (deps: MrReadDeps, name: string) => mrReadToolDefs(deps).find((t) => t.name === name)!;
// Targeting is exercised in mr-target.test.ts; here every call passes an identity so resolveMrTarget succeeds without a registry.
const ID = "remote:gitlab.com%2Facme%2Facme-dev";

describe("mr read tools", () => {
  test("mr_view returns the one MR whose iid matches", async () => {
    const { deps, calls } = fake();
    const res = await tool(deps, "mr_view").handler({ repoName: ID, iid: 2, maxAgeMs: 5000 }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(true);
    expect((res.body as any).mr.iid).toBe(2);
    expect(calls).toEqual([`mrs:${ID}:5000`]);
  });
  test("mr_view on an unknown iid errors naming it and the daemon's open-MR cache", async () => {
    const { deps } = fake();
    const res = await tool(deps, "mr_view").handler({ repoName: ID, iid: 9 }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("no MR !9 in the daemon's open-MR cache for");
    expect(res.error).toContain("certain authors and a time window");
  });
  test("mr_view on a never-synced cache says so and suggests a small maxAgeMs", async () => {
    const { deps } = fake({}, { mrs: {}, syncedAt: 0 });
    const res = await tool(deps, "mr_view").handler({ repoName: ID, iid: 9 }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("no MR !9 in the daemon's open-MR cache for");
    expect(res.error).toContain("never synced");
    expect(res.error).toContain("maxAgeMs");
    expect(res.error).not.toContain("certain authors");
  });
  test("mr_view and mr_list pass the daemon's scope and syncError through", async () => {
    const scope = { authors: ["alice"], windowDays: 14, uncovered: [] };
    const syncError = { since: 1, lastAt: 2, kind: "rate-limited", message: "429" };
    const { deps } = fake({}, { scope, syncError });
    const view = await tool(deps, "mr_view").handler({ repoName: ID, iid: 1 }, {} as NodeJS.ProcessEnv);
    const list = await tool(deps, "mr_list").handler({ repoName: ID }, {} as NodeJS.ProcessEnv);
    expect(view.body).toMatchObject({ scope, syncError });
    expect(list.body).toMatchObject({ scope, syncError });
  });
  test("mr_view and mr_list omit scope and syncError when the daemon sent none", async () => {
    const { deps } = fake();
    const view = await tool(deps, "mr_view").handler({ repoName: ID, iid: 1 }, {} as NodeJS.ProcessEnv);
    const list = await tool(deps, "mr_list").handler({ repoName: ID }, {} as NodeJS.ProcessEnv);
    for (const body of [view.body as object, list.body as object]) {
      expect("scope" in body).toBe(false);
      expect("syncError" in body).toBe(false);
    }
  });
  test("mr_list on a never-synced cache is an empty ok list carrying syncedAt 0", async () => {
    const { deps } = fake({}, { mrs: {}, syncedAt: 0 });
    const res = await tool(deps, "mr_list").handler({ repoName: ID }, {} as NodeJS.ProcessEnv);
    expect(res).toEqual({ ok: true, body: { mrs: [], syncedAt: 0 } });
  });
  test("mr_view, mr_list and mr_pipeline refuse a negative maxAgeMs before any daemon call", async () => {
    const { deps, calls } = fake();
    for (const name of ["mr_view", "mr_list", "mr_pipeline"]) {
      const res = await tool(deps, name).handler({ repoName: ID, iid: 1, maxAgeMs: -1 }, {} as NodeJS.ProcessEnv);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('"maxAgeMs" must be a non-negative number');
    }
    expect(calls).toEqual([]);
  });
  test("mr_list defaults to opened (draft included) and honors state all", async () => {
    const { deps } = fake();
    const opened = await tool(deps, "mr_list").handler({ repoName: ID }, {} as NodeJS.ProcessEnv);
    const all = await tool(deps, "mr_list").handler({ repoName: ID, state: "all" }, {} as NodeJS.ProcessEnv);
    expect((opened.body as any).mrs.map((m: any) => m.iid)).toEqual([1, 3]);
    expect((all.body as any).mrs.map((m: any) => m.iid)).toEqual([1, 2, 3, 4]);
  });
  test("mr_list state opened includes an open draft MR, marked by draft: true", async () => {
    const { deps } = fake();
    const res = await tool(deps, "mr_list").handler({ repoName: ID, state: "opened" }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).mrs.map((m: any) => [m.iid, m.state, m.draft])).toEqual([[1, "opened", false], [3, "opened", true]]);
  });
  test("mr_list state merged filters exactly", async () => {
    const { deps } = fake();
    const res = await tool(deps, "mr_list").handler({ repoName: ID, state: "merged" }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).mrs.map((m: any) => m.iid)).toEqual([2]);
  });
  test("mr_list state closed filters exactly", async () => {
    const { deps } = fake();
    const res = await tool(deps, "mr_list").handler({ repoName: ID, state: "closed" }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).mrs.map((m: any) => m.iid)).toEqual([4]);
  });
  test("mr_for_branch passes the branches through", async () => {
    const { deps, calls } = fake();
    await tool(deps, "mr_for_branch").handler({ repoName: ID, branches: ["x", "y"] }, {} as NodeJS.ProcessEnv);
    expect(calls).toEqual([`branch:${ID}:x,y`]);
  });
  test("mr_threads refreshes first only when asked", async () => {
    const { deps, calls } = fake();
    await tool(deps, "mr_threads").handler({ repoName: ID, iid: 1 }, {} as NodeJS.ProcessEnv);
    await tool(deps, "mr_threads").handler({ repoName: ID, iid: 1, refresh: true }, {} as NodeJS.ProcessEnv);
    expect(calls).toEqual([`disc:${ID}:1`, "cmd:discussions:refresh", `disc:${ID}:1`]);
  });
  test("mr_pipeline reads live by default and adds job detail for a jobId", async () => {
    const { deps, calls } = fake();
    const res = await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).pipeline.status).toBe("success");
    expect((res.body as any).job).toEqual({ id: 7 });
    expect(calls).toEqual([`mrs:${ID}:5000`, "cmd:mr:fetch-job-detail"]);
  });
  test("mr_pipeline on an unknown iid errors naming it and the daemon's open-MR cache", async () => {
    const { deps } = fake();
    const res = await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 9 }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("no MR !9 in the daemon's open-MR cache for");
  });
  test("mr_job_trace returns the trace text", async () => {
    const { deps } = fake();
    const res = await tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
    expect(res.body).toEqual({ trace: "log text" });
  });
  test("mr_job_trace refuses a non-positive jobId", async () => {
    const { deps, calls } = fake();
    const res = await tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 0 }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
