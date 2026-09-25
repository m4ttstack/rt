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

type RestCall = { method: string; path: string; body: unknown };

function harness(
  create: (input: any) => Promise<any>,
  opts: { writeback?: (repo: string, pp: string, pr: any) => void; restReply?: () => Promise<Response> } = {},
) {
  const inputs: any[] = [];
  const writebacks: any[] = [];
  const rest: RestCall[] = [];
  const handlers = createMRHandlers(fakeCtx(), () => {}, {
    getContext: async () => ({
      provider: {
        createPullRequest: async (input: any) => { inputs.push(input); return create(input); },
        restRequest: async (method: string, path: string, body: unknown) => {
          rest.push({ method, path, body });
          return opts.restReply ? opts.restReply() : new Response("{}", { status: 200 });
        },
      },
      projectPath: "g/p",
    }),
    writeback: opts.writeback ?? ((repo, pp, pr) => writebacks.push({ repo, pp, iid: pr.iid })),
  });
  return { handlers, inputs, writebacks, rest };
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

  test("the same-branch guard compares trimmed values", async () => {
    const { handlers, inputs } = harness(async () => { throw new Error("should not be called"); });
    const res = await handlers["mr:create"]({ ...base, sourceBranch: " feat ", targetBranch: "feat" });
    expect(res).toEqual({ ok: false, error: "sourceBranch and targetBranch are the same" });
    expect(inputs).toEqual([]);
  });

  test("sourceBranch, targetBranch and title are trimmed before reaching the provider", async () => {
    const { handlers, inputs } = harness(async () => ({ iid: 12, webUrl: "u" }));
    await handlers["mr:create"]({ ...base, sourceBranch: " feat", targetBranch: "main ", title: " Add thing " });
    expect(inputs[0]).toMatchObject({ sourceBranch: "feat", targetBranch: "main", title: "Add thing" });
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
    const { handlers } = harness(async () => ({ iid: 12, webUrl: null }), { writeback: () => { throw new Error("store boom"); } });
    const res = await handlers["mr:create"](base);
    expect(res).toEqual({ ok: true, data: { iid: 12, url: null } });
  });

  test("a provider error returns ok:false with its message", async () => {
    const { handlers } = harness(async () => { throw new Error("createPullRequest failed: 409 Another open merge request already exists"); });
    const res = await handlers["mr:create"](base);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("409");
  });

  test("labels pass through to glance trimmed; squash lands as one PUT after the create", async () => {
    const { handlers, inputs, rest } = harness(async () => ({ iid: 12, webUrl: "u" }));
    const res = await handlers["mr:create"]({ ...base, labels: [" needs-review", "team-a "], squash: true });
    expect(inputs[0]).toMatchObject({ labels: ["needs-review", "team-a"] });
    expect(rest).toEqual([{ method: "PUT", path: "/projects/g%2Fp/merge_requests/12", body: { squash: true } }]);
    expect(res).toEqual({ ok: true, data: { iid: 12, url: "u", squashApplied: true } });
  });

  test("squash: false is written too, and an omitted squash writes nothing", async () => {
    const off = harness(async () => ({ iid: 12, webUrl: "u" }));
    const res = await off.handlers["mr:create"]({ ...base, squash: false });
    expect(off.rest).toEqual([{ method: "PUT", path: "/projects/g%2Fp/merge_requests/12", body: { squash: false } }]);
    expect(res).toEqual({ ok: true, data: { iid: 12, url: "u", squashApplied: true } });

    const none = harness(async () => ({ iid: 12, webUrl: "u" }));
    const plain = await none.handlers["mr:create"](base);
    expect(none.rest).toEqual([]);
    expect(plain).toEqual({ ok: true, data: { iid: 12, url: "u" } });
    expect(none.inputs[0]).not.toHaveProperty("labels");
  });

  test("a squash write that fails after the create landed is still ok, with squashApplied false and the reason", async () => {
    const rejected = harness(async () => ({ iid: 12, webUrl: "u" }), {
      restReply: async () => new Response("insufficient scope", { status: 403, statusText: "Forbidden" }),
    });
    const res = await rejected.handlers["mr:create"]({ ...base, squash: true });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toMatchObject({ iid: 12, url: "u", squashApplied: false });
      expect(res.data.squashError).toContain("403");
    }

    const threw = harness(async () => ({ iid: 12, webUrl: "u" }), {
      restReply: async () => { throw new Error("socket hang up"); },
    });
    const res2 = await threw.handlers["mr:create"]({ ...base, squash: true });
    expect(res2.ok).toBe(true);
    if (res2.ok) expect(res2.data.squashError).toContain("socket hang up");
  });

  test("the read-back-failure path still attempts the squash write with the iid it has", async () => {
    const { handlers, rest } = harness(async () => {
      throw new ReadBackFailedError("Created MR but failed to fetch it back", {
        operation: "createPullRequest", projectPath: "g/p", iid: 12, writeApplied: true,
      });
    });
    const res = await handlers["mr:create"]({ ...base, squash: true });
    expect(rest).toEqual([{ method: "PUT", path: "/projects/g%2Fp/merge_requests/12", body: { squash: true } }]);
    expect(res).toEqual({ ok: true, data: { iid: 12, url: null, squashApplied: true } });
  });

  test("a blank label, a label with a comma, or a non-array is refused before the provider is called", async () => {
    const { handlers, inputs, rest } = harness(async () => { throw new Error("should not be called"); });
    for (const labels of [["ok", " "], ["a,b"], "a", [5]]) {
      expect(await handlers["mr:create"]({ ...base, labels })).toEqual({ ok: false, error: "invalid labels" });
    }
    expect(inputs).toEqual([]);
    expect(rest).toEqual([]);
  });

  test("labels: [] is a no-op: the create goes through with no labels field", async () => {
    const { handlers, inputs } = harness(async () => ({ iid: 12, webUrl: "u" }));
    const res = await handlers["mr:create"]({ ...base, labels: [] });
    expect(res).toEqual({ ok: true, data: { iid: 12, url: "u" } });
    expect(inputs[0]).not.toHaveProperty("labels");
  });

  test("a non-boolean squash is refused before the provider is called", async () => {
    const { handlers, inputs } = harness(async () => { throw new Error("should not be called"); });
    expect(await handlers["mr:create"]({ ...base, squash: "true" })).toEqual({ ok: false, error: "invalid squash" });
    expect(inputs).toEqual([]);
  });
});
