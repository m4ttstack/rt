import { describe, expect, test } from "bun:test";
import { mrReadToolDefs, tailTrace, type MrReadDeps } from "../mr-read-tools.ts";

const pr = (iid: number, state: string, draft = false) => ({
  iid, state, draft, sourceBranch: `b${iid}`, targetBranch: "main", title: `t${iid}`, description: "long body",
  author: { id: "gitlab:1", username: "alice", name: "Alice", avatarUrl: null },
  webUrl: `https://gitlab.com/acme/acme-dev/-/merge_requests/${iid}`, detailedMergeStatus: "mergeable",
  pipeline: { status: "success", id: "gitlab:pipeline:9", jobs: [] },
});

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
    command: (async (name: string) => { calls.push(`cmd:${name}`); return { ok: true, data: name === "mr:fetch-job-trace" ? "log text" : { type: "trace", content: "full log" } }; }) as any,
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
  test("mr_list returns a summary per MR, not the full MR", async () => {
    const { deps } = fake();
    const res = await tool(deps, "mr_list").handler({ repoName: ID }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).mrs[0]).toEqual({
      iid: 1, title: "t1", state: "opened", draft: false, sourceBranch: "b1", targetBranch: "main", author: "alice",
      webUrl: "https://gitlab.com/acme/acme-dev/-/merge_requests/1", pipelineStatus: "success", detailedMergeStatus: "mergeable",
    });
  });
  test("mr_list gives a null pipelineStatus for an MR with no pipeline", async () => {
    const { deps } = fake({}, { mrs: { a: { pr: { ...pr(1, "opened"), pipeline: null }, fetchedAt: 1 } } });
    const res = await tool(deps, "mr_list").handler({ repoName: ID }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).mrs[0].pipelineStatus).toBeNull();
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
  test("mr_pipeline reads live by default and replaces a trace job's log with a pointer to mr_job_trace", async () => {
    const { deps, calls } = fake();
    const res = await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).pipeline.status).toBe("success");
    expect((res.body as any).job).toEqual({ type: "trace", traceVia: "mr_job_trace" });
    expect(JSON.stringify(res.body)).not.toContain("full log");
    expect(calls).toEqual([`mrs:${ID}:5000`, "cmd:mr:fetch-job-detail"]);
  });
  test("mr_pipeline passes a bridge job's detail through unchanged", async () => {
    const bridge = { type: "bridge", downstreamPipeline: { id: "gitlab:pipeline:10", status: "failed", createdAt: null, webUrl: null, jobs: [] } };
    const { deps } = fake({ command: (async () => ({ ok: true, data: bridge })) as any });
    const res = await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
    expect((res.body as any).job).toEqual(bridge);
  });
  test("mr_pipeline sends the head pipeline's numeric id as pipelineId", async () => {
    const payloads: unknown[] = [];
    const { deps } = fake({ command: (async (_name: string, payload: unknown) => { payloads.push(payload); return { ok: true, data: { type: "trace", content: "" } }; }) as any });
    await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
    expect(payloads).toEqual([{ repoName: ID, iid: 1, jobId: 7, pipelineId: 9 }]);
  });
  test("mr_pipeline omits pipelineId when the MR has no pipeline or a non-numeric id", async () => {
    for (const pipeline of [null, { status: "success", id: "gitlab:pipeline:abc", jobs: [] }]) {
      const payloads: unknown[] = [];
      const { deps } = fake(
        { command: (async (_name: string, payload: unknown) => { payloads.push(payload); return { ok: true, data: { type: "trace", content: "" } }; }) as any },
        { mrs: { a: { pr: { ...pr(1, "opened"), pipeline }, fetchedAt: 1 } } },
      );
      await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
      expect(payloads).toEqual([{ repoName: ID, iid: 1, jobId: 7 }]);
    }
  });
  test("mr_pipeline and mr_job_trace descriptions say jobId is not checked against the MR", () => {
    const { deps } = fake();
    for (const name of ["mr_pipeline", "mr_job_trace"]) {
      expect(tool(deps, name).description).toContain("may name any job in the MR's project");
    }
  });
  test("mr_pipeline on an unknown iid errors naming it and the daemon's open-MR cache", async () => {
    const { deps } = fake();
    const res = await tool(deps, "mr_pipeline").handler({ repoName: ID, iid: 9 }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("no MR !9 in the daemon's open-MR cache for");
  });
  test("mr_job_trace returns the trace text with its line count", async () => {
    const { deps } = fake();
    const res = await tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv);
    expect(res.body).toEqual({ trace: "log text", truncated: false, totalLines: 1 });
  });
  test("mr_job_trace keeps the last tailLines lines, default 200, and strips ANSI sequences", async () => {
    const raw = Array.from({ length: 250 }, (_, i) => `\x1b[32;1mline ${i}\x1b[0m`).join("\n") + "\n";
    const { deps } = fake({ command: (async () => ({ ok: true, data: raw })) as any });
    const byDefault = (await tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 7 }, {} as NodeJS.ProcessEnv)).body as any;
    expect(byDefault.totalLines).toBe(250);
    expect(byDefault.truncated).toBe(true);
    expect(byDefault.trace.split("\n")).toHaveLength(200);
    expect(byDefault.trace.startsWith("line 50\n")).toBe(true);
    expect(byDefault.trace).not.toContain("\x1b");
    const three = (await tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 7, tailLines: 3 }, {} as NodeJS.ProcessEnv)).body as any;
    expect(three).toEqual({ trace: "line 247\nline 248\nline 249", truncated: true, totalLines: 250 });
  });
  test("mr_job_trace caps the kept lines at 64 KiB from the end on a whole character", () => {
    const line = "é".repeat(1000);
    const out = tailTrace(Array.from({ length: 100 }, () => line).join("\n"), 200);
    expect(out.truncated).toBe(true);
    expect(out.totalLines).toBe(100);
    expect(Buffer.byteLength(out.trace, "utf8")).toBeLessThanOrEqual(64 * 1024);
    expect(out.trace).not.toContain("�");
    expect(out.trace.endsWith(line)).toBe(true);
  });
  test("mr_job_trace refuses a non-positive or fractional tailLines before any daemon call", async () => {
    const { deps, calls } = fake();
    for (const tailLines of [0, -5, 2.5, "10"]) {
      const res = await tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 7, tailLines }, {} as NodeJS.ProcessEnv);
      expect(res.error).toBe('"tailLines" must be a positive integer');
    }
    expect(calls).toEqual([]);
  });
  test("mr_job_trace refuses a non-positive jobId", async () => {
    const { deps, calls } = fake();
    const res = await tool(deps, "mr_job_trace").handler({ repoName: ID, iid: 1, jobId: 0 }, {} as NodeJS.ProcessEnv);
    expect(res.ok).toBe(false);
    expect(calls).toEqual([]);
  });
});
