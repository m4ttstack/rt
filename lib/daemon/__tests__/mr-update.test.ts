/**
 * mr:update: title/description through glance (draft state survives),
 * add/remove labels and squash in one REST PUT, glance first; a partial
 * failure names what landed so a retry can carry only the rest.
 */
import { describe, expect, test } from "bun:test";
import { ReadBackFailedError } from "@mattstack/glance";
import { createMRHandlers } from "../handlers/mr.ts";
import { fakeStore } from "./fake-cache-store.ts";

const REPO = "remote:gitlab.com%2Fg%2Fp";
const URL = "https://gitlab.example.com/g/p/-/merge_requests/7";
const fakeCtx = () => ({
  cache: fakeStore({}),
  repoIndex: () => ({ [REPO]: "/tmp/repo" }),
  log: { warn() {}, info() {}, debug() {}, error() {} } as any,
});
const base = { repoName: REPO, iid: 7 };
const prOf = (iid: number) => ({ iid, webUrl: URL, title: "t" }) as any;

function harness(opts: {
  update?: (projectPath: string, iid: number, input: any) => Promise<any>;
  restReply?: () => Promise<Response>;
  fetchSingle?: () => Promise<any>;
  writeback?: (repo: string, pp: string, pr: any) => void;
} = {}) {
  const seq: string[] = [];
  const updates: any[] = [];
  const rest: Array<{ method: string; path: string; body: unknown }> = [];
  const writebacks: any[] = [];
  const singles: number[] = [];
  const handlers = createMRHandlers(fakeCtx(), () => {}, {
    getContext: async () => ({
      provider: {
        baseURL: "https://gitlab.example.com",
        updatePullRequest: async (pp: string, iid: number, input: any) => {
          seq.push("glance");
          updates.push(input);
          return opts.update ? opts.update(pp, iid, input) : prOf(iid);
        },
        restRequest: async (method: string, path: string, body: unknown) => {
          seq.push("rest");
          rest.push({ method, path, body });
          return opts.restReply ? opts.restReply() : new Response("{}", { status: 200 });
        },
      },
      projectPath: "g/p",
    }),
    writeback: opts.writeback ?? ((repo, pp, pr) => writebacks.push({ repo, pp, iid: pr.iid })),
    fetchSingle: async (_p, _pp, iid) => { singles.push(iid); return opts.fetchSingle ? opts.fetchSingle() : prOf(iid); },
  });
  return { handlers, seq, updates, rest, writebacks, singles };
}

describe("mr:update", () => {
  test("title alone goes through glance, writes the returned PR back, and reports applied", async () => {
    const h = harness();
    const res = await h.handlers["mr:update"]({ ...base, title: " New title " });
    expect(h.updates).toEqual([{ title: "New title" }]);
    expect(h.rest).toEqual([]);
    expect(h.writebacks).toEqual([{ repo: REPO, pp: "g/p", iid: 7 }]);
    expect(h.singles).toEqual([]);
    expect(res).toEqual({ ok: true, data: { iid: 7, url: URL, applied: ["title"] } });
  });

  test("description alone goes through glance", async () => {
    const h = harness();
    await h.handlers["mr:update"]({ ...base, description: "why" });
    expect(h.updates).toEqual([{ description: "why" }]);
    expect(h.rest).toEqual([]);
  });

  test("labels and squash go in one PUT, with add and remove never replace, then one follow-up fetch for write-back", async () => {
    const h = harness();
    const res = await h.handlers["mr:update"]({ ...base, addLabels: [" a", "b "], removeLabels: ["c"], squash: true });
    expect(h.updates).toEqual([]);
    expect(h.rest).toEqual([{ method: "PUT", path: "/projects/g%2Fp/merge_requests/7", body: { add_labels: "a,b", remove_labels: "c", squash: true } }]);
    expect(h.singles).toEqual([7]);
    expect(h.writebacks.length).toBe(1);
    expect(res).toEqual({ ok: true, data: { iid: 7, url: URL, applied: ["addLabels", "removeLabels", "squash"] } });
  });

  test("with both groups, glance runs first and the REST write second", async () => {
    const h = harness();
    const res = await h.handlers["mr:update"]({ ...base, title: "T", squash: false });
    expect(h.seq).toEqual(["glance", "rest"]);
    expect(h.rest[0]!.body).toEqual({ squash: false });
    expect(res).toEqual({ ok: true, data: { iid: 7, url: URL, applied: ["title", "squash"] } });
  });

  test("a REST failure after glance landed is ok:false naming what landed and what did not", async () => {
    const h = harness({ restReply: async () => new Response("nope", { status: 403, statusText: "Forbidden" }) });
    const res = await h.handlers["mr:update"]({ ...base, title: "T", addLabels: ["a"], squash: true });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("title landed");
      expect(res.error).toContain("addLabels/squash did not");
      expect(res.error).toContain("403");
      expect(res.error).toContain("retrying with only the failed fields is safe");
    }
  });

  test("a glance failure stops before the REST write and says so", async () => {
    const h = harness({ update: async () => { throw new Error("updatePullRequest failed: 409"); } });
    const res = await h.handlers["mr:update"]({ ...base, title: "T", squash: true });
    expect(h.rest).toEqual([]);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("title did not land");
      expect(res.error).toContain("409");
      expect(res.error).toContain("squash not attempted");
    }
  });

  test("a glance read-back failure with writeApplied counts as landed and the REST write still runs", async () => {
    const h = harness({
      update: async () => {
        throw new ReadBackFailedError("Updated MR but failed to fetch it back", {
          operation: "updatePullRequest", projectPath: "g/p", iid: 7, writeApplied: true,
        });
      },
    });
    const res = await h.handlers["mr:update"]({ ...base, title: "T", squash: true });
    expect(h.rest.length).toBe(1);
    expect(h.singles).toEqual([7]);
    expect(res).toEqual({ ok: true, data: { iid: 7, url: URL, applied: ["title", "squash"] } });
  });

  test("empty label arrays are no-ops beside a real field: nothing is sent for them", async () => {
    const h = harness();
    const res = await h.handlers["mr:update"]({ ...base, title: "T", addLabels: [], removeLabels: [] });
    expect(h.updates).toEqual([{ title: "T" }]);
    expect(h.rest).toEqual([]);
    expect(res).toEqual({ ok: true, data: { iid: 7, url: URL, applied: ["title"] } });
  });

  test("a write-back or follow-up throw never fails a landed update", async () => {
    const thrown = harness({ writeback: () => { throw new Error("store boom"); } });
    expect((await thrown.handlers["mr:update"]({ ...base, title: "T" })).ok).toBe(true);
    const fetchBroke = harness({ fetchSingle: async () => { throw new Error("fetch broke"); } });
    expect((await fetchBroke.handlers["mr:update"]({ ...base, squash: true })).ok).toBe(true);
  });

  test("refusals happen before any provider call", async () => {
    const h = harness({ update: async () => { throw new Error("should not be called"); } });
    expect(await h.handlers["mr:update"]({ ...base })).toEqual({ ok: false, error: "nothing to update" });
    expect(await h.handlers["mr:update"]({ ...base, title: "  " })).toEqual({ ok: false, error: "invalid title" });
    expect(await h.handlers["mr:update"]({ ...base, description: 5 })).toEqual({ ok: false, error: "invalid description" });
    expect(await h.handlers["mr:update"]({ ...base, addLabels: ["a,b"] })).toEqual({ ok: false, error: "invalid addLabels" });
    expect(await h.handlers["mr:update"]({ ...base, removeLabels: [" "] })).toEqual({ ok: false, error: "invalid removeLabels" });
    expect(await h.handlers["mr:update"]({ ...base, addLabels: [], removeLabels: [] })).toEqual({ ok: false, error: "nothing to update" });
    expect(await h.handlers["mr:update"]({ ...base, squash: "true" })).toEqual({ ok: false, error: "invalid squash" });
    expect(await h.handlers["mr:update"]({ repoName: REPO, iid: 0, title: "T" })).toEqual({ ok: false, error: "missing repoName/iid" });
    expect(await h.handlers["mr:update"]({ repoName: REPO, iid: 1.5, title: "T" })).toEqual({ ok: false, error: "missing repoName/iid" });
    expect(await h.handlers["mr:update"]({ repoName: "remote:gitlab.com%2Fother%2Fx", iid: 7, title: "T" })).toEqual({ ok: false, error: "repo-unknown" });
    expect(h.updates).toEqual([]);
    expect(h.rest).toEqual([]);
  });
});
