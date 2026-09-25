import { describe, expect, test } from "bun:test";
import { ReadBackFailedError } from "@mattstack/glance";
import { createMRHandlers } from "../handlers/mr.ts";
import { fakeStore } from "./fake-cache-store.ts";

const REPO = "remote:gitlab.com%2Fg%2Fp";
const fakeCtx = () => ({
  cache: fakeStore({}),
  repoIndex: () => ({ [REPO]: "/tmp/repo" }),
  log: { warn() {}, info() {}, debug() {}, error() {} } as any,
});
const base = { repoName: REPO, sourceBranch: "feat", targetBranch: "main", title: "Add thing" };

function harness(create: (input: any) => Promise<any>, writeback?: (repo: string, pp: string, pr: any) => void) {
  const inputs: any[] = [];
  const writebacks: any[] = [];
  const handlers = createMRHandlers(fakeCtx(), () => {}, {
    getContext: async () => ({
      provider: { createPullRequest: async (input: any) => { inputs.push(input); return create(input); } },
      projectPath: "g/p",
    }),
    writeback: writeback ?? ((repo, pp, pr) => writebacks.push({ repo, pp, iid: pr.iid })),
  });
  return { handlers, inputs, writebacks };
}

describe("mr:create", () => {
  test("defaults to draft, writes the MR back, and returns iid and url", async () => {
    const { handlers, inputs, writebacks } = harness(async () => ({ iid: 12, webUrl: "https://gitlab.com/g/p/-/merge_requests/12" }));
    const res = await handlers["mr:create"](base);
    expect(inputs).toEqual([{ projectPath: "g/p", title: "Add thing", sourceBranch: "feat", targetBranch: "main", draft: true }]);
    expect(writebacks).toEqual([{ repo: REPO, pp: "g/p", iid: 12 }]);
    expect(res).toEqual({ ok: true, data: { iid: 12, url: "https://gitlab.com/g/p/-/merge_requests/12" } });
  });

  test("draft:false and a description pass straight through", async () => {
    const { handlers, inputs } = harness(async () => ({ iid: 3, webUrl: null }));
    await handlers["mr:create"]({ ...base, draft: false, description: "why" });
    expect(inputs[0]).toMatchObject({ draft: false, description: "why" });
  });

  test("a missing or whitespace-only title or branch is refused before the provider is called", async () => {
    const { handlers, inputs } = harness(async () => { throw new Error("should not be called"); });
    for (const bad of [{ title: undefined }, { title: "  " }, { sourceBranch: "" }, { targetBranch: " " }]) {
      const res = await handlers["mr:create"]({ ...base, ...bad });
      expect(res).toEqual({ ok: false, error: "missing repoName/sourceBranch/targetBranch/title" });
    }
    expect(inputs).toEqual([]);
  });

  test("the same source and target branch is refused", async () => {
    const { handlers, inputs } = harness(async () => { throw new Error("should not be called"); });
    const res = await handlers["mr:create"]({ ...base, targetBranch: "feat" });
    expect(res).toEqual({ ok: false, error: "sourceBranch and targetBranch are the same" });
    expect(inputs).toEqual([]);
  });

  test("a non-boolean draft or non-string description is refused", async () => {
    const { handlers, inputs } = harness(async () => { throw new Error("should not be called"); });
    expect(await handlers["mr:create"]({ ...base, draft: "false" })).toEqual({ ok: false, error: "invalid draft" });
    expect(await handlers["mr:create"]({ ...base, description: 5 })).toEqual({ ok: false, error: "invalid description" });
    expect(inputs).toEqual([]);
  });

  test("a repo absent from the index is repo-unknown", async () => {
    const { handlers } = harness(async () => { throw new Error("should not be called"); });
    const res = await handlers["mr:create"]({ ...base, repoName: "remote:gitlab.com%2Fother%2Fx" });
    expect(res).toEqual({ ok: false, error: "repo-unknown" });
  });

  test("a read-back failure after the MR landed returns ok with the created iid", async () => {
    const { handlers, writebacks } = harness(async () => {
      throw new ReadBackFailedError("Created MR but failed to fetch it back", {
        operation: "createPullRequest", projectPath: "g/p", iid: 12, writeApplied: true,
      });
    });
    const res = await handlers["mr:create"](base);
    expect(res).toEqual({ ok: true, data: { iid: 12, url: null } });
    expect(writebacks).toEqual([]);
  });

  test("a write-back throw does not fail a created MR", async () => {
    const { handlers } = harness(async () => ({ iid: 12, webUrl: null }), () => { throw new Error("store boom"); });
    const res = await handlers["mr:create"](base);
    expect(res).toEqual({ ok: true, data: { iid: 12, url: null } });
  });

  test("a provider error returns ok:false with its message", async () => {
    const { handlers } = harness(async () => { throw new Error("createPullRequest failed: 409 Another open merge request already exists"); });
    const res = await handlers["mr:create"](base);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("409");
  });
});
