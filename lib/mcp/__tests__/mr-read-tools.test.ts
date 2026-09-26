import { describe, expect, test } from "bun:test";
import { mrReadToolDefs, type MrReadDeps } from "../mr-read-tools.ts";

const pr = (iid: number, state: string, branch = `b${iid}`) => ({ iid, state, sourceBranch: branch, title: `t${iid}`, pipeline: { status: "success", id: "gitlab:pipeline:9" } });

function fake(overrides: Partial<MrReadDeps> = {}): { deps: MrReadDeps; calls: string[] } {
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
            c: { pr: pr(3, "draft"), fetchedAt: 3 },
          },
          listSyncedAt: 3,
          source: "poll",
          syncedAt: 3,
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
  });
  test("mr_list defaults to opened (draft included) and honors state all", async () => {
    const { deps } = fake();
    const opened = await tool(deps, "mr_list").handler({ repoName: ID }, {} as NodeJS.ProcessEnv);
    const all = await tool(deps, "mr_list").handler({ repoName: ID, state: "all" }, {} as NodeJS.ProcessEnv);
    expect((opened.body as any).mrs.map((m: any) => m.iid)).toEqual([1, 3]);
    expect((all.body as any).mrs.map((m: any) => m.iid)).toEqual([1, 2, 3]);
  });
  test("mr_list state opened includes an open draft MR", async () => {
    const { deps } = fake();
    const res = await tool(deps, "mr_list").handler({ repoName: ID, state: "opened" }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).mrs.map((m: any) => m.state)).toEqual(["opened", "draft"]);
  });
  test("mr_list state merged filters exactly", async () => {
    const { deps } = fake();
    const res = await tool(deps, "mr_list").handler({ repoName: ID, state: "merged" }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).mrs.map((m: any) => m.iid)).toEqual([2]);
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
