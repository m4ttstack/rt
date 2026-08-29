import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchAll } from "../server/pipeline/fetch.js";
import { getMrByKey, mrKey } from "../server/cache/mr-store.js";
import type { Env } from "../server/env.js";
import type { Scope, TimeWindow } from "../shared/types.js";

const ENV: Env = { baseUrl: "https://gl.example", token: "tkn", port: 0 };
const WINDOW: TimeWindow = {
  start: "2026-05-01T00:00:00.000Z",
  end: "2026-05-31T00:00:00.000Z",
  key: "custom",
};

afterEach(() => vi.unstubAllGlobals());

/** A merged MR list node authored by alice, inside the window. */
const listNode = (iid: number, projectPath: string) => ({
  iid,
  title: `MR ${iid}`,
  state: "merged",
  createdAt: "2026-05-10T00:00:00.000Z",
  updatedAt: "2026-05-12T00:00:00.000Z",
  mergedAt: "2026-05-12T00:00:00.000Z",
  author: { username: "alice" },
  project: { fullPath: projectPath },
  sourceBranch: "feat/x",
});

const detailFor = (iid: number) => ({
  description: `body ${iid}`,
  diffStatsSummary: { additions: iid * 10, deletions: 1, fileCount: 2 },
  diffStats: [{ path: "a.ts", additions: iid * 10, deletions: 1 }],
  labels: { nodes: [] },
  approvedBy: { nodes: [] },
  notes: { nodes: [] },
});

interface StubOpts {
  projectPath: string;
  iids: number[];
  /** Called with the MR iid whose detail is being requested; return a canned response. */
  onDetail: (iid: number, call: number) => Response;
}

/** Stub the whole fetchAll surface: REST lookups plus the two GraphQL phases. */
function stubGitLab({ projectPath, iids, onDetail }: StubOpts) {
  let detailCalls = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url.includes("/api/graphql")) {
      const body = String(init?.body ?? "");
      if (body.includes("MrDetail")) {
        detailCalls += 1;
        const iid = Number(JSON.parse(body).variables.iid);
        return onDetail(iid, detailCalls);
      }
      return Response.json({
        data: {
          project: {
            mergeRequests: {
              nodes: iids.map((iid) => listNode(iid, projectPath)),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      });
    }
    if (url.includes("/users?")) return Response.json([{ id: 1, username: "alice", name: "Alice" }]);
    if (url.includes("/projects/")) return Response.json({ id: 99 });
    return Response.json([]);
  });
}

const run = (scope: Scope, signal?: AbortSignal) =>
  fetchAll({ env: ENV, scope, window: WINDOW, users: ["alice"], concurrency: 1, signal });

describe("MR detail persistence", () => {
  it("banks details already fetched when the run is cancelled partway", async () => {
    // The 133/134 hang: one stalled request held the phase open until the job's 10-minute
    // abort, which then discarded all 133 details the run had successfully fetched.
    const projectPath = "org/persist-abort";
    const controller = new AbortController();
    stubGitLab({
      projectPath,
      iids: [101, 102, 103],
      onDetail: (iid, call) => {
        if (call === 2) {
          controller.abort();
          const err = new Error("aborted");
          err.name = "AbortError";
          throw err;
        }
        return Response.json({ data: { project: { mergeRequest: detailFor(iid) } } });
      },
    });

    await expect(
      run({ type: "projects", projectPaths: [projectPath] }, controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });

    const first = await getMrByKey(mrKey(projectPath, 101));
    expect(first?.additions).toBe(1010);
  });

  it("does not store an MR whose detail never came back", async () => {
    // A zeroed record for a merged MR is permanent: getCachedMrKeys serves merged MRs from
    // the store, so caching the failure freezes empty diff/notes in for good.
    const projectPath = "org/persist-null";
    stubGitLab({
      projectPath,
      iids: [201, 202],
      onDetail: (iid) =>
        iid === 202
          ? Response.json({ data: { project: { mergeRequest: null } } })
          : Response.json({ data: { project: { mergeRequest: detailFor(iid) } } }),
    });

    const { result } = await run({ type: "projects", projectPaths: [projectPath] });

    expect(await getMrByKey(mrKey(projectPath, 201))).not.toBeNull();
    expect(await getMrByKey(mrKey(projectPath, 202))).toBeNull();
    // It still counts toward this run's data, just without detail fields.
    expect(result.mrs.find((m) => m.iid === 202)?.additions).toBe(0);
  });
});
